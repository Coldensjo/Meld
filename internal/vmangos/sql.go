// Package vmangos writes map data for a VMaNGOS server: spawn edits as SQL for its world database,
// and the map patch the 1.12 client loads (see install.go).
package vmangos

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// RespawnSeconds is the respawn time given to spawns the editor adds.
const RespawnSeconds = 300

// MaxGameMap is the highest map ID the server has; higher IDs are the editor's own.
const MaxGameMap = 99999

// Kind is what a spawn is: an NPC (creature table) or a game object.
type Kind int

const (
	Creature Kind = iota
	GameObject
)

// Spawn is one NPC or game object on a map, in the server's coordinates.
type Spawn struct {
	Kind       Kind
	GUID       int
	Entry      int
	Name       string
	Map        int
	X, Y, Z, O float64
	// Rotation is the game object's rotation quaternion. Nil means the facing O, turned about Z.
	Rotation *[4]float64
	// Scale is the editor's scale. VMaNGOS takes scale from the template, so a change is reported.
	Scale float64
	// RespawnMin and RespawnMax are the respawn time's range in seconds; zero for the default.
	RespawnMin, RespawnMax int
	// The creature's movement: MovementType 0 idle, 1 random within WanderDistance, 2 waypoints.
	MovementType   int
	WanderDistance float64
	// The creature's creature_addon fields: its display (0 for the template's), its equipment
	// (-1 for the template's), stand state, looping emote and sheath state.
	Display, Equipment                  int
	StandState, EmoteState, SheathState int
	// Path is the creature's waypoints (creature_movement), in point order.
	Path []PathPoint
}

// PathPoint is a waypoint in the server's coordinates: where, the facing there (0 none), the wait
// in milliseconds, the wander distance and the movement script run there.
type PathPoint struct {
	X, Y, Z, O     float64
	WaitMs         int
	WanderDistance float64
	ScriptID       int
}

// samePath says whether two paths have the same points.
func samePath(a, b []PathPoint) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		p, q := a[i], b[i]
		if p.WaitMs != q.WaitMs || p.ScriptID != q.ScriptID || math.Abs(p.WanderDistance-q.WanderDistance) > 1e-3 ||
			math.Abs(p.X-q.X) > 1e-3 || math.Abs(p.Y-q.Y) > 1e-3 || math.Abs(p.Z-q.Z) > 1e-3 || math.Abs(p.O-q.O) > 1e-4 {
			return false
		}
	}
	return true
}

// Edit is a spawn as the editor has it now. Original is what the database has (for a created
// spawn, what the editor first placed); Created says the spawn is new; Deleted says it was removed.
type Edit struct {
	Spawn    Spawn
	Original *Spawn
	Created  bool
	Deleted  bool
}

// Result is the SQL for a set of edits, with counts and the things that couldn't be written.
type Result struct {
	SQL     string `json:"sql"`
	Added   int    `json:"added"`
	Changed int    `json:"changed"`
	Deleted int    `json:"deleted"`
	// Skipped says, one line each, what wasn't exported and why.
	Skipped []string `json:"skipped"`
}

// Rows elsewhere that name a spawn by its guid, removed with it.
var creatureLinks = []string{"creature_addon", "creature_battleground", "game_event_creature", "game_event_creature_data", "pool_creature"}
var objectLinks = []string{"gameobject_battleground", "gameobject_requirement", "game_event_gameobject", "pool_gameobject"}

// num formats a number for SQL: finite, rounded to six decimals, without exponent noise.
func num(v float64) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return "0"
	}
	return strconv.FormatFloat(math.Round(v*1e6)/1e6, 'f', -1, 64)
}

// label describes a spawn for comments and messages, with nothing that could end a comment.
func label(s Spawn) string {
	text := fmt.Sprintf("%s (guid %d, entry %d)", s.Name, s.GUID, s.Entry)
	if s.Name == "" {
		text = fmt.Sprintf("spawn (guid %d, entry %d)", s.GUID, s.Entry)
	}
	return strings.NewReplacer("\r", " ", "\n", " ", "*/", " ").Replace(text)
}

// facing turns a facing into the rotation quaternion game objects carry, for those that only turn.
func facing(o float64) [4]float64 {
	return [4]float64{0, 0, math.Sin(o / 2), math.Cos(o / 2)}
}

// quaternion is the spawn's rotation, or its facing when it has none.
func quaternion(s Spawn) [4]float64 {
	if s.Rotation != nil {
		return *s.Rotation
	}
	return facing(s.O)
}

// respawn is the spawn's respawn range, the editor's default where it has none.
func respawn(s Spawn) (int, int) {
	lo, hi := s.RespawnMin, s.RespawnMax
	if lo <= 0 {
		lo = RespawnSeconds
	}
	if hi < lo {
		hi = lo
	}
	return lo, hi
}

// addonChanges are the creature_addon columns whose values differ from the original's, in a fixed
// order. A created spawn without an original sets every column that isn't the default.
func addonChanges(s Spawn, orig *Spawn) []string {
	base := Spawn{Equipment: -1, SheathState: 1}
	if orig != nil {
		base = *orig
	}
	var out []string
	for _, c := range []struct {
		col      string
		now, was int
	}{
		{"display_id", s.Display, base.Display},
		{"equipment_id", s.Equipment, base.Equipment},
		{"stand_state", s.StandState, base.StandState},
		{"emote_state", s.EmoteState, base.EmoteState},
		{"sheath_state", s.SheathState, base.SheathState},
	} {
		if c.now != c.was {
			out = append(out, fmt.Sprintf("`%s` = %d", c.col, c.now))
		}
	}
	return out
}

// ExportSQL turns spawn edits into SQL for the world database. Running the output twice gives the
// same result: added spawns are inserted under the editor's guids, changed ones are updated, and
// deleted ones are removed with the rows that refer to them.
func ExportSQL(edits []Edit, now time.Time) Result {
	sorted := append([]Edit(nil), edits...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Spawn.GUID < sorted[j].Spawn.GUID })

	var out []string
	var res Result
	for _, e := range sorted {
		s := e.Spawn
		name := label(s)
		if s.Map > MaxGameMap || s.GUID <= 0 {
			res.Skipped = append(res.Skipped, name+": not on a map the server has")
			continue
		}
		table, links := "gameobject", objectLinks
		if s.Kind == Creature {
			table, links = "creature", creatureLinks
		}

		if e.Deleted {
			// Spawns added in the editor and deleted again were never in the database.
			if e.Created {
				continue
			}
			out = append(out, "-- Delete "+name)
			out = append(out, fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d;", table, s.GUID))
			for _, link := range links {
				out = append(out, fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d;", link, s.GUID))
			}
			if s.Kind == Creature {
				out = append(out, fmt.Sprintf("DELETE FROM `creature_movement` WHERE `id` = %d;", s.GUID))
				out = append(out, fmt.Sprintf("DELETE FROM `creature_linking` WHERE `guid` = %d OR `master_guid` = %d;", s.GUID, s.GUID))
			}
			res.Deleted++
			continue
		}

		// A game object turned into another object takes the new template's size, which isn't the
		// author's own scale.
		entryChanged := e.Original != nil && e.Original.Entry != s.Entry
		if e.Original != nil && !entryChanged && math.Abs(e.Original.Scale-s.Scale) > 1e-3 {
			res.Skipped = append(res.Skipped, fmt.Sprintf("%s: its scale (%s); VMaNGOS takes scale from the template", name, num(s.Scale)))
		}
		q := quaternion(s)
		lo, hi := respawn(s)
		if e.Created {
			out = append(out, "-- Add "+name)
			// Only a row of this entry goes, the spawn's own earlier export: a guid the database gave
			// another spawn since makes the INSERT fail on the key instead of deleting that spawn (#199).
			// An object turned into another since that export was exported under the entry it was placed as.
			ids := strconv.Itoa(s.Entry)
			if entryChanged {
				ids = fmt.Sprintf("%d, %d", e.Original.Entry, s.Entry)
			}
			out = append(out, fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d AND `id` IN (%s);", table, s.GUID, ids))
			if s.Kind == Creature {
				out = append(out, fmt.Sprintf("INSERT INTO `creature` (`guid`, `id`, `map`, `position_x`, `position_y`, `position_z`, `orientation`, "+
					"`spawntimesecsmin`, `spawntimesecsmax`, `wander_distance`, `health_percent`, `mana_percent`, `movement_type`, `spawn_flags`, "+
					"`visibility_mod`, `patch_min`, `patch_max`) VALUES (%d, %d, %d, %s, %s, %s, %s, %d, %d, %s, 100, 100, %d, 0, 0, 0, 10);",
					s.GUID, s.Entry, s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), lo, hi, num(s.WanderDistance), s.MovementType))
			} else {
				out = append(out, fmt.Sprintf("INSERT INTO `gameobject` (`guid`, `id`, `map`, `position_x`, `position_y`, `position_z`, `orientation`, "+
					"`rotation0`, `rotation1`, `rotation2`, `rotation3`, `spawntimesecsmin`, `spawntimesecsmax`, `animprogress`, `state`, "+
					"`spawn_flags`, `visibility_mod`, `patch_min`, `patch_max`) VALUES (%d, %d, %d, %s, %s, %s, %s, %s, %s, %s, %s, %d, %d, 100, 1, 0, 0, 0, 10);",
					s.GUID, s.Entry, s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), num(q[0]), num(q[1]), num(q[2]), num(q[3]), lo, hi))
			}
			res.Added++
		} else {
			out = append(out, "-- Change "+name)
			if s.Kind == Creature {
				out = append(out, fmt.Sprintf("UPDATE `creature` SET `map` = %d, `position_x` = %s, `position_y` = %s, `position_z` = %s, "+
					"`orientation` = %s, `spawntimesecsmin` = %d, `spawntimesecsmax` = %d, `wander_distance` = %s, `movement_type` = %d WHERE `guid` = %d;",
					s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), lo, hi, num(s.WanderDistance), s.MovementType, s.GUID))
			} else {
				// The entry too: a game object can be turned into another (#136).
				out = append(out, fmt.Sprintf("UPDATE `gameobject` SET `id` = %d, `map` = %d, `position_x` = %s, `position_y` = %s, `position_z` = %s, "+
					"`orientation` = %s, `rotation0` = %s, `rotation1` = %s, `rotation2` = %s, `rotation3` = %s, `spawntimesecsmin` = %d, "+
					"`spawntimesecsmax` = %d WHERE `guid` = %d;",
					s.Entry, s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), num(q[0]), num(q[1]), num(q[2]), num(q[3]), lo, hi, s.GUID))
			}
			res.Changed++
		}

		// The path, when it changed: the spawn's own points replace its main path (path_id 0). A
		// creature that walked its template's path gets its own, which the server prefers.
		if s.Kind == Creature {
			var was []PathPoint
			if e.Original != nil {
				was = e.Original.Path
			}
			if !samePath(s.Path, was) || (e.Created && len(s.Path) > 0) {
				out = append(out, fmt.Sprintf("DELETE FROM `creature_movement` WHERE `id` = %d AND `path_id` = 0;", s.GUID))
				if len(s.Path) > 0 {
					rows := make([]string, len(s.Path))
					for i, p := range s.Path {
						rows[i] = fmt.Sprintf("(%d, %d, %s, %s, %s, %s, %d, %s, %d)", s.GUID, i+1, num(p.X), num(p.Y), num(p.Z), num(p.O),
							max(p.WaitMs, 0), num(max(p.WanderDistance, 0)), p.ScriptID)
					}
					out = append(out, "INSERT INTO `creature_movement` (`id`, `point`, `position_x`, `position_y`, `position_z`, `orientation`, "+
						"`waittime`, `wander_distance`, `script_id`) VALUES "+strings.Join(rows, ", ")+";")
				}
			}
		}

		// The creature_addon columns that changed: its display, equipment and pose.
		if s.Kind == Creature {
			if cols := addonChanges(s, e.Original); len(cols) > 0 {
				out = append(out, fmt.Sprintf("INSERT INTO `creature_addon` (`guid`, `patch`) SELECT %d, 0 FROM DUAL "+
					"WHERE NOT EXISTS (SELECT 1 FROM `creature_addon` WHERE `guid` = %d);", s.GUID, s.GUID))
				out = append(out, fmt.Sprintf("UPDATE `creature_addon` SET %s WHERE `guid` = %d;", strings.Join(cols, ", "), s.GUID))
			}
		}
	}

	header := []string{
		"-- Meld spawn edits for a VMaNGOS world database (`mangos`).",
		fmt.Sprintf("-- Exported %s: %d added, %d changed, %d deleted.", now.UTC().Format(time.RFC3339), res.Added, res.Changed, res.Deleted),
		"-- Import it into the world database, then restart the world server (mangosd).",
		"-- The world tables keep no undo: to go back, restore the world database from its dump.",
	}
	if len(res.Skipped) > 0 {
		header = append(header, "--", "-- Not exported:")
		for _, s := range res.Skipped {
			header = append(header, "--   "+strings.NewReplacer("\r", " ", "\n", " ").Replace(s))
		}
	}
	res.SQL = strings.Join(append(append(header, ""), append(out, "")...), "\n")
	return res
}

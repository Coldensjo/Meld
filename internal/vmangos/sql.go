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

// Spawn is one NPC or game object on a map.
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
	// Pose is an editor pose: a stand state or a looping emote. Zero means none.
	Pose int
}

// Edit is a spawn as the editor has it now. Original is what the database has (nil when the spawn
// was added in the editor); Created says the spawn is new; Deleted says it was removed.
type Edit struct {
	Spawn    Spawn
	Original *Spawn
	Created  bool
	Deleted  bool
}

// Result is the SQL for a set of edits, with counts and the things that couldn't be written.
type Result struct {
	SQL     string
	Added   int
	Changed int
	Deleted int
	// Skipped says, one line each, what wasn't exported and why.
	Skipped []string
}

// Editor poses (AnimationData IDs) as a creature_addon stand state (UnitStandStateType).
var standStates = map[int]int{97: 1, 100: 3, 102: 4, 103: 5, 104: 6, 6: 7, 115: 8}

// Editor poses as a looping 1.12 emote, where there's one.
var emoteStates = map[int]int{
	60: 1, 64: 5, 65: 6, 67: 3, 66: 2, 113: 66, 68: 4, 80: 21, 70: 11, 69: 10, 84: 29, 82: 23, 81: 22, 74: 15, 77: 18, 79: 20,
	83: 24, 76: 17, 73: 14, 78: 19, 62: 28, 25: 27, 26: 333, 27: 375, 29: 376, 48: 214, 16: 35, 17: 36, 18: 37, 24: 43, 32: 51,
	55: 53, 14: 64,
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

		if e.Original != nil && math.Abs(e.Original.Scale-s.Scale) > 1e-3 {
			res.Skipped = append(res.Skipped, fmt.Sprintf("%s: its scale (%s); VMaNGOS takes scale from the template", name, num(s.Scale)))
		}
		q := quaternion(s)
		if e.Created {
			out = append(out, "-- Add "+name)
			out = append(out, fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d;", table, s.GUID))
			if s.Kind == Creature {
				out = append(out, fmt.Sprintf("INSERT INTO `creature` (`guid`, `id`, `map`, `position_x`, `position_y`, `position_z`, `orientation`, "+
					"`spawntimesecsmin`, `spawntimesecsmax`, `wander_distance`, `health_percent`, `mana_percent`, `movement_type`, `spawn_flags`, "+
					"`visibility_mod`, `patch_min`, `patch_max`) VALUES (%d, %d, %d, %s, %s, %s, %s, %d, %d, 0, 100, 100, 0, 0, 0, 0, 10);",
					s.GUID, s.Entry, s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), RespawnSeconds, RespawnSeconds))
			} else {
				out = append(out, fmt.Sprintf("INSERT INTO `gameobject` (`guid`, `id`, `map`, `position_x`, `position_y`, `position_z`, `orientation`, "+
					"`rotation0`, `rotation1`, `rotation2`, `rotation3`, `spawntimesecsmin`, `spawntimesecsmax`, `animprogress`, `state`, "+
					"`spawn_flags`, `visibility_mod`, `patch_min`, `patch_max`) VALUES (%d, %d, %d, %s, %s, %s, %s, %s, %s, %s, %s, %d, %d, 100, 1, 0, 0, 0, 10);",
					s.GUID, s.Entry, s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), num(q[0]), num(q[1]), num(q[2]), num(q[3]),
					RespawnSeconds, RespawnSeconds))
			}
			res.Added++
		} else {
			out = append(out, "-- Change "+name)
			if s.Kind == Creature {
				// Edited NPCs stand still: they stop wandering and walking their paths.
				out = append(out, fmt.Sprintf("UPDATE `creature` SET `map` = %d, `position_x` = %s, `position_y` = %s, `position_z` = %s, "+
					"`orientation` = %s, `wander_distance` = 0, `movement_type` = 0 WHERE `guid` = %d;",
					s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), s.GUID))
			} else {
				out = append(out, fmt.Sprintf("UPDATE `gameobject` SET `map` = %d, `position_x` = %s, `position_y` = %s, `position_z` = %s, "+
					"`orientation` = %s, `rotation0` = %s, `rotation1` = %s, `rotation2` = %s, `rotation3` = %s WHERE `guid` = %d;",
					s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), num(q[0]), num(q[1]), num(q[2]), num(q[3]), s.GUID))
			}
			res.Changed++
		}

		// The pose, when it's set or was changed: a stand state or a looping emote.
		origPose := 0
		if e.Original != nil {
			origPose = e.Original.Pose
		}
		if s.Kind == Creature && (s.Pose != 0 || origPose != s.Pose) {
			stand, emote := standStates[s.Pose], emoteStates[s.Pose]
			if s.Pose != 0 && stand == 0 && emote == 0 {
				res.Skipped = append(res.Skipped, fmt.Sprintf("%s: its pose (animation %d) has no 1.12 emote; it stands", name, s.Pose))
			}
			out = append(out, fmt.Sprintf("INSERT INTO `creature_addon` (`guid`, `patch`, `stand_state`, `emote_state`) SELECT %d, 0, %d, %d FROM DUAL "+
				"WHERE NOT EXISTS (SELECT 1 FROM `creature_addon` WHERE `guid` = %d);", s.GUID, stand, emote, s.GUID))
			out = append(out, fmt.Sprintf("UPDATE `creature_addon` SET `stand_state` = %d, `emote_state` = %d WHERE `guid` = %d;", stand, emote, s.GUID))
		}
	}

	header := []string{
		"-- WorldEditor spawn edits for a VMaNGOS world database (`mangos`).",
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

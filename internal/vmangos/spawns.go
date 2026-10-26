package vmangos

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/adt"
)

// WorldSpawn kinds, as the editor shows them: a monster is a creature with no NPC flags, an NPC is a
// creature with some (a vendor, a quest giver, a trainer), and an object is a game object.
const (
	KindMonster = "monster"
	KindNPC     = "npc"
	KindObject  = "object"
)

// WorldSpawn is a creature or game object the world database places on a map, in a region's
// coordinates (yards from its north-west corner, Y the absolute height).
type WorldSpawn struct {
	Kind    string `json:"kind"`
	GUID    int    `json:"guid"`
	Entry   int    `json:"entry"`
	Name    string `json:"name"`
	Subname string `json:"subname"`
	// Level is the creature's level range; zero for an object.
	LevelMin int `json:"levelMin"`
	LevelMax int `json:"levelMax"`
	// Faction is the creature's faction template; zero for an object.
	Faction int `json:"faction"`
	// NPCFlags are the creature's NPC flags (vendor, quest giver, ...); zero for a monster.
	NPCFlags int `json:"npcFlags"`
	// Rank is the creature's rank (normal, elite, boss, ...); the object's type for an object.
	Rank int `json:"rank"`
	// Type is the creature type (beast, humanoid, ...), or the game object type (door, chest, ...).
	Type        int     `json:"type"`
	X           float32 `json:"x"`
	Y           float32 `json:"y"`
	Z           float32 `json:"z"`
	Orientation float32 `json:"orientation"`
	// Tilt is a tilted game object's rotation relative to its facing: the quaternion (x, y, z, w, in
	// the server's axes) that gameobject.rotation0..3 is once turned about Z by Orientation, so a
	// change of facing turns the object as it stands (#229). Empty for an object that only turns
	// (rotation0 and rotation1 zero) and for a creature.
	Tilt []float64 `json:"tilt"`
	// RespawnSecs and RespawnMaxSecs are the respawn time's range in seconds.
	RespawnSecs    int `json:"respawnSecs"`
	RespawnMaxSecs int `json:"respawnMaxSecs"`
	// Display is the creature or game object display shown: the spawn's own (creature_addon) or
	// its template's first.
	Display int `json:"display"`
	// Model is the client path of the model the spawn shows, such as a .mdx or .wmo name; "" when its
	// display has none.
	Model string `json:"model"`
	// Look is how the display dresses the model, as the model endpoint's query (wow.Look.Query,
	// without the animation); "" for none.
	Look string `json:"look"`
	// Anim is the AnimationData ID of the loop the spawn's pose plays (0 Stand).
	Anim int `json:"anim"`
	// Scale is the spawn's size: the template's scale for the display shown, times the display's own
	// (DisplayScale, 1 for an object).
	Scale        float32 `json:"scale"`
	DisplayScale float32 `json:"displayScale"`
	// The creature's spawn settings: its equipment (creature_equip_template; 0 none), stand state,
	// looping emote and sheath state (creature_addon, else the defaults), and how it moves
	// (MovementType: 0 idle, 1 random within WanderDistance, 2 waypoints). Zero for an object.
	Equipment int `json:"equipment"`
	// EquipItems are the equipment's items (item_template entries): main hand, off hand, ranged;
	// 0 for an empty slot.
	EquipItems     [3]int  `json:"equipItems"`
	StandState     int     `json:"standState"`
	EmoteState     int     `json:"emoteState"`
	SheathState    int     `json:"sheathState"`
	MovementType   int     `json:"movementType"`
	WanderDistance float32 `json:"wanderDistance"`
	// Waypoints are the creature's path, in point order: its own (creature_movement), or else for a
	// creature that walks waypoints its template's (creature_movement_template, PathFromTemplate).
	Waypoints        []Waypoint `json:"waypoints"`
	PathFromTemplate bool       `json:"pathFromTemplate"`
	// Events are the world events the spawn belongs to (game_event_creature, game_event_gameobject):
	// a positive one spawns it only while that event runs, a negative one takes it away while event
	// -n runs. None for an everyday spawn.
	Events []int `json:"events"`
	// Pool is the spawn pool the spawn belongs to (pool_creature, pool_gameobject; 0 for none): the
	// server spawns at most PoolLimit of the pool's members at a time (0 for all of them), such as one
	// of the veins that share a spot. PoolName is the pool's description.
	Pool      int    `json:"pool"`
	PoolLimit int    `json:"poolLimit"`
	PoolName  string `json:"poolName"`
	// PoolChance is the spawn's chance in its pool in percent (0: the members without one share
	// what the others leave). PoolElsewhere counts the pool's members the database has outside the
	// region.
	PoolChance    float32 `json:"poolChance"`
	PoolElsewhere int     `json:"poolElsewhere"`
	// MotherPool is the pool the spawn's pool belongs to (pool_pool; 0 for none), such as a zone's
	// master pool of vein spots: the server fills at most MotherLimit of its MotherSize pools at a
	// time. MotherName is its description.
	MotherPool  int    `json:"motherPool"`
	MotherLimit int    `json:"motherLimit"`
	MotherSize  int    `json:"motherSize"`
	MotherName  string `json:"motherName"`
	// Leader is the creature's formation leader (creature_groups; 0 for none, its own guid for a
	// leader). A member walks in its slot: FollowDist yards from the leader at FollowAngle radians
	// from the leader's facing (counter-clockwise seen from above, as the server's angles). GroupFlags
	// are its row's flags (FormationMove, FormationAggro, ...). Zero for an object.
	Leader      int     `json:"leader"`
	FollowDist  float32 `json:"followDist"`
	FollowAngle float32 `json:"followAngle"`
	GroupFlags  int     `json:"groupFlags"`
}

// Waypoint is a point of a creature's path, in the region's coordinates like its spawn: where it
// walks to, the facing it turns to there (0 for none), how long it waits there in milliseconds,
// how far it wanders there, and the movement script it runs there (0 for none).
type Waypoint struct {
	X              float32 `json:"x"`
	Y              float32 `json:"y"`
	Z              float32 `json:"z"`
	Orientation    float32 `json:"orientation"`
	WaitMs         int     `json:"waitMs"`
	WanderDistance float32 `json:"wanderDistance"`
	ScriptID       int     `json:"scriptId"`
}

// runSQL runs a query against the world database and returns mariadb's batch output: one line
// per row, tab-separated. It's a variable so tests can supply canned rows.
var runSQL = func(db worldDB, sql string) ([]byte, error) {
	args := append([]string{"-B", "-N"}, db.args(sql)...)
	cmd := exec.Command("mariadb", args...)
	cmd.Env = append(os.Environ(), db.env()...)
	hideConsole(cmd)
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("mariadb: %w: %s", err, mariadbError(errOut.String()))
	}
	return out.Bytes(), nil
}

// mariadbError is mariadb's error output without its WARNING lines: with the password in MYSQL_PWD,
// MariaDB 11.4's client warns on every run that it skips the server certificate check of a
// "passwordless" login, which would otherwise come before every error.
func mariadbError(stderr string) string {
	var keep []string
	for _, line := range strings.Split(stderr, "\n") {
		if line = strings.TrimSpace(line); line != "" && !strings.HasPrefix(line, "WARNING:") {
			keep = append(keep, line)
		}
	}
	return strings.Join(keep, "\n")
}

// ReadSpawns returns the creatures and game objects the world database places in the block of
// size tiles at (x, y) of the named map. The server's map ID comes from its Map.dbc.
func ReadSpawns(serverRoot, dataDir, mapName string, x, y, size int) ([]WorldSpawn, error) {
	if err := checkRegion(x, y, size); err != nil {
		return nil, err
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	mapID, err := serverMapID(serverRoot, mapName)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	// The server's axes are the editor's swapped and mirrored (adt.ToServer), so the block's far
	// corner gives the low bounds and its first corner the high ones.
	side := float64(size) * adt.TileSize
	xLo, yLo := adt.ToServer(side, side, x, y)
	xHi, yHi := adt.ToServer(0, 0, x, y)
	bounds := fmt.Sprintf("c.map = %d AND c.position_x BETWEEN %f AND %f AND c.position_y BETWEEN %f AND %f",
		mapID, xLo, xHi, yLo, yHi)
	gBounds := strings.ReplaceAll(bounds, "c.", "g.")

	creatures := fmt.Sprintf(`SELECT c.guid, c.id, t.name, COALESCE(t.subname, ''), t.level_min, t.level_max, t.faction,
		t.npc_flags, t.rank, t.type, c.position_x, c.position_y, c.position_z, c.orientation, c.spawntimesecsmin,
		COALESCE(NULLIF(t.display_id1, 0), NULLIF(t.display_id2, 0), NULLIF(t.display_id3, 0), NULLIF(t.display_id4, 0), 0),
		CASE WHEN t.display_id1 <> 0 THEN t.display_scale1 WHEN t.display_id2 <> 0 THEN t.display_scale2
		WHEN t.display_id3 <> 0 THEN t.display_scale3 ELSE t.display_scale4 END,
		COALESCE(a.display_id, 0), IF(a.equipment_id IS NULL OR a.equipment_id < 0, t.equipment_id, a.equipment_id),
		COALESCE(a.stand_state, 0), COALESCE(a.emote_state, 0), COALESCE(a.sheath_state, 1),
		c.movement_type, c.wander_distance, c.spawntimesecsmax, 0, 0, 0, 0
		FROM creature c JOIN creature_template t ON t.entry = c.id
		AND t.patch = (SELECT MAX(patch) FROM creature_template WHERE entry = c.id)
		LEFT JOIN creature_addon a ON a.guid = c.guid AND a.patch = (SELECT MAX(patch) FROM creature_addon WHERE guid = c.guid)
		WHERE %s`, bounds)
	objects := fmt.Sprintf(`SELECT g.guid, g.id, gt.name, '', 0, 0, 0, 0, 0, gt.type, g.position_x, g.position_y, g.position_z,
		g.orientation, g.spawntimesecsmin, gt.displayId, gt.size, 0, 0, 0, 0, 0, 0, 0, g.spawntimesecsmax,
		g.rotation0, g.rotation1, g.rotation2, g.rotation3
		FROM gameobject g JOIN gameobject_template gt ON gt.entry = g.id
		AND gt.patch = (SELECT MAX(patch) FROM gameobject_template WHERE entry = g.id)
		WHERE %s`, gBounds)

	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	var rows []spawnRow
	for _, q := range []struct {
		sql  string
		kind string
	}{{creatures, "creature"}, {objects, "object"}} {
		raw, err := runSQL(db, q.sql)
		if err != nil {
			return nil, err
		}
		got, err := parseSpawnRows(raw, q.kind)
		if err != nil {
			return nil, err
		}
		rows = append(rows, got...)
	}
	weapons, err := readEquipment(db, rows)
	if err != nil {
		return nil, err
	}
	out := make([]WorldSpawn, len(rows))
	for i, s := range rows {
		out[i] = regionSpawn(s, x, y, tables, weapons[s.Equipment])
	}
	if err := readWaypoints(db, out, x, y); err != nil {
		return nil, err
	}
	if err := readSpawnEvents(db, out); err != nil {
		return nil, err
	}
	if err := readSpawnPools(db, out); err != nil {
		return nil, err
	}
	if err := readFormations(db, out); err != nil {
		return nil, err
	}
	return out, nil
}

// readWaypoints gives the region's creatures their paths: each one's own points from
// creature_movement, and for a creature that walks waypoints without its own, its template's from
// creature_movement_template. The points move to the region's coordinates like the spawns.
func readWaypoints(db worldDB, spawns []WorldSpawn, x, y int) error {
	guids := map[int]bool{}
	for _, s := range spawns {
		if s.Kind != KindObject {
			guids[s.GUID] = true
		}
	}
	if len(guids) == 0 {
		return nil
	}
	// Only the main path (path_id 0): the few other paths are for scripts, not the spawn's walk.
	const cols = "point, position_x, position_y, position_z, orientation, waittime, script_id, wander_distance"
	raw, err := runSQL(db, fmt.Sprintf("SELECT id, %s FROM creature_movement WHERE id IN (%s) AND path_id = 0 ORDER BY id, point", cols, intList(guids)))
	if err != nil {
		return err
	}
	own := parseWaypoints(raw, x, y)
	entries := map[int]bool{}
	for i := range spawns {
		s := &spawns[i]
		if s.Kind == KindObject {
			continue
		}
		if p, ok := own[s.GUID]; ok {
			s.Waypoints = p
		} else if s.MovementType == 2 {
			entries[s.Entry] = true
		}
	}
	if len(entries) == 0 {
		return nil
	}
	raw, err = runSQL(db, fmt.Sprintf("SELECT entry, %s FROM creature_movement_template WHERE entry IN (%s) AND path_id = 0 ORDER BY entry, point", cols, intList(entries)))
	if err != nil {
		return err
	}
	shared := parseWaypoints(raw, x, y)
	for i := range spawns {
		s := &spawns[i]
		if s.Kind != KindObject && s.Waypoints == nil && s.MovementType == 2 {
			if p, ok := shared[s.Entry]; ok {
				s.Waypoints = append([]Waypoint(nil), p...)
				s.PathFromTemplate = true
			}
		}
	}
	return nil
}

// parseWaypoints reads path rows (owner, point, x, y, z, orientation, wait, script, wander) into
// paths by owner, in the region at tile (x, y), in the order the rows come.
func parseWaypoints(raw []byte, x, y int) map[int][]Waypoint {
	out := map[int][]Waypoint{}
	for _, f := range batchRows(raw, 9) {
		owner, err1 := strconv.Atoi(f[0])
		wait, err2 := strconv.Atoi(f[6])
		script, err3 := strconv.Atoi(f[7])
		wander, err4 := strconv.ParseFloat(f[8], 32)
		var v [4]float64
		ok := err1 == nil && err2 == nil && err3 == nil && err4 == nil
		for i := range v {
			n, err := strconv.ParseFloat(f[2+i], 64)
			ok = ok && err == nil
			v[i] = n
		}
		if !ok {
			continue
		}
		ex, ez := adt.FromServer(v[0], v[1], x, y)
		out[owner] = append(out[owner], Waypoint{
			X:              float32(ex),
			Z:              float32(ez),
			Y:              float32(v[2]),
			Orientation:    float32(v[3]),
			WaitMs:         wait,
			WanderDistance: float32(wander),
			ScriptID:       script,
		})
	}
	return out
}

// readEquipment reads the items the spawns' equipment puts in their hands, by equipment ID: the
// equipment's likeliest row in creature_equip_template, and its items' displays and inventory
// types from item_template.
func readEquipment(db worldDB, rows []spawnRow) (map[int][3]heldItem, error) {
	ids := map[int]bool{}
	for _, r := range rows {
		if r.Kind != KindObject && r.Equipment > 0 {
			ids[r.Equipment] = true
		}
	}
	out := map[int][3]heldItem{}
	if len(ids) == 0 {
		return out, nil
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT entry, item1, item2, item3 FROM creature_equip_template WHERE entry IN (%s) "+
		"ORDER BY entry, probability DESC", intList(ids)))
	if err != nil {
		return nil, err
	}
	items := map[int][3]int{}
	itemIDs := map[int]bool{}
	for _, f := range batchRows(raw, 4) {
		n, ok := atoiAll(f)
		if !ok {
			continue
		}
		if _, seen := items[n[0]]; seen {
			continue
		}
		items[n[0]] = [3]int{n[1], n[2], n[3]}
		for _, it := range n[1:] {
			if it > 0 {
				itemIDs[it] = true
			}
		}
	}
	held := map[int]heldItem{}
	if len(itemIDs) > 0 {
		raw, err := runSQL(db, fmt.Sprintf("SELECT i.entry, i.display_id, i.inventory_type FROM item_template i WHERE i.entry IN (%s) "+
			"AND i.patch = (SELECT MAX(patch) FROM item_template WHERE entry = i.entry)", intList(itemIDs)))
		if err != nil {
			return nil, err
		}
		for _, f := range batchRows(raw, 3) {
			if n, ok := atoiAll(f); ok {
				held[n[0]] = heldItem{display: uint32(n[1]), invType: n[2]}
			}
		}
	}
	for id, it := range items {
		var slots [3]heldItem
		for k, entry := range it {
			slots[k] = held[entry]
			slots[k].entry = entry
		}
		out[id] = slots
	}
	return out, nil
}

// intList joins IDs for an SQL IN list, in order.
func intList(ids map[int]bool) string {
	list := make([]int, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	sort.Ints(list)
	parts := make([]string, len(list))
	for i, id := range list {
		parts[i] = strconv.Itoa(id)
	}
	return strings.Join(parts, ", ")
}

// atoiAll reads every field as an integer.
func atoiAll(f []string) ([]int, bool) {
	out := make([]int, len(f))
	for i, s := range f {
		n, err := strconv.Atoi(s)
		if err != nil {
			return nil, false
		}
		out[i] = n
	}
	return out, true
}

// regionSpawn moves a spawn from the server's coordinates to the block at tile (x, y): editor x is
// the tile's X less the block's, editor z the tile's Z less the block's, and the height is the same.
// A creature is dressed in its display's look with weapons in its hands.
func regionSpawn(s spawnRow, x, y int, tables *modelTables, weapons [3]heldItem) WorldSpawn {
	out := s.WorldSpawn
	ex, ez := adt.FromServer(float64(s.sx), float64(s.sy), x, y)
	out.X = float32(ex)
	out.Z = float32(ez)
	out.Y = s.height
	out.Scale = s.scale
	if out.Scale <= 0 {
		out.Scale = 1
	}
	out.Display = int(s.display)
	out.DisplayScale = 1
	if s.Kind == KindObject {
		out.Model = tables.objectModel(s.display)
		return out
	}
	if s.addonDisplay != 0 {
		out.Display = int(s.addonDisplay)
	}
	for k, w := range weapons {
		out.EquipItems[k] = w.entry
	}
	look := tables.creatureLook(uint32(out.Display), gear{weapons: weapons, sheath: s.SheathState, stand: s.StandState, emote: s.EmoteState})
	out.Model = look.model
	out.Scale *= look.scale
	out.DisplayScale = look.scale
	out.Anim = look.look.Anim
	look.look.Anim = 0
	out.Look = look.look.Query()
	return out
}

// spawnRow is a spawn as the query returned it, with its server coordinates (sx, sy) and height.
type spawnRow struct {
	WorldSpawn
	sx, sy, height float32
	display        uint32
	scale          float32
	// addonDisplay is the spawn's own display (creature_addon), 0 for its template's.
	addonDisplay uint32
}

// spawnColumns is the width of a spawn query's rows (see parseSpawnRows).
const spawnColumns = 29

// parseSpawnRows reads the tab-separated rows of a spawn query. The columns are: guid, entry,
// name, subname, level_min, level_max, faction, npc_flags, rank, type, x, y, z, orientation,
// respawn seconds, display ID, scale, then for a creature (zeros for an object) its own display,
// equipment, stand state, emote state, sheath state, movement type and wander distance, then the
// most respawn seconds, and last for an object (zeros for a creature) its rotation quaternion.
func parseSpawnRows(raw []byte, kind string) ([]spawnRow, error) {
	var out []spawnRow
	for _, f := range batchLines(raw) {
		if len(f) == 1 && f[0] == "" {
			continue
		}
		if len(f) != spawnColumns {
			return nil, fmt.Errorf("spawn row has %d columns, want %d: %q", len(f), spawnColumns, strings.Join(f, "\t"))
		}
		var r spawnRow
		var display, addonDisplay int
		r.Name, r.Subname = f[2], f[3]
		ints := map[int]*int{0: &r.GUID, 1: &r.Entry, 4: &r.LevelMin, 5: &r.LevelMax, 6: &r.Faction, 7: &r.NPCFlags, 8: &r.Rank,
			9: &r.Type, 14: &r.RespawnSecs, 15: &display, 17: &addonDisplay, 18: &r.Equipment, 19: &r.StandState,
			20: &r.EmoteState, 21: &r.SheathState, 22: &r.MovementType, 24: &r.RespawnMaxSecs}
		for col, p := range ints {
			n, err := strconv.Atoi(f[col])
			if err != nil {
				return nil, fmt.Errorf("spawn row: column %d: %w", col, err)
			}
			*p = n
		}
		floats := map[int]*float32{10: &r.sx, 11: &r.sy, 12: &r.height, 13: &r.Orientation, 16: &r.scale, 23: &r.WanderDistance}
		for col, p := range floats {
			v, err := strconv.ParseFloat(f[col], 32)
			if err != nil {
				return nil, fmt.Errorf("spawn row: column %d: %w", col, err)
			}
			*p = float32(v)
		}
		r.display, r.addonDisplay = uint32(max(display, 0)), uint32(max(addonDisplay, 0))
		var q [4]float64
		for i := range q {
			v, err := strconv.ParseFloat(f[25+i], 64)
			if err != nil {
				return nil, fmt.Errorf("spawn row: column %d: %w", 25+i, err)
			}
			q[i] = v
		}
		switch {
		case kind == "object":
			r.Kind = KindObject
			r.Tilt = tiltOf(float64(r.Orientation), q)
		case r.NPCFlags != 0:
			r.Kind = KindNPC
		default:
			r.Kind = KindMonster
		}
		out = append(out, r)
	}
	return out, nil
}

// serverMapID finds the map ID of a map directory in the server's Map.dbc.
func serverMapID(serverRoot, mapName string) (int, error) {
	dbc, err := os.ReadFile(filepath.Join(serverRoot, "data", "5875", "dbc", "Map.dbc"))
	if err != nil {
		return 0, err
	}
	for _, id := range MapRowIDs(dbc) {
		if strings.EqualFold(MapRowDir(dbc, id), mapName) {
			return int(id), nil
		}
	}
	return 0, errors.New("the server has no map " + mapName)
}

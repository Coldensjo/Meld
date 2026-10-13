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

	"WorldEditor/internal/adt"
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
	// Scale is the spawn's size: the template's scale for the display shown, times the display's own.
	Scale float32 `json:"scale"`
	// The creature's spawn settings: its equipment (creature_equip_template; 0 none), stand state,
	// looping emote and sheath state (creature_addon, else the defaults), and how it moves
	// (MovementType: 0 idle, 1 random within WanderDistance, 2 waypoints). Zero for an object.
	Equipment      int     `json:"equipment"`
	StandState     int     `json:"standState"`
	EmoteState     int     `json:"emoteState"`
	SheathState    int     `json:"sheathState"`
	MovementType   int     `json:"movementType"`
	WanderDistance float32 `json:"wanderDistance"`
}

// runSQL runs a query against the world database and returns mariadb's batch output: one line
// per row, tab-separated. It's a variable so tests can supply canned rows.
var runSQL = func(db worldDB, sql string) ([]byte, error) {
	args := append([]string{"-B", "-N"}, db.args(sql)...)
	cmd := exec.Command("mariadb", args...)
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("mariadb: %w: %s", err, strings.TrimSpace(errOut.String()))
	}
	return out.Bytes(), nil
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
	// The server's coordinates are the ADT ones swapped and mirrored: its x is ZeroPoint less the
	// tile's Z, and its y is ZeroPoint less the tile's X. So the block's server bounds are:
	t := float64(adt.TileSize)
	zp := float64(adt.ZeroPoint)
	xLo, xHi := zp-float64(y+size)*t, zp-float64(y)*t
	yLo, yHi := zp-float64(x+size)*t, zp-float64(x)*t
	bounds := fmt.Sprintf("c.map = %d AND c.position_x BETWEEN %f AND %f AND c.position_y BETWEEN %f AND %f",
		mapID, xLo, xHi, yLo, yHi)
	gBounds := strings.Replace(bounds, "c.", "g.", -1)

	creatures := fmt.Sprintf(`SELECT c.guid, c.id, t.name, COALESCE(t.subname, ''), t.level_min, t.level_max, t.faction,
		t.npc_flags, t.rank, t.type, c.position_x, c.position_y, c.position_z, c.orientation, c.spawntimesecsmin,
		COALESCE(NULLIF(t.display_id1, 0), NULLIF(t.display_id2, 0), NULLIF(t.display_id3, 0), NULLIF(t.display_id4, 0), 0),
		CASE WHEN t.display_id1 <> 0 THEN t.display_scale1 WHEN t.display_id2 <> 0 THEN t.display_scale2
		WHEN t.display_id3 <> 0 THEN t.display_scale3 ELSE t.display_scale4 END,
		COALESCE(a.display_id, 0), IF(a.equipment_id IS NULL OR a.equipment_id < 0, t.equipment_id, a.equipment_id),
		COALESCE(a.stand_state, 0), COALESCE(a.emote_state, 0), COALESCE(a.sheath_state, 1),
		c.movement_type, c.wander_distance, c.spawntimesecsmax
		FROM creature c JOIN creature_template t ON t.entry = c.id
		AND t.patch = (SELECT MAX(patch) FROM creature_template WHERE entry = c.id)
		LEFT JOIN creature_addon a ON a.guid = c.guid AND a.patch = (SELECT MAX(patch) FROM creature_addon WHERE guid = c.guid)
		WHERE %s`, bounds)
	objects := fmt.Sprintf(`SELECT g.guid, g.id, gt.name, '', 0, 0, 0, 0, 0, gt.type, g.position_x, g.position_y, g.position_z,
		g.orientation, g.spawntimesecsmin, gt.displayId, gt.size, 0, 0, 0, 0, 0, 0, 0, g.spawntimesecsmax
		FROM gameobject g JOIN gameobject_template gt ON gt.entry = g.id
		AND gt.patch = (SELECT MAX(patch) FROM gameobject_template WHERE entry = g.id)
		WHERE %s`, gBounds)

	tables, err := loadModelTables(dataDir)
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
	return out, nil
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
	for _, f := range tsvRows(raw, 4) {
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
		for _, f := range tsvRows(raw, 3) {
			if n, ok := atoiAll(f); ok {
				held[n[0]] = heldItem{display: uint32(n[1]), invType: n[2]}
			}
		}
	}
	for id, it := range items {
		out[id] = [3]heldItem{held[it[0]], held[it[1]], held[it[2]]}
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

// tsvRows splits mariadb's batch output into rows of n fields, skipping rows of another width.
func tsvRows(raw []byte, n int) [][]string {
	var out [][]string
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if f := strings.Split(strings.TrimRight(line, "\r"), "\t"); len(f) == n {
			out = append(out, f)
		}
	}
	return out
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
	t := float64(adt.TileSize)
	zp := float64(adt.ZeroPoint)
	out := s.WorldSpawn
	out.X = float32(zp - float64(s.sy) - float64(x)*t)
	out.Z = float32(zp - float64(s.sx) - float64(y)*t)
	out.Y = s.height
	out.Scale = s.scale
	if out.Scale <= 0 {
		out.Scale = 1
	}
	out.Display = int(s.display)
	if s.Kind == KindObject {
		out.Model = tables.objectModel(s.display)
		return out
	}
	if s.addonDisplay != 0 {
		out.Display = int(s.addonDisplay)
	}
	look := tables.creatureLook(uint32(out.Display), gear{weapons: weapons, sheath: s.SheathState, stand: s.StandState, emote: s.EmoteState})
	out.Model = look.model
	out.Scale *= look.scale
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
const spawnColumns = 25

// parseSpawnRows reads the tab-separated rows of a spawn query. The columns are: guid, entry,
// name, subname, level_min, level_max, faction, npc_flags, rank, type, x, y, z, orientation,
// respawn seconds, display ID, scale, then for a creature (zeros for an object) its own display,
// equipment, stand state, emote state, sheath state, movement type and wander distance, and last
// the most respawn seconds.
func parseSpawnRows(raw []byte, kind string) ([]spawnRow, error) {
	var out []spawnRow
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) != spawnColumns {
			return nil, fmt.Errorf("spawn row has %d columns, want %d: %q", len(f), spawnColumns, line)
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
		switch {
		case kind == "object":
			r.Kind = KindObject
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

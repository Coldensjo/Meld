package vmangos

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
	Kind    string  `json:"kind"`
	GUID    int     `json:"guid"`
	Entry   int     `json:"entry"`
	Name    string  `json:"name"`
	Subname string  `json:"subname"`
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
	// RespawnSecs is the minimum respawn time in seconds.
	RespawnSecs int `json:"respawnSecs"`
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
func ReadSpawns(serverRoot, mapName string, x, y, size int) ([]WorldSpawn, error) {
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
		t.npc_flags, t.rank, t.type, c.position_x, c.position_y, c.position_z, c.orientation, c.spawntimesecsmin
		FROM creature c JOIN creature_template t ON t.entry = c.id
		AND t.patch = (SELECT MAX(patch) FROM creature_template WHERE entry = c.id)
		WHERE %s`, bounds)
	objects := fmt.Sprintf(`SELECT g.guid, g.id, gt.name, '', 0, 0, 0, 0, 0, gt.type, g.position_x, g.position_y, g.position_z,
		g.orientation, g.spawntimesecsmin
		FROM gameobject g JOIN gameobject_template gt ON gt.entry = g.id
		AND gt.patch = (SELECT MAX(patch) FROM gameobject_template WHERE entry = g.id)
		WHERE %s`, gBounds)

	var out []WorldSpawn
	for _, q := range []struct {
		sql  string
		kind string
	}{{creatures, "creature"}, {objects, "object"}} {
		raw, err := runSQL(db, q.sql)
		if err != nil {
			return nil, err
		}
		rows, err := parseSpawnRows(raw, q.kind)
		if err != nil {
			return nil, err
		}
		for _, s := range rows {
			out = append(out, regionSpawn(s, x, y))
		}
	}
	return out, nil
}

// regionSpawn moves a spawn from the server's coordinates to the block at tile (x, y): editor x is
// the tile's X less the block's, editor z the tile's Z less the block's, and the height is the same.
func regionSpawn(s spawnRow, x, y int) WorldSpawn {
	t := float64(adt.TileSize)
	zp := float64(adt.ZeroPoint)
	out := s.WorldSpawn
	out.X = float32(zp - float64(s.sy) - float64(x)*t)
	out.Z = float32(zp - float64(s.sx) - float64(y)*t)
	out.Y = s.height
	return out
}

// spawnRow is a spawn as the query returned it, with its server coordinates (sx, sy) and height.
type spawnRow struct {
	WorldSpawn
	sx, sy, height float32
}

// parseSpawnRows reads the tab-separated rows of a spawn query. The columns are: guid, entry,
// name, subname, level_min, level_max, faction, npc_flags, rank, type, x, y, z, orientation,
// respawn seconds.
func parseSpawnRows(raw []byte, kind string) ([]spawnRow, error) {
	var out []spawnRow
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) != 15 {
			return nil, fmt.Errorf("spawn row has %d columns, want 15: %q", len(f), line)
		}
		var r spawnRow
		var err error
		ints := []*int{&r.GUID, &r.Entry}
		for i, p := range ints {
			if *p, err = strconv.Atoi(f[i]); err != nil {
				return nil, fmt.Errorf("spawn row: %w", err)
			}
		}
		r.Name, r.Subname = f[2], f[3]
		fields := []*int{&r.LevelMin, &r.LevelMax, &r.Faction, &r.NPCFlags, &r.Rank, &r.Type}
		for i, p := range fields {
			if *p, err = strconv.Atoi(f[4+i]); err != nil {
				return nil, fmt.Errorf("spawn row: %w", err)
			}
		}
		floats := []*float32{&r.sx, &r.sy, &r.height, &r.Orientation}
		for i, p := range floats {
			v, err := strconv.ParseFloat(f[10+i], 32)
			if err != nil {
				return nil, fmt.Errorf("spawn row: %w", err)
			}
			*p = float32(v)
		}
		if r.RespawnSecs, err = strconv.Atoi(f[14]); err != nil {
			return nil, fmt.Errorf("spawn row: %w", err)
		}
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

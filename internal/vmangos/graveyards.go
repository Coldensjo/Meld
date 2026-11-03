package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/mpq"
)

// Graveyards (#947). A dead player's ghost goes to a graveyard: a row of WorldSafeLocs.dbc (ID, map,
// x, y, z and a name), which VMaNGOS reads from its own copy (data/5875/dbc) at start and the client
// carries too. The world database adds its facing (world_safe_locs_facing) and the zones it serves
// (game_graveyard_zone: a zone or area of AreaTable, for anyone, the Alliance or the Horde); the
// server sends a ghost to the nearest graveyard linked to the area it died in, else to its zone. A
// save writes the table into Meld's patch and the server's data, and the facing and links into the
// world database. The links reload with `.reload game_graveyard_zone`; the table and the facings only
// at the server's start.

// WorldSafeLocsPath is WorldSafeLocs.dbc's name in the client's archives.
const WorldSafeLocsPath = `DBFilesClient\WorldSafeLocs.dbc`

// WorldSafeLocs.dbc's layout is dbcWorldSafeLocs (1.12's is VMaNGOS's WorldSafeLocsEntryfmt
// "nifffxxxxxxxxx", checked against the server's file): ID, map, x, y, z and the localized name.

// The factions a graveyard link is for (game_graveyard_zone.faction, VMaNGOS's Team).
const (
	GraveyardAnyone   = 0
	GraveyardHorde    = 67
	GraveyardAlliance = 469
)

// graveyardPatch is the last content patch (1.12) a link is loaded for: a new link is written for
// patches 0 to it, and a link the editor shows is one that holds at it.
const graveyardPatch = 10

// maxGraveyardID is the largest graveyard ID: game_graveyard_zone.id is an unsigned mediumint.
const maxGraveyardID = 1<<24 - 1

// GraveyardLink is a zone (or area) a graveyard serves, and for whom.
type GraveyardLink struct {
	Zone    uint32 `json:"zone"`
	Faction uint32 `json:"faction"`
}

// Graveyard is a WorldSafeLocs row in the server's coordinates (yards, Z up), with its facing and its
// links from the world database (empty without a server folder).
type Graveyard struct {
	ID    uint32          `json:"id"`
	MapID uint32          `json:"mapId"`
	X     float32         `json:"x"`
	Y     float32         `json:"y"`
	Z     float32         `json:"z"`
	O     float32         `json:"o"`
	Name  string          `json:"name"`
	Links []GraveyardLink `json:"links"`
}

// LoadWorldSafeLocs reads the client's WorldSafeLocs.dbc as the game sees it, Meld's patch included.
func LoadWorldSafeLocs(dataDir string) ([]byte, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	return set.ReadFile(WorldSafeLocsPath)
}

// serverSafeLocsPath is the server's copy of the table.
func serverSafeLocsPath(serverDir string) string {
	return filepath.Join(serverDir, "data", "5875", "dbc", "WorldSafeLocs.dbc")
}

// ReadServerSafeLocs reads the server's copy of WorldSafeLocs.dbc, nil when it has none.
func ReadServerSafeLocs(serverDir string) ([]byte, error) {
	b, err := os.ReadFile(serverSafeLocsPath(serverDir))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return b, err
}

func safeLocTable(dbc []byte) (*dbcTable, error) {
	return parseExact(dbc, dbcWorldSafeLocs)
}

// ReadGraveyards lists map mapID's graveyards by ID, without facings or links (GraveyardExtras).
func ReadGraveyards(dbc []byte, mapID uint32) ([]Graveyard, error) {
	t, err := safeLocTable(dbc)
	if err != nil {
		return nil, err
	}
	cm, cp, cn := t.col("MapID"), t.at("Pos", 0), t.col("Name")
	out := []Graveyard{}
	for r := 0; r < t.records; r++ {
		if t.u32(r, cm) != mapID {
			continue
		}
		out = append(out, Graveyard{ID: t.u32(r, 0), MapID: mapID, X: t.f32(r, cp), Y: t.f32(r, cp+1), Z: t.f32(r, cp+2), Name: t.str(r, cn), Links: []GraveyardLink{}})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// checkGraveyard refuses a graveyard the client or the server can't use.
func checkGraveyard(g Graveyard) error {
	if g.ID == 0 || g.ID > maxGraveyardID {
		return fmt.Errorf("graveyard %d: the ID must be 1 to %d", g.ID, maxGraveyardID)
	}
	if strings.TrimSpace(g.Name) == "" || strings.ContainsRune(g.Name, 0) {
		return fmt.Errorf("graveyard %d needs a name", g.ID)
	}
	if len(g.Name) > 256 {
		return fmt.Errorf("graveyard %d: the name is longer than 256 characters", g.ID)
	}
	if !finite(g.X, g.Y, g.Z, g.O) {
		return fmt.Errorf("graveyard %d has a position or facing that is not a number", g.ID)
	}
	seen := map[uint32]bool{}
	for _, l := range g.Links {
		if l.Zone == 0 || l.Zone > maxGraveyardID {
			return fmt.Errorf("graveyard %d: a link needs a zone", g.ID)
		}
		if l.Faction != GraveyardAnyone && l.Faction != GraveyardHorde && l.Faction != GraveyardAlliance {
			return fmt.Errorf("graveyard %d: zone %d's link is for faction %d, not anyone (0), the Horde (67) or the Alliance (469)", g.ID, l.Zone, l.Faction)
		}
		if seen[l.Zone] {
			// The server keeps one link a graveyard and zone (AddGraveYardLink).
			return fmt.Errorf("graveyard %d links zone %d twice", g.ID, l.Zone)
		}
		seen[l.Zone] = true
	}
	return nil
}

// SetGraveyards returns WorldSafeLocs.dbc with rows written (each replacing the record of its ID, its
// other locales' names kept, or added at the end when new) and the records of remove taken out. A
// new or renamed name goes at the end of the string block; the old string stays, unused. A table
// whose rows are unchanged comes back byte for byte.
func SetGraveyards(dbc []byte, rows []Graveyard, remove []uint32) ([]byte, error) {
	t, err := safeLocTable(dbc)
	if err != nil {
		return nil, err
	}
	gone := map[uint32]bool{}
	for _, id := range remove {
		if _, ok := t.row(id); !ok {
			return nil, fmt.Errorf("graveyard %d is not in the table", id)
		}
		gone[id] = true
	}
	seen := map[uint32]bool{}
	for _, g := range rows {
		if err := checkGraveyard(g); err != nil {
			return nil, err
		}
		if gone[g.ID] {
			return nil, fmt.Errorf("graveyard %d is both saved and removed", g.ID)
		}
		if seen[g.ID] {
			return nil, fmt.Errorf("graveyard %d is listed twice", g.ID)
		}
		seen[g.ID] = true
	}
	recs := append([]byte(nil), dbc[20:t.strsAt]...)
	strs := append([]byte(nil), dbc[t.strsAt:]...)
	n := t.records
	f := math.Float32bits
	cm, cp, cn, cmask := t.col("MapID"), t.at("Pos", 0), t.col("Name"), t.mask("Name")
	for _, g := range rows {
		r, ok := t.row(g.ID)
		if !ok {
			// A new record starts from the first one's locale mask, with the other locales empty.
			r = n
			n++
			rec := make([]uint32, t.fields)
			if t.records > 0 {
				rec[cmask] = t.u32(0, cmask)
			}
			recs = appendFields(recs, rec...)
		}
		at := r * t.recSize
		put := func(field int, v uint32) { binary.LittleEndian.PutUint32(recs[at+field*4:], v) }
		if !ok || t.str(r, cn) != g.Name {
			if len(strs) == 0 {
				strs = []byte{0}
			}
			put(cn, uint32(len(strs)))
			strs = append(append(strs, g.Name...), 0)
		}
		put(0, g.ID)
		put(cm, g.MapID)
		put(cp, f(g.X))
		put(cp+1, f(g.Y))
		put(cp+2, f(g.Z))
	}
	kept := recs
	if len(gone) > 0 {
		kept = nil
		left := 0
		for r := 0; r < n; r++ {
			if gone[binary.LittleEndian.Uint32(recs[r*t.recSize:])] {
				continue
			}
			kept = append(kept, recs[r*t.recSize:(r+1)*t.recSize]...)
			left++
		}
		n = left
	}
	return dbcFile(t.fields, n, kept, strs), nil
}

// NewGraveyardID is the first ID above every graveyard of the client's table, the server's copy
// (nil when it has none) and the world database's graveyard rows (serverMax, so a new graveyard
// never inherits the facing or links of one removed by hand).
func NewGraveyardID(dbc, serverDBC []byte, serverMax uint32) (uint32, error) {
	top := serverMax
	for _, b := range [][]byte{dbc, serverDBC} {
		if b == nil {
			continue
		}
		t, err := safeLocTable(b)
		if err != nil {
			return 0, err
		}
		for r := 0; r < t.records; r++ {
			top = max(top, t.u32(r, 0))
		}
	}
	if top >= maxGraveyardID {
		return 0, fmt.Errorf("no free graveyard ID (the last is %d)", top)
	}
	return top + 1, nil
}

func graveyardIDs(ids []uint32) string {
	s := make([]string, len(ids))
	for i, v := range ids {
		s[i] = strconv.FormatUint(uint64(v), 10)
	}
	return strings.Join(s, ", ")
}

// GraveyardSQL writes rows' facings into world_safe_locs_facing and their links into
// game_graveyard_zone, and takes the graveyards of remove out of both. A link the server already has
// (any patch range that holds at 1.12) is left as it is; one the row no longer lists goes, and a new
// one is written for every patch. No transaction of its own: runScript wraps the script in one.
func GraveyardSQL(rows []Graveyard, remove []uint32) string {
	var b strings.Builder
	if len(remove) > 0 {
		ids := append([]uint32{}, remove...)
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		in := graveyardIDs(ids)
		fmt.Fprintf(&b, "DELETE FROM `game_graveyard_zone` WHERE `id` IN (%s);\nDELETE FROM `world_safe_locs_facing` WHERE `id` IN (%s);\n", in, in)
	}
	for _, g := range rows {
		fmt.Fprintf(&b, "REPLACE INTO `world_safe_locs_facing` (`id`, `orientation`) VALUES (%d, %s);\n", g.ID, num32(g.O))
		fmt.Fprintf(&b, "DELETE FROM `game_graveyard_zone` WHERE `id` = %d AND `patch_max` >= %d", g.ID, graveyardPatch)
		if len(g.Links) > 0 {
			pairs := make([]string, len(g.Links))
			for i, l := range g.Links {
				pairs[i] = fmt.Sprintf("(%d, %d)", l.Zone, l.Faction)
			}
			fmt.Fprintf(&b, " AND (`ghost_zone`, `faction`) NOT IN (%s)", strings.Join(pairs, ", "))
		}
		b.WriteString(";\n")
		if len(g.Links) > 0 {
			vals := make([]string, len(g.Links))
			for i, l := range g.Links {
				vals[i] = fmt.Sprintf("(%d, %d, %d, 0, %d)", g.ID, l.Zone, l.Faction, graveyardPatch)
			}
			fmt.Fprintf(&b, "INSERT IGNORE INTO `game_graveyard_zone` (`id`, `ghost_zone`, `faction`, `patch_min`, `patch_max`) VALUES %s;\n", strings.Join(vals, ", "))
		}
	}
	return b.String()
}

// GraveyardExtras adds the world database's facings and links to graveyards (by ID), and returns the
// highest graveyard ID its tables name, for NewGraveyardID.
func GraveyardExtras(serverRoot string, graveyards []Graveyard) (uint32, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return 0, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return 0, err
	}
	return graveyardExtras(db, graveyards)
}

// graveyardExtras is GraveyardExtras on an open world database.
func graveyardExtras(db worldDB, graveyards []Graveyard) (uint32, error) {
	raw, err := runSQL(db, "SELECT GREATEST((SELECT COALESCE(MAX(`id`), 0) FROM `game_graveyard_zone`), (SELECT COALESCE(MAX(`id`), 0) FROM `world_safe_locs_facing`))")
	if err != nil {
		return 0, err
	}
	top := atou(string(raw))
	if len(graveyards) == 0 {
		return top, nil
	}
	byID := map[uint32]*Graveyard{}
	ids := make([]uint32, len(graveyards))
	for i := range graveyards {
		byID[graveyards[i].ID] = &graveyards[i]
		ids[i] = graveyards[i].ID
	}
	in := graveyardIDs(ids)
	raw, err = runSQL(db, fmt.Sprintf("SELECT `id`, `orientation` FROM `world_safe_locs_facing` WHERE `id` IN (%s)", in))
	if err != nil {
		return 0, err
	}
	for _, f := range batchRows(raw, 2) {
		if g := byID[f.u32(0)]; g != nil {
			g.O = f.f32(1)
		}
	}
	raw, err = runSQL(db, fmt.Sprintf("SELECT `id`, `ghost_zone`, `faction` FROM `game_graveyard_zone` WHERE `id` IN (%s) AND `patch_max` >= %d ORDER BY `id`, `ghost_zone`", in, graveyardPatch))
	if err != nil {
		return 0, err
	}
	for _, f := range batchRows(raw, 3) {
		if g := byID[f.u32(0)]; g != nil {
			g.Links = append(g.Links, GraveyardLink{Zone: f.u32(1), Faction: f.u32(2)})
		}
	}
	return top, nil
}

// InstallServerSafeLocs writes WorldSafeLocs.dbc into the server's data, keeping the first copy it
// replaces as a backup, and returns the file written.
func InstallServerSafeLocs(serverDir string, dbc []byte) (string, error) {
	return installServerDBC(serverDir, "WorldSafeLocs.dbc", dbc)
}

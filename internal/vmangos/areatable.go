package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"Meld/internal/mpq"
)

// areaCols are the AreaTable.dbc columns the zone editor reads and writes (dbcAreaTable's layout);
// the name's other locales and its locale mask are kept as the table has them.
type areaCols struct {
	id, mapID, parent, bit, flags, soundPref, soundSwim, ambience, music, intro, level, name, nameMask int
	faction, liquid, minElevation, ambientMul, light                                                   int
}

func areaColsOf(l *dbcLayout) areaCols {
	return areaCols{
		id: l.col("ID"), mapID: l.col("MapID"), parent: l.col("ParentID"), bit: l.col("AreaBit"), flags: l.col("Flags"),
		soundPref: l.col("SoundPref"), soundSwim: l.col("SoundPrefSwim"), ambience: l.col("Ambience"), music: l.col("Music"),
		intro: l.col("IntroMusic"), level: l.col("Level"), name: l.col("Name"), nameMask: l.mask("Name"),
		faction: l.col("Faction"), liquid: l.col("Liquid"), minElevation: l.col("MinElevation"), ambientMul: l.col("AmbientMul"),
		light: l.col("Light"),
	}
}

// MaxAreaBit is one past the last exploration bit a 1.12 player has (PLAYER_EXPLORED_ZONES is 64
// 32-bit fields), so a new area's bit must stay below it.
const MaxAreaBit = 64 * 32

// AreaRow is a whole row of AreaTable.dbc as the zone editor edits it: a zone (Parent 0) or a
// subzone of one. AreaBit is the area's exploration bit, unique across the table.
type AreaRow struct {
	ID         uint32 `json:"id"`
	MapID      uint32 `json:"mapId"`
	Parent     uint32 `json:"parent"`
	AreaBit    uint32 `json:"areaBit"`
	Flags      uint32 `json:"flags"`
	SoundPref  uint32 `json:"soundPref"`
	SoundSwim  uint32 `json:"soundSwim"`
	Ambience   uint32 `json:"ambience"`
	Music      uint32 `json:"music"`
	IntroMusic uint32 `json:"introMusic"`
	// Level is the exploration level: the level the exploration experience is reckoned from.
	Level int32  `json:"level"`
	Name  string `json:"name"`
	// Faction is the faction group mask: 2 Alliance, 4 Horde, 0 contested.
	Faction      uint32  `json:"faction"`
	Liquid       uint32  `json:"liquid"`
	MinElevation float32 `json:"minElevation"`
	AmbientMul   float32 `json:"ambientMul"`
	Light        uint32  `json:"light"`
}

// areaTable reads an AreaTable of a width Meld knows, with its columns.
func areaTable(dbc []byte) (*dbcTable, areaCols, error) {
	t, err := parseExact(dbc, dbcAreaTable)
	if err != nil {
		return nil, areaCols{}, err
	}
	return t, areaColsOf(t.l), nil
}

// ReadAreaRows lists the areas of a map in AreaTable.dbc, zones before their subzones and each by name.
func ReadAreaRows(dbc []byte, mapID uint32) ([]AreaRow, error) {
	t, c, err := areaTable(dbc)
	if err != nil {
		return nil, err
	}
	var rows []AreaRow
	for r := 0; r < t.records; r++ {
		if t.u32(r, c.mapID) != mapID {
			continue
		}
		rows = append(rows, AreaRow{
			ID: t.u32(r, c.id), MapID: mapID, Parent: t.u32(r, c.parent), AreaBit: t.u32(r, c.bit),
			Flags: t.u32(r, c.flags), SoundPref: t.u32(r, c.soundPref), SoundSwim: t.u32(r, c.soundSwim),
			Ambience: t.u32(r, c.ambience), Music: t.u32(r, c.music), IntroMusic: t.u32(r, c.intro),
			Level: int32(t.u32(r, c.level)), Name: t.str(r, c.name), Faction: t.u32(r, c.faction),
			Liquid: t.u32(r, c.liquid), MinElevation: t.f32(r, c.minElevation), AmbientMul: t.f32(r, c.ambientMul),
			Light: t.u32(r, c.light),
		})
	}
	sort.Slice(rows, func(i, j int) bool {
		if (rows[i].Parent == 0) != (rows[j].Parent == 0) {
			return rows[i].Parent == 0
		}
		return rows[i].Name < rows[j].Name
	})
	return rows, nil
}

// NewAreaRow is a new area on a map, under parent (0 for a zone): the first ID past the table's and
// the first free exploration bit past the table's, with the flags most of the client's areas have.
// A subzone takes its zone's sounds, music, faction and liquid.
func NewAreaRow(dbc []byte, mapID, parent uint32) (AreaRow, error) {
	t, c, err := areaTable(dbc)
	if err != nil {
		return AreaRow{}, err
	}
	var id, bit uint32
	for r := 0; r < t.records; r++ {
		id = max(id, t.u32(r, c.id))
		bit = max(bit, t.u32(r, c.bit))
	}
	if bit+1 >= MaxAreaBit {
		return AreaRow{}, errors.New("the client has no exploration bit left for another area")
	}
	row := AreaRow{ID: id + 1, MapID: mapID, Parent: parent, AreaBit: bit + 1, Flags: 64, Name: "New zone", AmbientMul: 0}
	if parent != 0 {
		p, ok := t.row(parent)
		if !ok {
			return AreaRow{}, fmt.Errorf("area %d is not in the table", parent)
		}
		row.Name = "New subzone"
		row.SoundPref, row.SoundSwim = t.u32(p, c.soundPref), t.u32(p, c.soundSwim)
		row.Ambience, row.Music, row.IntroMusic = t.u32(p, c.ambience), t.u32(p, c.music), t.u32(p, c.intro)
		row.Faction, row.Liquid, row.Level = t.u32(p, c.faction), t.u32(p, c.liquid), int32(t.u32(p, c.level))
	}
	return row, nil
}

// SetAreaRows returns AreaTable.dbc with the rows written: a row whose ID is in the table replaces
// that row's fields (its other locales' names and the locale mask are kept), and a new ID is added
// at the end. A changed name is added to the string block; the old string stays, unused.
func SetAreaRows(dbc []byte, rows []AreaRow) ([]byte, error) {
	t, c, err := areaTable(dbc)
	if err != nil {
		return nil, err
	}
	bits := map[uint32]uint32{}
	for r := 0; r < t.records; r++ {
		bits[t.u32(r, c.bit)] = t.u32(r, c.id)
	}
	records := append([]byte(nil), dbc[20:t.strsAt]...)
	strs := append([]byte(nil), dbc[t.strsAt:]...)
	added := 0
	for _, a := range rows {
		if a.ID == 0 {
			return nil, errors.New("an area needs an ID")
		}
		if strings.TrimSpace(a.Name) == "" || strings.ContainsRune(a.Name, 0) {
			return nil, fmt.Errorf("area %d needs a name", a.ID)
		}
		if a.Parent == a.ID {
			return nil, fmt.Errorf("area %d can't be its own zone", a.ID)
		}
		if a.AreaBit >= MaxAreaBit {
			return nil, fmt.Errorf("area %d's exploration bit %d is past the client's %d", a.ID, a.AreaBit, MaxAreaBit)
		}
		if owner, ok := bits[a.AreaBit]; ok && owner != a.ID {
			return nil, fmt.Errorf("area %d's exploration bit %d is area %d's", a.ID, a.AreaBit, owner)
		}
		bits[a.AreaBit] = a.ID
		at := -1
		if r, ok := t.row(a.ID); ok {
			at = r * t.recSize
		} else {
			// A new row starts from the first row's fields, so its other locales and mask are the client's kind.
			at = len(records)
			records = append(records, records[:t.recSize]...)
			for f := c.name + 1; f < c.nameMask; f++ {
				binary.LittleEndian.PutUint32(records[at+f*4:], 0)
			}
			added++
		}
		put := func(f int, v uint32) { binary.LittleEndian.PutUint32(records[at+f*4:], v) }
		old := binary.LittleEndian.Uint32(records[at+c.name*4:])
		if at >= t.records*t.recSize || t.str(at/t.recSize, c.name) != a.Name || old == 0 {
			put(c.name, uint32(len(strs)))
			strs = append(strs, a.Name...)
			strs = append(strs, 0)
		}
		put(c.id, a.ID)
		put(c.mapID, a.MapID)
		put(c.parent, a.Parent)
		put(c.bit, a.AreaBit)
		put(c.flags, a.Flags)
		put(c.soundPref, a.SoundPref)
		put(c.soundSwim, a.SoundSwim)
		put(c.ambience, a.Ambience)
		put(c.music, a.Music)
		put(c.intro, a.IntroMusic)
		put(c.level, uint32(a.Level))
		put(c.faction, a.Faction)
		put(c.liquid, a.Liquid)
		put(c.minElevation, math.Float32bits(a.MinElevation))
		put(c.ambientMul, math.Float32bits(a.AmbientMul))
		put(c.light, a.Light)
		if _, ok := t.row(a.ID); !ok {
			// Two new rows with one ID would both be added; index the new one.
			t.byID[a.ID] = at / t.recSize
		}
	}
	var out []byte
	out = append(out, "WDBC"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(t.records+added))
	out = binary.LittleEndian.AppendUint32(out, uint32(t.fields))
	out = binary.LittleEndian.AppendUint32(out, uint32(t.recSize))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(strs)))
	out = append(out, records...)
	return append(out, strs...), nil
}

// AreaSQL writes the rows into the world database's area_template, which the server reads its areas
// from (not from AreaTable.dbc): the zone, exploration bit, flags, level, name, team and liquid.
// No transaction of its own: runScript wraps the script in one, and opening another inside
// it would commit the outer one.
func AreaSQL(rows []AreaRow) string {
	var b strings.Builder
	for _, a := range rows {
		fmt.Fprintf(&b, "REPLACE INTO area_template (entry, map_id, zone_id, explore_flag, flags, area_level, name, team, liquid_type) VALUES (%d, %d, %d, %d, %d, %d, %s, %d, %d);\n",
			a.ID, a.MapID, a.Parent, a.AreaBit, a.Flags, a.Level, sqlQuote(a.Name), a.Faction, a.Liquid)
	}
	return b.String()
}

// AreaTablePath is AreaTable.dbc's name in the client's archives.
const AreaTablePath = `DBFilesClient\AreaTable.dbc`

// LoadAreaTable reads the client's AreaTable.dbc as the game sees it, Meld's patch included.
func LoadAreaTable(dataDir string) ([]byte, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	return set.ReadFile(AreaTablePath)
}

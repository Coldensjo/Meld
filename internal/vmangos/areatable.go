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

// AreaTable.dbc in 1.12 has 25 fields a row. These are the ones the zone editor reads and writes;
// fields 12 to 18 are the other locales' names, and 19 the names' locale mask, which are kept.
const (
	areaFields        = 25
	areaID            = 0
	areaMap           = 1
	areaParent        = 2
	areaBit           = 3
	areaFlags         = 4
	areaSoundPref     = 5
	areaSoundPrefSwim = 6
	areaAmbience      = 7
	areaMusic         = 8
	areaIntroMusic    = 9
	areaLevel         = 10
	areaName          = 11
	areaNameMask      = 19
	areaFaction       = 20
	areaLiquid        = 21
	areaMinElevation  = 22
	areaAmbientMul    = 23
	areaLight         = 24
)

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

// areaTable checks a DBC is a 1.12 AreaTable.
func areaTable(dbc []byte) (*dbcTable, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.fields != areaFields || t.recSize != areaFields*4 {
		return nil, fmt.Errorf("AreaTable.dbc has %d fields, not the 1.12 client's %d", t.fields, areaFields)
	}
	return t, nil
}

// ReadAreaRows lists the areas of a map in AreaTable.dbc, zones before their subzones and each by name.
func ReadAreaRows(dbc []byte, mapID uint32) ([]AreaRow, error) {
	t, err := areaTable(dbc)
	if err != nil {
		return nil, err
	}
	var rows []AreaRow
	for r := 0; r < t.records; r++ {
		if t.u32(r, areaMap) != mapID {
			continue
		}
		rows = append(rows, AreaRow{
			ID: t.u32(r, areaID), MapID: mapID, Parent: t.u32(r, areaParent), AreaBit: t.u32(r, areaBit),
			Flags: t.u32(r, areaFlags), SoundPref: t.u32(r, areaSoundPref), SoundSwim: t.u32(r, areaSoundPrefSwim),
			Ambience: t.u32(r, areaAmbience), Music: t.u32(r, areaMusic), IntroMusic: t.u32(r, areaIntroMusic),
			Level: int32(t.u32(r, areaLevel)), Name: t.str(r, areaName), Faction: t.u32(r, areaFaction),
			Liquid: t.u32(r, areaLiquid), MinElevation: t.f32(r, areaMinElevation), AmbientMul: t.f32(r, areaAmbientMul),
			Light: t.u32(r, areaLight),
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
	t, err := areaTable(dbc)
	if err != nil {
		return AreaRow{}, err
	}
	var id, bit uint32
	for r := 0; r < t.records; r++ {
		id = max(id, t.u32(r, areaID))
		bit = max(bit, t.u32(r, areaBit))
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
		row.SoundPref, row.SoundSwim = t.u32(p, areaSoundPref), t.u32(p, areaSoundPrefSwim)
		row.Ambience, row.Music, row.IntroMusic = t.u32(p, areaAmbience), t.u32(p, areaMusic), t.u32(p, areaIntroMusic)
		row.Faction, row.Liquid, row.Level = t.u32(p, areaFaction), t.u32(p, areaLiquid), int32(t.u32(p, areaLevel))
	}
	return row, nil
}

// SetAreaRows returns AreaTable.dbc with the rows written: a row whose ID is in the table replaces
// that row's fields (its other locales' names and the locale mask are kept), and a new ID is added
// at the end. A changed name is added to the string block; the old string stays, unused.
func SetAreaRows(dbc []byte, rows []AreaRow) ([]byte, error) {
	t, err := areaTable(dbc)
	if err != nil {
		return nil, err
	}
	bits := map[uint32]uint32{}
	for r := 0; r < t.records; r++ {
		bits[t.u32(r, areaBit)] = t.u32(r, areaID)
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
			for f := areaName + 1; f < areaNameMask; f++ {
				binary.LittleEndian.PutUint32(records[at+f*4:], 0)
			}
			added++
		}
		put := func(f int, v uint32) { binary.LittleEndian.PutUint32(records[at+f*4:], v) }
		old := binary.LittleEndian.Uint32(records[at+areaName*4:])
		if at >= t.records*t.recSize || t.str(at/t.recSize, areaName) != a.Name || old == 0 {
			put(areaName, uint32(len(strs)))
			strs = append(strs, a.Name...)
			strs = append(strs, 0)
		}
		put(areaID, a.ID)
		put(areaMap, a.MapID)
		put(areaParent, a.Parent)
		put(areaBit, a.AreaBit)
		put(areaFlags, a.Flags)
		put(areaSoundPref, a.SoundPref)
		put(areaSoundPrefSwim, a.SoundSwim)
		put(areaAmbience, a.Ambience)
		put(areaMusic, a.Music)
		put(areaIntroMusic, a.IntroMusic)
		put(areaLevel, uint32(a.Level))
		put(areaFaction, a.Faction)
		put(areaLiquid, a.Liquid)
		put(areaMinElevation, math.Float32bits(a.MinElevation))
		put(areaAmbientMul, math.Float32bits(a.AmbientMul))
		put(areaLight, a.Light)
		if _, ok := t.row(a.ID); !ok {
			// Two new rows with one ID would both be added; index the new one.
			t.byID[a.ID] = at / t.recSize
		}
	}
	var out []byte
	out = append(out, "WDBC"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(t.records+added))
	out = binary.LittleEndian.AppendUint32(out, areaFields)
	out = binary.LittleEndian.AppendUint32(out, areaFields*4)
	out = binary.LittleEndian.AppendUint32(out, uint32(len(strs)))
	out = append(out, records...)
	return append(out, strs...), nil
}

// AreaSQL writes the rows into the world database's area_template, which the server reads its areas
// from (not from AreaTable.dbc): the zone, exploration bit, flags, level, name, team and liquid.
func AreaSQL(rows []AreaRow) string {
	var b strings.Builder
	b.WriteString("START TRANSACTION;\n")
	for _, a := range rows {
		fmt.Fprintf(&b, "REPLACE INTO area_template (entry, map_id, zone_id, explore_flag, flags, area_level, name, team, liquid_type) VALUES (%d, %d, %d, %d, %d, %d, %s, %d, %d);\n",
			a.ID, a.MapID, a.Parent, a.AreaBit, a.Flags, a.Level, sqlQuote(a.Name), a.Faction, a.Liquid)
	}
	b.WriteString("COMMIT;\n")
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

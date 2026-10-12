package vmangos

import (
	"sort"

	"WorldEditor/internal/mpq"
)

// The instance types the client's Map.dbc gives in its type field.
const (
	MapContinent = iota
	MapDungeon
	MapRaid
	MapBattleground
	MapArena
)

// MapEntry is a row of the client's Map.dbc: a map the client can load.
type MapEntry struct {
	ID   uint32
	Dir  string
	Type int
	Name string
}

// ReadMapEntries lists the maps in a Map.dbc, by ID. Field 1 is the folder, field 2 the instance
// type, and field 4 the English name.
func ReadMapEntries(dbc []byte) ([]MapEntry, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	entries := make([]MapEntry, 0, t.records)
	for r := 0; r < t.records; r++ {
		e := MapEntry{ID: t.u32(r, 0)}
		if t.fields > 1 {
			e.Dir = t.str(r, 1)
		}
		if t.fields > 2 {
			e.Type = int(t.u32(r, 2))
		}
		if t.fields > 4 {
			e.Name = t.str(r, 4)
		}
		entries = append(entries, e)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	return entries, nil
}

// LoadMapEntries reads the client's Map.dbc from its data folder.
func LoadMapEntries(dataDir string) ([]MapEntry, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	b, err := set.ReadFile(`DBFilesClient\Map.dbc`)
	if err != nil {
		return nil, err
	}
	return ReadMapEntries(b)
}

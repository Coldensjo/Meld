package vmangos

import (
	"sort"

	"Meld/internal/mpq"
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

// ReadMapEntries lists the maps in a Map.dbc, by ID: each map's folder, instance type and English
// name, those a narrower table has.
func ReadMapEntries(dbc []byte) ([]MapEntry, error) {
	t, err := parseTable(dbc, dbcMap)
	if err != nil {
		return nil, err
	}
	dir, typ, name := t.col("Directory"), t.col("InstanceType"), t.col("Name")
	entries := make([]MapEntry, 0, t.records)
	for r := 0; r < t.records; r++ {
		e := MapEntry{ID: t.u32(r, 0)}
		if t.fields > dir {
			e.Dir = t.str(r, dir)
		}
		if t.fields > typ {
			e.Type = int(t.u32(r, typ))
		}
		if t.fields > name {
			e.Name = t.str(r, name)
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
	b, err := set.ReadFile(dbcMap.file())
	if err != nil {
		return nil, err
	}
	return ReadMapEntries(b)
}

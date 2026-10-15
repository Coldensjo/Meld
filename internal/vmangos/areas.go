package vmangos

import (
	"errors"
	"sort"

	"Meld/internal/mpq"
)

// Area is a row of the client's AreaTable.dbc: a zone or a subzone, which a chunk names in its
// header to say where a player standing on it is.
type Area struct {
	ID uint32 `json:"id"`
	// MapID is the map (Map.dbc) the area is on.
	MapID uint32 `json:"mapId"`
	// Parent is the zone a subzone is part of, 0 for a zone.
	Parent uint32 `json:"parent"`
	Name   string `json:"name"`
}

// ReadAreas lists AreaTable.dbc's areas: field 0 is the ID, 1 the map, 2 the parent area and 11 the
// English name. Rows without a name are left out. The list is by map, then name.
func ReadAreas(dbc []byte) ([]Area, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.fields <= 11 {
		return nil, errors.New("AreaTable.dbc has too few fields")
	}
	areas := make([]Area, 0, t.records)
	for r := 0; r < t.records; r++ {
		a := Area{ID: t.u32(r, 0), MapID: t.u32(r, 1), Parent: t.u32(r, 2), Name: t.str(r, 11)}
		if a.ID == 0 || a.Name == "" {
			continue
		}
		areas = append(areas, a)
	}
	sort.Slice(areas, func(i, j int) bool {
		if areas[i].MapID != areas[j].MapID {
			return areas[i].MapID < areas[j].MapID
		}
		return areas[i].Name < areas[j].Name
	})
	return areas, nil
}

// LoadAreas reads the client's areas from its data folder.
func LoadAreas(dataDir string) ([]Area, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	b, err := set.ReadFile(`DBFilesClient\AreaTable.dbc`)
	if err != nil {
		return nil, err
	}
	return ReadAreas(b)
}

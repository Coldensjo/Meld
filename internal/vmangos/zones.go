package vmangos

import (
	"errors"
	"math"
	"sort"

	"Meld/internal/mpq"
)

// Zone is a named part of a map (Elwynn Forest, Durotar…) as a rectangle of tiles, from the
// client's WorldMapArea.dbc. X0/Y0 are the top-left tile and X1/Y1 one past the bottom-right.
type Zone struct {
	MapID uint32
	// AreaID is the zone's AreaTable.dbc ID.
	AreaID uint32
	Name   string
	X0     int
	Y0     int
	X1     int
	Y1     int
}

// TileYards is the width of a tile in yards.
const TileYards = 1600.0 / 3

// ReadZones lists the zones of WorldMapArea.dbc: field 1 is the map, field 2 the area (0 for a
// whole continent, which is left out), field 3 the internal name, and fields 4 to 7 the extent in
// world yards as left, right, top, bottom. `names` gives an area ID's English name, if known.
func ReadZones(dbc []byte, names map[uint32]string) ([]Zone, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.fields < 8 {
		return nil, errors.New("WorldMapArea.dbc has too few fields")
	}
	f32 := func(r, f int) float64 { return float64(math.Float32frombits(t.u32(r, f))) }
	// World x runs north (up the map, decreasing tile row) and y runs west (decreasing tile column).
	col := func(y float64) float64 { return 32 - y/TileYards }
	row := func(x float64) float64 { return 32 - x/TileYards }
	var zones []Zone
	for r := 0; r < t.records; r++ {
		area := t.u32(r, 2)
		if area == 0 {
			continue
		}
		left, right, top, bottom := f32(r, 4), f32(r, 5), f32(r, 6), f32(r, 7)
		z := Zone{
			MapID:  t.u32(r, 1),
			AreaID: area,
			Name:   names[area],
			X0:     zoneTile(math.Floor(col(left))),
			X1:     zoneTile(math.Ceil(col(right))),
			Y0:     zoneTile(math.Floor(row(top))),
			Y1:     zoneTile(math.Ceil(row(bottom))),
		}
		if z.Name == "" {
			z.Name = t.str(r, 3)
		}
		if z.X1 <= z.X0 || z.Y1 <= z.Y0 || z.Name == "" {
			continue
		}
		zones = append(zones, z)
	}
	sort.Slice(zones, func(i, j int) bool {
		if zones[i].MapID != zones[j].MapID {
			return zones[i].MapID < zones[j].MapID
		}
		return zones[i].Name < zones[j].Name
	})
	return zones, nil
}

func zoneTile(v float64) int {
	if v < 0 {
		return 0
	}
	if v > MapTiles {
		return MapTiles
	}
	return int(v)
}

// ReadAreaNames maps area IDs to English names from AreaTable.dbc (field 11).
func ReadAreaNames(dbc []byte) (map[uint32]string, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	names := make(map[uint32]string, t.records)
	if t.fields <= 11 {
		return names, nil
	}
	for r := 0; r < t.records; r++ {
		names[t.u32(r, 0)] = t.str(r, 11)
	}
	return names, nil
}

// LoadZones reads the client's zones from its data folder.
func LoadZones(dataDir string) ([]Zone, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	names := map[uint32]string{}
	if b, err := set.ReadFile(`DBFilesClient\AreaTable.dbc`); err == nil {
		if n, err := ReadAreaNames(b); err == nil {
			names = n
		}
	}
	b, err := set.ReadFile(`DBFilesClient\WorldMapArea.dbc`)
	if err != nil {
		return nil, err
	}
	return ReadZones(b, names)
}

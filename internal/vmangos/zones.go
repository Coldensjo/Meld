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

// ReadZones lists the zones of WorldMapArea.dbc: each row's map, area (0 for a whole continent,
// which is left out), internal name, and extent in world yards as left, right, top, bottom. `names`
// gives an area ID's English name, if known.
func ReadZones(dbc []byte, names map[uint32]string) ([]Zone, error) {
	t, err := parseTable(dbc, dbcWorldMapArea)
	if err != nil {
		return nil, err
	}
	if t.fields < t.l.columns {
		return nil, errors.New("WorldMapArea.dbc has too few fields")
	}
	mapCol, areaCol, nameCol := t.col("MapID"), t.col("AreaID"), t.col("Name")
	leftCol, rightCol, topCol, bottomCol := t.col("Left"), t.col("Right"), t.col("Top"), t.col("Bottom")
	f32 := func(r, f int) float64 { return float64(math.Float32frombits(t.u32(r, f))) }
	// World x runs north (up the map, decreasing tile row) and y runs west (decreasing tile column).
	col := func(y float64) float64 { return 32 - y/TileYards }
	row := func(x float64) float64 { return 32 - x/TileYards }
	var zones []Zone
	for r := 0; r < t.records; r++ {
		area := t.u32(r, areaCol)
		if area == 0 {
			continue
		}
		left, right, top, bottom := f32(r, leftCol), f32(r, rightCol), f32(r, topCol), f32(r, bottomCol)
		z := Zone{
			MapID:  t.u32(r, mapCol),
			AreaID: area,
			Name:   names[area],
			X0:     zoneTile(math.Floor(col(left))),
			X1:     zoneTile(math.Ceil(col(right))),
			Y0:     zoneTile(math.Floor(row(top))),
			Y1:     zoneTile(math.Ceil(row(bottom))),
		}
		if z.Name == "" {
			z.Name = t.str(r, nameCol)
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

// ReadAreaNames maps area IDs to English names from AreaTable.dbc.
func ReadAreaNames(dbc []byte) (map[uint32]string, error) {
	t, err := parseTable(dbc, dbcAreaTable)
	if err != nil {
		return nil, err
	}
	names := make(map[uint32]string, t.records)
	name := t.col("Name")
	if t.fields <= name {
		return names, nil
	}
	for r := 0; r < t.records; r++ {
		names[t.u32(r, 0)] = t.str(r, name)
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
	if b, err := set.ReadFile(dbcAreaTable.file()); err == nil {
		if n, err := ReadAreaNames(b); err == nil {
			names = n
		}
	}
	b, err := set.ReadFile(dbcWorldMapArea.file())
	if err != nil {
		return nil, err
	}
	return ReadZones(b, names)
}

package vmangos

import (
	"errors"
	"fmt"

	"Meld/internal/mpq"
)

// The 1.12 client's lighting tables, as the editor's preview reads them (Noggit Red's Sky, with the
// 1.12 layouts checked against the client): Light.dbc places a light on a map (12 fields: ID, map,
// position, inner and outer radius, and five LightParams IDs: clear, clear underwater, storm, storm
// underwater, death); a position of 0,0,0 is the map's global light. Positions and radii are in
// thirty-sixths of a yard. LightParams.dbc (9 fields) holds the glow and the water alphas, and each
// params row owns 18 colour bands in LightIntBand.dbc (ID params*18-17+i) and 6 float bands in
// LightFloatBand.dbc (ID params*6-5+i), each a list of up to 16 times (half-minutes, 2880 a day) and
// values.

// LightBands is the number of colour bands a LightParams row owns.
const LightBands = 18

// LightFloats is the number of float bands a LightParams row owns.
const LightFloats = 6

// lightScale turns Light.dbc's positions and radii into yards.
const lightScale = 36

// MapLight is a light of a map in yards: X and Z as the tiles' placements have them (the file's
// frame), Y the height; Inner and Outer the radii it is full and fades out over. Params are its five
// LightParams IDs (clear, clear underwater, storm, storm underwater, death).
type MapLight struct {
	ID     uint32    `json:"id"`
	X      float32   `json:"x"`
	Y      float32   `json:"y"`
	Z      float32   `json:"z"`
	Inner  float32   `json:"inner"`
	Outer  float32   `json:"outer"`
	Global bool      `json:"global"`
	Params [5]uint32 `json:"params"`
}

// LightKey is one key of a band: the time in half-minutes and the value (an 0xRRGGBB colour for a
// colour band, the number for a float band).
type LightKey struct {
	T int     `json:"t"`
	V float64 `json:"v"`
}

// LightParamSet is a LightParams row with its bands: Colors[i] is colour band i (0 the sun's light,
// 1 the ambient, 2 to 6 the sky from top to horizon, 7 the fog, 9 the sun, 14 to 17 the shallow and
// deep ocean and river colours), Floats[i] float band i (0 the fog distance, 1 the fog multiplier).
type LightParamSet struct {
	ID         uint32       `json:"id"`
	Glow       float32      `json:"glow"`
	WaterAlpha [2]float32   `json:"waterAlpha"`
	OceanAlpha [2]float32   `json:"oceanAlpha"`
	Colors     [][]LightKey `json:"colors"`
	Floats     [][]LightKey `json:"floats"`
}

// MapLights is a map's lights and the LightParams rows they name.
type MapLights struct {
	MapID  uint32                   `json:"mapId"`
	Lights []MapLight               `json:"lights"`
	Params map[uint32]LightParamSet `json:"params"`
}

// ReadMapLights reads a map's lights from the four tables. A map without a global light of its own
// takes Azeroth's (map 0), as a new map has none.
func ReadMapLights(light, params, intBand, floatBand []byte, mapID uint32) (*MapLights, error) {
	lt, err := parseDBC(light)
	if err != nil {
		return nil, fmt.Errorf("Light.dbc: %w", err)
	}
	if lt.fields < 12 {
		return nil, fmt.Errorf("Light.dbc has %d fields, not the 1.12 client's 12", lt.fields)
	}
	row := func(r int) MapLight {
		l := MapLight{
			ID: lt.u32(r, 0),
			X:  lt.f32(r, 2) / lightScale, Y: lt.f32(r, 3) / lightScale, Z: lt.f32(r, 4) / lightScale,
			Inner: lt.f32(r, 5) / lightScale, Outer: lt.f32(r, 6) / lightScale,
		}
		l.Global = lt.f32(r, 2) == 0 && lt.f32(r, 3) == 0 && lt.f32(r, 4) == 0
		for i := range l.Params {
			l.Params[i] = lt.u32(r, 7+i)
		}
		return l
	}
	out := &MapLights{MapID: mapID, Params: map[uint32]LightParamSet{}}
	hasGlobal := false
	for r := 0; r < lt.records; r++ {
		if lt.u32(r, 1) != mapID {
			continue
		}
		l := row(r)
		hasGlobal = hasGlobal || l.Global
		out.Lights = append(out.Lights, l)
	}
	if !hasGlobal {
		for r := 0; r < lt.records; r++ {
			if l := row(r); lt.u32(r, 1) == 0 && l.Global {
				out.Lights = append(out.Lights, l)
				break
			}
		}
	}
	pt, err := parseDBC(params)
	if err != nil {
		return nil, fmt.Errorf("LightParams.dbc: %w", err)
	}
	it, err := parseDBC(intBand)
	if err != nil {
		return nil, fmt.Errorf("LightIntBand.dbc: %w", err)
	}
	ft, err := parseDBC(floatBand)
	if err != nil {
		return nil, fmt.Errorf("LightFloatBand.dbc: %w", err)
	}
	if pt.fields < 9 || it.fields < 34 || ft.fields < 34 {
		return nil, errors.New("the light tables aren't the 1.12 client's")
	}
	bands := func(t *dbcTable, id uint32, float bool) []LightKey {
		r, ok := t.row(id)
		if !ok {
			return nil
		}
		n := int(t.u32(r, 1))
		keys := make([]LightKey, 0, n)
		for k := 0; k < n && k < 16; k++ {
			v := float64(t.u32(r, 18+k))
			if float {
				v = float64(t.f32(r, 18+k))
			}
			keys = append(keys, LightKey{T: int(t.u32(r, 2+k)), V: v})
		}
		return keys
	}
	for _, l := range out.Lights {
		// The preview shows clear weather, so only each light's first params row is read.
		id := l.Params[0]
		if id == 0 {
			continue
		}
		if _, done := out.Params[id]; done {
			continue
		}
		r, ok := pt.row(id)
		if !ok {
			continue
		}
		p := LightParamSet{
			ID: id, Glow: pt.f32(r, 4),
			WaterAlpha: [2]float32{pt.f32(r, 5), pt.f32(r, 6)},
			OceanAlpha: [2]float32{pt.f32(r, 7), pt.f32(r, 8)},
		}
		for i := 0; i < LightBands; i++ {
			p.Colors = append(p.Colors, bands(it, id*LightBands-(LightBands-1)+uint32(i), false))
		}
		for i := 0; i < LightFloats; i++ {
			p.Floats = append(p.Floats, bands(ft, id*LightFloats-(LightFloats-1)+uint32(i), true))
		}
		out.Params[id] = p
	}
	return out, nil
}

// LoadMapLights reads a map's lights from the client.
func LoadMapLights(dataDir string, mapID uint32) (*MapLights, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	var tables [4][]byte
	for i, n := range []string{"Light", "LightParams", "LightIntBand", "LightFloatBand"} {
		if tables[i], err = set.ReadFile(`DBFilesClient\` + n + `.dbc`); err != nil {
			return nil, err
		}
	}
	return ReadMapLights(tables[0], tables[1], tables[2], tables[3], mapID)
}

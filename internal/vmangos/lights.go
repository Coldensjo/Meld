package vmangos

import (
	"bytes"
	"errors"
	"fmt"
	"math"

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
	// Borrowed marks Azeroth's global light, read for a map without a global light of its own: a
	// write under this map's ID would move Azeroth's row, so an imported global light takes a new ID.
	Borrowed bool `json:"borrowed,omitempty"`
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
	ID uint32 `json:"id"`
	// HighlightSky is LightParams field 1: the sky dome's dawn and dusk warp is on. It is read only;
	// a write keeps the client's.
	HighlightSky bool         `json:"highlightSky"`
	Glow         float32      `json:"glow"`
	WaterAlpha   [2]float32   `json:"waterAlpha"`
	OceanAlpha   [2]float32   `json:"oceanAlpha"`
	Colors       [][]LightKey `json:"colors"`
	Floats       [][]LightKey `json:"floats"`
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
				l.Borrowed = mapID != 0
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
	readParams := func(id uint32) {
		if id == 0 {
			return
		}
		if _, done := out.Params[id]; done {
			return
		}
		r, ok := pt.row(id)
		if !ok {
			return
		}
		p := LightParamSet{
			ID: id, HighlightSky: pt.u32(r, 1) != 0, Glow: pt.f32(r, 4),
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
	for _, l := range out.Lights {
		// The preview reads each light's clear-weather params and its storm ones, which the client
		// blends over them in rain, snow and sandstorms (Lighting › Weather Preview, #185).
		readParams(l.Params[0])
		readParams(l.Params[2])
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

// LightsEdit is what the light editor saves: lights of a map (edited or new, by ID) and the params rows
// they use (edited or new, with all their bands).
type LightsEdit struct {
	MapID  uint32          `json:"mapId"`
	Lights []MapLight      `json:"lights"`
	Params []LightParamSet `json:"params"`
}

// lightTables are the four light DBCs, in the order LoadMapLights reads them.
var lightTables = [4]string{"Light", "LightParams", "LightIntBand", "LightFloatBand"}

// lightTablePath is a light table's name in the client's archives.
func lightTablePath(name string) string { return `DBFilesClient\` + name + `.dbc` }

// WriteLights returns the four tables with the edit's lights and params written: a light's row is
// replaced by its ID or added (a global light keeps its position at 0,0,0), a params row keeps its sky
// box and cloud fields (a new one takes the first row's) and gets its glow and water alphas, and each
// of its 18 colour and 6 float bands is written whole. A band holds at most 16 keys, in time order
// within the day (0 to 2879 half-minutes), unless it is sent back as the client already has it.
func WriteLights(tables [4][]byte, e LightsEdit) ([4][]byte, error) {
	var out [4][]byte
	pt, err := parseDBC(tables[1])
	if err != nil {
		return out, fmt.Errorf("LightParams.dbc: %w", err)
	}
	it, err := parseDBC(tables[2])
	if err != nil {
		return out, fmt.Errorf("LightIntBand.dbc: %w", err)
	}
	ft, err := parseDBC(tables[3])
	if err != nil {
		return out, fmt.Errorf("LightFloatBand.dbc: %w", err)
	}
	var lightRows, paramRows, intRows, floatRows [][]uint32
	for _, l := range e.Lights {
		if l.ID == 0 {
			return out, errors.New("a light needs an ID")
		}
		if !l.Global && (l.Outer <= 0 || l.Inner < 0 || l.Inner > l.Outer) {
			return out, fmt.Errorf("light %d: the inner radius must be within the outer one", l.ID)
		}
		x, y, z := l.X, l.Y, l.Z
		if l.Global {
			x, y, z = 0, 0, 0
		}
		row := []uint32{l.ID, e.MapID, f32bits(x * lightScale), f32bits(y * lightScale), f32bits(z * lightScale), f32bits(l.Inner * lightScale), f32bits(l.Outer * lightScale)}
		for _, p := range l.Params {
			row = append(row, p)
		}
		lightRows = append(lightRows, row)
	}
	for _, p := range e.Params {
		if p.ID == 0 {
			return out, errors.New("a light's params need an ID")
		}
		if len(p.Colors) != LightBands || len(p.Floats) != LightFloats {
			return out, fmt.Errorf("params %d has %d colour and %d float bands, want %d and %d", p.ID, len(p.Colors), len(p.Floats), LightBands, LightFloats)
		}
		src := 0
		if r, ok := pt.row(p.ID); ok {
			src = r
		}
		paramRows = append(paramRows, []uint32{p.ID, pt.u32(src, 1), pt.u32(src, 2), pt.u32(src, 3), f32bits(p.Glow),
			f32bits(p.WaterAlpha[0]), f32bits(p.WaterAlpha[1]), f32bits(p.OceanAlpha[0]), f32bits(p.OceanAlpha[1])})
		band := func(t *dbcTable, id uint32, keys []LightKey, float bool) ([]uint32, error) {
			if len(keys) > 16 {
				return nil, fmt.Errorf("params %d: a band has %d keys, the client takes 16", p.ID, len(keys))
			}
			// An existing row keeps what its unused key slots hold (the client's are 0xcccccccc).
			row := make([]uint32, 34)
			r, had := t.row(id)
			if had {
				for f := range row {
					row[f] = t.u32(r, f)
				}
				// A band whose times are sent back as the client has them keeps them as they are, with
				// only the changed values written: a few of the client's own bands (params 8 and 499)
				// list their keys out of time order, which the client walks as a cycle in file order
				// (Benilla's light/tables.rs, segment), so they must neither be refused nor sorted,
				// and recolouring one of their keys must not reorder them (#276).
				if sameBandTimes(row, keys) {
					for k, key := range keys {
						if row[18+k] != bandValue(key, float, false) {
							row[18+k] = bandValue(key, float, true)
						}
					}
					return row, nil
				}
			}
			row[0], row[1] = id, uint32(len(keys))
			last := -1
			for k, key := range keys {
				if key.T <= last || key.T >= 2880 {
					return nil, fmt.Errorf("params %d: band keys must run through the day in order (half-minutes 0 to 2879)", p.ID)
				}
				last = key.T
				row[2+k] = uint32(key.T)
				row[18+k] = bandValue(key, float, true)
			}
			return row, nil
		}
		for i, keys := range p.Colors {
			row, err := band(it, p.ID*LightBands-(LightBands-1)+uint32(i), keys, false)
			if err != nil {
				return out, err
			}
			intRows = append(intRows, row)
		}
		for i, keys := range p.Floats {
			row, err := band(ft, p.ID*LightFloats-(LightFloats-1)+uint32(i), keys, true)
			if err != nil {
				return out, err
			}
			floatRows = append(floatRows, row)
		}
	}
	for i, rows := range [4][][]uint32{lightRows, paramRows, intRows, floatRows} {
		if len(rows) == 0 {
			out[i] = tables[i]
			continue
		}
		if out[i], err = setRecords(tables[i], rows); err != nil {
			return out, fmt.Errorf("%s.dbc: %w", lightTables[i], err)
		}
	}
	return out, nil
}

// sameBandTimes tells whether keys have the times a band's row (34 fields: ID, count, 16 times,
// 16 values) already holds, in the same order.
func sameBandTimes(row []uint32, keys []LightKey) bool {
	if row[1] != uint32(len(keys)) {
		return false
	}
	for k, key := range keys {
		if row[2+k] != uint32(key.T) {
			return false
		}
	}
	return true
}

// bandValue is a key's value as a band row holds it. Unmasked, a colour keeps the bits it was read
// with, so a value sent back unchanged compares equal to the row's and the row's own bits are kept.
func bandValue(key LightKey, float, masked bool) uint32 {
	if float {
		return f32bits(float32(key.V))
	}
	if masked {
		return uint32(key.V) & 0xffffff
	}
	return uint32(key.V)
}

// NewLightIDs gives the IDs a new light and its params row take: past every light and params row in
// the tables, so the params row's bands (whose IDs follow from it) are new too.
func NewLightIDs(light, params []byte) (lightID, paramsID uint32, err error) {
	lt, err := parseDBC(light)
	if err != nil {
		return 0, 0, err
	}
	pt, err := parseDBC(params)
	if err != nil {
		return 0, 0, err
	}
	for r := 0; r < lt.records; r++ {
		lightID = max(lightID, lt.u32(r, 0))
	}
	for r := 0; r < pt.records; r++ {
		paramsID = max(paramsID, pt.u32(r, 0))
	}
	return lightID + 1, paramsID + 1, nil
}

func f32bits(f float32) uint32 { return math.Float32bits(f) }

// LoadLightTables reads the four light tables from the client (Meld's patch included).
func LoadLightTables(dataDir string) ([4][]byte, error) {
	var tables [4][]byte
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return tables, err
	}
	defer set.Close()
	for i, n := range lightTables {
		if tables[i], err = set.ReadFile(lightTablePath(n)); err != nil {
			return tables, err
		}
	}
	return tables, nil
}

// LightFiles are the light tables as patch files, only those the edit changed.
func LightFiles(before, after [4][]byte) []mpq.File {
	var files []mpq.File
	for i := range before {
		if !bytes.Equal(before[i], after[i]) {
			files = append(files, mpq.File{Name: lightTablePath(lightTables[i]), Data: after[i]})
		}
	}
	return files
}

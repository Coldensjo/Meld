package vmangos

import (
	"bytes"
	"encoding/binary"
	"math"
	"slices"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestClientMapLights reads Azeroth's lights from the client: its global light (Light 1, params 12)
// carries the ocean colours the liquid shader was tuned to (band 14: 0x213e2f at midnight, 0x114b59 at
// noon) and the fog distance 500 yards; a local light sits on the map in yards. A new map takes
// Azeroth's global light. It needs WOW_DIR.
func TestClientMapLights(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	az, err := LoadMapLights(dataDir, 0)
	if err != nil {
		t.Fatal(err)
	}
	var global *MapLight
	for i := range az.Lights {
		if az.Lights[i].Global {
			global = &az.Lights[i]
		}
	}
	if global == nil || global.ID != 1 || global.Params[0] != 12 {
		t.Fatalf("Azeroth's global light = %+v", global)
	}
	// The storm params (slot 2), which Weather Preview blends over the clear ones, are read too.
	if storm, ok := az.Params[global.Params[2]]; global.Params[2] == 0 || !ok || len(storm.Colors) != LightBands {
		t.Fatalf("Azeroth's storm params %d were not read", global.Params[2])
	}
	p := az.Params[12]
	if len(p.Colors) != LightBands || len(p.Colors[14]) == 0 || p.Colors[14][0].V != 0x213e2f {
		t.Fatalf("params 12 ocean band = %v", p.Colors)
	}
	noon := false
	for _, k := range p.Colors[14] {
		if k.T == 1440 && k.V == 0x114b59 {
			noon = true
		}
	}
	if !noon || p.Floats[0][0].V/36 < 400 || p.OceanAlpha != [2]float32{0.75, 1} {
		t.Fatalf("params 12: noon ocean %v, fog %v, ocean alpha %v", noon, p.Floats[0], p.OceanAlpha)
	}
	local := az.Lights[0]
	if local.Global {
		local = az.Lights[1]
	}
	if local.X < 0 || local.X > 64*533.34 || local.Outer <= local.Inner || local.Outer > 3000 {
		t.Fatalf("a local light in yards = %+v", local)
	}
	fresh, err := LoadMapLights(dataDir, 1901)
	if err != nil {
		t.Fatal(err)
	}
	if len(fresh.Lights) != 1 || fresh.Lights[0].ID != 1 {
		t.Fatalf("a new map's lights = %+v", fresh.Lights)
	}
	// Some of Azeroth's lights warp the sky at dawn and dusk (LightParams field 1), most don't.
	highlight := 0
	for _, p := range az.Params {
		if p.HighlightSky {
			highlight++
		}
	}
	if highlight == 0 || highlight == len(az.Params) {
		t.Fatalf("%d of Azeroth's %d params rows highlight the sky", highlight, len(az.Params))
	}
	t.Logf("Azeroth has %d lights, %d params rows, %d highlighting the sky", len(az.Lights), len(az.Params), highlight)
}

// TestClientLightsWriteBack writes Azeroth's own lights and params back unchanged (the params and band
// tables come out byte-identical, the bands with keys out of time order too; the lights within a float's
// rounding), then moves a light, edits a band
// key, adds a light with its own params and recolours a band out of time order, and reads them back.
// It needs WOW_DIR.
func TestClientLightsWriteBack(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	tables, err := LoadLightTables(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	az, err := ReadMapLights(tables[0], tables[1], tables[2], tables[3], 0)
	if err != nil {
		t.Fatal(err)
	}
	// Params 499 lists some band keys out of time order (#275), which must go back as they are.
	var params []LightParamSet
	unordered := 0
	for _, p := range az.Params {
		params = append(params, p)
		for _, b := range append(append([][]LightKey(nil), p.Colors...), p.Floats...) {
			for k := 1; k < len(b); k++ {
				if b[k].T <= b[k-1].T {
					unordered++
					break
				}
			}
		}
	}
	if unordered == 0 {
		t.Fatal("no band of Azeroth's keeps its keys out of time order, so the write-back no longer covers one")
	}
	same, err := WriteLights(tables, LightsEdit{MapID: 0, Lights: az.Lights, Params: params})
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < 4; i++ {
		if !bytes.Equal(same[i], tables[i]) {
			t.Fatalf("%s written back unchanged differs", lightTables[i])
		}
	}
	again, err := ReadMapLights(same[0], same[1], same[2], same[3], 0)
	if err != nil {
		t.Fatal(err)
	}
	for i, l := range again.Lights {
		w := az.Lights[i]
		if l.ID != w.ID || math.Abs(float64(l.X-w.X)) > 0.01 || math.Abs(float64(l.Outer-w.Outer)) > 0.01 || l.Params != w.Params {
			t.Fatalf("light %d written back as %+v, was %+v", w.ID, l, w)
		}
	}

	// Move a local light, recolour its params' fog at noon, and add a light of its own.
	local := az.Lights[0]
	if local.Global {
		local = az.Lights[1]
	}
	local.X += 10
	local.Outer += 5
	p := az.Params[local.Params[0]]
	p.Colors = append([][]LightKey(nil), p.Colors...)
	p.Colors[7] = []LightKey{{T: 0, V: 0x102030}, {T: 1440, V: 0xff8040}}
	lid, pid, err := NewLightIDs(tables[0], tables[1])
	if err != nil {
		t.Fatal(err)
	}
	fresh := MapLight{ID: lid, X: 9000, Y: 50, Z: 9000, Inner: 30, Outer: 60, Params: [5]uint32{pid}}
	np := az.Params[12]
	np.ID = pid
	out, err := WriteLights(tables, LightsEdit{MapID: 0, Lights: []MapLight{local, fresh}, Params: []LightParamSet{p, np}})
	if err != nil {
		t.Fatal(err)
	}
	back, err := ReadMapLights(out[0], out[1], out[2], out[3], 0)
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, l := range back.Lights {
		if l.ID == local.ID && math.Abs(float64(l.X-local.X)) < 0.01 && math.Abs(float64(l.Outer-local.Outer)) < 0.01 {
			found++
		}
		if l.ID == lid && l.Params[0] == pid && math.Abs(float64(l.Inner-30)) < 0.01 {
			found++
		}
	}
	fog := back.Params[local.Params[0]].Colors[7]
	if found != 2 || len(fog) != 2 || fog[1].V != 0xff8040 || len(back.Params[pid].Colors[14]) == 0 {
		t.Fatalf("after the edit: %d lights found, fog %v, new params %v", found, fog, back.Params[pid].Colors[14])
	}

	// Recolour one key of a colour band whose keys are out of time order: it keeps its stored order (#276).
	var up LightParamSet
	ub := -1
	for _, q := range az.Params {
		for i, b := range q.Colors {
			for k := 1; k < len(b) && ub < 0; k++ {
				if b[k].T <= b[k-1].T {
					up, ub = q, i
				}
			}
		}
		if ub >= 0 {
			break
		}
	}
	if ub < 0 {
		t.Fatal("no colour band of Azeroth's keeps its keys out of time order")
	}
	want := append([]LightKey(nil), up.Colors[ub]...)
	want[0].V = 0x123456
	up.Colors = append([][]LightKey(nil), up.Colors...)
	up.Colors[ub] = want
	rec, err := WriteLights(tables, LightsEdit{MapID: 0, Params: []LightParamSet{up}})
	if err != nil {
		t.Fatalf("recolouring a band out of time order: %v", err)
	}
	recBack, err := ReadMapLights(rec[0], rec[1], rec[2], rec[3], 0)
	if err != nil {
		t.Fatal(err)
	}
	got := recBack.Params[up.ID].Colors[ub]
	if len(got) != len(want) {
		t.Fatalf("recoloured band %d of params %d: %v, want %v", ub, up.ID, got, want)
	}
	for k := range want {
		if got[k].T != want[k].T || got[k].V != want[k].V {
			t.Fatalf("recoloured band %d of params %d: %v, want %v", ub, up.ID, got, want)
		}
	}
	if _, err := WriteLights(tables, LightsEdit{MapID: 0, Params: []LightParamSet{{ID: 12, Colors: make([][]LightKey, LightBands), Floats: [][]LightKey{{{T: 100}, {T: 50}}, nil, nil, nil, nil, nil}}}}); err == nil {
		t.Fatal("band keys out of order were accepted")
	}
}

// lightTestTables builds the four light tables without the client: Azeroth's global light (1, params 1)
// and a local light (2, params 2), with each params row's 18 colour and 6 float bands. Every band's
// unused key slots hold 0xcccccccc as the client's do, and params 1's colour band 9 lists its keys out
// of time order (2640, 2520, 0, 1440), as params 499's does in the client (#275).
func lightTestTables() [4][]byte {
	const unused = 0xcccccccc
	light := [][]uint32{
		{1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0},
		{2, 0, f32bits(100 * lightScale), f32bits(20 * lightScale), f32bits(200 * lightScale), f32bits(30 * lightScale), f32bits(60 * lightScale), 2, 0, 0, 0, 0},
	}
	params := [][]uint32{
		{1, 1, 7, 9, f32bits(0.5), f32bits(0.25), f32bits(0.75), f32bits(0.75), f32bits(1)},
		{2, 0, 3, 4, f32bits(0.1), f32bits(0.2), f32bits(0.3), f32bits(0.4), f32bits(0.5)},
	}
	band := func(id uint32, times []uint32, value func(k int) uint32) []uint32 {
		row := make([]uint32, 34)
		for i := range row {
			row[i] = unused
		}
		row[0], row[1] = id, uint32(len(times))
		for k, t := range times {
			row[2+k], row[18+k] = t, value(k)
		}
		return row
	}
	var ints, floats [][]uint32
	for p := uint32(1); p <= 2; p++ {
		for i := uint32(0); i < LightBands; i++ {
			times := []uint32{0, 1440}
			if p == 1 && i == 9 {
				times = []uint32{2640, 2520, 0, 1440}
			}
			ints = append(ints, band(p*LightBands-(LightBands-1)+i, times, func(k int) uint32 { return p<<20 | i<<8 | uint32(k) }))
		}
		for i := uint32(0); i < LightFloats; i++ {
			floats = append(floats, band(p*LightFloats-(LightFloats-1)+i, []uint32{0, 720, 2160}, func(k int) uint32 { return f32bits(float32(p*100 + i*10 + uint32(k))) }))
		}
	}
	return [4][]byte{dbcBytes(12, light, "\x00"), dbcBytes(9, params, "\x00"), dbcBytes(34, ints, "\x00"), dbcBytes(34, floats, "\x00")}
}

// fieldAt is the offset of a field of a row in a DBC of 32-bit fields.
func fieldAt(fields, row, field int) int { return 20 + (row*fields+field)*4 }

// TestWriteLightsSynthetic is the client-free check of WriteLights and LightFiles: tables written back
// unchanged come out byte-identical (unused 0xcccccccc slots and out-of-order keys too), recolouring one
// key of an out-of-order band changes only that value's four bytes (#275, #276), new times rewrite only
// that band and keep its unused slots, new lights and params are added, and LightFiles names only the
// changed tables, by the paths the client reads.
func TestWriteLightsSynthetic(t *testing.T) {
	tables := lightTestTables()
	az, err := ReadMapLights(tables[0], tables[1], tables[2], tables[3], 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(az.Lights) != 2 || len(az.Params) != 2 || !az.Lights[0].Global || az.Lights[1].X != 100 {
		t.Fatalf("read back: %+v", az)
	}

	same, err := WriteLights(tables, LightsEdit{MapID: 0, Lights: az.Lights, Params: []LightParamSet{az.Params[1], az.Params[2]}})
	if err != nil {
		t.Fatal(err)
	}
	for i := range tables {
		if !bytes.Equal(same[i], tables[i]) {
			t.Fatalf("%s written back unchanged differs", lightTables[i])
		}
	}
	if files := LightFiles(tables, same); len(files) != 0 {
		t.Fatalf("an unchanged write gives %d patch files", len(files))
	}

	// Recolour key 1 of params 1's out-of-order colour band 9 (row 9 of LightIntBand): only that value changes.
	up := az.Params[1]
	up.Colors = append([][]LightKey(nil), up.Colors...)
	up.Colors[9] = append([]LightKey(nil), up.Colors[9]...)
	up.Colors[9][1].V = 0x123456
	rec, err := WriteLights(tables, LightsEdit{MapID: 0, Params: []LightParamSet{up}})
	if err != nil {
		t.Fatalf("recolouring a band out of time order: %v", err)
	}
	want := bytes.Clone(tables[2])
	binary.LittleEndian.PutUint32(want[fieldAt(34, 9, 18+1):], 0x123456)
	if !bytes.Equal(rec[2], want) {
		t.Fatal("recolouring one key changed more than its value")
	}
	if !bytes.Equal(rec[0], tables[0]) || !bytes.Equal(rec[1], tables[1]) || !bytes.Equal(rec[3], tables[3]) {
		t.Fatal("recolouring a colour key changed another table")
	}
	files := LightFiles(tables, rec)
	if len(files) != 1 || files[0].Name != `DBFilesClient\LightIntBand.dbc` || !bytes.Equal(files[0].Data, rec[2]) {
		t.Fatalf("patch files after a recolour: %d", len(files))
	}

	// New times rewrite that band alone: params 2's float band 0 (ID 7, row 6) gets two keys. Its unused
	// slots keep 0xcccccccc.
	ft := az.Params[2]
	ft.Floats = append([][]LightKey(nil), ft.Floats...)
	ft.Floats[0] = []LightKey{{T: 100, V: 7}, {T: 2000, V: 8}}
	moved, err := WriteLights(tables, LightsEdit{MapID: 0, Params: []LightParamSet{ft}})
	if err != nil {
		t.Fatal(err)
	}
	fb, err := parseDBC(moved[3])
	if err != nil {
		t.Fatal(err)
	}
	r, _ := fb.row(7)
	if r != 6 || fb.u32(r, 1) != 2 || fb.u32(r, 2) != 100 || fb.u32(r, 3) != 2000 || fb.f32(r, 18) != 7 || fb.f32(r, 19) != 8 {
		t.Fatalf("float band 7 (row %d) has %d keys", r, fb.u32(r, 1))
	}
	for k := 3; k < 16; k++ {
		if fb.u32(r, 2+k) != 0xcccccccc || fb.u32(r, 18+k) != 0xcccccccc {
			t.Fatalf("float band 7's unused slot %d was overwritten", k)
		}
	}
	for row := 0; row < fb.records; row++ {
		at, end := fieldAt(34, row, 0), fieldAt(34, row+1, 0)
		if row != r && !bytes.Equal(moved[3][at:end], tables[3][at:end]) {
			t.Fatalf("float band row %d changed", row)
		}
	}
	if !bytes.Equal(moved[1], tables[1]) || !bytes.Equal(moved[2], tables[2]) {
		t.Fatal("a float band edit changed the params or colour bands")
	}
	if files := LightFiles(tables, moved); len(files) != 1 || files[0].Name != `DBFilesClient\LightFloatBand.dbc` {
		t.Fatalf("patch files after a float band edit: %d", len(files))
	}

	// Move the local light and add one with params of its own: every table changes, the global light's
	// row and the old rows' bands don't.
	lid, pid, err := NewLightIDs(tables[0], tables[1])
	if err != nil || lid != 3 || pid != 3 {
		t.Fatalf("new IDs %d, %d, %v", lid, pid, err)
	}
	local := az.Lights[1]
	local.X += 10
	np := az.Params[2]
	np.ID = pid
	fresh := MapLight{ID: lid, X: 50, Y: 5, Z: 50, Inner: 10, Outer: 20, Params: [5]uint32{pid}}
	added, err := WriteLights(tables, LightsEdit{MapID: 0, Lights: []MapLight{local, fresh}, Params: []LightParamSet{np}})
	if err != nil {
		t.Fatal(err)
	}
	back, err := ReadMapLights(added[0], added[1], added[2], added[3], 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.Lights) != 3 || back.Lights[1].X != 110 || back.Lights[2].ID != lid || back.Lights[2].Outer != 20 {
		t.Fatalf("after adding: %+v", back.Lights)
	}
	if got, was := back.Params[pid].Colors[9], az.Params[2].Colors[9]; !slices.Equal(got, was) {
		t.Fatalf("the new params' band 9 = %v, want %v", got, was)
	}
	if !bytes.Equal(added[0][20:fieldAt(12, 1, 0)], tables[0][20:fieldAt(12, 1, 0)]) {
		t.Fatal("the global light's row changed")
	}
	// The new params row takes the first row's sky box and cloud fields.
	pt, _ := parseDBC(added[1])
	if r, ok := pt.row(pid); !ok || pt.records != 3 || pt.u32(r, 1) != 1 || pt.u32(r, 2) != 7 || pt.u32(r, 3) != 9 {
		t.Fatalf("new params row: %d rows", pt.records)
	}
	for i := 1; i < 4; i++ {
		old := len(tables[i]) - 1 // the string block's one byte
		if !bytes.Equal(added[i][20:old], tables[i][20:old]) {
			t.Fatalf("%s's old rows changed when a params row was added", lightTables[i])
		}
	}
	var names []string
	for _, f := range LightFiles(tables, added) {
		names = append(names, f.Name)
	}
	if want := []string{`DBFilesClient\Light.dbc`, `DBFilesClient\LightParams.dbc`, `DBFilesClient\LightIntBand.dbc`, `DBFilesClient\LightFloatBand.dbc`}; !slices.Equal(names, want) {
		t.Fatalf("patch files %v, want %v", names, want)
	}

	// Changed times must run through the day in order, and a band holds 16 keys.
	bad := az.Params[2]
	bad.Floats = append([][]LightKey(nil), bad.Floats...)
	bad.Floats[1] = []LightKey{{T: 100}, {T: 50}}
	if _, err := WriteLights(tables, LightsEdit{Params: []LightParamSet{bad}}); err == nil {
		t.Fatal("band keys out of order were accepted")
	}
	bad.Floats[1] = make([]LightKey, 17)
	if _, err := WriteLights(tables, LightsEdit{Params: []LightParamSet{bad}}); err == nil {
		t.Fatal("a band of 17 keys was accepted")
	}
}

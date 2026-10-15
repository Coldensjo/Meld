package vmangos

import (
	"bytes"
	"math"
	"os"
	"testing"

	"Meld/internal/wow"
)

// TestClientMapLights reads Azeroth's lights from the client: its global light (Light 1, params 12)
// carries the ocean colours the liquid shader was tuned to (band 14: 0x213e2f at midnight, 0x114b59 at
// noon) and the fog distance 500 yards; a local light sits on the map in yards. A new map takes
// Azeroth's global light. It needs WOW_DIR.
func TestClientMapLights(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	t.Logf("Azeroth has %d lights, %d params rows", len(az.Lights), len(az.Params))
}

// TestClientLightsWriteBack writes Azeroth's own lights and params back unchanged (the params and band
// tables come out byte-identical; the lights within a float's rounding), then moves a light, edits a band
// key and adds a light with its own params, and reads them back. It needs WOW_DIR.
func TestClientLightsWriteBack(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	var params []LightParamSet
	for _, p := range az.Params {
		params = append(params, p)
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
	if _, err := WriteLights(tables, LightsEdit{MapID: 0, Params: []LightParamSet{{ID: 12, Colors: make([][]LightKey, LightBands), Floats: [][]LightKey{{{T: 100}, {T: 50}}, nil, nil, nil, nil, nil}}}}); err == nil {
		t.Fatal("band keys out of order were accepted")
	}
}

package vmangos

import (
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

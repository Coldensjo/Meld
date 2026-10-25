package vmangos

import (
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestRealZones reads the client's zones and checks Elwynn Forest sits where Goldshire is (tile
// 32,48 on Azeroth): WOW_DIR=/path/to/client go test ./internal/vmangos/ -run RealZones
func TestRealZones(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	zones, err := LoadZones(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	var elwynn, durotar *Zone
	for i := range zones {
		switch zones[i].Name {
		case "Elwynn Forest":
			elwynn = &zones[i]
		case "Durotar":
			durotar = &zones[i]
		}
	}
	if elwynn == nil || durotar == nil {
		t.Fatalf("zones not found among %d: %+v", len(zones), zones[:min(10, len(zones))])
	}
	if elwynn.MapID != 0 || elwynn.X0 > 32 || elwynn.X1 <= 32 || elwynn.Y0 > 48 || elwynn.Y1 <= 48 {
		t.Fatalf("Elwynn Forest = %+v, want it to cover tile 32,48 on map 0", *elwynn)
	}
	if durotar.MapID != 1 {
		t.Fatalf("Durotar = %+v, want map 1", *durotar)
	}
	t.Logf("Elwynn %+v, Durotar %+v", *elwynn, *durotar)
}

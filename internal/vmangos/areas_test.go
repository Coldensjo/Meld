package vmangos

import (
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestReadAreasFromClient checks the field layout against the client's own AreaTable.dbc: Elwynn
// Forest is zone 12 on Azeroth, and Goldshire (87) is a subzone of it. It needs WOW_DIR set.
func TestReadAreasFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	areas, err := LoadAreas(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[uint32]Area{}
	for _, a := range areas {
		byID[a.ID] = a
	}
	if a := byID[12]; a.Name != "Elwynn Forest" || a.MapID != 0 || a.Parent != 0 {
		t.Fatalf("area 12: %+v", a)
	}
	if a := byID[87]; a.Name != "Goldshire" || a.MapID != 0 || a.Parent != 12 {
		t.Fatalf("area 87: %+v", a)
	}
	if len(areas) < 1000 {
		t.Fatalf("only %d areas", len(areas))
	}
}

package vmangos

import (
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestLoadLiquidTypesFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := LoadLiquidTypes(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[int]LiquidTypeEntry{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	for id, want := range map[int]struct {
		name string
		kind int
	}{1: {"Water", 3}, 2: {"Ocean", 3}, 3: {"Magma", 0}, 4: {"Slime", 2}} {
		got, ok := byID[id]
		if !ok || got.Name != want.name || got.Kind != want.kind {
			t.Errorf("liquid %d: got %+v, want %s kind %d", id, got, want.name, want.kind)
		}
	}
}

package vmangos

import (
	"testing"

	"Meld/internal/clientbuild"
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

// A 3.3.5a table's kinds come in 1.12's numbers, and a 1.12 table's as they are.
func TestLiquidKind112(t *testing.T) {
	for kind, want := range map[int]int{0: 3, 1: 3, 2: 0, 3: 2} {
		if got := liquidKind112(clientbuild.WotLK, kind); got != want {
			t.Errorf("3.3.5a kind %d reads as %d, want %d", kind, got, want)
		}
	}
	for _, kind := range []int{0, 2, 3} {
		if got := liquidKind112(clientbuild.Vanilla, kind); got != kind {
			t.Errorf("1.12 kind %d reads as %d", kind, got)
		}
	}
}

package vmangos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

// TestExportMapInClientFolder exports with the read and patch folders the same, as the editor does
// when the client is its own Data folder. It fails if the read archives still hold the patch open.
// WOW_DIR=/path/to/client go test ./internal/vmangos/
func TestExportMapInClientFolder(t *testing.T) {
	src := testclient.DataDir(t)
	clientData, err := filepath.Abs(filepath.Join(src, "Data"))
	if err != nil {
		t.Fatal(err)
	}
	// A folder with the client's archives as hard links (no copy), and its own copy of the patch.
	dir := t.TempDir()
	entries, err := os.ReadDir(clientData)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".mpq") || strings.EqualFold(name, PatchName) {
			continue
		}
		if err := os.Link(filepath.Join(clientData, name), filepath.Join(dir, name)); err != nil {
			t.Skipf("cannot link the client's archives here: %v", err)
		}
	}
	patch, err := os.ReadFile(filepath.Join(clientData, PatchName))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, PatchName), patch, 0o644); err != nil {
		t.Fatal(err)
	}

	outer := make([]float32, LatticeSize*LatticeSize)
	spec := MapSpec{Dir: "InClientFolder", MapID: 1902, Tiles: []TileSpec{{X: 7, Y: 8, Outer: outer}}}
	res, err := ExportMap(dir, dir, "", spec)
	if err != nil {
		t.Fatalf("export in the client folder: %v", err)
	}
	arch, err := mpq.Open(res.Patch)
	if err != nil {
		t.Fatal(err)
	}
	defer arch.Close()
	if !arch.Has(adt.TilePath("InClientFolder", 7, 8, "")) {
		t.Fatal("the tile is not in the patch")
	}
}

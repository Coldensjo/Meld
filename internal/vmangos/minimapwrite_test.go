package vmangos

import (
	"path/filepath"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestMinimapFilesSetTheTiles writes two tiles, one of Northshire and one of a new map, into the
// client's index: both rows point at their BLPs, identical tiles share one file, and every other row
// stays. WOW_DIR=/path/to/client go test ./internal/vmangos/
func TestMinimapFilesSetTheTiles(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := set.ReadFile(wow.MinimapIndexPath)
	set.Close()
	if err != nil {
		t.Fatal(err)
	}
	before := wow.ParseMinimapIndex(raw)
	px := make([]byte, MinimapSide*MinimapSide*4)
	for i := range px {
		px[i] = byte(i * 7)
	}
	files, err := MinimapFiles(dataDir, "Azeroth", []MinimapTile{{X: 32, Y: 48, Pixels: px}})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 || files[1].Name != wow.MinimapIndexPath {
		t.Fatalf("files %d", len(files))
	}
	after := wow.ParseMinimapIndex(files[1].Data)
	name, _ := after.Tile("Azeroth", 32, 48)
	if files[0].Name != `textures\Minimap\`+name || name != wow.MinimapFileName(files[0].Data) {
		t.Fatalf("tile row %q, file %q", name, files[0].Name)
	}
	if after.Len() != before.Len() {
		t.Fatalf("rows %d, before %d", after.Len(), before.Len())
	}
	// A new map: its rows are added; two identical tiles store one BLP.
	files, err = MinimapFiles(dataDir, "MeldTest", []MinimapTile{{X: 0, Y: 0, Pixels: px}, {X: 1, Y: 0, Pixels: px}})
	if err != nil {
		t.Fatal(err)
	}
	after = wow.ParseMinimapIndex(files[len(files)-1].Data)
	a, okA := after.Tile("MeldTest", 0, 0)
	b, okB := after.Tile("MeldTest", 1, 0)
	if len(files) != 2 || !okA || !okB || a != b || after.Len() != before.Len()+2 {
		t.Fatalf("new map: %d files, rows %v %v, %d rows", len(files), okA, okB, after.Len())
	}
	if _, err := MinimapFiles(dataDir, "Azeroth", []MinimapTile{{X: 64, Y: 0, Pixels: px}}); err == nil {
		t.Fatal("a tile off the grid was accepted")
	}

	// Into a patch in a folder of its own (not the client's): the archive reads back with the index
	// row and a BLP that decodes.
	out := t.TempDir()
	patch, err := InstallPatch(out, files)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(patch) != PatchName {
		t.Fatalf("patch %s", patch)
	}
	arc, err := mpq.Open(patch)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := arc.ReadFile(wow.MinimapIndexPath)
	if err != nil {
		t.Fatal(err)
	}
	name, ok := wow.ParseMinimapIndex(idx).Tile("MeldTest", 1, 0)
	if !ok {
		t.Fatal("no row for the new tile in the written index")
	}
	blp, err := arc.ReadFile(`textures\Minimap\` + name)
	if err != nil {
		t.Fatal(err)
	}
	img, err := wow.DecodeBLP(blp)
	if err != nil || img.W != MinimapSide {
		t.Fatalf("tile %v, %v", img, err)
	}
	arc.Close()

	// The same tiles drawn again with other pixels: the patch keeps the new BLP, not the old (#164).
	for i := range px {
		px[i] = byte(i * 13)
	}
	again, err := MinimapFiles(dataDir, "MeldTest", []MinimapTile{{X: 0, Y: 0, Pixels: px}, {X: 1, Y: 0, Pixels: px}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InstallPatch(out, again); err != nil {
		t.Fatal(err)
	}
	arc2, err := mpq.Open(patch)
	if err != nil {
		t.Fatal(err)
	}
	defer arc2.Close()
	if arc2.Has(`textures\Minimap\` + name) {
		t.Fatal("the old tile stayed in the patch")
	}
	if !arc2.Has(again[0].Name) {
		t.Fatal("the new tile is missing")
	}
}

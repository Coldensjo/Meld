package vmangos

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// TestTileRoundTrip reads a real tile, edits one outer height and reads it back:
// WOW_DIR=/path/to/client go test ./internal/vmangos/
func TestTileRoundTrip(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.12 client to run")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, root, err := ReadTile(dataDir, "Azeroth", 32, 48)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Heights) != LatticeSize*LatticeSize || len(view.Chunks) != adt.ChunkCount {
		t.Fatalf("%d heights, %d chunks", len(view.Heights), len(view.Chunks))
	}
	same, err := PatchTileHeights(root, view.Heights)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(same, root) {
		t.Fatal("unchanged heights changed the tile")
	}

	const at = 50*LatticeSize + 60
	view.Heights[at] += 3
	patched, err := PatchTileHeights(root, view.Heights)
	if err != nil {
		t.Fatal(err)
	}
	back, err := viewOf(patched, false)
	if err != nil {
		t.Fatal(err)
	}
	if d := back.Heights[at] - view.Heights[at]; d > 0.01 || d < -0.01 {
		t.Fatalf("edited sample reads back %v, want %v", back.Heights[at], view.Heights[at])
	}
	moved := 0
	for i := range back.Heights {
		if d := back.Heights[i] - view.Heights[i]; d > 0.01 || d < -0.01 {
			moved++
		}
	}
	if moved != 0 {
		t.Errorf("%d samples differ after the edit", moved)
	}
}

// A save rebuilds a tile from the client without Meld's patch only: Azeroth_31_29 is in terrain.MPQ
// and in Blizzard's patch-2.MPQ, and the copy it starts from must be patch-2's (#273).
// It needs WOW_DIR set to the client.
func TestBaseTileRootKeepsBlizzardPatches(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	a, err := mpq.Open(filepath.Join(dataDir, "patch-2.MPQ"))
	if err != nil {
		t.Skip("no patch-2.MPQ in the client")
	}
	defer a.Close()
	want, err := a.ReadFile(adt.TilePath("Azeroth", 31, 29, ""))
	if err != nil {
		t.Skip("patch-2.MPQ has no Azeroth_31_29")
	}
	got, err := BaseTileRoot(dataDir, "Azeroth", 31, 29)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("the tile read without Meld's patch is %d bytes, not patch-2's %d", len(got), len(want))
	}
}

// Saving Azeroth_31_29 with nothing edited must write patch-2's tile, not terrain.MPQ's older one.
// It needs WOW_DIR set to the client, and is skipped when Meld's patch has the tile (the view is then
// the patch's).
func TestRegionSaveKeepsBlizzardPatch(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	name := adt.TilePath("Azeroth", 31, 29, "")
	if a, err := mpq.Open(filepath.Join(dataDir, PatchName)); err == nil {
		has := a.Has(name)
		a.Close()
		if has {
			t.Skip("Meld's patch has Azeroth_31_29")
		}
	}
	a, err := mpq.Open(filepath.Join(dataDir, "patch-2.MPQ"))
	if err != nil {
		t.Skip("no patch-2.MPQ in the client")
	}
	patched, err := a.ReadFile(name)
	a.Close()
	if err != nil {
		t.Skip("patch-2.MPQ has no Azeroth_31_29")
	}
	view, err := ReadRegion(dataDir, "Azeroth", 31, 29, 1)
	if err != nil {
		t.Fatal(err)
	}
	files, err := BuildRegion(dataDir, RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: view.Heights, Objects: view.Objects})
	if err != nil {
		t.Fatal(err)
	}
	// Patch-2 moved a few of the tile's height samples. With nothing edited, every sample written,
	// the inner ones rebuilt from the file the save starts from included, must be patch-2's.
	want, err := adt.ParseTerrain(patched)
	if err != nil {
		t.Fatal(err)
	}
	got, err := adt.ParseTerrain(files[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	for c := range want.Chunks {
		for k, h := range want.Chunks[c].Heights {
			if d := got.Chunks[c].Heights[k] - h; d > 1e-3 || d < -1e-3 {
				t.Fatalf("chunk %d sample %d: the save wrote %v, patch-2 has %v", c, k, got.Chunks[c].Heights[k], h)
			}
		}
	}
	// The models written are the ones the editor showed, patch-2's.
	placed, err := adt.ParsePlacements(files[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	orig, err := adt.ParsePlacements(patched)
	if err != nil {
		t.Fatal(err)
	}
	if len(placed) != len(orig) {
		t.Fatalf("the save wrote %d models, patch-2's tile has %d", len(placed), len(orig))
	}
}

// Raising the outer samples must raise the inner samples inside them too; leaving the inner ones
// alone made a sculpted surface jagged. It needs WOW_DIR set to the client.
func TestPatchMovesInnerSamples(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	root, err := BaseTileRoot(dataDir, "Azeroth", 32, 48)
	if err != nil {
		t.Fatal(err)
	}
	view, err := viewOf(root, false)
	if err != nil {
		t.Fatal(err)
	}
	outer := append([]float32(nil), view.Heights...)
	for i := range outer {
		outer[i] += 4
	}
	patched, err := PatchTileHeights(root, outer)
	if err != nil {
		t.Fatal(err)
	}
	before, err := adt.ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	after, err := adt.ParseTerrain(patched)
	if err != nil {
		t.Fatal(err)
	}
	for c := range before.Chunks {
		for r := 0; r < adt.CellsPerChunk; r++ {
			for col := 0; col < adt.CellsPerChunk; col++ {
				d := after.Chunks[c].Heights[r*17+9+col] - before.Chunks[c].Heights[r*17+9+col]
				if math.Abs(float64(d)-4) > 1e-3 {
					t.Fatalf("chunk %d inner %d,%d moved by %v, want 4", c, r, col, d)
				}
			}
		}
	}
}

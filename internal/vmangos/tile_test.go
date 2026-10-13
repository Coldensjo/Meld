package vmangos

import (
	"bytes"
	"math"
	"os"
	"testing"

	"Meld/internal/adt"
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

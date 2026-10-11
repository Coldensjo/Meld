package vmangos

import (
	"bytes"
	"os"
	"testing"

	"WorldEditor/internal/adt"
	"WorldEditor/internal/wow"
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

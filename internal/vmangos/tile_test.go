package vmangos

import (
	"bytes"
	"math"
	"path/filepath"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestTileRoundTrip reads a real tile, edits one outer height and reads it back:
// WOW_DIR=/path/to/client go test ./internal/vmangos/
func TestTileRoundTrip(t *testing.T) {
	dir := testclient.DataDir(t)
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
	// Every layer but a chunk's first has its alpha map in Alpha (#636).
	layers := 0
	for _, c := range view.Chunks {
		layers += max(len(c.Layers)-1, 0)
	}
	if layers == 0 || len(view.Alpha) != layers*AlphaBytes {
		t.Fatalf("%d bytes of alpha maps for %d layers", len(view.Alpha), layers)
	}
	same, err := PatchTileHeights(root, view.Heights, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(same, root) {
		t.Fatal("unchanged heights changed the tile")
	}

	const at = 50*LatticeSize + 60
	view.Heights[at] += 3
	patched, err := PatchTileHeights(root, view.Heights, nil)
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
	dir := testclient.DataDir(t)
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
	dir := testclient.DataDir(t)
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
	files, err := BuildRegion(dataDir, RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights), Objects: view.Objects})
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

// Raising the outer samples must move the inner samples inside them too; leaving the inner ones
// alone made a sculpted surface jagged. A sculpted cell's middle goes to its corners' mean, as the
// editor shows it (#380), even where the client's tile lifts it a few yards off that mean. It needs
// WOW_DIR set to the client.
func TestPatchMovesInnerSamples(t *testing.T) {
	dir := testclient.DataDir(t)
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
	patched, err := PatchTileHeights(root, outer, nil)
	if err != nil {
		t.Fatal(err)
	}
	after, err := adt.ParseTerrain(patched)
	if err != nil {
		t.Fatal(err)
	}
	for c := range after.Chunks {
		h := after.Chunks[c].Heights
		for r := 0; r < adt.CellsPerChunk; r++ {
			for col := 0; col < adt.CellsPerChunk; col++ {
				mean := (h[r*17+col] + h[r*17+col+1] + h[(r+1)*17+col] + h[(r+1)*17+col+1]) / 4
				if d := h[r*17+9+col] - mean; math.Abs(float64(d)) > 1e-3 {
					t.Fatalf("chunk %d inner %d,%d is %v off its corners' mean", c, r, col, d)
				}
			}
		}
	}
}

// A sculpted cell's inner sample goes to its corners' mean, and a cell whose corners all keep the
// client's heights keeps the client's own middle, bump and all (#380).
func TestPatchSculptedCellsTakeTheMean(t *testing.T) {
	outer := make([]float32, LatticeSize*LatticeSize)
	for i := range outer {
		outer[i] = 10
	}
	built, err := adt.BuildTile(outer, adt.Ring{}, adt.Changes{TileX: 32, TileY: 48})
	if err != nil {
		t.Fatal(err)
	}
	// The client's detail: every cell's middle 3 yd over its corners.
	terrain, err := adt.ParseTerrain(built)
	if err != nil {
		t.Fatal(err)
	}
	for c := range terrain.Chunks {
		for r := 0; r < adt.CellsPerChunk; r++ {
			for col := 0; col < adt.CellsPerChunk; col++ {
				terrain.Chunks[c].Heights[r*17+9+col] += 3
			}
		}
	}
	root, err := adt.WriteHeights(built, terrain, nil)
	if err != nil {
		t.Fatal(err)
	}
	same, err := PatchTileHeights(root, outer, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(same, root) {
		t.Fatal("unchanged heights changed the tile")
	}

	// Lower one corner: the four cells around it are sculpted, the rest are not.
	const gr, gc = 20, 30
	edited := append([]float32(nil), outer...)
	edited[gr*LatticeSize+gc] = 6
	patched, err := PatchTileHeights(root, edited, nil)
	if err != nil {
		t.Fatal(err)
	}
	after, err := adt.ParseTerrain(patched)
	if err != nil {
		t.Fatal(err)
	}
	inner := func(cellR, cellC int) float32 {
		for _, c := range after.Chunks {
			if c.IndexX == cellC/adt.CellsPerChunk && c.IndexY == cellR/adt.CellsPerChunk {
				return c.Heights[(cellR%adt.CellsPerChunk)*17+9+cellC%adt.CellsPerChunk]
			}
		}
		t.Fatalf("no chunk holds cell %d,%d", cellR, cellC)
		return 0
	}
	for _, cell := range [][2]int{{gr - 1, gc - 1}, {gr - 1, gc}, {gr, gc - 1}, {gr, gc}} {
		if got := inner(cell[0], cell[1]); math.Abs(float64(got-9)) > 1e-5 {
			t.Fatalf("sculpted cell %v has its middle at %v, want the corners' mean 9", cell, got)
		}
	}
	for _, cell := range [][2]int{{gr - 2, gc}, {gr + 1, gc + 1}, {0, 0}} {
		if got := inner(cell[0], cell[1]); math.Abs(float64(got-13)) > 1e-5 {
			t.Fatalf("untouched cell %v has its middle at %v, want the client's 13", cell, got)
		}
	}
}

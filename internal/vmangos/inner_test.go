package vmangos

import (
	"encoding/base64"
	"encoding/binary"
	"math"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// A cell's lift is its inner sample less its four corners' mean, placed in the block by the chunk's
// index and the tile's offset.
func TestInnerLifts(t *testing.T) {
	var c adt.Chunk
	c.IndexX, c.IndexY = 2, 3
	for r := 0; r <= adt.CellsPerChunk; r++ {
		for col := 0; col <= adt.CellsPerChunk; col++ {
			c.Heights[r*17+col] = float32(r + col)
		}
	}
	for r := 0; r < adt.CellsPerChunk; r++ {
		for col := 0; col < adt.CellsPerChunk; col++ {
			c.Heights[r*17+9+col] = float32(r+col) + 1 // the corners' mean, plus 0
		}
	}
	c.Heights[4*17+9+5] += 0.25
	side := 2 * adt.ChunksPerTile * adt.CellsPerChunk
	out := make([]float32, side*side)
	innerLifts(&adt.Terrain{Chunks: []adt.Chunk{c}}, out, side, tileCells, 0)
	at := 3*adt.CellsPerChunk + 4
	gx := tileCells + 2*adt.CellsPerChunk + 5
	for k, v := range out {
		want := float32(0)
		if k == at*side+gx {
			want = 0.25
		}
		if math.Abs(float64(v-want)) > 1e-6 {
			t.Fatalf("cell %d,%d lifts %v, want %v", k%side, k/side, v, want)
		}
	}
}

// Northshire's tile (Azeroth 32_48): the client's inner heights part from the corners' mean by at most
// a few tenths of a yard under the abbey, and the lifts put each one back. It needs WOW_DIR set.
func TestClientRegionInner(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	in, err := ReadRegionInner(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	if in.Side != tileCells || in.Lifts == "" {
		t.Fatalf("side %d, %d bytes of lifts", in.Side, len(in.Lifts))
	}
	b, err := base64.StdEncoding.DecodeString(in.Lifts)
	if err != nil || len(b) != 4*tileCells*tileCells {
		t.Fatalf("%d bytes of lifts (%v)", len(b), err)
	}
	lift := func(gx, gy int) float32 {
		return math.Float32frombits(binary.LittleEndian.Uint32(b[4*(gy*tileCells+gx):]))
	}
	root, err := BaseTileRoot(dataDir, "Azeroth", 32, 48)
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := adt.ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	// Base is the tile's own corners, the heights the export compares the editor's with (#380).
	bb, err := base64.StdEncoding.DecodeString(in.Base)
	if err != nil || len(bb) != 4*LatticeSize*LatticeSize {
		t.Fatalf("%d bytes of base heights (%v)", len(bb), err)
	}
	lattice, err := tileLattice(root)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range lattice {
		if got := math.Float32frombits(binary.LittleEndian.Uint32(bb[4*k:])); got != v {
			t.Fatalf("base height %d is %v, want %v", k, got, v)
		}
	}
	var most float64
	for _, c := range terrain.Chunks {
		for r := 0; r < adt.CellsPerChunk; r++ {
			for col := 0; col < adt.CellsPerChunk; col++ {
				h := c.Heights
				mean := (h[r*17+col] + h[r*17+col+1] + h[(r+1)*17+col] + h[(r+1)*17+col+1]) / 4
				l := lift(c.IndexX*adt.CellsPerChunk+col, c.IndexY*adt.CellsPerChunk+r)
				if d := math.Abs(float64(mean + l - h[r*17+9+col])); d > 1e-3 {
					t.Fatalf("chunk %d,%d cell %d,%d: mean %v + lift %v is not the inner %v", c.IndexX, c.IndexY, col, r, mean, l, h[r*17+9+col])
				}
				most = max(most, math.Abs(float64(l)))
			}
		}
	}
	t.Logf("the largest lift in 32_48 is %.3f yd", most)
	if most == 0 {
		t.Fatal("every inner sample is its corners' mean")
	}
}

package adt

import (
	"bytes"
	"math"
	"testing"
)

// slope is a hilly ground over the lattice samples of a whole map, gx east and gy south, so the
// tiles cut from it meet.
func slope(gx, gy int) float32 {
	return float32(20*math.Sin(float64(gy)/9) + 15*math.Cos(float64(gx)/13) + 0.02*float64(gx*gx%97))
}

// slopeTile is the 129 x 129 lattice of the tile at (tx, ty) of slope.
func slopeTile(tx, ty int) []float32 {
	out := make([]float32, lattice*lattice)
	for r := 0; r < lattice; r++ {
		for c := 0; c < lattice; c++ {
			out[r*lattice+c] = slope(tx*(lattice-1)+c, ty*(lattice-1)+r)
		}
	}
	return out
}

// slopeRing is the ring around the tile at (tx, ty) of slope, as its neighbours have it.
func slopeRing(tx, ty int) Ring {
	ring := Ring{North: make([]float32, lattice), South: make([]float32, lattice), West: make([]float32, lattice), East: make([]float32, lattice)}
	x0, y0 := tx*(lattice-1), ty*(lattice-1)
	for k := 0; k < lattice; k++ {
		ring.North[k], ring.South[k] = slope(x0+k, y0-1), slope(x0+k, y0+lattice)
		ring.West[k], ring.East[k] = slope(x0-1, y0+k), slope(x0+lattice, y0+k)
	}
	return ring
}

// normalBytes is each chunk's MCNR payload, in file order.
func normalBytes(t *testing.T, root []byte) [][]byte {
	t.Helper()
	out, err := ParseNormals(root)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// normalOf is the stored normal at lattice sample (r, c) of a tile, from its chunks' normals.
func normalOf(normals [][]byte, r, c int) [3]int8 {
	cx, cy := min(c/CellsPerChunk, ChunksPerTile-1), min(r/CellsPerChunk, ChunksPerTile-1)
	n := normals[cy*ChunksPerTile+cx][((r-cy*CellsPerChunk)*17+c-cx*CellsPerChunk)*3:]
	return [3]int8{int8(n[0]), int8(n[1]), int8(n[2])}
}

// Two tiles that meet store the same normals along the border they share, worked out across it from
// the ring, where one-sided normals on hilly ground differ (#492).
func TestBuildTileNormalsMeetAcrossTheBorder(t *testing.T) {
	build := func(tx, ty int, ring Ring) [][]byte {
		root, err := BuildTile(slopeTile(tx, ty), ring, Changes{TileX: tx, TileY: ty})
		if err != nil {
			t.Fatal(err)
		}
		return normalBytes(t, root)
	}
	last := lattice - 1
	pairs := func(a, east, south [][]byte) (int, int) {
		apart := 0
		for k := 0; k < lattice; k++ {
			if normalOf(a, k, last) != normalOf(east, k, 0) {
				apart++
			}
			if normalOf(a, last, k) != normalOf(south, 0, k) {
				apart++
			}
		}
		return apart, 2 * lattice
	}
	if apart, n := pairs(build(3, 4, slopeRing(3, 4)), build(4, 4, slopeRing(4, 4)), build(3, 5, slopeRing(3, 5))); apart != 0 {
		t.Errorf("%d of %d border samples store different normals in the two tiles", apart, n)
	}
	// Without the ring the two sides are one-sided each way, and the test would see the seam.
	if apart, n := pairs(build(3, 4, Ring{}), build(4, 4, Ring{}), build(3, 5, Ring{})); apart < n/2 {
		t.Errorf("one-sided normals differ at only %d of %d border samples: the ground is too flat to test", apart, n)
	}
}

// A tile whose own heights didn't change rewrites the normals of a border chunk when the ring next to
// it moved, and leaves every other byte; an unmoved ring changes nothing.
func TestWriteHeightsRefreshesTheBorderWhenTheRingMoves(t *testing.T) {
	ring := slopeRing(3, 4)
	root, err := BuildTile(slopeTile(3, 4), ring, Changes{TileX: 3, TileY: 4})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	same, err := WriteHeights(root, terrain, &Edges{Now: ring, Was: ring})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(same, root) {
		t.Fatal("an unmoved ring changed the tile")
	}

	// The east neighbour rises along the first chunk row's span of the border only.
	moved := ring
	moved.East = append([]float32(nil), ring.East...)
	for k := 0; k <= 4; k++ {
		moved.East[k] += 30
	}
	out, err := WriteHeights(root, terrain, &Edges{Now: moved, Was: ring})
	if err != nil {
		t.Fatal(err)
	}
	before, after := normalBytes(t, root), normalBytes(t, out)
	for i := range after {
		if i == 15 {
			if bytes.Equal(before[i], after[i]) {
				t.Error("the border chunk next to the moved ring kept its normals")
			}
			continue
		}
		if !bytes.Equal(before[i], after[i]) {
			t.Errorf("chunk %d's normals changed, away from the moved ring", i)
		}
	}
	if len(out) != len(root) {
		t.Fatalf("the tile's size changed: %d -> %d", len(root), len(out))
	}
}

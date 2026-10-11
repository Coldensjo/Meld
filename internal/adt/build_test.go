package adt

import (
	"math"
	"testing"
)

// hills is a test ground: a smooth bump over a tile's outer grid.
func hills() []float32 {
	const lattice = ChunksPerTile*CellsPerChunk + 1
	out := make([]float32, lattice*lattice)
	for r := 0; r < lattice; r++ {
		for c := 0; c < lattice; c++ {
			out[r*lattice+c] = float32(20*math.Sin(float64(r)/9) + 15*math.Cos(float64(c)/13))
		}
	}
	return out
}

func TestBuildTileReadsBack(t *testing.T) {
	outer := hills()
	alpha := make([]byte, 64*64)
	for i := range alpha {
		alpha[i] = 200
	}
	root, err := BuildTile(outer, Changes{
		TileX: 3, TileY: 4,
		Paint: map[int]ChunkPaint{5: {Layers: []Layer{{Texture: `Tileset\Elwynn\ElwynnGrassBase.blp`}, {Texture: `Tileset\Elwynn\ElwynnDirtBase2.blp`, Alpha: alpha}}}},
		Add:   []Object{{Kind: M2, Name: `World\Test\Tree.m2`, UID: 7, Position: [3]float32{100, 30, 120}, Scale: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(terrain.Chunks) != ChunkCount {
		t.Fatalf("%d chunks", len(terrain.Chunks))
	}
	const lattice = ChunksPerTile*CellsPerChunk + 1
	for _, c := range terrain.Chunks {
		for r := 0; r <= CellsPerChunk; r++ {
			for col := 0; col <= CellsPerChunk; col++ {
				want := outer[(c.IndexY*CellsPerChunk+r)*lattice+c.IndexX*CellsPerChunk+col]
				got := c.Heights[r*17+col]
				if d := got - want; d > 0.001 || d < -0.001 {
					t.Fatalf("chunk %d,%d sample %d,%d = %v, want %v", c.IndexX, c.IndexY, r, col, got, want)
				}
			}
		}
	}
	tex, err := ParseTextures(root, false, terrain)
	if err != nil {
		t.Fatal(err)
	}
	layers := tex.Chunks[5].Layers
	if len(layers) != 2 || layers[0].Texture != `Tileset\Elwynn\ElwynnGrassBase.blp` || layers[1].Texture != `Tileset\Elwynn\ElwynnDirtBase2.blp` {
		t.Fatalf("chunk 5 layers = %+v", layers)
	}
	if v := tex.Chunks[5].Alpha[0][100]; v < 190 || v > 210 {
		t.Fatalf("alpha = %d, want about 200", v)
	}
	if len(tex.Chunks[0].Layers) != 0 {
		t.Fatalf("an unpainted chunk has layers: %+v", tex.Chunks[0].Layers)
	}
	placed, err := ParsePlacements(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(placed) != 1 || placed[0].Name != `World\Test\Tree.m2` || placed[0].UID != 7 {
		t.Fatalf("placements = %+v", placed)
	}
}

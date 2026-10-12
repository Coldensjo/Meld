package adt

import (
	"encoding/binary"
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

// TestBuildTileWater checks water: chunks the level covers get a liquid, others don't.
func TestBuildTileWater(t *testing.T) {
	const lattice = ChunksPerTile*CellsPerChunk + 1
	outer := make([]float32, lattice*lattice)
	for r := 0; r < lattice; r++ {
		for c := 0; c < lattice; c++ {
			// West of the middle is 10 yards under the level, east of it 10 above.
			if c < lattice/2 {
				outer[r*lattice+c] = -10
			} else {
				outer[r*lattice+c] = 10
			}
		}
	}
	root, err := BuildTile(outer, Changes{TileX: 1, TileY: 1, Water: &Water{Level: 0}})
	if err != nil {
		t.Fatal(err)
	}
	starts, err := mcnkStarts(root)
	if err != nil {
		t.Fatal(err)
	}
	chunkAt := func(cx, cy int) []byte {
		for i := range starts {
			if int(binary.LittleEndian.Uint32(root[starts[i]+4:])) == cx && int(binary.LittleEndian.Uint32(root[starts[i]+8:])) == cy {
				return root[starts[i] : starts[i]+mcnkHeaderLen]
			}
		}
		t.Fatalf("no chunk %d,%d", cx, cy)
		return nil
	}
	// The chunk at (0, 0) is under the level: it gets the water kind and an MCLQ.
	west := chunkAt(0, 0)
	if binary.LittleEndian.Uint32(west[0:])&liquidWater == 0 {
		t.Fatal("a chunk under the water has no water flag")
	}
	ofs := int(binary.LittleEndian.Uint32(west[mcnkLiquidOfs:]))
	if ofs == 0 {
		t.Fatal("a chunk under the water has no liquid")
	}
	// The chunk at (15, 0) is above the level: no water.
	east := chunkAt(15, 0)
	if binary.LittleEndian.Uint32(east[0:])&mcnkLiquidMask != 0 || binary.LittleEndian.Uint32(east[mcnkLiquidOfs:]) != 0 {
		t.Fatal("a chunk above the water has liquid")
	}
}

// The water a tile is built with reads back through ParseLiquids, the reader that opens the client's
// own tiles: the level on every vertex, the cells under it covered, and the dry cells left out.
func TestBuildTileWaterReadsBack(t *testing.T) {
	const lattice = ChunksPerTile*CellsPerChunk + 1
	outer := make([]float32, lattice*lattice)
	for r := 0; r < lattice; r++ {
		for c := 0; c < lattice; c++ {
			// The first four columns of cells lie 5 yards under the level, the rest 5 above.
			if c <= 4 {
				outer[r*lattice+c] = -5
			} else {
				outer[r*lattice+c] = 5
			}
		}
	}
	const level = 1.5
	root, err := BuildTile(outer, Changes{TileX: 1, TileY: 1, Water: &Water{Level: level}})
	if err != nil {
		t.Fatal(err)
	}
	liquids, err := ParseLiquids(root)
	if err != nil {
		t.Fatal(err)
	}
	// Only the chunks of the western column have ground under the level.
	if len(liquids) != ChunksPerTile {
		t.Fatalf("got water in %d chunks, want %d", len(liquids), ChunksPerTile)
	}
	for _, l := range liquids {
		if l.IndexX != 0 {
			t.Fatalf("water in chunk %d,%d, which is above the level", l.IndexX, l.IndexY)
		}
		if l.Kind&liquidWater == 0 {
			t.Fatalf("chunk %d,%d: kind %#x has no water bit", l.IndexX, l.IndexY, l.Kind)
		}
		for v, h := range l.Heights {
			if h != level {
				t.Fatalf("chunk %d,%d: vertex %d at %v, want %v", l.IndexX, l.IndexY, v, h, level)
			}
		}
		for i, on := range l.Cells {
			// Cells 0 to 3 of each row sit wholly on the low ground; cell 4 straddles the step (its
			// average, 0, is under the level too); the rest are dry.
			want := i%CellsPerChunk <= 4
			if on != want {
				t.Fatalf("chunk %d,%d: cell %d covered %v, want %v", l.IndexX, l.IndexY, i, on, want)
			}
		}
	}
}

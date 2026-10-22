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
	root, err := BuildTile(outer, Ring{}, Changes{
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
	root, err := BuildTile(outer, Ring{}, Changes{TileX: 1, TileY: 1, Water: &Water{Level: 0}})
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
	// The chunk at (0, 0) is under the level: it gets the ocean flag and an MCLQ.
	west := chunkAt(0, 0)
	if binary.LittleEndian.Uint32(west[0:])&mcnkLiquidMask != liquidKinds[LiquidOcean].flag {
		t.Fatal("a chunk under the sea has no ocean flag")
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
	root, err := BuildTile(outer, Ring{}, Changes{TileX: 1, TileY: 1, Water: &Water{Level: level}})
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
		if l.Type != LiquidOcean {
			t.Fatalf("chunk %d,%d: type %d, want ocean", l.IndexX, l.IndexY, l.Type)
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

// Painted layers write into their chunks and read back with their type, heights, depth and cells,
// in the client's flag order; the sea fills only the cells they leave.
func TestBuildTileLiquidLayers(t *testing.T) {
	const lattice = ChunksPerTile*CellsPerChunk + 1
	outer := make([]float32, lattice*lattice)
	for i := range outer {
		outer[i] = -5
	}
	lava := Liquid{Type: LiquidMagma}
	lake := Liquid{Type: LiquidWater}
	for v := range lake.Heights {
		lava.Heights[v] = 3
		lake.Heights[v] = 2 + float32(v%9)*0.25 // a sloping river
		lake.Depth[v] = byte(v)
	}
	for i := 0; i < 8; i++ {
		lake.Cells[i] = true    // the first row
		lava.Cells[63-i] = true // the last row
	}
	ch := Changes{TileX: 2, TileY: 3, Water: &Water{Level: 0}, Liquids: map[int][]Liquid{
		17: {lava, lake},
		18: nil, // listed with no layers: just the sea
	}}
	root, err := BuildTile(outer, Ring{}, ch)
	if err != nil {
		t.Fatal(err)
	}
	liquids, err := ParseLiquids(root)
	if err != nil {
		t.Fatal(err)
	}
	var at17 []Liquid
	for _, l := range liquids {
		if l.IndexX == 1 && l.IndexY == 1 {
			at17 = append(at17, l)
		}
	}
	// River (0x04), then ocean (0x08), then magma (0x10).
	if len(at17) != 3 || at17[0].Type != LiquidWater || at17[1].Type != LiquidOcean || at17[2].Type != LiquidMagma {
		t.Fatalf("chunk 17 layers: %+v", typesOf(at17))
	}
	if at17[0].Heights != lake.Heights || at17[0].Depth != lake.Depth || at17[0].Cells != lake.Cells {
		t.Fatal("the lake layer did not read back as written")
	}
	if at17[2].Cells != lava.Cells || at17[2].Heights != lava.Heights {
		t.Fatal("the lava layer did not read back as written")
	}
	for i, on := range at17[1].Cells {
		if on != (i >= 8 && i < 56) {
			t.Fatalf("sea cell %d covered %v; the sea must fill only what the layers leave", i, on)
		}
	}
}

// Two layers of one type in a chunk (two LiquidType.dbc rows of one kind, or a painted ocean beside
// the sea) are written as one entry under their one flag, since the client reads an entry a flag (#527).
func TestBuildTileMergesLayersOfOneType(t *testing.T) {
	const lattice = ChunksPerTile*CellsPerChunk + 1
	outer := make([]float32, lattice*lattice)
	for i := range outer {
		outer[i] = -5
	}
	lake := Liquid{Type: LiquidWater}
	river := Liquid{Type: LiquidWater}
	ocean := Liquid{Type: LiquidOcean}
	for v := range lake.Heights {
		lake.Heights[v], lake.Depth[v] = 2, 100
		river.Heights[v], river.Depth[v] = 7, 200
		ocean.Heights[v] = 0
	}
	for i := 0; i < 8; i++ {
		lake.Cells[i] = true     // row 0
		river.Cells[8+i] = true  // row 1, sharing row 0's lower vertices
		river.Cells[i] = i < 2   // two cells the lake has too
		ocean.Cells[56+i] = true // the last row, beside the sea
	}
	ch := Changes{TileX: 2, TileY: 3, Water: &Water{Level: 0}, Liquids: map[int][]Liquid{17: {lake, river, ocean}}}
	root, err := BuildTile(outer, Ring{}, ch)
	if err != nil {
		t.Fatal(err)
	}
	liquids, err := ParseLiquids(root)
	if err != nil {
		t.Fatal(err)
	}
	var at17 []Liquid
	for _, l := range liquids {
		if l.IndexX == 1 && l.IndexY == 1 {
			at17 = append(at17, l)
		}
	}
	if len(at17) != 2 || at17[0].Type != LiquidWater || at17[1].Type != LiquidOcean {
		t.Fatalf("chunk 17 layers: %+v, want one water and one ocean", typesOf(at17))
	}
	w := at17[0]
	for i, on := range w.Cells {
		if on != (i < 16) {
			t.Fatalf("water cell %d covered %v; want rows 0 and 1", i, on)
		}
	}
	for v := 0; v < 27; v++ {
		want, depth := float32(2), byte(100) // rows 0 and 1 of vertices are the lake's, the first layer
		if v >= 18 {
			want, depth = 7, 200 // row 2 only the river's cells reach
		}
		if w.Heights[v] != want || w.Depth[v] != depth {
			t.Fatalf("water vertex %d: height %v depth %d, want %v and %d", v, w.Heights[v], w.Depth[v], want, depth)
		}
	}
	for i, on := range at17[1].Cells {
		if on != (i >= 16) {
			t.Fatalf("ocean cell %d covered %v; want the painted row and the sea's joined", i, on)
		}
	}
}

func typesOf(ls []Liquid) []int {
	out := make([]int, len(ls))
	for i, l := range ls {
		out[i] = l.Type
	}
	return out
}

// A chunk listed with no layers loses the liquid it had; chunks not listed keep theirs.
func TestRewriteRemovesLiquid(t *testing.T) {
	const lattice = ChunksPerTile*CellsPerChunk + 1
	outer := make([]float32, lattice*lattice)
	lake := Liquid{Type: LiquidWater}
	lake.Cells[0] = true
	root, err := BuildTile(outer, Ring{}, Changes{TileX: 0, TileY: 0, Liquids: map[int][]Liquid{0: {lake}, 1: {lake}}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := Rewrite(root, Changes{TileX: 0, TileY: 0, Liquids: map[int][]Liquid{0: nil}})
	if err != nil {
		t.Fatal(err)
	}
	liquids, err := ParseLiquids(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(liquids) != 1 || liquids[0].IndexX != 1 {
		t.Fatalf("got %d layers, want only chunk 1's", len(liquids))
	}
}

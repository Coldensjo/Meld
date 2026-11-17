package adt

import (
	"encoding/binary"
	"math"
	"testing"
)

// mh2oLayerSpec is one layer of a test MH2O.
type mh2oLayerSpec struct {
	chunk, id, format int
	level             float32
	x, y, w, h        int
	bitmap            []byte    // nil: every cell of the rectangle
	heights           []float32 // nil with depths nil: no vertex data
	depths            []byte
	uvs               bool
}

// mh2oTile is a tile's root that holds only an MH2O chunk with the layers given, a chunk's layers
// one after the other as the client stores them.
func mh2oTile(layers ...mh2oLayerSpec) []byte {
	data := make([]byte, ChunksPerTile*ChunksPerTile*mh2oChunkHeader)
	put32 := func(at int, v uint32) { binary.LittleEndian.PutUint32(data[at:], v) }
	byChunk := map[int][]mh2oLayerSpec{}
	var order []int
	for _, l := range layers {
		if byChunk[l.chunk] == nil {
			order = append(order, l.chunk)
		}
		byChunk[l.chunk] = append(byChunk[l.chunk], l)
	}
	for _, c := range order {
		ls := byChunk[c]
		at := len(data)
		put32(c*mh2oChunkHeader, uint32(at))
		put32(c*mh2oChunkHeader+4, uint32(len(ls)))
		data = append(data, make([]byte, len(ls)*mh2oLayer)...)
		for k, l := range ls {
			o := at + k*mh2oLayer
			binary.LittleEndian.PutUint16(data[o:], uint16(l.id))
			binary.LittleEndian.PutUint16(data[o+2:], uint16(l.format))
			binary.LittleEndian.PutUint32(data[o+4:], math.Float32bits(l.level))
			binary.LittleEndian.PutUint32(data[o+8:], math.Float32bits(l.level))
			data[o+12], data[o+13], data[o+14], data[o+15] = byte(l.x), byte(l.y), byte(l.w), byte(l.h)
			if l.bitmap != nil {
				binary.LittleEndian.PutUint32(data[o+16:], uint32(len(data)))
				data = append(data, l.bitmap...)
			}
			if l.heights != nil || l.depths != nil {
				binary.LittleEndian.PutUint32(data[o+20:], uint32(len(data)))
				for _, h := range l.heights {
					data = binary.LittleEndian.AppendUint32(data, math.Float32bits(h))
				}
				if l.uvs {
					data = append(data, make([]byte, len(l.heights)*4)...)
				}
				data = append(data, l.depths...)
			}
		}
	}
	root := []byte{'O', '2', 'H', 'M', 0, 0, 0, 0}
	binary.LittleEndian.PutUint32(root[4:], uint32(len(data)))
	return append(root, data...)
}

// A 3.3.5a tile's MH2O layers read as the layers of a 1.12 MCLQ do: a lake's rectangle with a hole
// in it, a sea of depths alone at its level, a flat layer without vertex data, and lava (#1068).
func TestParseMH2O(t *testing.T) {
	// A lake 3 cells wide and 2 high at column 2, row 3, without its middle cell of the first row.
	lakeHeights := make([]float32, 4*3)
	lakeDepths := make([]byte, 4*3)
	for i := range lakeHeights {
		lakeHeights[i], lakeDepths[i] = 100+float32(i), byte(10+i)
	}
	seaDepths := make([]byte, 81)
	for i := range seaDepths {
		seaDepths[i] = byte(i)
	}
	lava := make([]float32, 4)
	for i := range lava {
		lava[i] = 50
	}
	root := mh2oTile(
		mh2oLayerSpec{chunk: 5*16 + 2, id: 1, format: mh2oHeightDepth, level: 100, x: 2, y: 3, w: 3, h: 2, bitmap: []byte{0b111101}, heights: lakeHeights, depths: lakeDepths},
		mh2oLayerSpec{chunk: 5*16 + 2, id: 5, format: mh2oHeightDepth, level: 90, x: 0, y: 0, w: 8, h: 8},
		mh2oLayerSpec{chunk: 0, id: 2, format: mh2oDepth, level: 0, x: 0, y: 0, w: 8, h: 8, depths: seaDepths},
		mh2oLayerSpec{chunk: 255, id: 3, format: mh2oHeightUV, level: 50, x: 7, y: 7, w: 1, h: 1, heights: lava, uvs: true},
		mh2oLayerSpec{chunk: 17, id: 300, format: mh2oDepth, level: 7, x: 0, y: 0, w: 1, h: 1},
		// Dry: its bitmap covers no cell.
		mh2oLayerSpec{chunk: 18, id: 1, format: mh2oHeightDepth, level: 1, x: 0, y: 0, w: 2, h: 2, bitmap: []byte{0}},
	)
	layers, err := ParseLiquids(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(layers) != 5 {
		t.Fatalf("%d layers, want 5", len(layers))
	}
	by := map[[2]int][]Liquid{}
	for _, l := range layers {
		by[[2]int{l.IndexX, l.IndexY}] = append(by[[2]int{l.IndexX, l.IndexY}], l)
	}

	lakes := by[[2]int{2, 5}]
	if len(lakes) != 2 {
		t.Fatalf("chunk 2,5 has %d layers, want the lake and the flat water", len(lakes))
	}
	lake := lakes[0]
	if lake.Type != LiquidWater || lake.LiquidID != 1 {
		t.Errorf("the lake is type %d, liquid %d", lake.Type, lake.LiquidID)
	}
	covered := 0
	for i, on := range lake.Cells {
		row, col := i/CellsPerChunk, i%CellsPerChunk
		want := row >= 3 && row < 5 && col >= 2 && col < 5 && !(row == 3 && col == 3)
		if on != want {
			t.Errorf("the lake's cell %d,%d covered: %v", col, row, on)
		}
		if on {
			covered++
		}
	}
	if covered != 5 {
		t.Errorf("the lake covers %d cells, want 5", covered)
	}
	// Vertex (row 1, column 2) of the rectangle is the chunk's (row 4, column 4).
	if v := 4*9 + 4; lake.Heights[v] != 106 || lake.Depth[v] != 16 {
		t.Errorf("the lake's vertex 4,4: height %g, depth %d; want 106 and 16", lake.Heights[v], lake.Depth[v])
	}
	if lake.Heights[0] != 100 || lake.Depth[0] != 255 {
		t.Errorf("a vertex outside the lake's rectangle: height %g, depth %d; want its level and 255", lake.Heights[0], lake.Depth[0])
	}
	if flat := lakes[1]; flat.LiquidID != 5 || flat.Type != LiquidWater || flat.Heights[40] != 90 || flat.Depth[40] != 255 || !flat.Cells[0] || !flat.Cells[63] {
		t.Errorf("the flat water: liquid %d, type %d, height %g, depth %d", flat.LiquidID, flat.Type, flat.Heights[40], flat.Depth[40])
	}

	sea := by[[2]int{0, 0}][0]
	if sea.Type != LiquidOcean || sea.Heights[80] != 0 || sea.Depth[80] != 80 || sea.Depth[1] != 1 {
		t.Errorf("the sea: type %d, height %g, depths %d and %d", sea.Type, sea.Heights[80], sea.Depth[80], sea.Depth[1])
	}
	magma := by[[2]int{15, 15}][0]
	if magma.Type != LiquidMagma || !magma.Cells[63] || magma.Cells[62] || magma.Heights[80] != 50 || magma.Depth[80] != 255 {
		t.Errorf("the lava: type %d, cells %v %v, height %g, depth %d", magma.Type, magma.Cells[63], magma.Cells[62], magma.Heights[80], magma.Depth[80])
	}
	// A liquid the client's table does not have reads by its vertex format: depths alone are a sea.
	if other := by[[2]int{1, 1}][0]; other.Type != LiquidOcean || other.LiquidID != 300 || other.Heights[0] != 7 {
		t.Errorf("an unknown liquid of depths alone: type %d, liquid %d, height %g", other.Type, other.LiquidID, other.Heights[0])
	}
}

// A layer whose offsets leave the chunk is dropped without reading past it.
func TestParseMH2OTruncated(t *testing.T) {
	heights := make([]float32, 81)
	root := mh2oTile(mh2oLayerSpec{chunk: 3, id: 1, format: mh2oHeightDepth, level: 5, x: 0, y: 0, w: 8, h: 8, heights: heights, depths: make([]byte, 81)})
	for cut := len(root) - 1; cut > 8+ChunksPerTile*ChunksPerTile*mh2oChunkHeader; cut -= 37 {
		short := append([]byte(nil), root[:cut]...)
		binary.LittleEndian.PutUint32(short[4:], uint32(cut-8))
		layers, err := ParseLiquids(short)
		if err != nil {
			t.Fatalf("cut at %d: %v", cut, err)
		}
		// The vertex data is cut first: the layer then lies flat at its level.
		for _, l := range layers {
			if l.Heights[0] != 5 && l.Heights[0] != 0 {
				t.Fatalf("cut at %d: height %g", cut, l.Heights[0])
			}
		}
	}
	// A rectangle that leaves the chunk, and an MH2O too short for its headers.
	bad := mh2oTile(mh2oLayerSpec{chunk: 0, id: 1, x: 6, y: 0, w: 4, h: 1})
	if layers, _ := ParseLiquids(bad); len(layers) != 0 {
		t.Errorf("a rectangle past the chunk's edge read as %d layers", len(layers))
	}
	if layers, err := ParseLiquids([]byte{'O', '2', 'H', 'M', 4, 0, 0, 0, 1, 2, 3, 4}); err != nil || len(layers) != 0 {
		t.Errorf("a short MH2O: %d layers, %v", len(layers), err)
	}
}

package adt

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

// The tests of what Rewrite does for the later clients' tiles (#1068 to #1070), on tiles made here:
// the 3.3.5a client's own are read by the client tests (internal/wow).

var laterFormat = Format{MH2O: true, BigAlpha: true}

// topChunkAt is where the first top-level chunk named id starts (its header), or -1.
func topChunkAt(t *testing.T, root []byte, id string) int {
	t.Helper()
	at := -1
	err := eachChunk(root, 0, len(root), func(c chunk) error {
		if c.id == id && at < 0 {
			at = c.start - 8
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return at
}

// mhdrField is MHDR's offset field at ofs, and where MHDR's data starts.
func mhdrField(t *testing.T, root []byte, ofs int) (value, data int) {
	t.Helper()
	at := topChunkAt(t, root, "MHDR")
	if at < 0 {
		t.Fatal("no MHDR")
	}
	return int(binary.LittleEndian.Uint32(root[at+8+ofs:])), at + 8
}

// laterTile is a tile as the 3.3.5a client's Northrend has them, made without Rewrite's help for the
// parts it must carry: vertex colours (MCCV) after every chunk's heights, with the header's offset
// and flag, and the flight bounds (MFBO) and MTXF after the MCNK chunks, with MHDR's offsets. Its
// paint is on 8-bit alpha maps and its liquids are in MH2O: a lake, lava and the sea.
func laterTile(t *testing.T) []byte {
	t.Helper()
	paint := map[int]ChunkPaint{}
	for i := 0; i < ChunkCount; i++ {
		layers := []Layer{{Texture: `Tileset\Test\Snow.blp`}}
		for l := 1; l <= i%4; l++ {
			alpha := make([]byte, 64*64)
			for k := range alpha {
				alpha[k] = byte(k%64*3 + l*30 + i)
			}
			layers = append(layers, Layer{Texture: []string{`Tileset\Test\Ice.blp`, `Tileset\Test\Rock.blp`, `Tileset\Test\Moss.blp`}[l-1], Alpha: alpha})
		}
		paint[i] = ChunkPaint{Layers: layers}
	}
	lake, lava := Liquid{Type: LiquidWater}, Liquid{Type: LiquidMagma}
	for v := range lake.Heights {
		lake.Heights[v], lake.Depth[v] = 40+float32(v%9)*0.5, byte(v*3)
		lava.Heights[v] = 55
	}
	for c := range lake.Cells {
		lake.Cells[c] = c%8 >= 2 && c%8 < 6 && c/8 >= 1 && c/8 < 4 && c != 11
		lava.Cells[c] = c >= 48
	}
	root, err := BuildTile(hills(), Ring{}, Changes{
		TileX: 30, TileY: 21, Format: laterFormat, Paint: paint,
		Liquids: map[int][]Liquid{17: {lake}, 18: {lake, lava}, 200: {lava}},
		Water:   &Water{Level: 0},
		Add: []Object{
			{Kind: M2, Name: `World\Test\Pine.m2`, UID: 11, Position: [3]float32{30*TileSize + 50, 20, 21*TileSize + 60}, Scale: 1},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// The same file again, each MCNK with an MCCV spliced in behind its MCVT.
	var out, mcin []byte
	mcinAt := -1
	var mcnkAt []int
	err = eachChunk(root, 0, len(root), func(c chunk) error {
		data := root[c.start:c.end]
		if c.id == "MCNK" {
			m := append([]byte(nil), data...)
			idx := len(mcnkAt)
			split := int(binary.LittleEndian.Uint32(m[0x18:])) - 8 // the MCNR's header, right after the MCVT
			colors := make([]byte, HeightCount*4)
			for k := range colors {
				colors[k] = byte(k*5 + idx)
			}
			grown := uint32(8 + len(colors))
			for _, f := range []int{0x18, 0x1c, 0x20, 0x24, 0x2c, mcnkSoundOfs, mcnkLiquidOfs} {
				if v := binary.LittleEndian.Uint32(m[f:]); v != 0 {
					binary.LittleEndian.PutUint32(m[f:], v+grown)
				}
			}
			binary.LittleEndian.PutUint32(m[mcnkVertexColor:], uint32(split+8))
			binary.LittleEndian.PutUint32(m[0:], binary.LittleEndian.Uint32(m[0:])|0x40)
			// A chunk without baked shadows points their field at its alpha maps, as Northrend's do.
			if binary.LittleEndian.Uint32(m[0x2c:]) == 0 {
				copy(m[0x2c:0x30], m[0x24:0x28])
			}
			data = append(append(append([]byte(nil), m[:split]...), chunkBytes("MCCV", colors)...), m[split:]...)
			mcnkAt = append(mcnkAt, len(out))
		}
		if c.id == "MCIN" {
			mcinAt = len(out) + 8
		}
		out = append(out, chunkBytes(c.id, data)...)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	mcin = out[mcinAt : mcinAt+ChunkCount*16]
	for i, at := range mcnkAt {
		binary.LittleEndian.PutUint32(mcin[i*16:], uint32(at))
		binary.LittleEndian.PutUint32(mcin[i*16+4:], binary.LittleEndian.Uint32(out[at+4:])+8)
	}
	// MHDR: the top-level chunks before the MCNKs keep their places, so only the new ones are set.
	_, mhdr := mhdrField(t, out, 0)
	bounds := make([]byte, 36)
	for k := range bounds {
		bounds[k] = byte(200 - k)
	}
	binary.LittleEndian.PutUint32(out[mhdr:], 1) // the header's flag for the flight bounds
	binary.LittleEndian.PutUint32(out[mhdr+mhdrMFBO:], uint32(len(out)-mhdr))
	out = append(out, chunkBytes("MFBO", bounds)...)
	binary.LittleEndian.PutUint32(out[mhdr+mhdrMTXF:], uint32(len(out)-mhdr))
	out = append(out, chunkBytes("MTXF", []byte{1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0})...)
	checkOffsets(t, out)
	return out
}

// vertexColors is chunk i's MCCV payload as its header points at it, or nil.
func vertexColors(t *testing.T, root []byte, i int) []byte {
	t.Helper()
	starts, err := mcnkStarts(root)
	if err != nil {
		t.Fatal(err)
	}
	m := root[starts[i] : starts[i]+int(binary.LittleEndian.Uint32(root[starts[i]-4:]))]
	ofs := int(binary.LittleEndian.Uint32(m[mcnkVertexColor:]))
	if ofs == 0 {
		return nil
	}
	if ofs < mcnkHeaderLen+8 || ofs+HeightCount*4 > len(m) || string(m[ofs-8:ofs-4]) != "VCCM" {
		t.Fatalf("chunk %d: the header's MCCV offset %d does not point at one", i, ofs)
	}
	return m[ofs : ofs+HeightCount*4]
}

// checkLaterOffsets checks MHDR's offsets to the later clients' chunks, which the client and the
// server's map extractor find them by.
func checkLaterOffsets(t *testing.T, root []byte) {
	t.Helper()
	checkOffsets(t, root)
	for id, ofs := range map[string]int{"MFBO": mhdrMFBO, "MH2O": mhdrMH2O, "MTXF": mhdrMTXF} {
		v, data := mhdrField(t, root, ofs)
		at := topChunkAt(t, root, id)
		switch {
		case at < 0 && v != 0:
			t.Errorf("MHDR points at an %s (%d) the tile does not have", id, v)
		case at >= 0 && data+v != at:
			t.Errorf("MHDR's %s offset is %d, the chunk is at %d", id, v, at-data)
		}
	}
}

// A 3.3.5a tile keeps its vertex colours, flight bounds, MTXF and liquids through a save, with the
// offsets the client finds them by, whether the save changes nothing or paint, models and zones
// (#1070). Before, MFBO moved ahead of the MCNK chunks under a stale offset and MCCV was dropped.
func TestRewriteKeepsLaterChunks(t *testing.T) {
	root := laterTile(t)
	alpha := make([]byte, 64*64)
	for k := range alpha {
		alpha[k] = byte(k)
	}
	changes := map[string]Changes{
		"nothing": {},
		"paint, a model and a zone": {
			Paint:   map[int]ChunkPaint{40: {Layers: []Layer{{Texture: `Tileset\Test\Snow.blp`}, {Texture: `Tileset\Test\Mud.blp`, Alpha: alpha}}}},
			Add:     []Object{{Kind: WMO, Name: `World\Test\Hut.wmo`, Position: [3]float32{30*TileSize + 200, 30, 21*TileSize + 200}}},
			Remove:  map[uint32]bool{11: true},
			Headers: map[int]ChunkHeader{7: {AreaID: 4197}},
		},
	}
	beforeLiquids, err := ParseLiquids(root)
	if err != nil {
		t.Fatal(err)
	}
	water := root[topChunkAt(t, root, "MH2O"):]
	water = water[:8+binary.LittleEndian.Uint32(water[4:])]
	for name, ch := range changes {
		t.Run(name, func(t *testing.T) {
			ch.TileX, ch.TileY, ch.Format = 30, 21, laterFormat
			out, err := Rewrite(root, ch)
			if err != nil {
				t.Fatal(err)
			}
			checkLaterOffsets(t, out)
			starts, _ := mcnkStarts(out)
			was, _ := mcnkStarts(root)
			for i := 0; i < ChunkCount; i++ {
				if !bytes.Equal(vertexColors(t, out, i), vertexColors(t, root, i)) {
					t.Fatalf("chunk %d lost its vertex colours", i)
				}
				// The shadow's field still follows the alpha maps, which are there once.
				m := out[starts[i] : starts[i]+int(binary.LittleEndian.Uint32(out[starts[i]-4:]))]
				subs := subChunksOf(t, m)
				if binary.LittleEndian.Uint32(root[was[i]+0x24:]) == 0 {
					continue // a chunk of one layer had no alpha maps to point at
				}
				if _, shadows := subs["MCSH"]; shadows || !bytes.Equal(m[0x2c:0x30], m[0x24:0x28]) {
					t.Fatalf("chunk %d: the shadow's field is %d beside the alpha maps' %d (an MCSH there: %v)", i,
						binary.LittleEndian.Uint32(m[0x2c:]), binary.LittleEndian.Uint32(m[0x24:]), shadows)
				}
			}
			after, before := mustTerrain(t, out), mustTerrain(t, root)
			for i := range before.Chunks {
				if after.Chunks[i].Flags&0x40 == 0 || after.Chunks[i].Heights != before.Chunks[i].Heights {
					t.Fatalf("chunk %d: flags %#x, heights equal %v", i, after.Chunks[i].Flags, after.Chunks[i].Heights == before.Chunks[i].Heights)
				}
			}
			for _, id := range []string{"MFBO", "MTXF"} {
				a, b := topChunkAt(t, out, id), topChunkAt(t, root, id)
				if a < 0 || !bytes.Equal(out[a:a+8+int(binary.LittleEndian.Uint32(out[a+4:]))], root[b:b+8+int(binary.LittleEndian.Uint32(root[b+4:]))]) {
					t.Errorf("%s did not come through as it was", id)
				}
				if a < topChunkAt(t, out, "MCNK") {
					t.Errorf("%s is ahead of the MCNK chunks; the client's tiles have it after them", id)
				}
			}
			if a := topChunkAt(t, out, "MH2O"); a < 0 || !bytes.Equal(out[a:a+len(water)], water) {
				t.Error("the liquids, which the save does not change, are not the tile's own bytes")
			}
			afterLiquids, err := ParseLiquids(out)
			if err != nil || len(afterLiquids) != len(beforeLiquids) {
				t.Fatalf("%d liquid layers after, %d before (%v)", len(afterLiquids), len(beforeLiquids), err)
			}
		})
	}
}

// layerOf is the layer of a kind in chunk (x, y) among ls, or nil.
func layerOf(ls []Liquid, x, y, kind int) *Liquid {
	for i := range ls {
		if ls[i].IndexX == x && ls[i].IndexY == y && ls[i].Type == kind {
			return &ls[i]
		}
	}
	return nil
}

// sameSurface says b covers just a's cells, with a's heights and depths at their corners.
func sameSurface(a, b *Liquid) bool {
	return b != nil && a.Cells == b.Cells && surfaceWithin(a, b)
}

// surfaceWithin says b covers a's cells, among others it may, with a's heights and depths at their
// corners.
func surfaceWithin(a, b *Liquid) bool {
	if a == nil || b == nil {
		return false
	}
	for i, on := range a.Cells {
		if !on {
			continue
		}
		if !b.Cells[i] {
			return false
		}
		r, c := i/CellsPerChunk, i%CellsPerChunk
		for _, v := range [4]int{r*9 + c, r*9 + c + 1, (r+1)*9 + c, (r+1)*9 + c + 1} {
			if a.Heights[v] != b.Heights[v] || !textured(a.Type) && a.Depth[v] != b.Depth[v] {
				return false
			}
		}
	}
	return true
}

func mustMH2O(t *testing.T, root []byte) *[ChunkCount]waterChunk {
	t.Helper()
	at := topChunkAt(t, root, "MH2O")
	if at < 0 {
		t.Fatal("the tile has no MH2O")
	}
	chunks, err := readMH2O(root[at+8 : at+8+int(binary.LittleEndian.Uint32(root[at+4:]))])
	if err != nil {
		t.Fatal(err)
	}
	return chunks
}

// A 3.3.5a tile's liquids are written into its MH2O, each kind in the form the client's own tiles
// have it, and read back as they were given; no chunk holds an MCLQ or a liquid flag (#1068).
func TestRewriteWritesMH2O(t *testing.T) {
	const lattice = ChunksPerTile*CellsPerChunk + 1
	outer := make([]float32, lattice*lattice)
	for i := range outer {
		outer[i] = -400 // far under the sea, so it is deep all over
	}
	// A shore in the tile's first chunk row, so the sea there has depths to hold.
	for i := 0; i < lattice*9; i++ {
		outer[i] = -5
	}
	lake, lava, bay := Liquid{Type: LiquidWater}, Liquid{Type: LiquidMagma}, Liquid{Type: LiquidOcean}
	for v := range lake.Heights {
		lake.Heights[v], lake.Depth[v] = 40+float32(v%9)*0.5, byte(v*3)
		lava.Heights[v] = 55
		bay.Heights[v], bay.Depth[v] = 12, byte(100+v)
	}
	for c := range lake.Cells {
		lake.Cells[c] = c%8 >= 2 && c%8 < 6 && c/8 >= 1 && c/8 < 4 && c != 11
		lava.Cells[c] = c >= 48
		bay.Cells[c] = c < 16
	}
	ch := Changes{TileX: 30, TileY: 21, Format: Format{MH2O: true}, Water: &Water{Level: 0},
		Liquids: map[int][]Liquid{17: {lake}, 18: {lava, lake}, 40: {bay}}}
	root, err := BuildTile(outer, Ring{}, ch)
	if err != nil {
		t.Fatal(err)
	}
	checkLaterOffsets(t, root)
	if topChunkAt(t, root, "MH2O") > topChunkAt(t, root, "MCNK") {
		t.Error("MH2O is after the MCNK chunks; the client's tiles have it before them")
	}
	for i, c := range mustTerrain(t, root).Chunks {
		if c.Flags&mcnkLiquidMask != 0 {
			t.Fatalf("chunk %d has liquid flags %#x; they name an MCLQ's liquids", i, c.Flags&mcnkLiquidMask)
		}
	}
	starts, _ := mcnkStarts(root)
	for i, s := range starts {
		if binary.LittleEndian.Uint32(root[s+mcnkLiquidOfs:]) != 0 || binary.LittleEndian.Uint32(root[s+mcnkLiquidSize:]) != 0 {
			t.Fatalf("chunk %d holds an MCLQ", i)
		}
	}

	// They read back as given, the sea in the cells the layers leave.
	got, err := ParseLiquids(root)
	if err != nil {
		t.Fatal(err)
	}
	if !sameSurface(&lake, layerOf(got, 1, 1, LiquidWater)) || !sameSurface(&lake, layerOf(got, 2, 1, LiquidWater)) {
		t.Error("the lake did not read back as written")
	}
	if !sameSurface(&lava, layerOf(got, 2, 1, LiquidMagma)) {
		t.Error("the lava did not read back as written")
	}
	// The bay is one layer with the sea around it, as two of a kind in a chunk are (MergeLiquids).
	if !surfaceWithin(&bay, layerOf(got, 8, 2, LiquidOcean)) {
		t.Error("the raised bay did not read back as written")
	}
	sea := layerOf(got, 1, 1, LiquidOcean)
	if sea == nil {
		t.Fatal("chunk 17 has no sea around its lake")
	}
	for i, on := range sea.Cells {
		if on == lake.Cells[i] {
			t.Fatalf("sea cell %d covered %v; the sea fills what the lake leaves", i, on)
		}
	}

	// And in the file: the form and the row of each, the first layer the one of an MCLQ's first flag.
	chunks := mustMH2O(t, root)
	want := func(idx int, forms ...[2]uint16) {
		t.Helper()
		c := chunks[idx]
		if len(c.layers) != len(forms) {
			t.Fatalf("chunk %d has %d layers, want %d", idx, len(c.layers), len(forms))
		}
		for k, f := range forms {
			if c.layers[k].id != f[0] || c.layers[k].format != f[1] {
				t.Errorf("chunk %d layer %d is row %d in format %d, want row %d in format %d", idx, k, c.layers[k].id, c.layers[k].format, f[0], f[1])
			}
		}
	}
	want(17, [2]uint16{5, mh2oHeightDepth}, [2]uint16{2, mh2oDepth})
	want(18, [2]uint16{5, mh2oHeightDepth}, [2]uint16{2, mh2oDepth}, [2]uint16{7, mh2oHeightUV})
	want(40, [2]uint16{2, mh2oHeightDepth}) // an ocean off height 0 carries its heights, for the server
	want(255, [2]uint16{2, mh2oDepth})

	// The lake's rectangle and bitmap: 4 by 3 cells at (2, 1), without cell 11.
	if l := chunks[17].layers[0]; l.x != 2 || l.y != 1 || l.w != 4 || l.h != 3 || len(l.bitmap) != 2 || l.bitmap[0] != 0xfd || l.bitmap[1] != 0x0f ||
		len(l.verts) != 5*4*5 || l.lo != 41 || l.hi != 43 {
		t.Errorf("the lake's layer: %d,%d %dx%d bitmap %x, %d vertex bytes, heights %v to %v", l.x, l.y, l.w, l.h, l.bitmap, len(l.verts), l.lo, l.hi)
	}
	// The open sea, deep all over: nothing but the layer, as the client's tiles have it.
	if c := chunks[255]; c.attrs != nil || c.layers[0].bitmap != nil || c.layers[0].verts != nil || c.layers[0].w != 8 || c.layers[0].h != 8 {
		t.Errorf("the open sea holds attributes %v, a bitmap %v or vertex data (%d bytes)", c.attrs, c.layers[0].bitmap, len(c.layers[0].verts))
	}
	// The sea by the shore: depths, and attributes that do not call it deep.
	if c := chunks[3]; len(c.layers) != 1 || len(c.layers[0].verts) != 81 || len(c.attrs) != 16 ||
		binary.LittleEndian.Uint64(c.attrs) != math.MaxUint64 || binary.LittleEndian.Uint64(c.attrs[8:]) != 0 {
		t.Errorf("the shore's sea: %d layers, attributes %x", len(c.layers), c.attrs)
	}
	// The lake's chunk: fishable where the lake and the sea are, which is everywhere, and not deep.
	if c := chunks[17]; len(c.attrs) != 16 || binary.LittleEndian.Uint64(c.attrs) != math.MaxUint64 {
		t.Errorf("the lake chunk's attributes: %x", c.attrs)
	}
	// Lava is no place to fish.
	if c := chunks[18]; binary.LittleEndian.Uint64(c.attrs)>>48 != 0 {
		t.Errorf("the lava's cells are fishable: %x", c.attrs)
	}

	// A save that changes one chunk's liquids writes the others' layers as they were, and a layer
	// takes the row its chunk's own had, or the tile's usual one of its kind.
	at := topChunkAt(t, root, "MH2O") + 8
	binary.LittleEndian.PutUint16(root[at+int(binary.LittleEndian.Uint32(root[at+17*mh2oChunkHeader:])):], 81) // the lake of chunk 17: Wintergrasp's water
	binary.LittleEndian.PutUint16(root[at+int(binary.LittleEndian.Uint32(root[at+18*mh2oChunkHeader:])):], 81)
	before := mustMH2O(t, root)
	pond := lake
	pond.Cells = [64]bool{}
	pond.Cells[27], pond.Cells[28] = true, true
	out, err := Rewrite(root, Changes{TileX: 30, TileY: 21, Format: Format{MH2O: true}, Liquids: map[int][]Liquid{17: {pond}, 100: {pond}, 40: nil}})
	if err != nil {
		t.Fatal(err)
	}
	checkLaterOffsets(t, out)
	after := mustMH2O(t, out)
	for i := range before {
		if i == 17 || i == 100 || i == 40 {
			continue
		}
		if len(after[i].layers) != len(before[i].layers) || !bytes.Equal(after[i].attrs, before[i].attrs) {
			t.Fatalf("chunk %d, which the save left alone, has %d layers for %d", i, len(after[i].layers), len(before[i].layers))
		}
		for k, l := range before[i].layers {
			a := after[i].layers[k]
			if a.id != l.id || a.format != l.format || a.lo != l.lo || a.hi != l.hi || a.x != l.x || a.y != l.y || a.w != l.w || a.h != l.h ||
				!bytes.Equal(a.bitmap, l.bitmap) || !bytes.Equal(a.verts, l.verts) {
				t.Fatalf("chunk %d layer %d changed", i, k)
			}
		}
	}
	if l := after[17].layers; len(l) != 1 || l[0].id != 81 || l[0].w != 2 || l[0].h != 1 {
		t.Errorf("chunk 17's pond: %+v; it takes the row its lake had, 81", l)
	}
	if l := after[100].layers; len(l) != 1 || l[0].id != 81 {
		t.Errorf("chunk 100's pond: %+v; it takes the tile's usual water, 81", l)
	}
	if len(after[40].layers) != 0 {
		t.Error("chunk 40 kept the liquid the save took out")
	}

	// A tile left without liquid has no MH2O, and MHDR does not point at one.
	none := map[int][]Liquid{}
	for i := 0; i < ChunkCount; i++ {
		none[i] = nil
	}
	dry, err := Rewrite(out, Changes{TileX: 30, TileY: 21, Format: Format{MH2O: true}, Liquids: none})
	if err != nil {
		t.Fatal(err)
	}
	if topChunkAt(t, dry, "MH2O") >= 0 {
		t.Error("the dry tile still has an MH2O")
	}
	checkLaterOffsets(t, dry)
	if ls, err := ParseLiquids(dry); err != nil || len(ls) != 0 {
		t.Errorf("the dry tile reads %d liquid layers (%v)", len(ls), err)
	}
}

// A tile of the 3.3.5a client that holds its liquids in MCLQ, as Outland's do, keeps them there: the
// client reads both, and a tile with some chunks in each form is one it never ships.
func TestRewriteKeepsMCLQOnATileThatHasIt(t *testing.T) {
	root := syntheticTile(t)
	pond := Liquid{Type: LiquidWater}
	for v := range pond.Heights {
		pond.Heights[v] = 30
	}
	pond.Cells[0] = true
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Format: Format{MH2O: true}, Liquids: map[int][]Liquid{90: {pond}}})
	if err != nil {
		t.Fatal(err)
	}
	if topChunkAt(t, out, "MH2O") >= 0 {
		t.Fatal("the tile gained an MH2O beside its MCLQ liquids")
	}
	ls, err := ParseLiquids(out)
	if err != nil || layerOf(ls, 90%16, 90/16, LiquidWater) == nil {
		t.Fatalf("the pond is not in chunk 90's MCLQ (%v)", err)
	}
}

// On a map whose WDT asks for 8-bit alpha maps, paint is written a byte a texel as each layer's
// share of it, with the layers' offsets and the header's length to match, and reads back as the
// alpha it was given (#1069).
func TestRewriteBigAlpha(t *testing.T) {
	root := laterTile(t)
	maps := make([][]byte, 3)
	for l := range maps {
		maps[l] = make([]byte, 64*64)
		for k := range maps[l] {
			maps[l][k] = byte((k%64)*(l+2) + k/64)
		}
	}
	paint := ChunkPaint{Layers: []Layer{
		{Texture: `Tileset\Test\Snow.blp`}, {Texture: `Tileset\Test\Ice.blp`, Alpha: maps[0]},
		{Texture: `Tileset\Test\Rock.blp`, Alpha: maps[1]}, {Texture: `Tileset\Test\Mud.blp`, Alpha: maps[2]},
	}}
	out, err := Rewrite(root, Changes{TileX: 30, TileY: 21, Format: laterFormat, Paint: map[int]ChunkPaint{40: paint}})
	if err != nil {
		t.Fatal(err)
	}
	checkLaterOffsets(t, out)
	starts, _ := mcnkStarts(out)
	m := out[starts[40]:]
	if flags := binary.LittleEndian.Uint32(m); flags&mcnkFlagNoFix == 0 {
		t.Errorf("the chunk's flags %#x lack the one for 64x64 alpha maps", flags)
	}
	if n := binary.LittleEndian.Uint32(m[0x28:]); n != 8+3*alphaBytes8 {
		t.Errorf("the header gives the alpha maps %d bytes, want %d", n, 8+3*alphaBytes8)
	}
	mcly, ok := subRegion(m, int(binary.LittleEndian.Uint32(m[0x1c:])))
	mcal, ok2 := subRegion(m, int(binary.LittleEndian.Uint32(m[0x24:])))
	if !ok || !ok2 || len(mcly) != 4*16 || len(mcal) != 3*alphaBytes8 {
		t.Fatalf("MCLY is %d bytes and MCAL %d", len(mcly), len(mcal))
	}
	shares := WeightAlpha(maps)
	for l := 1; l < 4; l++ {
		flags, ofs := binary.LittleEndian.Uint32(mcly[l*16+4:]), int(binary.LittleEndian.Uint32(mcly[l*16+8:]))
		if flags&(layerUseAlpha|layerAlphaRLE) != layerUseAlpha || ofs != (l-1)*alphaBytes8 {
			t.Errorf("layer %d: flags %#x, alpha at %d", l, flags, ofs)
		}
		if !bytes.Equal(mcal[ofs:ofs+alphaBytes8], shares[l-1]) {
			t.Errorf("layer %d's bytes are not its share of each texel", l)
		}
	}
	for k := 0; k < alphaBytes8; k++ {
		if sum := int(mcal[k]) + int(mcal[alphaBytes8+k]) + int(mcal[2*alphaBytes8+k]); sum > 255 {
			t.Fatalf("texel %d's shares sum to %d; the base must be left the rest of 255", k, sum)
		}
	}
	// Read back, each texel shows the same mix: the shares of what was read are the file's.
	tex, err := ParseTextures(out, true, mustTerrain(t, out))
	if err != nil {
		t.Fatal(err)
	}
	back := WeightAlpha(tex.Chunks[40].Alpha)
	for l := range back {
		for k := range back[l] {
			if d := int(back[l][k]) - int(shares[l][k]); d < -1 || d > 1 {
				t.Fatalf("layer %d texel %d reads back as a share of %d, written %d", l+1, k, back[l][k], shares[l][k])
			}
		}
	}
	// The chunks the save did not paint keep their alpha bytes.
	for _, i := range []int{3, 39, 41, 255} {
		a, b := mustAlpha(t, out, i), mustAlpha(t, root, i)
		if !bytes.Equal(a, b) {
			t.Errorf("chunk %d's alpha maps changed", i)
		}
	}
}

// mustAlpha is chunk i's MCAL payload, as long as its header says.
func mustAlpha(t *testing.T, root []byte, i int) []byte {
	t.Helper()
	starts, err := mcnkStarts(root)
	if err != nil {
		t.Fatal(err)
	}
	m := root[starts[i]:]
	ofs, n := int(binary.LittleEndian.Uint32(m[0x24:])), int(binary.LittleEndian.Uint32(m[0x28:]))
	if ofs == 0 {
		return nil
	}
	return m[ofs : ofs+n-8]
}

func TestWeightAlpha(t *testing.T) {
	// The top layer shows half of the texel; the one under it half of what is left, a quarter.
	got := WeightAlpha([][]byte{{128}, {128}})
	if got[1][0] != 128 || got[0][0] != 64 {
		t.Errorf("shares %d and %d, want 64 under 128", got[0][0], got[1][0])
	}
	// And back, to within the rounding of a byte.
	if seq := SequentialAlpha(got); seq[0][0] < 127 || seq[0][0] > 129 || seq[1][0] != 128 {
		t.Errorf("back to %d and %d, want 128 and 128", seq[0][0], seq[1][0])
	}
	// Three layers whose rounded shares would pass 255 are held to it.
	got = WeightAlpha([][]byte{{255}, {127}, {127}})
	if sum := int(got[0][0]) + int(got[1][0]) + int(got[2][0]); sum > 255 {
		t.Errorf("shares sum to %d", sum)
	}
}

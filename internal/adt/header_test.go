package adt

import "testing"

func TestRewriteChunkHeadersReadBack(t *testing.T) {
	root := newTileRoot(32, 48)
	yes, no := true, false
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Headers: map[int]ChunkHeader{
		5: {AreaID: 12, Impassable: &yes},
		6: {AreaID: 40},
	}})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := ParseTerrain(out)
	if err != nil {
		t.Fatal(err)
	}
	c := terrain.Chunks
	if c[5].AreaID != 12 || !c[5].Impassable() {
		t.Fatalf("chunk 5: area %d, impassable %v", c[5].AreaID, c[5].Impassable())
	}
	if c[6].AreaID != 40 || c[6].Impassable() {
		t.Fatalf("chunk 6: area %d, impassable %v", c[6].AreaID, c[6].Impassable())
	}
	if c[4].AreaID != c[0].AreaID || c[4].Flags != c[0].Flags {
		t.Fatal("a chunk not listed changed")
	}
	if c[5].Flags&^mcnkFlagImpass != c[4].Flags {
		t.Fatalf("other flags changed: %#x vs %#x", c[5].Flags, c[4].Flags)
	}
	if c[5].Heights != c[4].Heights {
		t.Fatal("heights changed")
	}

	// The no-effect bits are replaced, not added to, even over what a paint adds.
	alpha := make([]byte, 64*64)
	paint := map[int]ChunkPaint{5: {Layers: []Layer{{Texture: `Tileset\Elwynn\ElwynnGrassBase.blp`}, {Texture: `Tileset\Elwynn\ElwynnDirtBase.blp`, Alpha: alpha}}, NoEffect: []uint8{0xff, 0, 0, 0, 0, 0, 0, 0}}}
	bits, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Paint: paint, Headers: map[int]ChunkHeader{5: {AreaID: 12, Impassable: &yes, NoEffect: []uint8{1, 0, 0, 0, 0, 0, 0, 2}}}})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err = ParseTerrain(bits)
	if err != nil {
		t.Fatal(err)
	}
	if got := terrain.Chunks[5].NoEffect; got != [CellsPerChunk]uint8{1, 0, 0, 0, 0, 0, 0, 2} {
		t.Fatalf("no-effect rows %v", got)
	}

	// Area 0 and no impassable value keep the chunk's own zone and flag (a map without chunk data, #644).
	kept, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Headers: map[int]ChunkHeader{5: {}}})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err = ParseTerrain(kept)
	if err != nil {
		t.Fatal(err)
	}
	if c := terrain.Chunks[5]; c.AreaID != 12 || !c.Impassable() {
		t.Fatalf("after keeping: area %d, impassable %v", c.AreaID, c.Impassable())
	}

	// A cleared flag comes off.
	out2, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Headers: map[int]ChunkHeader{5: {Impassable: &no}}})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err = ParseTerrain(out2)
	if err != nil {
		t.Fatal(err)
	}
	if c := terrain.Chunks[5]; c.AreaID != 12 || c.Impassable() {
		t.Fatalf("after clearing: area %d, impassable %v", c.AreaID, c.Impassable())
	}
	if terrain.Chunks[6].AreaID != 40 {
		t.Fatal("a chunk not listed in the second write lost its area")
	}
}

func TestHoleBitsTakeAnyCellOfABlock(t *testing.T) {
	// Cell (0, 0) alone cuts block (0, 0); cells (7, 7) and (6, 6) cut block (3, 3).
	if got := HoleBits([]uint8{1, 0, 0, 0, 0, 0, 0x40, 0x80}); got != 1|1<<15 {
		t.Fatalf("bits %#x", got)
	}
	if HoleBits(make([]uint8, CellsPerChunk)) != 0 {
		t.Fatal("no cells, but bits")
	}
}

func TestRewriteHolesReadBack(t *testing.T) {
	root := newTileRoot(32, 48)
	bits := HoleBits([]uint8{0, 0, 0, 0x0c, 0, 0, 0, 0})
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Headers: map[int]ChunkHeader{9: {Holes: &bits}}})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := ParseTerrain(out)
	if err != nil {
		t.Fatal(err)
	}
	c := terrain.Chunks[9]
	// Cells 2 and 3 of row 3 make block (1, 1): rows 2 and 3, cells 2 and 3.
	if c.Holes != [CellsPerChunk]uint8{0, 0, 0x0c, 0x0c, 0, 0, 0, 0} {
		t.Fatalf("holes %v", c.Holes)
	}
	if c.Flags&mcnkFlagHighHole != 0 {
		t.Fatal("high-resolution hole flag set")
	}
	if terrain.Chunks[8].Holes != [CellsPerChunk]uint8{} {
		t.Fatal("another chunk got holes")
	}

	// Added, as a map that doesn't know the client's holes sends them (#663), they join the chunk's
	// own; replaced, the chunk's own go.
	more := HoleBits([]uint8{0x03, 0, 0, 0, 0, 0, 0, 0})
	for _, add := range []bool{true, false} {
		again, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Headers: map[int]ChunkHeader{9: {Holes: &more, HolesAdd: add}}})
		if err != nil {
			t.Fatal(err)
		}
		terrain, err := ParseTerrain(again)
		if err != nil {
			t.Fatal(err)
		}
		want := [CellsPerChunk]uint8{0x03, 0x03, 0, 0, 0, 0, 0, 0}
		if add {
			want = [CellsPerChunk]uint8{0x03, 0x03, 0x0c, 0x0c, 0, 0, 0, 0}
		}
		if terrain.Chunks[9].Holes != want {
			t.Fatalf("add %v: holes %v, want %v", add, terrain.Chunks[9].Holes, want)
		}
	}
}

func TestRewriteShadowReadsBack(t *testing.T) {
	root := newTileRoot(32, 48)
	shadow := make([]byte, ShadowBytes)
	shadow[0], shadow[ShadowBytes-1] = 0x81, 0x40
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Headers: map[int]ChunkHeader{
		5: {Shadow: shadow},
		6: {Shadow: make([]byte, ShadowBytes)},
	}})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := ParseTerrain(out)
	if err != nil {
		t.Fatal(err)
	}
	c := terrain.Chunks
	if string(c[5].Shadow) != string(shadow) || c[5].Flags&mcnkFlagShadow == 0 {
		t.Fatalf("chunk 5: flags %#x, shadow read back %v", c[5].Flags, c[5].Shadow != nil)
	}
	// An empty map is still written, as the client's tiles have it, and leaves the flag alone.
	if len(c[6].Shadow) != ShadowBytes || c[6].Flags != c[4].Flags {
		t.Fatalf("chunk 6: flags %#x vs %#x, %d bytes", c[6].Flags, c[4].Flags, len(c[6].Shadow))
	}
	if c[5].Heights != c[4].Heights {
		t.Fatal("heights changed")
	}

	// A second rewrite keeps the written map, and a new one replaces it.
	again, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Headers: map[int]ChunkHeader{5: {}}})
	if err != nil {
		t.Fatal(err)
	}
	if terrain, err = ParseTerrain(again); err != nil || string(terrain.Chunks[5].Shadow) != string(shadow) {
		t.Fatalf("not kept: %v", err)
	}
}

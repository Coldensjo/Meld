package adt

import "testing"

func TestRewriteChunkHeadersReadBack(t *testing.T) {
	root := newTileRoot(32, 48)
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Headers: map[int]ChunkHeader{
		5: {AreaID: 12, Impassable: true},
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
	bits, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Paint: paint, Headers: map[int]ChunkHeader{5: {AreaID: 12, Impassable: true, NoEffect: []uint8{1, 0, 0, 0, 0, 0, 0, 2}}}})
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

	// Area 0 keeps the chunk's own zone, and a cleared flag comes off.
	out2, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Headers: map[int]ChunkHeader{5: {}}})
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

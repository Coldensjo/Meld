package adt

import "testing"

func TestPredominantFromWeights(t *testing.T) {
	// A 32-texel chunk: the base everywhere but the last cell row, where layer 1 weighs more.
	const per = 32
	w := make([]byte, per*per*4)
	for y := 0; y < per; y++ {
		for x := 0; x < per; x++ {
			i := (y*per + x) * 4
			if y >= per-4 {
				w[i], w[i+1] = 55, 200
			} else {
				w[i], w[i+1] = 200, 55
			}
		}
	}
	pred := PredominantFromWeights(2, w, per)
	if len(pred) != 64 {
		t.Fatalf("got %d cells", len(pred))
	}
	for i, p := range pred {
		want := uint8(0)
		if i >= 56 {
			want = 1
		}
		if p != want {
			t.Errorf("cell %d: layer %d, want %d", i, p, want)
		}
	}
	// One layer: nothing to choose.
	for _, p := range PredominantFromWeights(1, w, per) {
		if p != 0 {
			t.Fatal("a single layer is always predominant")
		}
	}
}

func TestWritePredominantPacksTwoBitsPerCell(t *testing.T) {
	header := make([]byte, mcnkHeaderLen)
	pred := make([]uint8, 64)
	pred[0], pred[1], pred[3], pred[63] = 1, 2, 3, 3
	writePredominant(header, pred)
	// Cells 0..3 share the first byte: 1 | 2<<2 | 0<<4 | 3<<6.
	if got := header[mcnkPredTex]; got != 1|2<<2|3<<6 {
		t.Fatalf("first byte %08b", got)
	}
	if got := header[mcnkPredTex+15]; got != 3<<6 {
		t.Fatalf("last byte %08b", got)
	}
}

func TestRewriteWritesLayerEffectsAndLearnsThem(t *testing.T) {
	root := newTileRoot(32, 48)
	alpha := make([]byte, 64*64)
	for i := range alpha {
		alpha[i] = 255
	}
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Paint: map[int]ChunkPaint{
		5: {Layers: []Layer{{Texture: `Tileset\Elwynn\ElwynnGrassBase.blp`, Effect: 42}, {Texture: `Tileset\Elwynn\ElwynnDirtBase.blp`, Alpha: alpha}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	effects, err := LayerEffects(out)
	if err != nil {
		t.Fatal(err)
	}
	if effects[`tileset\elwynn\elwynngrassbase.blp`] != 42 {
		t.Fatalf("grass effect %v", effects)
	}
	if _, has := effects[`tileset\elwynn\elwynndirtbase.blp`]; has {
		t.Fatal("a layer without an effect carries none")
	}
	// A second write of the same tile without effects keeps the learned one.
	out2, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Paint: map[int]ChunkPaint{
		5: {Layers: []Layer{{Texture: `Tileset\Elwynn\ElwynnGrassBase.blp`}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	effects, _ = LayerEffects(out2)
	if effects[`tileset\elwynn\elwynngrassbase.blp`] != 42 {
		t.Fatalf("the tile's own effect was lost: %v", effects)
	}
}

func TestRewriteNoEffectBitsReadBackAndKeepTheTilesOwn(t *testing.T) {
	root := newTileRoot(32, 48)
	alpha := make([]byte, 64*64)
	paint := func(bits []uint8) map[int]ChunkPaint {
		return map[int]ChunkPaint{5: {Layers: []Layer{{Texture: `Tileset\Elwynn\ElwynnGrassBase.blp`}, {Texture: `Tileset\Elwynn\ElwynnDirtBase.blp`, Alpha: alpha}}, NoEffect: bits}}
	}
	// Row 0 cells 0 and 1, row 7 cell 7.
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Paint: paint([]uint8{3, 0, 0, 0, 0, 0, 0, 0x80})})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := ParseTerrain(out)
	if err != nil {
		t.Fatal(err)
	}
	if got := terrain.Chunks[5].NoEffect; got != [CellsPerChunk]uint8{3, 0, 0, 0, 0, 0, 0, 0x80} {
		t.Fatalf("no-effect rows %v", got)
	}
	if terrain.Chunks[4].NoEffect != [CellsPerChunk]uint8{} {
		t.Fatal("another chunk got bits")
	}
	// A second write adds its bits to the tile's own rather than replacing them.
	out2, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Paint: paint([]uint8{0, 4, 0, 0, 0, 0, 0, 0})})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err = ParseTerrain(out2)
	if err != nil {
		t.Fatal(err)
	}
	if got := terrain.Chunks[5].NoEffect; got != [CellsPerChunk]uint8{3, 4, 0, 0, 0, 0, 0, 0x80} {
		t.Fatalf("no-effect rows after the second write %v", got)
	}
	// A write without bits keeps them.
	out3, err := Rewrite(out2, Changes{TileX: 32, TileY: 48, Paint: paint(nil)})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err = ParseTerrain(out3)
	if err != nil {
		t.Fatal(err)
	}
	if got := terrain.Chunks[5].NoEffect; got != [CellsPerChunk]uint8{3, 4, 0, 0, 0, 0, 0, 0x80} {
		t.Fatalf("no-effect rows after a write without bits %v", got)
	}
}

// TestRewriteLayerLookFlags writes an animated, overbright lava layer, checks the flags read back with
// the alpha flag beside them, that a later write without flags keeps the tile's own, and that explicit
// flags (0 included) replace them.
func TestRewriteLayerLookFlags(t *testing.T) {
	root := newTileRoot(32, 48)
	alpha := make([]byte, 64*64)
	for i := range alpha {
		alpha[i] = 255
	}
	lava := `Tileset\Test\Lava.blp`
	anim := uint32(0x40 | 0x18 | 0x2 | 0x80) // animated, speed 3, turned 90 degrees, overbright
	layerFlags := func(data []byte) uint32 {
		terrain, err := ParseTerrain(data)
		if err != nil {
			t.Fatal(err)
		}
		tex, err := ParseTextures(data, false, terrain)
		if err != nil {
			t.Fatal(err)
		}
		return tex.Chunks[5].Layers[1].Flags
	}
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Paint: map[int]ChunkPaint{
		5: {Layers: []Layer{{Texture: `Tileset\Test\Rock.blp`}, {Texture: lava, Alpha: alpha, Flags: &anim}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got := layerFlags(out); got != anim|layerUseAlpha {
		t.Fatalf("lava layer flags %#x, want %#x", got, anim|layerUseAlpha)
	}
	keep, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Paint: map[int]ChunkPaint{
		5: {Layers: []Layer{{Texture: `Tileset\Test\Rock.blp`}, {Texture: lava, Alpha: alpha}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got := layerFlags(keep); got != anim|layerUseAlpha {
		t.Fatalf("a rewrite without flags lost the tile's own: %#x", got)
	}
	none := uint32(0)
	cleared, err := Rewrite(out, Changes{TileX: 32, TileY: 48, Paint: map[int]ChunkPaint{
		5: {Layers: []Layer{{Texture: `Tileset\Test\Rock.blp`}, {Texture: lava, Alpha: alpha, Flags: &none}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got := layerFlags(cleared); got != layerUseAlpha {
		t.Fatalf("explicit flags 0 left %#x", got)
	}
}

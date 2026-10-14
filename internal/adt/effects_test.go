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

package adt

import (
	"bytes"
	"testing"
)

// parityAlpha is the alpha the ClientWeights parity check reads, which frontend/tests/tileImport.test.ts
// gives tilePaint too: layer l (1 or 2) of a chunk, texel i.
func parityAlpha(l, i int) byte {
	if l == 1 {
		return byte(i * 37 % 256)
	}
	return byte((i*91 + 17) % 256)
}

// paritySum folds a chunk's weights into one number, as tileImport.test.ts does.
func paritySum(w []byte) int {
	sum := 0
	for i, v := range w {
		sum = (sum*31 + int(v)*(i%251+1)) % 1000000007
	}
	return sum
}

// TestClientWeightsMatchesTilePaint pins ClientWeights to the number tileImport.test.ts pins
// tilePaint's weights of the same chunk to, since KeepClientAlpha compares them exactly (#526).
func TestClientWeightsMatchesTilePaint(t *testing.T) {
	own := TexChunk{Layers: []TexLayer{{Texture: "a"}, {Texture: "b"}, {Texture: "c"}}}
	for l := 1; l <= 2; l++ {
		alpha := make([]byte, AlphaSize*AlphaSize)
		for i := range alpha {
			alpha[i] = parityAlpha(l, i)
		}
		own.Alpha = append(own.Alpha, alpha)
	}
	w := ClientWeights(own, 32)
	for t0 := 0; t0 < len(w); t0 += 4 {
		if s := int(w[t0]) + int(w[t0+1]) + int(w[t0+2]) + int(w[t0+3]); s != 255 || w[t0+3] != 0 {
			t.Fatalf("texel %d weights %v", t0/4, w[t0:t0+4])
		}
	}
	if got := paritySum(w); got != parityWant {
		t.Fatalf("ClientWeights sum %d, tilePaint's is %d", got, parityWant)
	}
}

// parityWant is paritySum of tilePaint's weights for the parity chunk (tileImport.test.ts).
const parityWant = 138039546

// smoothTile is a tile whose chunk 5 has three layers with alpha that changes from texel to texel,
// at the client's full resolution, as a Blizzard tile's does.
func smoothTile(t *testing.T) ([]byte, []string) {
	t.Helper()
	names := []string{`Tileset\Elwynn\ElwynnGrassBase.blp`, `Tileset\Elwynn\ElwynnDirtBase2.blp`, `Tileset\Elwynn\ElwynnRock.blp`}
	a1 := make([]byte, AlphaSize*AlphaSize)
	a2 := make([]byte, AlphaSize*AlphaSize)
	for y := 0; y < AlphaSize; y++ {
		for x := 0; x < AlphaSize; x++ {
			a1[y*AlphaSize+x] = byte(x * 4)
			a2[y*AlphaSize+x] = byte((x*y + 3*y) % 256)
		}
	}
	root, err := BuildTile(hills(), Ring{}, Changes{TileX: 3, TileY: 4, Paint: map[int]ChunkPaint{5: {Layers: []Layer{
		{Texture: names[0]}, {Texture: names[1], Alpha: a1}, {Texture: names[2], Alpha: a2},
	}}}})
	if err != nil {
		t.Fatal(err)
	}
	return root, names
}

func ownChunk(t *testing.T, root []byte, idx int) TexChunk {
	t.Helper()
	tex, err := ParseTextures(root, false, mustTerrain(t, root))
	if err != nil {
		t.Fatal(err)
	}
	return tex.Chunks[idx]
}

// TestUnpaintedChunkKeepsClientAlpha sends a chunk back with the weights the editor read from it: the
// tile must come out as the same save without that chunk's paint writes it, byte for byte, where
// before #526 the chunk's alpha came back at half resolution.
func TestUnpaintedChunkKeepsClientAlpha(t *testing.T) {
	root, names := smoothTile(t)
	own := ownChunk(t, root, 5)
	weights := ClientWeights(own, 32)
	plain, err := Rewrite(root, Changes{TileX: 3, TileY: 4})
	if err != nil {
		t.Fatal(err)
	}

	blocky := ChunkPaint{Layers: LayersFromWeights(names, weights, 32), Predominant: PredominantFromWeights(3, weights, 32)}
	out, err := Rewrite(root, Changes{TileX: 3, TileY: 4, Paint: map[int]ChunkPaint{5: blocky}})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out, plain) {
		t.Fatal("the weights alone should lose the alpha's detail, or this test checks nothing")
	}

	kept := ChunkPaint{Layers: LayersFromWeights(names, weights, 32), Predominant: PredominantFromWeights(3, weights, 32)}
	kept.KeepClientAlpha(own, weights, 32)
	if !kept.ClientAlpha {
		t.Fatal("an unpainted chunk should keep its own alpha")
	}
	out, err = Rewrite(root, Changes{TileX: 3, TileY: 4, Paint: map[int]ChunkPaint{5: kept}})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, plain) {
		t.Fatal("an unpainted chunk changed the tile")
	}
}

// TestPaintedTexelsOnlyChange paints one texel of the chunk, with a texture it didn't have: that
// texel's 2x2 block of alpha changes, and every other texel keeps the client's alpha exactly.
func TestPaintedTexelsOnlyChange(t *testing.T) {
	root, names := smoothTile(t)
	own := ownChunk(t, root, 5)
	weights := ClientWeights(own, 32)
	const u, v = 10, 7
	at := (v*32 + u) * 4
	copy(weights[at:at+4], []byte{0, 0, 55, 200})
	names = append(names, `Tileset\Elwynn\ElwynnFlowers.blp`)
	p := ChunkPaint{Layers: LayersFromWeights(names, weights, 32)}
	p.KeepClientAlpha(own, weights, 32)
	if p.ClientAlpha {
		t.Fatal("a painted chunk is not the client's")
	}
	out, err := Rewrite(root, Changes{TileX: 3, TileY: 4, Paint: map[int]ChunkPaint{5: p}})
	if err != nil {
		t.Fatal(err)
	}
	back := ownChunk(t, out, 5)
	if len(back.Layers) != 4 || back.Layers[3].Texture != names[3] {
		t.Fatalf("layers %+v", back.Layers)
	}
	for y := 0; y < AlphaSize; y++ {
		for x := 0; x < AlphaSize; x++ {
			i := y*AlphaSize + x
			painted := x/2 == u && y/2 == v
			for l := 1; l <= 2; l++ {
				if same := back.Alpha[l-1][i] == own.Alpha[l-1][i]; same == painted {
					t.Fatalf("layer %d texel %d,%d: %d, the client's %d (painted %v)", l, x, y, back.Alpha[l-1][i], own.Alpha[l-1][i], painted)
				}
			}
			if new := back.Alpha[2][i]; (new != 0) != painted {
				t.Fatalf("new layer texel %d,%d: %d (painted %v)", x, y, new, painted)
			}
		}
	}
}

// TestRenamedLayerIsRepainted: a chunk whose textures are not the client's in order is written from
// its weights, as before.
func TestRenamedLayerIsRepainted(t *testing.T) {
	root, names := smoothTile(t)
	own := ownChunk(t, root, 5)
	weights := ClientWeights(own, 32)
	names[1] = `Tileset\Elwynn\ElwynnFlowers.blp`
	p := ChunkPaint{Layers: LayersFromWeights(names, weights, 32)}
	before := append([]byte(nil), p.Layers[1].Alpha...)
	p.KeepClientAlpha(own, weights, 32)
	if p.ClientAlpha || !bytes.Equal(p.Layers[1].Alpha, before) {
		t.Fatal("a chunk with another texture kept the client's alpha")
	}
}

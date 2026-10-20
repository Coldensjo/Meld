package wow

import (
	"slices"
	"testing"
)

func TestComposedTextureRoundTrip(t *testing.T) {
	layers := []SkinLayer{{RegionBase, `Character\Human\Male\HumanMaleSkin00_00.blp`}, {RegionTorsoUpper, `Item\TextureComponents\TorsoUpperTexture\A_TU_U.blp`}}
	name := ComposedTexture(layers)
	got, ok := parseComposed(name)
	if !ok || !slices.Equal(got, layers) {
		t.Fatalf("%q read back as %+v", name, got)
	}
	if _, ok := parseComposed(`Character\Human\Male\HumanMaleSkin00_00.blp`); ok {
		t.Fatal("a client file's path is not composed")
	}
	// A layer of an unknown region, or with a '?' (which ends the path in the frontend's URLs), is dropped.
	if got, _ := parseComposed("COMPOSE:0=a.blp|11=b.blp|6=c?.blp"); len(got) != 1 {
		t.Fatalf("got %+v", got)
	}
}

func TestPaintRegion(t *testing.T) {
	// A 512x512 skin scales the 256 layout by two; a 1x1 half-transparent red layer fills the torso
	// upper region (128,0 128x64 at 256) and blends over the grey, keeping the skin's alpha.
	dst := &Image{W: 512, H: 512, Pix: make([]byte, 512*512*4)}
	for i := 0; i < len(dst.Pix); i += 4 {
		dst.Pix[i], dst.Pix[i+1], dst.Pix[i+2], dst.Pix[i+3] = 100, 100, 100, 200
	}
	paintRegion(dst, &Image{W: 1, H: 1, Pix: []byte{255, 0, 0, 128}}, RegionTorsoUpper)
	px := func(x, y int) []byte { return dst.Pix[(y*512+x)*4 : (y*512+x)*4+4] }
	if got := px(256, 0); !slices.Equal(got, []byte{178, 50, 50, 200}) {
		t.Fatalf("painted texel %v", got)
	}
	if got := px(511, 127); got[0] != 178 {
		t.Fatalf("the region's far corner %v", got)
	}
	for _, p := range [][2]int{{255, 0}, {256, 128}} {
		if got := px(p[0], p[1]); got[0] != 100 {
			t.Fatalf("outside the region at %v: %v", p, got)
		}
	}
}

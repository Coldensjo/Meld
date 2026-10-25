package wow

import (
	"bytes"
	"math"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

// meanError is the mean difference per colour channel of two RGBA images.
func meanError(a, b []byte) float64 {
	sum := 0.0
	n := 0
	for i := range a {
		if i%4 == 3 {
			continue
		}
		sum += math.Abs(float64(a[i]) - float64(b[i]))
		n++
	}
	return sum / float64(n)
}

func TestEncodeMinimapBLPReadsBack(t *testing.T) {
	const w, h = 256, 256
	img := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := (y*w + x) * 4
			img[i], img[i+1], img[i+2], img[i+3] = byte(x), byte(y), byte((x+y)/2), 255
		}
	}
	blp, err := EncodeMinimapBLP(img, w, h)
	if err != nil {
		t.Fatal(err)
	}
	if len(blp) != 33940 {
		t.Fatalf("%d bytes, the client's tiles are 33940", len(blp))
	}
	got, err := DecodeBLP(blp)
	if err != nil {
		t.Fatal(err)
	}
	if got.W != w || got.H != h {
		t.Fatalf("size %dx%d", got.W, got.H)
	}
	if e := meanError(img, got.Pix); e > 3 {
		t.Fatalf("mean error %.2f per channel", e)
	}
	if _, err := EncodeMinimapBLP(img, 255, 256); err == nil {
		t.Fatal("a size not a multiple of 4 was accepted")
	}
}

// TestClientMinimapReencoded decodes Northshire's minimap tile from the client and writes it again:
// the header is the client's byte for byte, and the picture comes back close.
// WOW_DIR=/path/to/client go test ./internal/wow/
func TestClientMinimapReencoded(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	raw, err := set.ReadFile(MinimapIndexPath)
	if err != nil {
		t.Fatal(err)
	}
	name, ok := ParseMinimapIndex(raw).Tile("Azeroth", 32, 48)
	if !ok {
		t.Fatal("no minimap tile for Azeroth 32_48")
	}
	orig, err := set.ReadFile(`textures\Minimap\` + name)
	if err != nil {
		t.Fatal(err)
	}
	img, err := DecodeBLP(orig)
	if err != nil {
		t.Fatal(err)
	}
	blp, err := EncodeMinimapBLP(img.Pix, img.W, img.H)
	if err != nil {
		t.Fatal(err)
	}
	if len(blp) != len(orig) || !bytes.Equal(blp[:blpHeaderLen], orig[:blpHeaderLen]) {
		t.Fatalf("header differs: ours % x\nclient % x", blp[:24], orig[:24])
	}
	again, err := DecodeBLP(blp)
	if err != nil {
		t.Fatal(err)
	}
	if e := meanError(img.Pix, again.Pix); e > 2 {
		t.Fatalf("re-encoded tile differs by %.2f per channel", e)
	}
}

// TestEncodeOverlayBLPReadsBack writes world map overlay pieces (#219) as DXT3 with mips: a 256x256
// piece is the size of the client's (Elwynn's Goldshire1.blp, 88580 bytes), a 64x256 one (the last
// column of a piece, as RidgepointTower2.blp) works too, and both read back with their alpha.
func TestEncodeOverlayBLPReadsBack(t *testing.T) {
	for _, sz := range [][2]int{{256, 256}, {64, 256}} {
		w, h := sz[0], sz[1]
		img := make([]byte, w*h*4)
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				i := (y*w + x) * 4
				img[i], img[i+1], img[i+2], img[i+3] = byte(x), byte(y), 90, byte(y)
			}
		}
		blp, err := EncodeOverlayBLP(img, w, h)
		if err != nil {
			t.Fatal(err)
		}
		if w == 256 && len(blp) != 88580 {
			t.Fatalf("%d bytes, the client's 256x256 overlay pieces are 88580", len(blp))
		}
		if blp[8] != 2 || blp[9] != 8 || blp[10] != 1 || blp[11] != 1 {
			t.Fatalf("format bytes %v, want DXT3 with mips (2 8 1 1)", blp[8:12])
		}
		back, err := DecodeBLP(blp)
		if err != nil {
			t.Fatal(err)
		}
		if back.W != w || back.H != h {
			t.Fatalf("read back %dx%d", back.W, back.H)
		}
		if e := meanError(img, back.Pix); e > 3 {
			t.Fatalf("%dx%d colour differs by %.2f a channel", w, h, e)
		}
		for i := 3; i < len(img); i += 4 {
			if d := int(img[i]) - int(back.Pix[i]); d > 9 || d < -9 {
				t.Fatalf("alpha %d read back as %d", img[i], back.Pix[i])
			}
		}
	}
	if _, err := EncodeOverlayBLP(make([]byte, 100*64*4), 100, 64); err == nil {
		t.Fatal("a size not a power of two was taken")
	}
}

package wow

import (
	"bytes"
	"math"
	"os"
	"testing"

	"Meld/internal/mpq"
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
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.12 client to run")
	}
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

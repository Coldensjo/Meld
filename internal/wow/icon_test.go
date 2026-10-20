package wow

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// testPNG is an n by m PNG made here: a red left half, a blue right half and a transparent corner.
func testPNG(t *testing.T, n, m int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, n, m))
	for y := 0; y < m; y++ {
		for x := 0; x < n; x++ {
			c := color.NRGBA{200, 30, 20, 255}
			if x >= n/2 {
				c = color.NRGBA{20, 40, 220, 255}
			}
			if x < n/8 && y < m/8 {
				c.A = 0
			}
			img.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestIconFromPNG(t *testing.T) {
	for _, n := range []int{64, 128, 40} {
		blp, err := IconFromPNG(testPNG(t, n, n))
		if err != nil {
			t.Fatalf("%d: %v", n, err)
		}
		// The client's own icon format: DXT3, alpha depth 8, a full mip chain, 64x64.
		if blp[8] != 2 || blp[9] != 8 || blp[10] != 1 || blp[11] != 1 {
			t.Fatalf("%d: header %v, want DXT3 with mips", n, blp[8:12])
		}
		if _, ok := DXTOf(blp); !ok {
			t.Fatalf("%d: the mip chain doesn't reach 1x1", n)
		}
		img, err := DecodeBLP(blp)
		if err != nil {
			t.Fatal(err)
		}
		if img.W != IconSize || img.H != IconSize {
			t.Fatalf("%d: %dx%d, want 64x64", n, img.W, img.H)
		}
		px := func(x, y int) []byte { i := (y*img.W + x) * 4; return img.Pix[i : i+4] }
		if p := px(16, 32); p[0] < 150 || p[2] > 70 || p[3] != 255 {
			t.Errorf("%d: the left half reads %v, want red", n, p)
		}
		if p := px(48, 32); p[2] < 150 || p[0] > 70 {
			t.Errorf("%d: the right half reads %v, want blue", n, p)
		}
		if p := px(2, 2); p[3] != 0 {
			t.Errorf("%d: the corner's alpha is %d, want 0", n, p[3])
		}
		// Back out as a PNG, the same pixels.
		out, err := IconPNG(blp)
		if err != nil {
			t.Fatal(err)
		}
		back, err := png.Decode(bytes.NewReader(out))
		if err != nil {
			t.Fatal(err)
		}
		if r, g, b, a := back.At(48, 32).RGBA(); b>>8 < 150 || r>>8 > 70 || a>>8 != 255 || g>>8 > 100 {
			t.Errorf("%d: the exported PNG's right half reads %v %v %v %v", n, r>>8, g>>8, b>>8, a>>8)
		}
	}
}

func TestIconFromPNGRefuses(t *testing.T) {
	if _, err := IconFromPNG(testPNG(t, 64, 32)); err == nil {
		t.Error("a 64x32 image was taken")
	}
	if _, err := IconFromPNG([]byte("not a png")); err == nil {
		t.Error("bytes that aren't a PNG were taken")
	}
}

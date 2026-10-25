package heightmap

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestReadGreyBoxesDownAndAverages(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 4, 2))
	// Left half white, right half black; one red pixel on the right counts a third.
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			c := color.NRGBA{0, 0, 0, 255}
			if x < 2 {
				c = color.NRGBA{255, 255, 255, 255}
			}
			img.Set(x, y, c)
		}
	}
	img.Set(3, 1, color.NRGBA{255, 0, 0, 255})
	dir := t.TempDir()
	path := filepath.Join(dir, "b.png")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	f.Close()
	os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644)

	g, err := ReadGrey(path, 2)
	if err != nil {
		t.Fatal(err)
	}
	if g.W != 2 || g.H != 1 {
		t.Fatalf("size %dx%d", g.W, g.H)
	}
	if g.Pix[0] != 255 || g.Pix[1] != 21 {
		t.Fatalf("pixels %v", g.Pix)
	}
	names, err := ListImages(dir)
	if err != nil || len(names) != 1 || names[0] != "b.png" {
		t.Fatalf("list %v %v", names, err)
	}
}

func TestToGreyTerminatesForZeroMax(t *testing.T) {
	g := toGrey(image.NewGray(image.Rect(0, 0, 4, 4)), 0)
	if g.W != 1 || g.H != 1 {
		t.Fatalf("size = %dx%d", g.W, g.H)
	}
}

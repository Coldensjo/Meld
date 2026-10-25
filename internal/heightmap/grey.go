package heightmap

import (
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg" // brush images may be JPEGs
	_ "image/png"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Grey is an image as grey levels, a byte a pixel, row-major: what an image brush is shaped by.
type Grey struct {
	W   int
	H   int
	Pix []byte
}

// GreyView is a Grey for the bridge, its pixels as base64.
type GreyView struct {
	W   int    `json:"w"`
	H   int    `json:"h"`
	Pix string `json:"pix"`
}

// View is g for the bridge.
func (g *Grey) View() *GreyView {
	return &GreyView{W: g.W, H: g.H, Pix: base64.StdEncoding.EncodeToString(g.Pix)}
}

// brushExts are the image files a brush folder lists.
var brushExts = map[string]bool{".png": true, ".jpg": true, ".jpeg": true}

// ListImages names the PNG and JPEG files in dir, sorted, without the folder.
func ListImages(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && brushExts[strings.ToLower(filepath.Ext(e.Name()))] {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out, nil
}

// ReadGrey reads a PNG or JPEG as grey levels (the mean of red, green and blue, times alpha), boxed
// down so neither side exceeds max pixels.
func ReadGrey(path string, max int) (*Grey, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("brush image %s: %w", filepath.Base(path), err)
	}
	return toGrey(img, max), nil
}

// toGrey boxes img down to fit max a side and turns it grey.
func toGrey(img image.Image, max int) *Grey {
	if max < 1 {
		max = 1
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	step := 1
	for (w+step-1)/step > max || (h+step-1)/step > max {
		step++
	}
	ow, oh := (w+step-1)/step, (h+step-1)/step
	g := &Grey{W: ow, H: oh, Pix: make([]byte, ow*oh)}
	for oy := 0; oy < oh; oy++ {
		for ox := 0; ox < ow; ox++ {
			var sum, n uint64
			for y := oy * step; y < (oy+1)*step && y < h; y++ {
				for x := ox * step; x < (ox+1)*step && x < w; x++ {
					// RGBA is alpha-premultiplied, so a transparent pixel counts as black.
					r, gg, bb, _ := img.At(b.Min.X+x, b.Min.Y+y).RGBA()
					sum += (uint64(r) + uint64(gg) + uint64(bb)) / 3
					n++
				}
			}
			g.Pix[oy*ow+ox] = byte(sum / n >> 8)
		}
	}
	return g
}

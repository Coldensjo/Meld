package wow

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"math"
)

// IconSize is the side of the client's icons (Interface\Icons): every one of the 2684 in 1.12.1 is
// 64x64, 1474 of them BLP2 DXT3 with a full mip chain (surveyed 2026-10-20).
const IconSize = 64

// IconFromPNG makes a client icon from a PNG image (#364): square, scaled to 64x64 when it is another
// size, and written as most of the client's icons are, the DXT3 BLP EncodeOverlayBLP writes.
func IconFromPNG(data []byte) ([]byte, error) {
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("not a PNG image: %w", err)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w != h {
		return nil, fmt.Errorf("an icon is square, and this image is %dx%d", w, h)
	}
	if w < 8 || w > 4096 {
		return nil, fmt.Errorf("an icon is 8 to 4096 pixels wide, and this image is %d", w)
	}
	rgba := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(rgba, rgba.Bounds(), img, b.Min, draw.Src)
	pix := rgba.Pix
	if w != IconSize {
		pix = resample(pix, w, IconSize)
	}
	return EncodeOverlayBLP(pix, IconSize, IconSize)
}

// IconFromPixels makes a client icon from an IconSize by IconSize RGBA picture (not premultiplied, row
// 0 at the top), one the page has already fitted, framed and backed (#717), written as IconFromPNG
// writes it.
func IconFromPixels(pix []byte) ([]byte, error) {
	if len(pix) != IconSize*IconSize*4 {
		return nil, fmt.Errorf("an icon's picture is %d bytes, want %d (%dx%d RGBA)", len(pix), IconSize*IconSize*4, IconSize, IconSize)
	}
	return EncodeOverlayBLP(pix, IconSize, IconSize)
}

// IconPNG is a client texture (an icon's BLP) as a PNG image, alpha kept.
func IconPNG(blp []byte) ([]byte, error) {
	img, err := DecodeBLP(blp)
	if err != nil {
		return nil, err
	}
	out := image.NewNRGBA(image.Rect(0, 0, img.W, img.H))
	copy(out.Pix, img.Pix)
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// resample scales a square n by n RGBA image to size by size by area: each new pixel is the mean of
// the old ones it covers, each by the part of it covered, colour weighted by alpha as halve does, so a
// transparent edge doesn't darken the icon's.
func resample(pix []byte, n, size int) []byte {
	out := make([]byte, size*size*4)
	scale := float64(n) / float64(size)
	// span is the old pixels a new row or column covers, with the part of each.
	type part struct {
		i int
		w float64
	}
	spans := make([][]part, size)
	for t := 0; t < size; t++ {
		lo, hi := float64(t)*scale, float64(t+1)*scale
		for i := int(math.Floor(lo)); i < n && float64(i) < hi; i++ {
			if w := math.Min(hi, float64(i+1)) - math.Max(lo, float64(i)); w > 0 {
				spans[t] = append(spans[t], part{i, w})
			}
		}
	}
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var c [3]float64
			var a, area float64
			for _, py := range spans[y] {
				for _, px := range spans[x] {
					i := (py.i*n + px.i) * 4
					w := py.w * px.w
					wa := w * (float64(pix[i+3]) + 1)
					for k := 0; k < 3; k++ {
						c[k] += float64(pix[i+k]) * wa
					}
					a += wa
					area += w
				}
			}
			o := (y*size + x) * 4
			for k := 0; k < 3; k++ {
				out[o+k] = byte(math.Round(c[k] / a))
			}
			out[o+3] = byte(math.Round(math.Max(0, a/area-1)))
		}
	}
	return out
}

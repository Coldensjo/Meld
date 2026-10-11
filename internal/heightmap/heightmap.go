// Package heightmap reads and writes terrain heights as 16-bit grayscale PNG images. A pixel is a height
// on a fixed scale, so an image needs no other data: black is Min yards, white is Max yards.
package heightmap

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
)

const (
	// Min and Max are the heights the image covers, in yards. Heights outside them are clamped.
	Min = -1024.0
	Max = 1024.0
)

// Encode writes a square grid of heights (side x side, row-major) as a 16-bit PNG.
func Encode(side int, heights []float32) ([]byte, error) {
	if side < 2 || len(heights) != side*side {
		return nil, fmt.Errorf("heightmap: %d heights for a %dx%d grid", len(heights), side, side)
	}
	img := image.NewGray16(image.Rect(0, 0, side, side))
	for i, h := range heights {
		v := (float64(h) - Min) / (Max - Min)
		v = math.Max(0, math.Min(1, v))
		level := uint16(math.Round(v * 65535))
		img.Pix[2*i] = byte(level >> 8)
		img.Pix[2*i+1] = byte(level)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Decode reads a PNG as a square grid of heights. Any 8- or 16-bit grayscale image works, as do other
// images, which are read as grayscale. It fails when the image isn't square.
func Decode(data []byte) (int, []float32, error) {
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return 0, nil, fmt.Errorf("not a PNG image: %w", err)
	}
	b := img.Bounds()
	if b.Dx() != b.Dy() || b.Dx() < 2 {
		return 0, nil, errors.New("the heightmap must be a square image")
	}
	side := b.Dx()
	heights := make([]float32, 0, side*side)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			g := color.Gray16Model.Convert(img.At(x, y)).(color.Gray16)
			v := float64(g.Y) / 65535
			heights = append(heights, float32(Min+v*(Max-Min)))
		}
	}
	return side, heights, nil
}

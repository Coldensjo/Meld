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

// EncodeRGB writes a square grid of 8-bit RGB pixels (side x side, three bytes each, row-major) as a
// PNG, for the normal map export.
func EncodeRGB(side int, rgb []byte) ([]byte, error) {
	if side < 1 || len(rgb) != side*side*3 {
		return nil, fmt.Errorf("heightmap: %d bytes for a %dx%d RGB image", len(rgb), side, side)
	}
	img := image.NewNRGBA(image.Rect(0, 0, side, side))
	for i := 0; i < side*side; i++ {
		copy(img.Pix[4*i:4*i+3], rgb[3*i:3*i+3])
		img.Pix[4*i+3] = 255
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// MaxSide is the largest side Decode accepts: the largest .wmap, 4 x 2048 + 1.
const MaxSide = 4*2048 + 1

// Decode reads a PNG as a square grid of heights. Any 8- or 16-bit grayscale image works, as do other
// images, which are read as grayscale. It fails when the image isn't square or its side exceeds
// MaxSide, which it checks before decoding any pixel.
func Decode(data []byte) (int, []float32, error) {
	cfg, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, nil, fmt.Errorf("not a PNG image: %w", err)
	}
	if cfg.Width != cfg.Height || cfg.Width < 2 {
		return 0, nil, errors.New("the heightmap must be a square image")
	}
	if cfg.Width > MaxSide {
		return 0, nil, fmt.Errorf("the heightmap is %d pixels a side, more than the %d a map can hold", cfg.Width, MaxSide)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return 0, nil, fmt.Errorf("not a PNG image: %w", err)
	}
	b := img.Bounds()
	side := b.Dx()
	heights := make([]float32, side*side)
	const scale = (Max - Min) / 65535
	switch im := img.(type) {
	case *image.Gray16:
		for y := 0; y < side; y++ {
			row := im.Pix[y*im.Stride : y*im.Stride+2*side]
			for x := 0; x < side; x++ {
				heights[y*side+x] = float32(Min + float64(uint16(row[2*x])<<8|uint16(row[2*x+1]))*scale)
			}
		}
	case *image.Gray:
		for y := 0; y < side; y++ {
			row := im.Pix[y*im.Stride : y*im.Stride+side]
			for x := 0; x < side; x++ {
				heights[y*side+x] = float32(Min + float64(uint16(row[x])*257)*scale)
			}
		}
	default:
		i := 0
		for y := b.Min.Y; y < b.Max.Y; y++ {
			for x := b.Min.X; x < b.Max.X; x++ {
				g := color.Gray16Model.Convert(img.At(x, y)).(color.Gray16)
				heights[i] = float32(Min + float64(g.Y)*scale)
				i++
			}
		}
	}
	return side, heights, nil
}

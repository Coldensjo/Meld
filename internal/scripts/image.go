package scripts

import (
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
)

// MaxImagePixels is the most pixels an image a script loads may have (4096 by 4096), as the page keeps
// it whole for the script.
const MaxImagePixels = 4096 * 4096

// ImagePath is where a script's load_png reads path from: the path itself when it is whole, else that
// path under dir (the scripts folder), as Noggit Red's scripts name images beside themselves.
func ImagePath(dir, path string) (string, error) {
	if path == "" {
		return "", errors.New("no file named")
	}
	if filepath.IsAbs(path) {
		return filepath.Clean(path), nil
	}
	return filepath.Join(dir, filepath.FromSlash(path)), nil
}

// LoadPNG reads the PNG at file as RGBA, a byte each and not premultiplied, row by row from the top.
func LoadPNG(file string) (w, h int, pix []byte, err error) {
	f, err := os.Open(file)
	if err != nil {
		return 0, 0, nil, err
	}
	defer f.Close()
	cfg, err := png.DecodeConfig(f)
	if err != nil {
		return 0, 0, nil, fmt.Errorf("%s is not a PNG: %w", filepath.Base(file), err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > MaxImagePixels {
		return 0, 0, nil, fmt.Errorf("%s is %d×%d, over 4096×4096", filepath.Base(file), cfg.Width, cfg.Height)
	}
	if _, err := f.Seek(0, 0); err != nil {
		return 0, 0, nil, err
	}
	img, err := png.Decode(f)
	if err != nil {
		return 0, 0, nil, fmt.Errorf("%s is not a PNG: %w", filepath.Base(file), err)
	}
	b := img.Bounds()
	out, ok := img.(*image.NRGBA)
	if !ok || out.Stride != 4*b.Dx() || b.Min != (image.Point{}) {
		out = image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
		draw.Draw(out, out.Bounds(), img, b.Min, draw.Src)
	}
	return b.Dx(), b.Dy(), out.Pix, nil
}

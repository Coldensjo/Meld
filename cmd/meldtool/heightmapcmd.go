package main

import (
	"encoding/base64"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"

	"Meld/internal/heightmap"
	"Meld/internal/mapfile"
)

// heightmapInfo is what heightmap export and import print.
type heightmapInfo struct {
	File string `json:"file"`
	Out  string `json:"out"`
	// Side is the map's vertices a side (cells + 1); ImageSide the image's, which import stretches.
	Side      int     `json:"side"`
	ImageSide int     `json:"imageSide"`
	HeightMin float32 `json:"heightMin"`
	HeightMax float32 `json:"heightMax"`
	// Clamped counts the heights outside the image's -1024 to 1024 yards, which export clamps.
	Clamped int `json:"clamped,omitempty"`
	// ShadowsStale is set when import changed a map with baked shadows: bake them again in Meld.
	ShadowsStale bool `json:"shadowsStale,omitempty"`
}

// mapHeights decodes a map's height blob: (size + 1)² float32s, row by row.
func mapHeights(m *mapfile.MapData) ([]float32, int, error) {
	raw, err := base64.StdEncoding.DecodeString(m.Heights)
	if err != nil {
		return nil, 0, fmt.Errorf("heights: %w", err)
	}
	side := m.Size + 1
	if len(raw) != side*side*4 {
		return nil, 0, fmt.Errorf("heights: %d bytes for %d vertices a side", len(raw), side)
	}
	h := make([]float32, side*side)
	for i := range h {
		h[i] = math.Float32frombits(binary.LittleEndian.Uint32(raw[i*4:]))
	}
	return h, side, nil
}

func heightRange(h []float32) (float32, float32) {
	lo, hi := float32(math.Inf(1)), float32(math.Inf(-1))
	for _, v := range h {
		lo, hi = min(lo, v), max(hi, v)
	}
	return lo, hi
}

// heightmapExport writes a .wmap's heights as the 16-bit grey PNG the app's Export Heightmap writes:
// one pixel a vertex, black -1024 yards and white 1024.
func heightmapExport(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("heightmap export", flag.ContinueOnError)
	dest := fs.String("o", "", "the PNG to write")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 || *dest == "" {
		return fmt.Errorf("%w: heightmap export takes one .wmap and -o out.png", errUsage)
	}
	m, err := mapfile.Load(pos[0])
	if err != nil {
		return err
	}
	h, side, err := mapHeights(m)
	if err != nil {
		return err
	}
	data, err := heightmap.Encode(side, h)
	if err != nil {
		return err
	}
	if err := os.WriteFile(*dest, data, 0o644); err != nil {
		return err
	}
	info := heightmapInfo{File: pos[0], Out: *dest, Side: side, ImageSide: side}
	info.HeightMin, info.HeightMax = heightRange(h)
	for _, v := range h {
		if v < heightmap.Min || v > heightmap.Max {
			info.Clamped++
		}
	}
	return writeJSON(out, info)
}

// heightmapImport sets a .wmap's heights from a grey image, as the app's Import Heightmap does in its
// Set mode over the whole map (io/heightmapImport.ts): each pixel's grey, black to white, becomes a
// height from --min to --max, and an image of another size is stretched bilinearly over the map. It
// writes a new file (-o), never the one it read unless -o names it.
func heightmapImport(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("heightmap import", flag.ContinueOnError)
	dest := fs.String("o", "", "the .wmap to write")
	lo := fs.Float64("min", heightmap.Min, "the height black stands for, in yards")
	hi := fs.Float64("max", heightmap.Max, "the height white stands for, in yards")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 2 || *dest == "" {
		return fmt.Errorf("%w: heightmap import takes a .wmap, an image and -o out.wmap", errUsage)
	}
	if !strings.EqualFold(filepath.Ext(*dest), ".wmap") {
		return fmt.Errorf("%w: -o names a .wmap", errUsage)
	}
	m, err := mapfile.Load(pos[0])
	if err != nil {
		return err
	}
	_, side, err := mapHeights(m)
	if err != nil {
		return err
	}
	png, err := os.ReadFile(pos[1])
	if err != nil {
		return err
	}
	n, img, err := heightmap.Decode(png)
	if err != nil {
		return fmt.Errorf("%s: %w", pos[1], err)
	}
	h := importedHeights(img, n, side, *lo, *hi)
	raw := make([]byte, len(h)*4)
	for i, v := range h {
		binary.LittleEndian.PutUint32(raw[i*4:], math.Float32bits(v))
	}
	m.Heights = base64.StdEncoding.EncodeToString(raw)
	if err := mapfile.Save(*dest, m); err != nil {
		return err
	}
	info := heightmapInfo{File: pos[0], Out: *dest, Side: side, ImageSide: n, ShadowsStale: m.Shadows != ""}
	info.HeightMin, info.HeightMax = heightRange(h)
	return writeJSON(out, info)
}

// importedHeights resamples an n-a-side image's decoded heights to side and maps their greys (0 to 1
// over the image's -1024 to 1024) onto lo to hi: imageRatios and importHeights' Set mode in
// frontend/src/lib/io/heightmapImport.ts, which this must match.
func importedHeights(img []float32, n, side int, lo, hi float64) []float32 {
	ratio := func(i int) float64 { return (float64(img[i]) - heightmap.Min) / (heightmap.Max - heightmap.Min) }
	out := make([]float32, side*side)
	for z := 0; z < side; z++ {
		v := float64(z*(n-1)) / float64(side-1)
		z0 := min(n-1, int(math.Floor(v)))
		z1 := min(n-1, z0+1)
		fz := v - float64(z0)
		for x := 0; x < side; x++ {
			u := float64(x*(n-1)) / float64(side-1)
			x0 := min(n-1, int(math.Floor(u)))
			x1 := min(n-1, x0+1)
			fx := u - float64(x0)
			top := ratio(z0*n+x0)*(1-fx) + ratio(z0*n+x1)*fx
			bottom := ratio(z1*n+x0)*(1-fx) + ratio(z1*n+x1)*fx
			r := float64(float32(top*(1-fz) + bottom*fz)) // a Float32Array there
			out[z*side+x] = float32(lo + r*(hi-lo))
		}
	}
	return out
}

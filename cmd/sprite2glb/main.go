// Command sprite2glb turns sprites drawn in a slanted projection (Tibia's item sprites, such as a
// pillar, or 2:1 isometric ones) into 3D models, glTF binaries, as the editor's Tools > Sprite to 3D
// Model does (internal/spritemodel):
//
//	go run ./cmd/sprite2glb [-proj tibia|iso] [-reading auto|box|round|wall|cutout|hull|outfit] [-outline]
//		[-centre x,y] [-scale f] [-frame n] [-out dir] [-preview] <sprite.png>...
//
// An outfit sheet (four columns of frames facing north, east, south and west) is read as one, its
// model carved from the four views.
//
// Each model is written beside its sprite with its name and .glb, unless -out names a folder;
// -preview also writes <name>.preview.png, the model drawn from its four sides as the sprite was.
package main

import (
	"flag"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"

	"Meld/internal/spritemodel"
)

func main() {
	proj := flag.String("proj", "tibia", "how the sprite is drawn: tibia, or iso (2:1 isometric)")
	reading := flag.String("reading", "auto", "how to guess the depth: auto, box, round, wall, cutout, hull, or outfit (a sheet facing four ways)")
	outline := flag.Bool("outline", false, "keep the dark outline round the silhouette in the colours")
	centre := flag.String("centre", "", "where the thing's axis meets the ground, as x,y in sprite pixels (default: its tile's centre)")
	scale := flag.Float64("scale", 1, "size factor; 1 makes one tile one unit")
	outDir := flag.String("out", "", "folder for the models (default: beside each sprite)")
	preview := flag.Bool("preview", false, "also write <name>.preview.png, the model drawn from its four sides")
	frame := flag.Int("frame", 0, "for an outfit sheet, the row (frame of its walk) to read, from 0")
	flag.Parse()
	if flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: sprite2glb [-proj tibia|iso] [-reading auto|box|round|wall|cutout|hull|outfit] [-outline] [-centre x,y] [-scale f] [-frame n] [-out dir] [-preview] <sprite.png>...")
		os.Exit(2)
	}
	opt := spritemodel.Options{
		Projection:  spritemodel.Projection(*proj),
		Reading:     spritemodel.Reading(*reading),
		KeepOutline: *outline,
		Scale:       *scale,
		Frame:       *frame,
	}
	if *centre != "" {
		var p image.Point
		if _, err := fmt.Sscanf(*centre, "%d,%d", &p.X, &p.Y); err != nil {
			fmt.Fprintf(os.Stderr, "-centre %q: want x,y\n", *centre)
			os.Exit(2)
		}
		opt.Centre = &p
	}
	failed := false
	for _, in := range flag.Args() {
		if err := convert(in, *outDir, opt, *preview); err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", in, err)
			failed = true
		}
	}
	if failed {
		os.Exit(1)
	}
}

func convert(in, outDir string, opt spritemodel.Options, preview bool) error {
	f, err := os.Open(in)
	if err != nil {
		return err
	}
	img, err := png.Decode(f)
	f.Close()
	if err != nil {
		return err
	}
	base := strings.TrimSuffix(filepath.Base(in), filepath.Ext(in))
	m, err := spritemodel.Convert(spritemodel.SafeName(base), img, opt)
	if err != nil {
		return err
	}
	glb, err := m.GLB()
	if err != nil {
		return err
	}
	dir := outDir
	if dir == "" {
		dir = filepath.Dir(in)
	}
	out := filepath.Join(dir, spritemodel.SafeName(base)+".glb")
	if err := os.WriteFile(out, glb, 0o644); err != nil {
		return err
	}
	fmt.Printf("%s: %s\n", out, m.Report.Summary())
	if preview {
		pv, err := os.Create(strings.TrimSuffix(out, ".glb") + ".preview.png")
		if err != nil {
			return err
		}
		defer pv.Close()
		return png.Encode(pv, m.Preview(4))
	}
	return nil
}

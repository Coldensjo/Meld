package otbm

import (
	"archive/zip"
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// SpriteSize is the side of a Tibia item sprite that can lie on a cube face: one tile, top-down.
const SpriteSize = 32

// spriteName is an item sprite's file name: its item id, as "0102_item_image.png" or "102.png".
var spriteName = regexp.MustCompile(`^0*(\d+)(?:_item_image)?\.png$`)

// SpriteReport says what ItemSprites read: the sprites found for the asked items, those kept, and why
// the others were not.
type SpriteReport struct {
	Asked, Found, Kept int
	// Walls is how many of the kept were walls, their face unsheared from the sprite (3dgame #225), and
	// Borders how many borders, kept see-through (3dgame #226).
	Walls, Borders int
	// NotSquare and SeeThrough are sprites left out for not being one tile, or for having see-through
	// pixels: a tree, a monster, an object standing on the ground.
	NotSquare, SeeThrough int
}

// ItemSprites reads the item sprites in src, a .zip or a folder of PNGs named by item id (as a sprite
// exporter writes them, "0102_item_image.png"), and gives the PNG of each of `items` whose sprite can
// lie on a cube face: one SpriteSize square and opaque, as a ground or floor is, or, given the item
// table, a wall's face unsheared from Tibia's slanted drawing of it (Unshear, 3dgame #225). The others
// (trees, monsters, objects) keep their colour.
func ItemSprites(src string, items []uint16, table Items) (map[uint16][]byte, *SpriteReport, error) {
	want := make(map[uint16]bool, len(items))
	for _, id := range items {
		want[id] = true
	}
	rep := &SpriteReport{Asked: len(want)}
	out := map[uint16][]byte{}
	take := func(name string, open func() ([]byte, error)) error {
		m := spriteName.FindStringSubmatch(strings.ToLower(filepath.Base(name)))
		if m == nil {
			return nil
		}
		n, err := strconv.Atoi(m[1])
		if err != nil || n > 0xffff || !want[uint16(n)] || out[uint16(n)] != nil {
			return nil
		}
		data, err := open()
		if err != nil {
			return err
		}
		rep.Found++
		img, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			return nil
		}
		// A border keeps its see-through pixels: it is drawn over the ground (3dgame #226).
		if it := table[uint16(n)]; it != nil && it.Border() && img.Bounds().Dx() == SpriteSize && img.Bounds().Dy() == SpriteSize {
			out[uint16(n)] = data
			rep.Kept++
			rep.Borders++
			return nil
		}
		if it := table[uint16(n)]; it != nil && it.Opaque() && !it.Ground() {
			if face := WallFace(img); face != nil {
				var b bytes.Buffer
				if err := png.Encode(&b, face); err != nil {
					return err
				}
				out[uint16(n)] = b.Bytes()
				rep.Kept++
				rep.Walls++
				return nil
			}
		}
		switch {
		case img.Bounds().Dx() != SpriteSize || img.Bounds().Dy() != SpriteSize:
			rep.NotSquare++
		case !opaque(img):
			rep.SeeThrough++
		default:
			// The few clear pixels opaque lets through are filled, as a wall's face's are (3dgame #228).
			flat := image.NewNRGBA(image.Rect(0, 0, SpriteSize, SpriteSize))
			b := img.Bounds()
			holes := false
			for y := range SpriteSize {
				for x := range SpriteSize {
					c := color.NRGBAModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA)
					flat.SetNRGBA(x, y, c)
					holes = holes || c.A < 0xfa
				}
			}
			if holes {
				fillClear(flat)
				var buf bytes.Buffer
				if err := png.Encode(&buf, flat); err != nil {
					return err
				}
				data = buf.Bytes()
			}
			out[uint16(n)] = data
			rep.Kept++
		}
		return nil
	}
	if info, err := os.Stat(src); err == nil && info.IsDir() {
		entries, err := os.ReadDir(src)
		if err != nil {
			return nil, nil, err
		}
		for _, e := range entries {
			path := filepath.Join(src, e.Name())
			if err := take(e.Name(), func() ([]byte, error) { return os.ReadFile(path) }); err != nil {
				return nil, nil, err
			}
		}
		return out, rep, nil
	}
	zr, err := zip.OpenReader(src)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", src, err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.FileInfo().IsDir() || f.UncompressedSize64 > 1<<20 {
			continue
		}
		err := take(f.Name, func() ([]byte, error) {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		})
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", f.Name, err)
		}
	}
	return out, rep, nil
}

// WallRun is which way a wall runs, for unshearing its sprite.
type WallRun int

const (
	// WallEastWest runs east-west, its face to the south.
	WallEastWest WallRun = iota
	// WallNorthSouth runs north-south, its face to the east.
	WallNorthSouth
)

// WallFace gives the face of a wall item (one that blocks walking and sight: a wall, a mountain's edge)
// from its sprite, unsheared (Unshear) along whichever run fills the face, or nil when neither does (a
// post, an end piece, an archway). An east-west wall is drawn as a slanted band with level top and bottom
// edges, a north-south one with upright sides, so only its own run's face is full: on the stone,
// sandstone, brick and framework walls one run leaves no pixel of the face clear and the other 736 of
// 1024. The item table's horizontal and vertical flags are no guide: TVP's say the opposite of
// Ironcore's for the same sprites.
func WallFace(img image.Image) image.Image {
	ew, ewClear := unshear(img, WallEastWest)
	ns, nsClear := unshear(img, WallNorthSouth)
	face, clear := ew, ewClear
	if nsClear < ewClear {
		face, clear = ns, nsClear
	}
	// A face more than 5% clear is not a wall's: an archway, a window, or a sprite drawn otherwise.
	if clear*20 > SpriteSize*SpriteSize {
		return nil
	}
	fillClear(face)
	return face
}

// fillClear gives each clear pixel of a wall's face the colour of the nearest solid one in its row, else
// in its column, and makes it solid: a face lies on an opaque cube, where a clear pixel draws black. The
// mountain sprites 874 and 875 draw their band a pixel short of the tile, so their face's last column
// was clear and every mountain cube had a black line down one side (3dgame #228).
func fillClear(face *image.NRGBA) {
	solid := func(x, y int) bool { return face.NRGBAAt(x, y).A >= 0xfa }
	src := image.NewNRGBA(face.Rect)
	copy(src.Pix, face.Pix)
	for y := range SpriteSize {
		for x := range SpriteSize {
			if solid(x, y) {
				continue
			}
			c, found := color.NRGBA{}, false
			for d := 1; d < SpriteSize && !found; d++ {
				for _, p := range [][2]int{{x - d, y}, {x + d, y}, {x, y - d}, {x, y + d}} {
					if p[0] >= 0 && p[0] < SpriteSize && p[1] >= 0 && p[1] < SpriteSize && src.NRGBAAt(p[0], p[1]).A >= 0xfa {
						c, found = src.NRGBAAt(p[0], p[1]), true
						break
					}
				}
			}
			c.A = 0xff
			face.SetNRGBA(x, y, c)
		}
	}
}

// Unshear gives the face of a wall from its sprite, as a flat SpriteSize square texture, or nil when the
// sprite does not fill the face (it is not drawn as a wall running that way). Tibia draws a point at tile position (x, y)
// and height z at screen (x - z, y - z), 32 px a tile, a sprite's bottom-right corner on its tile's: an
// east-west wall's face lies in the plane of the sprite's bottom row, a north-south wall's in that of its
// right column, and a wall is one tile tall. The face's pixel (u, v), u along the wall and v down from
// its top, is the sprite's pixel the projection puts it on.
func Unshear(img image.Image, run WallRun) image.Image {
	face, clear := unshear(img, run)
	// A face more than 5% clear is not a wall's: an archway, a window, or a sprite drawn otherwise.
	if clear*20 > SpriteSize*SpriteSize {
		return nil
	}
	fillClear(face)
	return face
}

// unshear is Unshear's face, whatever it holds, and how many of its pixels are clear.
func unshear(img image.Image, run WallRun) (*image.NRGBA, int) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	face := image.NewNRGBA(image.Rect(0, 0, SpriteSize, SpriteSize))
	clear := 0
	for v := range SpriteSize {
		z := SpriteSize - 1 - v
		for u := range SpriteSize {
			var sx, sy int
			if run == WallEastWest {
				sx, sy = w-SpriteSize+u-z, h-1-z
			} else {
				sx, sy = w-1-z, h-SpriteSize+u-z
			}
			var c color.Color = color.NRGBA{}
			if sx >= 0 && sx < w && sy >= 0 && sy < h {
				c = img.At(b.Min.X+sx, b.Min.Y+sy)
			}
			face.Set(u, v, c)
			if _, _, _, a := c.RGBA(); a < 0xfa00 {
				clear++
			}
		}
	}
	return face, clear
}

// opaque says whether at most 1% of the picture's pixels let anything through: a ground tile fills its
// square, while a wall drawn at an angle or a thing standing on the ground leaves its corners clear.
func opaque(img image.Image) bool {
	b := img.Bounds()
	clear := 0
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if _, _, _, a := img.At(x, y).RGBA(); a < 0xfa00 {
				clear++
			}
		}
	}
	return clear*100 <= b.Dx()*b.Dy()
}

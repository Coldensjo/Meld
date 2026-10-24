// Package spritemodel turns the picture of a thing drawn in a game's slanted projection (a Tibia item
// sprite such as a pillar, or a 2:1 isometric sprite) into a 3D model: voxels one sprite pixel wide,
// meshed into a glTF binary (.glb) with the sprite's colours as its texture.
//
// One picture does not say how deep anything is: every pixel is a ray through the scene, and a thing
// anywhere along it would draw the same. A reading (readings.go) settles it with what such a thing
// most likely is:
//   - Box and Round: it stands about its tile's centre and is the same mirrored east to west and north
//     to south. Its mirrored copies must all fall on the silhouette, which carves a visual hull out of
//     every ray; each level is then a box (or an ellipse) as wide as the hull reaches along the
//     diagonals, as long and as deep as the level whose top the sprite shows. Its top is as low as
//     still draws every pixel: the hull leaves a pyramid over a flat top, peeled.
//   - Wall: it runs the length of its tile, the same all along.
//   - Cutout: it is one-sided, stood up facing the eye and given a rounded body behind.
//   - Auto tries them and keeps the one that draws most of the sprite.
//
// Pixels the reading leaves undrawn (an arm, a handle, a branch) become thin plates on its surface at
// the depth of the pixels beside them. The faces the picture shows take the colour of the pixel they
// are drawn at; the hidden ones that of the same face mirrored towards the viewer, or of the face at
// the other end of their row.
package spritemodel

import (
	"fmt"
	"image"
	"image/color"
	"strings"
)

// Projection is how the sprite was drawn.
type Projection string

const (
	// Tibia draws tile position (x, y) at height z at screen (x - z, y - z), 32 px a tile, the sprite's
	// bottom-right corner on its tile's (internal/otbm, Unshear).
	Tibia Projection = "tibia"
	// Isometric is 2:1 pixel isometry: a tile is a diamond as wide as the sprite and half as high, at the
	// sprite's bottom, and a cube's sides are as high as the diamond.
	Isometric Projection = "iso"
)

// Options say how to read the sprite. The zero value reads a Tibia sprite with Auto.
type Options struct {
	Projection Projection
	Reading    Reading
	// KeepOutline keeps the dark line drawn round the silhouette in the colours. Left out, its pixels
	// take the colour of the pixels inside them, since a model's edges are not outlined.
	KeepOutline bool
	// Centre is where the thing's vertical axis meets the ground, in sprite pixels at height 0; nil is
	// the centre of its tile (the sprite's bottom-right 32 x 32 for Tibia, the bottom diamond for iso).
	Centre *image.Point
	// Scale multiplies the model's size; 1 (or 0) makes one tile one unit wide, a cube of the game.
	Scale float64
	// Frame is the row of an outfit sheet to read (Outfit), from 0: the frames of its walk.
	Frame int
}

// Face directions, as indices into dirs.
const (
	east  = iota // +x
	west         // -x
	south        // +y
	north        // -y
	up           // +z
	down         // -z
)

var dirs = [6][3]int{{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}}

// turnDir is a face direction after a quarter turn of the cells (x, y) -> (-y, x) about the axis.
var turnDir = [6]int{east: south, south: west, west: north, north: east, up: up, down: down}

// opposite is a face direction's opposite.
var opposite = [6]int{east: west, west: east, south: north, north: south, up: down, down: up}

// Model is a converted sprite: its voxels, the colour of each face, and how they sit in the game.
type Model struct {
	Name string
	g    grid
	// extra marks the cells added for pixels the reading left undrawn.
	extra []bool
	// syms are the symmetries the reading took the thing to have.
	syms []sym
	// colours holds each exposed face's colour, by faceKey.
	colours map[int]color.NRGBA
	// cx, cy is the axis on the ground, in cell corners; unit is a cell's side in the game's units;
	// ground the height of the lowest cell, which stands on the ground in the model.
	cx, cy int
	unit   float64
	ground int
	// v is how the sprite (or an outfit's frame) was drawn, for Preview.
	v view
	// Report says what was made, for a status line.
	Report Report
}

// Report says what Convert made.
type Report struct {
	Width, Height int // the sprite's size
	Voxels        int // the model's cells, extra ones included
	Extra         int // cells added for pixels the symmetric core left undrawn
	Covered       int // percentage of the sprite's opaque pixels the symmetric core draws
	Size          [3]float64
	Triangles     int // the mesh's, once GLB has made it
	// Reading is the reading made (Auto's choice), with the way a wall runs; Centre the axis's foot,
	// in sprite pixels at height 0.
	Reading Reading
	Run     string
	Centre  image.Point
	// Scores are what each reading tried drew of the sprite, Auto's choice among them.
	Scores []Score
}

// Summary is the report as a line.
func (r Report) Summary() string {
	how := string(r.Reading)
	if r.Run != "" {
		how += " (" + r.Run + ")"
	}
	var tried []string
	for _, sc := range r.Scores {
		tried = append(tried, fmt.Sprintf("%s %d%%", sc.Reading, sc.Covered))
	}
	return fmt.Sprintf("%d x %d sprite read as %s about (%d, %d): %d voxels (%d of detail), the reading drawing %d%% of it [%s]; %.2f x %.2f x %.2f units",
		r.Width, r.Height, how, r.Centre.X, r.Centre.Y, r.Voxels, r.Extra, r.Covered, strings.Join(tried, ", "), r.Size[0], r.Size[1], r.Size[2])
}

// grid is a box of cells, x along the ground east, y south, z up.
type grid struct {
	nx, ny, nz int
	b          []bool
}

func newGrid(nx, ny, nz int) grid { return grid{nx, ny, nz, make([]bool, nx*ny*nz)} }

func (g grid) in(x, y, z int) bool {
	return x >= 0 && y >= 0 && z >= 0 && x < g.nx && y < g.ny && z < g.nz
}
func (g grid) idx(x, y, z int) int { return (z*g.ny+y)*g.nx + x }
func (g grid) at(x, y, z int) bool { return g.in(x, y, z) && g.b[g.idx(x, y, z)] }

// view is the projection of one sprite: which pixel a cell is drawn at and back.
type view struct {
	proj       Projection
	w, h       int
	vBase, mid int // iso: the row of the tile's centre and the grid's middle cell
	ox, oy     int // Tibia: where the grid's cell (0, 0) is drawn at height 0 (an outfit's frame)
}

// pixel is the sprite pixel the cell (x, y, z) is drawn at. Along a pixel's ray the cells go up by one
// in z each, the higher nearer the eye.
func (v view) pixel(x, y, z int) (int, int) {
	if v.proj == Isometric {
		return v.w/2 + x - y, v.vBase + floorDiv(x+y-2*v.mid, 2) - z
	}
	return x - z + v.ox, y - z + v.oy
}

// cell is the cell at height z drawn at pixel (px, py).
func (v view) cell(px, py, z int) (int, int) {
	if v.proj == Isometric {
		d := px - v.w/2
		s := 2*(py-v.vBase+z) + 2*v.mid
		if (s-d)%2 != 0 {
			s++
		}
		return (s + d) / 2, (s - d) / 2
	}
	return px + z - v.ox, py + z - v.oy
}

func floorDiv(a, b int) int {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// Convert makes the model of the sprite img.
func Convert(name string, img image.Image, opt Options) (*Model, error) {
	if opt.Projection == "" {
		opt.Projection = Tibia
	}
	if opt.Reading == "" {
		opt.Reading = Auto
	}
	if opt.Scale == 0 {
		opt.Scale = 1
	}
	switch opt.Projection {
	case Tibia, Isometric:
	default:
		return nil, fmt.Errorf("unknown projection %q (tibia or iso)", opt.Projection)
	}
	switch opt.Reading {
	case Auto, Box, Round, Hull, Wall, Cutout, Outfit:
	default:
		return nil, fmt.Errorf("unknown reading %q (auto, box, round, wall, cutout, hull or outfit)", opt.Reading)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if opt.Reading == Outfit || (opt.Reading == Auto && opt.Projection == Tibia && IsOutfitSheet(w, h)) {
		return convertOutfit(name, img, opt)
	}
	if w < 8 || h < 8 || w > 1024 || h > 1024 {
		return nil, fmt.Errorf("the sprite is %d x %d; it must be 8 to 1024 pixels a side", w, h)
	}
	s := &sprite{pix: image.NewNRGBA(image.Rect(0, 0, w, h)), opaque: make([]bool, w*h), w: w, h: h}
	for y := range h {
		for x := range w {
			c := color.NRGBAModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA)
			s.pix.SetNRGBA(x, y, c)
			if c.A >= 128 {
				s.opaque[y*w+x] = true
				s.nOpaque++
			}
		}
	}
	if s.nOpaque == 0 {
		return nil, fmt.Errorf("the sprite has no opaque pixels")
	}
	if !opt.KeepOutline {
		dropOutline(s.pix, s.opaque)
	}

	m := &Model{Name: name}
	s.v = view{proj: opt.Projection, w: w, h: h}
	var centre *[2]int
	if opt.Projection == Isometric {
		n := w
		s.v.mid, s.v.vBase = n/2, h-w/4
		s.nx, s.ny, s.nz = n, n, h
		s.runX = [2]int{n/2 - w/4, n/2 + w/4}
		s.runY = s.runX
		m.unit = 2 / float64(w)
		if opt.Centre != nil {
			// The cell under the given ground pixel, at height 0.
			x, y := s.v.cell(opt.Centre.X, opt.Centre.Y, 0)
			centre = &[2]int{x, y}
		}
	} else {
		s.nx, s.ny, s.nz = w, h, max(w, h)
		s.runX = [2]int{max(0, w-32), w}
		s.runY = [2]int{max(0, h-32), h}
		m.unit = 1.0 / 32
		if opt.Centre != nil {
			centre = &[2]int{opt.Centre.X, opt.Centre.Y}
		}
	}
	m.unit *= opt.Scale
	m.v = s.v

	a, scores := s.choose(opt.Reading, centre)
	m.g, m.syms, m.cx, m.cy = a.core, a.syms, a.cx, a.cy
	m.Report.Scores = scores
	m.Report.Covered = a.covered
	m.Report.Reading, m.Report.Run = a.reading, a.run
	m.Report.Centre = image.Point{X: a.cx, Y: a.cy}
	if s.v.proj == Isometric {
		m.Report.Centre = image.Pt(s.v.pixel(a.cx, a.cy, 0))
	}
	m.extra = make([]bool, len(m.g.b))
	if a.reading != Cutout {
		m.Report.Extra = attachDetail(m, s.v, s.opaque, a.count, w, h)
	}
	if a.covered == 0 && m.Report.Extra == 0 {
		return nil, fmt.Errorf("nothing of the sprite stands about its tile's centre (%d, %d): give the centre", m.cx, m.cy)
	}
	m.colourFaces(s.v, s.pix)

	lo, hi := m.bounds()
	m.ground = lo[2]
	for i := range 3 {
		m.Report.Size[i] = float64(hi[i]-lo[i]) * m.unit
	}
	m.Report.Size[1], m.Report.Size[2] = m.Report.Size[2], m.Report.Size[1] // width, height, depth
	m.Report.Width, m.Report.Height = w, h
	for _, k := range m.g.b {
		if k {
			m.Report.Voxels++
		}
	}
	return m, nil
}

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

func sign(a int) int {
	if a < 0 {
		return -1
	}
	return 1
}

// peel takes off, from the top down, the pieces of each level that nothing kept stands on (cells with
// none above them, joined side to side) and whose every pixel another kept cell still draws: the
// pyramid the hull leaves over a flat top, and the steps it leaves round a thing's foot where the
// picture shows a flat plate. A piece goes with its mirror images (syms), so the core stays symmetric;
// a piece that is needed stays whole, and the cells under it are not on top any more.
func peel(core grid, v view, syms []sym, count []int, w int, isOpaque func(px, py int) bool) {
	label := make([]int, core.nx*core.ny)
	var stack [][2]int
	top := func(x, y, z int) bool { return core.at(x, y, z) && !core.at(x, y, z+1) }
	for z := core.nz - 1; z >= 0; z-- {
		for i := range label {
			label[i] = -1
		}
		var pieces [][][2]int
		for y := range core.ny {
			for x := range core.nx {
				if !top(x, y, z) || label[y*core.nx+x] >= 0 {
					continue
				}
				id := len(pieces)
				var cells [][2]int
				stack = append(stack[:0], [2]int{x, y})
				label[y*core.nx+x] = id
				for len(stack) > 0 {
					c := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					cells = append(cells, c)
					for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
						nx, ny := c[0]+d[0], c[1]+d[1]
						if top(nx, ny, z) && label[ny*core.nx+nx] < 0 {
							label[ny*core.nx+nx] = id
							stack = append(stack, [2]int{nx, ny})
						}
					}
				}
				pieces = append(pieces, cells)
			}
		}
		// A piece can go when nothing kept is on it and each of its pixels is drawn by another cell.
		free := make([]bool, len(pieces))
		for id, cells := range pieces {
			free[id] = true
			for _, c := range cells {
				if px, py := v.pixel(c[0], c[1], z); isOpaque(px, py) && count[py*w+px] < 2 {
					free[id] = false
					break
				}
			}
		}
		// It goes with its turns, all free.
		for id, cells := range pieces {
			if !free[id] {
				continue
			}
			orbit := []int{id}
			ok := true
			for _, sm := range syms {
				x, y := sm.cell(cells[0][0], cells[0][1])
				if !top(x, y, z) {
					ok = false
					break
				}
				o := label[y*core.nx+x]
				if !free[o] {
					ok = false
					break
				}
				orbit = append(orbit, o)
			}
			if !ok {
				continue
			}
			for _, o := range orbit {
				if !free[o] {
					continue
				}
				free[o] = false
				for _, c := range pieces[o] {
					core.b[core.idx(c[0], c[1], z)] = false
					if px, py := v.pixel(c[0], c[1], z); isOpaque(px, py) {
						count[py*w+px]--
					}
				}
			}
		}
	}
}

// attachDetail adds a cell for each opaque pixel no kept cell draws, at the height of the cell drawn
// at a pixel beside it, so the detail continues the surface it grows from. It gives how many it added.
func attachDetail(m *Model, v view, opaque []bool, count []int, w, h int) int {
	g := m.g
	// front is the height of the nearest kept cell on each pixel's ray, -1 where none is.
	front := make([]int, w*h)
	for i := range front {
		front[i] = -1
	}
	for z := range g.nz {
		for y := range g.ny {
			for x := range g.nx {
				if g.at(x, y, z) {
					if px, py := v.pixel(x, y, z); px >= 0 && py >= 0 && px < w && py < h {
						front[py*w+px] = max(front[py*w+px], z)
					}
				}
			}
		}
	}
	var queue []int
	queued := make([]bool, w*h)
	near := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	// The silhouette's own edge is left out: where the core misses only its rim (the hull's cells are
	// drawn at one pixel each, so a slanted side can leave one bare), plates there would run off along
	// the rim. A detail's inside still grows from the core.
	inside := func(px, py int) bool {
		for _, d := range near {
			nx, ny := px+d[0], py+d[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h || !opaque[ny*w+nx] {
				return false
			}
		}
		return true
	}
	push := func(px, py int) {
		for _, d := range near {
			nx, ny := px+d[0], py+d[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h {
				continue
			}
			i := ny*w + nx
			if opaque[i] && front[i] < 0 && !queued[i] && inside(nx, ny) {
				queued[i] = true
				queue = append(queue, i)
			}
		}
	}
	for i, f := range front {
		if f >= 0 {
			push(i%w, i/w)
		}
	}
	added := 0
	for len(queue) > 0 {
		i := queue[0]
		queue = queue[1:]
		px, py := i%w, i/w
		placed := false
		for _, d := range near {
			nx, ny := px+d[0], py+d[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h || front[ny*w+nx] < 0 {
				continue
			}
			z := front[ny*w+nx]
			x, y := v.cell(px, py, z)
			if !g.in(x, y, z) {
				continue
			}
			k := g.idx(x, y, z)
			if !g.b[k] {
				g.b[k] = true
				m.extra[k] = true
				added++
			}
			front[i] = z
			count[i]++
			placed = true
			break
		}
		if placed {
			push(px, py)
		}
	}
	return added
}

// dropOutline gives the dark pixels round the silhouette the colour of the opaque pixels inside them.
func dropOutline(pix *image.NRGBA, opaque []bool) {
	w, h := pix.Rect.Dx(), pix.Rect.Dy()
	edge := func(x, y int) bool {
		for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := x+d[0], y+d[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h || !opaque[ny*w+nx] {
				return true
			}
		}
		return false
	}
	dark := func(c color.NRGBA) bool {
		return 299*int(c.R)+587*int(c.G)+114*int(c.B) < 48*1000
	}
	var line []int
	for y := range h {
		for x := range w {
			if opaque[y*w+x] && edge(x, y) && dark(pix.NRGBAAt(x, y)) {
				line = append(line, y*w+x)
			}
		}
	}
	isLine := make([]bool, w*h)
	for _, i := range line {
		isLine[i] = true
	}
	// Fill the line from inside, a ring at a time, so a two-pixel line takes the colour of its inside.
	for len(line) > 0 {
		var next []int
		var fills []color.NRGBA
		var at []int
		for _, i := range line {
			x, y := i%w, i/w
			var r, g, b, n int
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					nx, ny := x+dx, y+dy
					if nx < 0 || ny < 0 || nx >= w || ny >= h {
						continue
					}
					j := ny*w + nx
					if !opaque[j] || isLine[j] {
						continue
					}
					c := pix.NRGBAAt(nx, ny)
					r, g, b, n = r+int(c.R), g+int(c.G), b+int(c.B), n+1
				}
			}
			if n == 0 {
				next = append(next, i)
				continue
			}
			at = append(at, i)
			fills = append(fills, color.NRGBA{uint8(r / n), uint8(g / n), uint8(b / n), 255})
		}
		if len(at) == 0 {
			break // a line with no inside: a sprite that is all outline
		}
		for k, i := range at {
			pix.SetNRGBA(i%w, i/w, fills[k])
			isLine[i] = false
		}
		line = next
	}
}

// faceKey names a cell's face for the colour table.
func (m *Model) faceKey(x, y, z, d int) int { return m.g.idx(x, y, z)*6 + d }

// exposed says whether the cell's face in direction d shows: no kept cell is beside it there.
func (m *Model) exposed(x, y, z, d int) bool {
	o := dirs[d]
	return !m.g.at(x+o[0], y+o[1], z+o[2])
}

// drawing is what a render shows at each pixel: the depth of what is nearest the eye there (-1 for
// nothing), its cell and which face of it.
type drawing struct {
	depth, cell, face []int
}

// render draws the model as the sprite was drawn, turned k quarter turns about its axis. A cell's
// sides towards the eye (south, east) are drawn at its pixel, at depth 2z, and its top at the pixel of
// the cell above it, at depth 2z + 1: a cube drawn so covers the two pixels it does in the picture.
func (m *Model) render(v view, w, h, k int) drawing {
	g := m.g
	r := drawing{make([]int, w*h), make([]int, w*h), make([]int, w*h)}
	for i := range r.depth {
		r.depth[i] = -1
	}
	// The faces of the model shown as the view's south, east and top: turned back k quarter turns.
	var s, e int = south, east
	for range (4 - k) % 4 {
		s, e = turnDir[s], turnDir[e]
	}
	plot := func(x, y, z, depth, cell, face int) {
		px, py := v.pixel(x, y, z)
		if px < 0 || py < 0 || px >= w || py >= h {
			return
		}
		if i := py*w + px; depth > r.depth[i] {
			r.depth[i], r.cell[i], r.face[i] = depth, cell, face
		}
	}
	for z := range g.nz {
		for y := range g.ny {
			for x := range g.nx {
				if !g.at(x, y, z) {
					continue
				}
				tx, ty := x, y
				for range k {
					tx, ty = m.turn(tx, ty)
				}
				c := g.idx(x, y, z)
				switch {
				case m.exposed(x, y, z, s):
					plot(tx, ty, z, 2*z, c, s)
				case m.exposed(x, y, z, e):
					plot(tx, ty, z, 2*z, c, e)
				case m.exposed(x, y, z, up):
					// A step of a staircase, its sides against its neighbours: still the nearest thing at
					// its pixel, so nothing behind it shows there.
					plot(tx, ty, z, 2*z, c, up)
				}
				// A south face also covers half the pixel left of the cell's, and an east face half the one
				// above it: they fill those where nothing nearer is drawn (a staircase's enclosed steps).
				if m.exposed(x, y, z, s) {
					plot(tx-1, ty, z, 2*z-1, c, s)
				}
				if m.exposed(x, y, z, e) {
					plot(tx, ty-1, z, 2*z-1, c, e)
				}
				if m.exposed(x, y, z, up) {
					plot(tx, ty, z+1, 2*z+1, c, up)
				}
			}
		}
	}
	return r
}

// turn is the cell a quarter turn about the axis from (x, y): (x, y) -> (-y, x) about it.
func (m *Model) turn(x, y int) (int, int) { return m.cx + m.cy - 1 - y, m.cy - m.cx + x }

// colourFaces gives every exposed face a colour. A face the sprite shows takes the colour of the pixel
// it is drawn at. Another takes that of the same face mirrored, where the reading takes the thing to
// be (north is south's twin), else a back face that of the front face at the other end of its row,
// else the colour of the cell's own pixel.
func (m *Model) colourFaces(v view, pix *image.NRGBA) {
	g := m.g
	w, h := pix.Rect.Dx(), pix.Rect.Dy()
	r := m.render(v, w, h, 0)
	seen := func(x, y, z, d int) (color.NRGBA, bool) {
		if !g.at(x, y, z) || !m.exposed(x, y, z, d) {
			return color.NRGBA{}, false
		}
		var px, py int
		switch d {
		case east, south:
			px, py = v.pixel(x, y, z)
		case up:
			px, py = v.pixel(x, y, z+1)
		default:
			return color.NRGBA{}, false
		}
		if px < 0 || py < 0 || px >= w || py >= h {
			return color.NRGBA{}, false
		}
		i := py*w + px
		if r.depth[i] < 0 || r.cell[i] != g.idx(x, y, z) || (r.face[i] == up) != (d == up) {
			return color.NRGBA{}, false
		}
		c := pix.NRGBAAt(px, py)
		return c, c.A >= 128
	}
	m.colours = make(map[int]color.NRGBA)
	for z := range g.nz {
		for y := range g.ny {
			for x := range g.nx {
				if !g.at(x, y, z) {
					continue
				}
				for d := range 6 {
					if !m.exposed(x, y, z, d) {
						continue
					}
					c, ok := seen(x, y, z, d)
					if !ok && !m.extra[g.idx(x, y, z)] {
						// The same face mirrored, where the reading takes the thing to be so.
						for _, sm := range m.syms {
							mx, my := sm.cell(x, y)
							if c, ok = seen(mx, my, z, sm.dir[d]); ok {
								break
							}
						}
					}
					if !ok && (d == west || d == north || d == down) {
						// The face at the other end of the row through the thing: a wall's back is its front.
						o, step := opposite[d], dirs[opposite[d]]
						ex, ey, ez := x, y, z
						for g.at(ex+step[0], ey+step[1], ez+step[2]) {
							ex, ey, ez = ex+step[0], ey+step[1], ez+step[2]
						}
						c, ok = seen(ex, ey, ez, o)
					}
					if !ok {
						px, py := v.pixel(x, y, z)
						px, py = min(max(px, 0), w-1), min(max(py, 0), h-1)
						c = pix.NRGBAAt(px, py)
						if c.A < 128 {
							c = nearestOpaque(pix, px, py)
						}
					}
					c.A = 255
					m.colours[m.faceKey(x, y, z, d)] = c
				}
			}
		}
	}
}

// nearestOpaque is the colour of the opaque pixel nearest (px, py), searching outwards in rings.
func nearestOpaque(pix *image.NRGBA, px, py int) color.NRGBA {
	w, h := pix.Rect.Dx(), pix.Rect.Dy()
	for r := 1; r < max(w, h); r++ {
		for dy := -r; dy <= r; dy++ {
			for dx := -r; dx <= r; dx++ {
				if max(abs(dx), abs(dy)) != r {
					continue
				}
				x, y := px+dx, py+dy
				if x >= 0 && y >= 0 && x < w && y < h {
					if c := pix.NRGBAAt(x, y); c.A >= 128 {
						return c
					}
				}
			}
		}
	}
	return color.NRGBA{128, 128, 128, 255}
}

// bounds is the box round the kept cells: its lowest corner and its highest, exclusive.
func (m *Model) bounds() (lo, hi [3]int) {
	g := m.g
	lo = [3]int{g.nx, g.ny, g.nz}
	for z := range g.nz {
		for y := range g.ny {
			for x := range g.nx {
				if g.at(x, y, z) {
					lo = [3]int{min(lo[0], x), min(lo[1], y), min(lo[2], z)}
					hi = [3]int{max(hi[0], x+1), max(hi[1], y+1), max(hi[2], z+1)}
				}
			}
		}
	}
	return lo, hi
}

// SafeName is a model name made from a file name: lower case, letters, digits, '_' and '-'.
func SafeName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		case r == ' ' || r == '.':
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "sprite"
	}
	return b.String()
}

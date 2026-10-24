package spritemodel

import (
	"fmt"
	"image"
	"image/color"
)

// Outfit reads a sheet of a creature (a Tibia outfit sheet) drawn facing the four ways: its columns
// face north, east, south and west, its rows are the frames of its walk. Tibia draws every direction
// from the same eye (south-east, above), so the creature facing east is the creature seen from an eye
// a quarter turn round: the four columns are four real views from the four diagonals, and the model is
// carved from them with nothing guessed but where the creature stands.
const Outfit Reading = "outfit"

// outfitColumn is the sheet's column a view k (k quarter turns, as render turns the model) shows: the
// model faces south unturned, then west, north and east.
var outfitColumn = [4]int{2, 3, 0, 1}

// IsOutfitSheet says whether a picture of w x h looks like an outfit sheet: four columns of square
// frames of 32 or 64 pixels, one row or more. Tibia's item sprites are never wider than 64.
func IsOutfitSheet(w, h int) bool {
	f := w / 4
	return w%4 == 0 && (f == 32 || f == 64) && h >= f && h%f == 0
}

// OutfitFrames is how many frames (rows) an outfit sheet of w x h holds.
func OutfitFrames(w, h int) int {
	if !IsOutfitSheet(w, h) {
		return 0
	}
	return h / (w / 4)
}

// outfitView is one of the four views: its frame's colours and drawn pixels.
type outfitView struct {
	pix    *image.NRGBA
	opaque []bool
	n      int
}

// convertOutfit makes the model of a creature from row `frame` of its outfit sheet.
func convertOutfit(name string, img image.Image, opt Options) (*Model, error) {
	b := img.Bounds()
	if !IsOutfitSheet(b.Dx(), b.Dy()) {
		return nil, fmt.Errorf("a %d x %d picture is not an outfit sheet (four columns of 32 or 64 pixel frames: north, east, south, west)", b.Dx(), b.Dy())
	}
	f := b.Dx() / 4
	row := min(max(opt.Frame, 0), b.Dy()/f-1)
	var views [4]outfitView
	for k, col := range outfitColumn {
		ov := outfitView{pix: image.NewNRGBA(image.Rect(0, 0, f, f)), opaque: make([]bool, f*f)}
		for y := range f {
			for x := range f {
				c := color.NRGBAModel.Convert(img.At(b.Min.X+col*f+x, b.Min.Y+row*f+y)).(color.NRGBA)
				ov.pix.SetNRGBA(x, y, c)
				if c.A >= 128 {
					ov.opaque[y*f+x] = true
					ov.n++
				}
			}
		}
		if ov.n == 0 {
			return nil, fmt.Errorf("the sheet's frame facing %s is empty", [4]string{"south", "west", "north", "east"}[k])
		}
		if !opt.KeepOutline {
			dropOutline(ov.pix, ov.opaque)
		}
		views[k] = ov
	}
	v := view{proj: Tibia, w: f, h: f}
	scale := opt.Scale
	if scale == 0 {
		scale = 1
	}
	m := &Model{Name: name, unit: scale / 32, v: v}

	// The grid is centred on the creature's axis; (fx, fy) is where the axis's foot is drawn in a frame.
	m.cx, m.cy = f/2, f/2
	carve := func(fx, fy int) (grid, [4][]int, int) {
		v.ox, v.oy = fx-m.cx, fy-m.cy
		g := newGrid(f, f, f)
		var count [4][]int
		for k := range count {
			count[k] = make([]int, f*f)
		}
		for z := range f {
			for y := range f {
				for x := range f {
					tx, ty, ok := x, y, true
					for k := range 4 {
						px, py := v.pixel(tx, ty, z)
						if px < 0 || py < 0 || px >= f || py >= f || !views[k].opaque[py*f+px] {
							ok = false
							break
						}
						tx, ty = m.turn(tx, ty)
					}
					if !ok {
						continue
					}
					g.b[g.idx(x, y, z)] = true
					tx, ty = x, y
					for k := range 4 {
						px, py := v.pixel(tx, ty, z)
						count[k][py*f+px]++
						tx, ty = m.turn(tx, ty)
					}
				}
			}
		}
		drawn := 0
		for k := range 4 {
			for i, c := range count[k] {
				if c > 0 && views[k].opaque[i] {
					drawn++
				}
			}
		}
		return g, count, drawn
	}

	// Where the creature stands: the foot the four views agree on best.
	total := 0
	for _, ov := range views {
		total += ov.n
	}
	bestX, bestY, best := f/2, f/2, -1
	if opt.Centre != nil {
		bestX, bestY = opt.Centre.X, opt.Centre.Y
	} else {
		for cy := f / 4; cy < f; cy++ {
			for cx := f / 4; cx < f; cx++ {
				if _, _, d := carve(cx, cy); d > best {
					bestX, bestY, best = cx, cy, d
				}
			}
		}
	}
	g, count, drawn := carve(bestX, bestY)
	peelViews(g, v, m.turn, count, f, views)
	m.g, m.v = g, v
	m.extra = make([]bool, len(g.b))
	m.Report.Covered = drawn * 100 / total
	m.Report.Reading = Outfit
	m.Report.Run = fmt.Sprintf("frame %d of %d", row+1, b.Dy()/f)
	m.Report.Centre = image.Pt(bestX, bestY)
	m.Report.Scores = []Score{{Outfit, m.Report.Covered}}
	empty := true
	for _, k := range g.b {
		if k {
			empty = false
			m.Report.Voxels++
		}
	}
	if empty {
		return nil, fmt.Errorf("the four views of the sheet do not agree on any shape: is it drawn facing north, east, south and west, column by column?")
	}
	m.colourOutfit(v, views)

	lo, hi := m.bounds()
	m.ground = lo[2]
	for i := range 3 {
		m.Report.Size[i] = float64(hi[i]-lo[i]) * m.unit
	}
	m.Report.Size[1], m.Report.Size[2] = m.Report.Size[2], m.Report.Size[1]
	m.Report.Width, m.Report.Height = b.Dx(), b.Dy()
	return m, nil
}

// peelViews is peel for four views: a piece goes when each of its pixels, in every view, is still
// drawn by another cell.
func peelViews(core grid, v view, turn func(x, y int) (int, int), count [4][]int, w int, views [4]outfitView) {
	label := make([]int, core.nx*core.ny)
	var stack [][2]int
	top := func(x, y, z int) bool { return core.at(x, y, z) && !core.at(x, y, z+1) }
	each := func(x, y, z int, fn func(k, i int)) {
		tx, ty := x, y
		for k := range 4 {
			px, py := v.pixel(tx, ty, z)
			if px >= 0 && py >= 0 && px < w && py < w && views[k].opaque[py*w+px] {
				fn(k, py*w+px)
			}
			tx, ty = turn(tx, ty)
		}
	}
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
		for _, cells := range pieces {
			free := true
			for _, c := range cells {
				each(c[0], c[1], z, func(k, i int) {
					if count[k][i] < 2 {
						free = false
					}
				})
				if !free {
					break
				}
			}
			if !free {
				continue
			}
			for _, c := range cells {
				core.b[core.idx(c[0], c[1], z)] = false
				each(c[0], c[1], z, func(k, i int) { count[k][i]-- })
			}
		}
	}
}

// colourOutfit gives every exposed face the colour the views that show it agree on most (a top is seen
// from all four, and one view's pixel there may belong to the front of the head, its eyes). A face
// none shows (under the feet, between the legs) takes that of the face at the other end of its row,
// else of the nearest drawn pixel.
func (m *Model) colourOutfit(v view, views [4]outfitView) {
	g := m.g
	w := v.w
	var draws [4]drawing
	for k := range 4 {
		draws[k] = m.render(v, w, w, k)
	}
	seen := func(x, y, z, d int) (color.NRGBA, bool) {
		if !g.at(x, y, z) || !m.exposed(x, y, z, d) {
			return color.NRGBA{}, false
		}
		var got []color.NRGBA
		for k := range 4 {
			tx, ty, td := x, y, d
			for range k {
				tx, ty = m.turn(tx, ty)
				td = turnDir[td]
			}
			if td != east && td != south && td != up {
				continue
			}
			z1 := z
			if td == up {
				z1 = z + 1
			}
			px, py := v.pixel(tx, ty, z1)
			if px < 0 || py < 0 || px >= w || py >= w {
				continue
			}
			i := py*w + px
			r := draws[k]
			if r.depth[i] < 0 || r.cell[i] != g.idx(x, y, z) || (r.face[i] == up) != (d == up) {
				continue
			}
			if c := views[k].pix.NRGBAAt(px, py); c.A >= 128 {
				got = append(got, c)
			}
		}
		return medoid(got)
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
					if !ok {
						o, step := opposite[d], dirs[opposite[d]]
						ex, ey, ez := x, y, z
						for g.at(ex+step[0], ey+step[1], ez+step[2]) {
							ex, ey, ez = ex+step[0], ey+step[1], ez+step[2]
						}
						c, ok = seen(ex, ey, ez, o)
					}
					if !ok {
						px, py := v.pixel(x, y, z)
						px, py = min(max(px, 0), w-1), min(max(py, 0), w-1)
						c = nearestOpaque(views[0].pix, px, py)
					}
					c.A = 255
					m.colours[m.faceKey(x, y, z, d)] = c
				}
			}
		}
	}
}

// medoid is the colour of cs nearest all the others (of two, the first); false for none.
func medoid(cs []color.NRGBA) (color.NRGBA, bool) {
	if len(cs) == 0 {
		return color.NRGBA{}, false
	}
	best, bestSum := 0, -1
	for i, a := range cs {
		sum := 0
		for _, b := range cs {
			sum += abs(int(a.R)-int(b.R)) + abs(int(a.G)-int(b.G)) + abs(int(a.B)-int(b.B))
		}
		if bestSum < 0 || sum < bestSum {
			best, bestSum = i, sum
		}
	}
	return cs[best], true
}

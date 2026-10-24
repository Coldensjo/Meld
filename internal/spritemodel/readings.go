package spritemodel

import (
	"image"
	"math"
)

// Reading is how a sprite's depth is guessed: which shape the thing is taken to have.
type Reading string

const (
	// Auto tries the readings below and keeps the one that explains most of the sprite (readings.go,
	// choose).
	Auto Reading = "auto"
	// Box takes the thing to be the same mirrored east to west and north to south, each level a box,
	// as long and as deep as the level whose top the sprite shows: pillars, crates, tables, wardrobes.
	Box Reading = "box"
	// Round is Box with each level an ellipse: columns, barrels, trees, rocks.
	Round Reading = "round"
	// Hull keeps everything the four mirrored silhouettes allow: levels are diamonds where the picture
	// gives only their width across the diagonals.
	Hull Reading = "hull"
	// Wall takes the thing to run the length of its tile east to west, north to south, or both (a
	// corner), the same all along: walls, fences, railings, a wall's carving.
	Wall Reading = "wall"
	// Cutout stands the sprite up on the plane through its tile's centre facing the eye, and puffs it
	// out behind by how far each pixel is from its edge: statues, creatures, anything one-sided.
	Cutout Reading = "cutout"
)

// sym is one of the symmetries a reading takes the thing to have, other than leaving it as it is: what
// it does to a cell and to a face's direction.
type sym struct {
	cell func(x, y int) (int, int)
	dir  [6]int
}

// mirrors are the mirrorings east to west, north to south, and both, about the axis at (cx, cy) (cell
// corners). The sprite seen mirrored is the thing seen from another diagonal, so together they carve
// the depth that one view cannot see, while leaving a level free to be longer than it is deep.
func mirrors(cx, cy int) []sym {
	mx := func(x, y int) (int, int) { return 2*cx - 1 - x, y }
	my := func(x, y int) (int, int) { return x, 2*cy - 1 - y }
	both := func(x, y int) (int, int) { return 2*cx - 1 - x, 2*cy - 1 - y }
	id := [6]int{east, west, south, north, up, down}
	dx, dy, dxy := id, id, id
	dx[east], dx[west] = west, east
	dy[south], dy[north] = north, south
	dxy[east], dxy[west], dxy[south], dxy[north] = west, east, north, south
	return []sym{{my, dy}, {mx, dx}, {both, dxy}}
}

// sprite is a sprite read for converting: its colours, which pixels are drawn, and its view.
type sprite struct {
	pix        *image.NRGBA
	opaque     []bool
	w, h       int
	nOpaque    int
	v          view
	nx, ny, nz int
	// The tile's cells along x and along y, where a wall runs.
	runX, runY [2]int
}

func (s *sprite) isOpaque(px, py int) bool {
	return px >= 0 && py >= 0 && px < s.w && py < s.h && s.opaque[py*s.w+px]
}

// attempt is one reading of a sprite: the cells kept, about which axis, with which symmetries, and how
// many of the sprite's pixels they draw.
type attempt struct {
	reading Reading
	cx, cy  int
	core    grid
	syms    []sym
	count   []int
	covered int // percentage of the opaque pixels drawn
	run     string
	// square says whether a level of the hull showed its corner: a box's top does, a round thing's
	// never.
	square bool
}

// measure counts the kept cells on each pixel's ray, and the share of the sprite they draw.
func (s *sprite) measure(a *attempt) {
	a.count = make([]int, s.w*s.h)
	g := a.core
	for z := range g.nz {
		for y := range g.ny {
			for x := range g.nx {
				if g.at(x, y, z) {
					if px, py := s.v.pixel(x, y, z); s.isOpaque(px, py) {
						a.count[py*s.w+px]++
					}
				}
			}
		}
	}
	s.cover(a)
}

func (s *sprite) cover(a *attempt) {
	n := 0
	for i, c := range a.count {
		if c > 0 && s.opaque[i] {
			n++
		}
	}
	a.covered = n * 100 / s.nOpaque
}

// mirrored reads the sprite as mirrored both ways about (cx, cy): the hull of its four mirrorings,
// each level shaped as a box or an ellipse (or left as the hull), the hull's overhang peeled.
func (s *sprite) mirrored(reading Reading, cx, cy int) *attempt {
	a := &attempt{reading: reading, cx: cx, cy: cy, syms: mirrors(cx, cy)}
	hull := newGrid(s.nx, s.ny, s.nz)
	for z := range s.nz {
		for y := range s.ny {
			for x := range s.nx {
				if !s.isOpaque(s.v.pixel(x, y, z)) {
					continue
				}
				ok := true
				for _, m := range a.syms {
					mx, my := m.cell(x, y)
					if !hull.in(mx, my, z) || !s.isOpaque(s.v.pixel(mx, my, z)) {
						ok = false
						break
					}
				}
				hull.b[hull.idx(x, y, z)] = ok
			}
		}
	}
	a.core = hull
	if reading != Hull {
		a.core, a.square = shapeLevels(hull, cx, cy, reading == Round)
	}
	s.measure(a)
	peel(a.core, s.v, a.syms, a.count, s.w, s.isOpaque)
	s.cover(a)
	return a
}

// shapeLevels makes each level of the hull a box (or an ellipse) about the axis, as wide along each
// diagonal as the hull reaches. A level whose corner the hull holds is a box the sprite shows the top
// of, and gives its length to depth; a level the hull holds only a diamond of (the sprite shows its
// sides, whose width across the diagonal is all it tells) takes the proportions of the nearest level
// above that showed them, else below, else a square. A cell is kept when the hull holds the cell on
// its ring at the corner (a box) or at the diagonal (an ellipse): so a level can be a ring, or legs.
// It also says whether any level showed its corner.
func shapeLevels(hull grid, cx, cy int, round bool) (grid, bool) {
	// The proportions of each level that shows them: its length over its depth.
	seen := make([]float64, hull.nz)
	square := false
	for z := range hull.nz {
		// The level's reach along x and along y, in half cells.
		X, Y := 0, 0
		for y := range hull.ny {
			for x := range hull.nx {
				if hull.at(x, y, z) {
					X = max(X, abs(2*(x-cx)+1))
					Y = max(Y, abs(2*(y-cy)+1))
				}
			}
		}
		if X > 0 && hull.at(cx+(X-1)/2, cy+(Y-1)/2, z) {
			seen[z] = float64(X) / float64(Y)
		}
		// A box shows its corner, a cell in from its reach either way (an outline may add one); a
		// round level never does, but a level a few cells across is a corner of itself.
		if X >= 9 && Y >= 9 && hull.at(cx+(X-3)/2, cy+(Y-3)/2, z) {
			square = true
		}
	}
	ratio := make([]float64, hull.nz)
	for z := range ratio {
		ratio[z] = 1
		for d := 0; d < hull.nz; d++ {
			if z+d < hull.nz && seen[z+d] > 0 {
				ratio[z] = seen[z+d]
				break
			}
			if z-d >= 0 && seen[z-d] > 0 {
				ratio[z] = seen[z-d]
				break
			}
		}
	}
	odd := func(f float64) int { return max(1, 2*int(math.Round((f-1)/2))+1) }
	out := newGrid(hull.nx, hull.ny, hull.nz)
	for z := range hull.nz {
		r := ratio[z]
		if round {
			r = 1 // what grew is round in plan; a blob's narrow top would make it a blade
		}
		for y := range hull.ny {
			for x := range hull.nx {
				if !hull.at(x, y, z) {
					continue
				}
				a, b := 2*(x-cx)+1, 2*(y-cy)+1
				var ca, cb int
				if round {
					rho := math.Hypot(float64(abs(a)), float64(abs(b))*r) / math.Sqrt2
					ca, cb = odd(rho), odd(rho/r)
				} else {
					t := math.Max(float64(abs(a)), float64(abs(b))*r)
					ca, cb = odd(t), odd(t/r)
				}
				// The corner cell on this cell's side of each axis (ca, cb odd: sign*c - 1 halves exactly).
				if hull.at(cx+(sign(a)*ca-1)/2, cy+(sign(b)*cb-1)/2, z) {
					out.b[out.idx(x, y, z)] = true
				}
			}
		}
	}
	return out, square
}

// wall reads the sprite as a wall the length of its tile: the cells of each cross-section drawn on the
// silhouette at every step along the run. It tries the run east to west and north to south and keeps
// the better, or both (a corner) when together they draw clearly more than either.
func (s *sprite) wall(cx, cy int) *attempt {
	run := func(alongX bool) grid {
		g := newGrid(s.nx, s.ny, s.nz)
		lo, hi := s.runX[0], s.runX[1]
		if !alongX {
			lo, hi = s.runY[0], s.runY[1]
		}
		for z := range s.nz {
			for c := range max(s.nx, s.ny) {
				ok := true
				for k := lo; k < hi && ok; k++ {
					x, y := k, c
					if !alongX {
						x, y = c, k
					}
					ok = g.in(x, y, z) && s.isOpaque(s.v.pixel(x, y, z))
				}
				if !ok {
					continue
				}
				for k := lo; k < hi; k++ {
					if alongX {
						g.b[g.idx(k, c, z)] = true
					} else {
						g.b[g.idx(c, k, z)] = true
					}
				}
			}
		}
		return g
	}
	try := func(name string, g grid) *attempt {
		a := &attempt{reading: Wall, cx: cx, cy: cy, core: g, run: name}
		s.measure(a)
		peel(a.core, s.v, nil, a.count, s.w, s.isOpaque)
		s.cover(a)
		return a
	}
	ew, ns := run(true), run(false)
	both := newGrid(s.nx, s.ny, s.nz)
	for i := range both.b {
		both.b[i] = ew.b[i] || ns.b[i]
	}
	a, b, c := try("east to west", ew), try("north to south", ns), try("corner", both)
	best := a
	if b.covered > best.covered {
		best = b
	}
	if c.covered >= best.covered+10 {
		best = c
	}
	return best
}

// cutout stands the sprite up on the vertical plane through (cx, cy) that faces the eye (x + y the
// same all over it), each pixel at the height that puts it there, and fills behind it as deep as the
// pixel is far from the sprite's edge, rounded as a section of a ball is, so a figure has a body.
func (s *sprite) cutout(cx, cy int) *attempt {
	a := &attempt{reading: Cutout, cx: cx, cy: cy}
	g := newGrid(s.nx, s.ny, s.nz)
	// How far each opaque pixel is from a clear one, in steps.
	dist := make([]int, s.w*s.h)
	var queue []int
	for i, o := range s.opaque {
		dist[i] = -1
		if !o {
			continue
		}
		x, y := i%s.w, i/s.w
		for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			if !s.isOpaque(x+d[0], y+d[1]) {
				dist[i] = 1
				queue = append(queue, i)
				break
			}
		}
	}
	deepest := 1
	for len(queue) > 0 {
		i := queue[0]
		queue = queue[1:]
		x, y := i%s.w, i/s.w
		for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := x+d[0], y+d[1]
			if s.isOpaque(nx, ny) && dist[ny*s.w+nx] < 0 {
				dist[ny*s.w+nx] = dist[i] + 1
				deepest = max(deepest, dist[i]+1)
				queue = append(queue, ny*s.w+nx)
			}
		}
	}
	plane := cx + cy - 1
	for py := range s.h {
		for px := range s.w {
			i := py*s.w + px
			if !s.opaque[i] {
				continue
			}
			// The first height at which the pixel's ray reaches the plane; in front of it, the ground.
			z, x, y := 0, 0, 0
			for z = 0; z < s.nz; z++ {
				x, y = s.v.cell(px, py, z)
				if x+y >= plane {
					break
				}
			}
			if z == s.nz {
				continue
			}
			d := float64(dist[i])
			depth := int(math.Round(0.6 * math.Sqrt(d*(2*float64(deepest)-d))))
			for j := 0; j <= depth; j++ {
				// Only where the sprite is drawn: a cell behind the plane is then hidden behind the front.
				if g.in(x-j, y-j, z) && s.isOpaque(s.v.pixel(x-j, y-j, z)) {
					g.b[g.idx(x-j, y-j, z)] = true
				}
			}
		}
	}
	a.core = g
	s.measure(a)
	return a
}

// straightness is the share of the silhouette's edge that lies on straight runs (across, down or
// diagonal) of six pixels or more: high for what is built (a pillar, a crate), low for what grew (a
// tree, a rock, a creature).
func (s *sprite) straightness() float64 {
	edge := func(x, y int) bool {
		if !s.isOpaque(x, y) {
			return false
		}
		return !s.isOpaque(x+1, y) || !s.isOpaque(x-1, y) || !s.isOpaque(x, y+1) || !s.isOpaque(x, y-1)
	}
	total, straight := 0, 0
	for y := range s.h {
		for x := range s.w {
			if !edge(x, y) {
				continue
			}
			total++
			for _, d := range [4][2]int{{1, 0}, {0, 1}, {1, 1}, {1, -1}} {
				n := 1
				for k := 1; edge(x+k*d[0], y+k*d[1]); k++ {
					n++
				}
				for k := 1; edge(x-k*d[0], y-k*d[1]); k++ {
					n++
				}
				if n >= 6 {
					straight++
					break
				}
			}
		}
	}
	if total == 0 {
		return 0
	}
	return float64(straight) / float64(total)
}

// centres are where a thing's axis may meet the ground: the centre of the sprite's own tile (its
// bottom-right one for Tibia), and of the two or four tiles a bigger sprite may stand on.
func (s *sprite) centres() [][2]int {
	if s.v.proj == Isometric {
		return [][2]int{{s.v.mid, s.v.mid}}
	}
	out := [][2]int{{s.w - 16, s.h - 16}}
	if s.w >= 64 {
		out = append(out, [2]int{s.w - 32, s.h - 16})
	}
	if s.h >= 64 {
		out = append(out, [2]int{s.w - 16, s.h - 32})
	}
	if s.w >= 64 && s.h >= 64 {
		out = append(out, [2]int{s.w - 32, s.h - 32})
	}
	return out
}

// Thresholds of Auto, in percent of the sprite drawn: a wall must draw this much more than a box to be
// taken for one, and a box or wall drawing less than cutoutBelow leaves the sprite to Cutout.
const (
	wallMargin  = 8
	cutoutBelow = 55
	// organicBelow is the straightness under which a thing is taken to have grown: round, never a wall.
	organicBelow = 0.45
)

// Score is how much of the sprite a reading drew, in percent of its opaque pixels.
type Score struct {
	Reading Reading `json:"reading"`
	Covered int     `json:"covered"`
}

// choose reads the sprite as asked: with the given reading (or, for Auto, a box or ellipse, a wall and
// a cutout) about each centre the sprite may stand on (or the one given), and keeps the reading that
// draws most of it. It gives the scores of the readings it tried.
func (s *sprite) choose(reading Reading, centre *[2]int) (*attempt, []Score) {
	centres := s.centres()
	if c, ok := s.footCentre(); ok {
		centres = append(centres, c)
	}
	if centre != nil {
		centres = [][2]int{*centre}
	}
	var scores []Score
	best := func(r Reading) *attempt {
		var b *attempt
		for _, c := range centres {
			var a *attempt
			switch r {
			case Wall:
				a = s.wall(c[0], c[1])
			case Cutout:
				a = s.cutout(c[0], c[1])
			default:
				a = s.mirrored(r, c[0], c[1])
			}
			if b == nil || a.covered > b.covered {
				b = a
			}
			if r == Cutout || r == Wall {
				break // neither depends on the axis but for where the model's origin is
			}
		}
		scores = append(scores, Score{r, b.covered})
		return b
	}
	if reading != Auto {
		return best(reading), scores
	}
	// What grew (a tree, a rock) is round and never a wall; what is built is boxes and walls.
	organic := s.straightness() < organicBelow
	shape := Box
	if organic {
		shape = Round
	}
	box := best(shape)
	if !organic && !box.square {
		// No level shows a corner: built, but round (a barrel, a column).
		if round := best(Round); round.covered >= box.covered-5 {
			box = round
		}
	}
	if organic {
		if box.covered >= cutoutBelow {
			return box, scores
		}
		return best(Cutout), scores
	}
	wall := best(Wall)
	switch {
	case wall.covered >= box.covered+wallMargin && wall.covered >= cutoutBelow:
		return wall, scores
	case box.covered >= cutoutBelow:
		return box, scores
	case wall.covered >= cutoutBelow:
		return wall, scores
	}
	return best(Cutout), scores
}

// footCentre is where the thing's foot is centred, read off the sprite: in Tibia's drawing a box's
// south edge on the ground is the bottom row's run and its east edge the rightmost column's, each as
// long as the box and centred on its axis. Not for isometric sprites.
func (s *sprite) footCentre() ([2]int, bool) {
	if s.v.proj == Isometric {
		return [2]int{}, false
	}
	bottom, right := -1, -1
	for i, o := range s.opaque {
		if o {
			bottom = max(bottom, i/s.w)
			right = max(right, i%s.w)
		}
	}
	x0, x1, y0, y1 := s.w, -1, s.h, -1
	for x := range s.w {
		if s.opaque[bottom*s.w+x] {
			x0, x1 = min(x0, x), max(x1, x)
		}
	}
	for y := range s.h {
		if s.opaque[y*s.w+right] {
			y0, y1 = min(y0, y), max(y1, y)
		}
	}
	if x1 < 0 || y1 < 0 {
		return [2]int{}, false
	}
	return [2]int{(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2}, true
}

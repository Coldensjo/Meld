package adt

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// lattice is the tile's outer height grid: (ChunksPerTile*8+1) samples on each side.
const lattice = ChunksPerTile*CellsPerChunk + 1

// padded is the side of the grid normalAt reads (normalGrid): the lattice on a grid of half a cell's
// step, with two half steps around it.
const padded = 2*lattice - 1 + 4

// Ring is the outer heights one sample beyond each side of a tile's lattice, from the neighbouring
// tiles (#492): North is the row north of the tile's first (the north neighbour's second to last),
// South the row south of its last (the south neighbour's second), West and East the columns beside
// its first and last. Each is lattice long, North and South running east, West and East south. A nil
// side has no neighbour, and the normals along it are one-sided (from the triangles inside the tile).
//
// NorthIn, SouthIn, WestIn and EastIn are the inner samples of the cells just across each side (the
// north neighbour's last row of cells, and so on), lattice-1 long in the same order, since a border
// sample's normal takes in the triangles of those cells (#668). A nil one is taken as the mean of each
// cell's four corners, as a tile Meld builds has them.
type Ring struct {
	North, South, West, East         []float32
	NorthIn, SouthIn, WestIn, EastIn []float32
}

// Edges is the ring around a tile for working out the normals on its border: Now from the heights
// being written, Was from those the tile's normals were made against. A chunk on the border whose
// ring changed has its normals refreshed though its own heights didn't change, since the samples just
// across the border move them.
type Edges struct{ Now, Was Ring }

// WriteHeights returns root with the heights of terrain written into it. terrain must be the
// result of ParseTerrain on root, edited in place (its chunks in the same order). Only the chunks
// whose heights changed are rewritten, along with the normals around them, so every other byte of
// the file stays as it was. Heights are stored relative to each chunk's base height, which
// stays as it is. edges, when not nil, gives the neighbours' heights, so the normals on the tile's
// border match the ones across it; without it they are one-sided there.
func WriteHeights(root []byte, terrain *Terrain, edges *Edges) ([]byte, error) {
	orig, err := ParseTerrain(root)
	if err != nil {
		return nil, err
	}
	if len(orig.Chunks) != len(terrain.Chunks) {
		return nil, fmt.Errorf("adt: %d chunks for a tile of %d", len(terrain.Chunks), len(orig.Chunks))
	}
	starts, err := mcnkStarts(root)
	if err != nil {
		return nil, err
	}

	var ring Ring
	if edges != nil {
		ring = edges.Now
	}
	grid := normalGrid(terrain, ring)

	out := append([]byte(nil), root...)
	changed := make([]bool, len(terrain.Chunks))
	for i := range terrain.Chunks {
		c, before := terrain.Chunks[i], orig.Chunks[i]
		if c.IndexX != before.IndexX || c.IndexY != before.IndexY {
			return nil, errors.New("adt: chunks are out of order")
		}
		if c.Heights == before.Heights {
			continue
		}
		changed[i] = true
		mcvt, ok := subChunk(out, starts[i], len(out), u32(out, starts[i]+0x14), "MCVT")
		if !ok {
			return nil, errors.New("adt: chunk without heights")
		}
		for s := 0; s < HeightCount; s++ {
			if c.Heights[s] == before.Heights[s] {
				continue
			}
			binary.LittleEndian.PutUint32(out[mcvt.start+s*4:], math.Float32bits(c.Heights[s]-c.Position[2]))
		}
	}

	// A changed sample moves the normals of its neighbours, so refresh every chunk in the 3x3
	// block around a changed one.
	refresh := make([]bool, len(terrain.Chunks))
	for i, c := range terrain.Chunks {
		if edges != nil && edges.moved(c) {
			refresh[i] = true
		}
		if !changed[i] {
			continue
		}
		for j, n := range terrain.Chunks {
			if abs(n.IndexX-c.IndexX) <= 1 && abs(n.IndexY-c.IndexY) <= 1 {
				refresh[j] = true
			}
		}
	}
	for i, c := range terrain.Chunks {
		if !refresh[i] {
			continue
		}
		mcnr, ok := subChunk(out, starts[i], len(out), u32(out, starts[i]+0x18), "MCNR")
		if !ok {
			continue
		}
		for s := 0; s < HeightCount; s++ {
			n := normalAt(grid, c, s)
			for k := 0; k < 3; k++ {
				out[mcnr.start+s*3+k] = byte(n[k])
			}
		}
	}
	return out, nil
}

// ParseNormals returns each chunk's normals (MCNR) in file order: HeightCount of them, three signed
// bytes each (north, west, up, 127 for 1), in the order of the chunk's heights.
func ParseNormals(root []byte) ([][]byte, error) {
	starts, err := mcnkStarts(root)
	if err != nil {
		return nil, err
	}
	out := make([][]byte, len(starts))
	for i, s := range starts {
		mcnr, ok := subChunk(root, s, len(root), u32(root, s+0x18), "MCNR")
		if !ok || mcnr.start+HeightCount*3 > len(root) {
			return nil, fmt.Errorf("adt: chunk %d without normals", i)
		}
		out[i] = append([]byte(nil), root[mcnr.start:mcnr.start+HeightCount*3]...)
	}
	return out, nil
}

// mcnkStarts returns the payload offset of each top-level MCNK, in file order.
func mcnkStarts(root []byte) ([]int, error) {
	var starts []int
	err := eachChunk(root, 0, len(root), func(c chunk) error {
		if c.id == "MCNK" {
			starts = append(starts, c.start)
		}
		return nil
	})
	return starts, err
}

// moved says the ring along chunk c's side of the tile changed, over the samples c's border ones
// read: a chunk off the border never has.
func (e *Edges) moved(c Chunk) bool {
	lo, hi := c.IndexX*CellsPerChunk, c.IndexX*CellsPerChunk+CellsPerChunk
	if c.IndexY == 0 && (ringMoved(e.Now.North, e.Was.North, lattice, lo, hi) || ringMoved(e.Now.NorthIn, e.Was.NorthIn, lattice-1, lo, hi-1)) ||
		c.IndexY == ChunksPerTile-1 && (ringMoved(e.Now.South, e.Was.South, lattice, lo, hi) || ringMoved(e.Now.SouthIn, e.Was.SouthIn, lattice-1, lo, hi-1)) {
		return true
	}
	lo, hi = c.IndexY*CellsPerChunk, c.IndexY*CellsPerChunk+CellsPerChunk
	return c.IndexX == 0 && (ringMoved(e.Now.West, e.Was.West, lattice, lo, hi) || ringMoved(e.Now.WestIn, e.Was.WestIn, lattice-1, lo, hi-1)) ||
		c.IndexX == ChunksPerTile-1 && (ringMoved(e.Now.East, e.Was.East, lattice, lo, hi) || ringMoved(e.Now.EastIn, e.Was.EastIn, lattice-1, lo, hi-1))
}

// ringMoved says one side of the ring, n samples long, differs between now and was over samples lo
// to hi; a side that appears or goes away counts as moved.
func ringMoved(now, was []float32, n, lo, hi int) bool {
	if len(now) != n || len(was) != n {
		return len(now) == n || len(was) == n
	}
	for k := lo; k <= hi; k++ {
		if now[k] != was[k] {
			return true
		}
	}
	return false
}

// normalGrid is the grid normalAt reads: the tile's outer and inner heights from terrain on a grid of
// half a cell's step (an outer sample at (2r, 2c) of the lattice, an inner one at (2r+1, 2c+1)),
// padded by two half steps a side. The padding holds the ring at two half steps out and, at one, the
// inner samples of the cells just across the border (the ring's, or the average of their four corners
// where it has none). It is NaN where a side has no ring, in the corners beyond two sides, and between
// the samples.
func normalGrid(terrain *Terrain, ring Ring) []float32 {
	grid := make([]float32, padded*padded)
	nan := float32(math.NaN())
	for i := range grid {
		grid[i] = nan
	}
	for _, c := range terrain.Chunks {
		for s := 0; s < HeightCount; s++ {
			grid[halfIndex(c, s)] = c.Heights[s]
		}
	}
	// at is the cell (R, C) of the half-step grid, 0 at the tile's first sample.
	at := func(R, C int) *float32 { return &grid[(R+2)*padded+C+2] }
	last := 2 * (lattice - 1)
	// Each side's ring sample k sits at R0 + k*dR, C0 + k*dC, and the inner sample of the cell across
	// the border between ring samples k and k+1 at R1 + k*dR, C1 + k*dC (dR and dC in half steps, so
	// one sample along is 2).
	sides := []struct {
		line, inner    []float32
		R0, C0, R1, C1 int
		dR, dC         int
	}{
		{ring.North, ring.NorthIn, -2, 0, -1, 1, 0, 2},
		{ring.South, ring.SouthIn, last + 2, 0, last + 1, 1, 0, 2},
		{ring.West, ring.WestIn, 0, -2, 1, -1, 2, 0},
		{ring.East, ring.EastIn, 0, last + 2, 1, last + 1, 2, 0},
	}
	for _, side := range sides {
		if len(side.line) != lattice {
			continue
		}
		for k := 0; k < lattice; k++ {
			*at(side.R0+k*side.dR, side.C0+k*side.dC) = side.line[k]
		}
	}
	// The inner samples across, once every side's ring is in. The mean adds the corners in the order
	// BuildTile's chunkHeights does (north-west, north-east, south-west, south-east), so a tile built
	// beside this one has the same value to the bit.
	for _, side := range sides {
		if len(side.line) != lattice {
			continue
		}
		for k := 0; k+1 < lattice; k++ {
			R, C := side.R1+k*side.dR, side.C1+k*side.dC
			if len(side.inner) == lattice-1 {
				*at(R, C) = side.inner[k]
			} else {
				*at(R, C) = (*at(R-1, C-1) + *at(R-1, C+1) + *at(R+1, C-1) + *at(R+1, C+1)) / 4
			}
		}
	}
	return grid
}

// halfIndex is where sample s of chunk c sits in normalGrid.
func halfIndex(c Chunk, s int) int {
	row, col := s/17, s%17
	R, C := 2*(c.IndexY*CellsPerChunk+row), 2*(c.IndexX*CellsPerChunk+col)
	if col >= 9 {
		R, C = R+1, 2*(c.IndexX*CellsPerChunk+col-9)+1
	}
	return (R+2)*padded + C + 2
}

// Around a sample, the neighbours of the triangles it is a corner of, on the half-step grid (rows
// south, columns east), going round from north through west, south and east. An outer sample is a
// corner of eight: in each of the four cells around it, the two between it, the cell's inner sample
// and the outer samples beside it. An inner sample is the centre of its cell's four. crossFan is the
// four triangles between an outer sample's outer neighbours, for a tile's corner (normalAt).
var (
	outerFan = [][2]int{{-2, 0}, {-1, -1}, {0, -2}, {1, -1}, {2, 0}, {1, 1}, {0, 2}, {-1, 1}}
	innerFan = [][2]int{{-1, 1}, {-1, -1}, {1, -1}, {1, 1}}
	crossFan = [][2]int{{-2, 0}, {0, -2}, {2, 0}, {0, 2}}
)

// normalAt is the ground normal at sample s of chunk c, from the half-step grid around it
// (normalGrid), as the client's tiles store it: north, west and up, 127 for 1. As the game's own
// normals are made (#668), it is the mean of the unit normals of the triangles the sample is a corner
// of in the ground's mesh (a cell is four triangles around its inner sample), each part truncated
// toward zero. A triangle with a corner the grid lacks (past a border without a ring) is left out. A
// tile's corner lacks the cell of the tile diagonally beyond it, and each of the four tiles meeting
// there lacks a different one, so where its four outer neighbours are known a corner takes the four
// triangles between them instead, which every one of those tiles has, and they store the same normal.
func normalAt(grid []float32, c Chunk, s int) [3]int8 {
	half := TileSize / (ChunksPerTile * CellsPerChunk) / 2
	i := halfIndex(c, s)
	known := func(d [2]int) bool { return !math.IsNaN(float64(grid[i+d[0]*padded+d[1]])) }
	fan := outerFan
	if s%17 >= 9 {
		fan = innerFan
	} else if !known(fan[1]) || !known(fan[3]) || !known(fan[5]) || !known(fan[7]) {
		if known(crossFan[0]) && known(crossFan[1]) && known(crossFan[2]) && known(crossFan[3]) {
			fan = crossFan
		}
	}
	h := float64(grid[i])
	// arm is the edge from the sample to its neighbour d, in north, west and up.
	arm := func(d [2]int) (v [3]float64, ok bool) {
		n := grid[i+d[0]*padded+d[1]]
		return [3]float64{-float64(d[0]) * half, -float64(d[1]) * half, float64(n) - h}, known(d)
	}
	var sum [3]float64
	for k := range fan {
		a, okA := arm(fan[k])
		b, okB := arm(fan[(k+1)%len(fan)])
		if !okA || !okB {
			continue
		}
		n := [3]float64{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
		l := math.Sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2])
		for j := range sum {
			sum[j] += n[j] / l
		}
	}
	l := math.Sqrt(sum[0]*sum[0] + sum[1]*sum[1] + sum[2]*sum[2])
	if l == 0 {
		return [3]int8{0, 0, 127}
	}
	return [3]int8{int8(sum[0] / l * 127), int8(sum[1] / l * 127), int8(sum[2] / l * 127)}
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

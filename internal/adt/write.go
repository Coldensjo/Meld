package adt

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// lattice is the tile's outer height grid: (ChunksPerTile*8+1) samples on each side.
const lattice = ChunksPerTile*CellsPerChunk + 1

// padded is the side of the grid normalAt reads: the lattice with one ring of samples around it.
const padded = lattice + 2

// Ring is the outer heights one sample beyond each side of a tile's lattice, from the neighbouring
// tiles (#492): North is the row north of the tile's first (the north neighbour's second to last),
// South the row south of its last (the south neighbour's second), West and East the columns beside
// its first and last. Each is lattice long, North and South running east, West and East south. A nil
// side has no neighbour, and the normals along it are one-sided.
type Ring struct{ North, South, West, East []float32 }

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
				out[mcnr.start+s*3+k] = byte(int8(math.Round(float64(n[k]) * 127)))
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
	if c.IndexY == 0 && ringMoved(e.Now.North, e.Was.North, lo, hi) ||
		c.IndexY == ChunksPerTile-1 && ringMoved(e.Now.South, e.Was.South, lo, hi) {
		return true
	}
	lo, hi = c.IndexY*CellsPerChunk, c.IndexY*CellsPerChunk+CellsPerChunk
	return c.IndexX == 0 && ringMoved(e.Now.West, e.Was.West, lo, hi) ||
		c.IndexX == ChunksPerTile-1 && ringMoved(e.Now.East, e.Was.East, lo, hi)
}

// ringMoved says one side of the ring differs between now and was over samples lo to hi; a side that
// appears or goes away counts as moved.
func ringMoved(now, was []float32, lo, hi int) bool {
	if len(now) != lattice || len(was) != lattice {
		return len(now) == lattice || len(was) == lattice
	}
	for k := lo; k <= hi; k++ {
		if now[k] != was[k] {
			return true
		}
	}
	return false
}

// normalGrid is the outer grid normalAt reads: the tile's lattice from terrain's heights, padded by
// one sample a side with the ring, NaN where a side has none.
func normalGrid(terrain *Terrain, ring Ring) []float32 {
	grid := make([]float32, padded*padded)
	nan := float32(math.NaN())
	for i := range grid {
		grid[i] = nan
	}
	for _, c := range terrain.Chunks {
		for r := 0; r < CellsPerChunk+1; r++ {
			for col := 0; col < CellsPerChunk+1; col++ {
				gr, gc := c.IndexY*CellsPerChunk+r, c.IndexX*CellsPerChunk+col
				grid[(gr+1)*padded+gc+1] = c.Heights[r*17+col]
			}
		}
	}
	for k := 0; k < lattice; k++ {
		if len(ring.North) == lattice {
			grid[k+1] = ring.North[k]
		}
		if len(ring.South) == lattice {
			grid[(padded-1)*padded+k+1] = ring.South[k]
		}
		if len(ring.West) == lattice {
			grid[(k+1)*padded] = ring.West[k]
		}
		if len(ring.East) == lattice {
			grid[(k+1)*padded+padded-1] = ring.East[k]
		}
	}
	return grid
}

// normalAt is the ground normal at sample s of chunk c, from the padded grid around it (normalGrid),
// in the file's order: north, west, up. Rows run south and columns east. An outer sample takes the
// difference across its neighbours, from the ring on the tile's border, one-sided where the ring has
// no sample.
func normalAt(grid []float32, c Chunk, s int) [3]float32 {
	step := TileSize / (ChunksPerTile * CellsPerChunk)
	// at reads lattice sample (r, col), which may be one outside the tile, in the ring.
	at := func(r, col int) float64 { return float64(grid[(r+1)*padded+col+1]) }
	known := func(r, col int) bool { return !math.IsNaN(float64(grid[(r+1)*padded+col+1])) }
	row, col := s/17, s%17
	var north, west float64
	if col < 9 {
		gr, gc := c.IndexY*CellsPerChunk+row, c.IndexX*CellsPerChunk+col
		rn, rs := gr-1, gr+1
		if !known(rn, gc) {
			rn = gr
		}
		if !known(rs, gc) {
			rs = gr
		}
		cw, ce := gc-1, gc+1
		if !known(gr, cw) {
			cw = gc
		}
		if !known(gr, ce) {
			ce = gc
		}
		north = (at(rn, gc) - at(rs, gc)) / (float64(rs-rn) * step)
		west = (at(gr, cw) - at(gr, ce)) / (float64(ce-cw) * step)
	} else {
		gr, gc := c.IndexY*CellsPerChunk+row, c.IndexX*CellsPerChunk+col-9
		nw, ne := at(gr, gc), at(gr, gc+1)
		sw, se := at(gr+1, gc), at(gr+1, gc+1)
		north = ((nw + ne) - (sw + se)) / 2 / step
		west = ((nw + sw) - (ne + se)) / 2 / step
	}
	l := math.Hypot(math.Hypot(north, west), 1)
	return [3]float32{float32(-north / l), float32(-west / l), float32(1 / l)}
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

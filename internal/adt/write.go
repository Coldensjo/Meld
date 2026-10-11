package adt

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// lattice is the tile's outer height grid: (ChunksPerTile*8+1) samples on each side.
const lattice = ChunksPerTile*CellsPerChunk + 1

// WriteHeights returns root with the heights of terrain written into it. terrain must be the
// result of ParseTerrain on root, edited in place (its chunks in the same order). Only the chunks
// whose heights changed are rewritten, along with the normals around them, so every other byte of
// the file stays as it was. Heights are stored relative to each chunk's base height, which
// stays as it is.
func WriteHeights(root []byte, terrain *Terrain) ([]byte, error) {
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

	// The outer grid of the whole tile, from the new heights, for working out normals.
	grid := make([]float32, lattice*lattice)
	for _, c := range terrain.Chunks {
		for r := 0; r < CellsPerChunk+1; r++ {
			for col := 0; col < CellsPerChunk+1; col++ {
				gr, gc := c.IndexY*CellsPerChunk+r, c.IndexX*CellsPerChunk+col
				grid[gr*lattice+gc] = c.Heights[r*17+col]
			}
		}
	}

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

// normalAt is the ground normal at sample s of chunk c, from the outer grid around it, in the
// file's order: north, west, up. Rows run south and columns east; the edges of the tile are one-sided.
func normalAt(grid []float32, c Chunk, s int) [3]float32 {
	step := TileSize / (ChunksPerTile * CellsPerChunk)
	at := func(r, col int) float64 {
		r = max(0, min(lattice-1, r))
		col = max(0, min(lattice-1, col))
		return float64(grid[r*lattice+col])
	}
	row, col := s/17, s%17
	var north, west float64
	if col < 9 {
		gr, gc := c.IndexY*CellsPerChunk+row, c.IndexX*CellsPerChunk+col
		rn, rs := max(0, gr-1), min(lattice-1, gr+1)
		cw, ce := max(0, gc-1), min(lattice-1, gc+1)
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

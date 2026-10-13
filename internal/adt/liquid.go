package adt

import (
	"math"
	"math/bits"
)

// Liquid is one liquid layer of a chunk, as the client stores it and noggit3 edits it: what liquid
// it is, the surface heights, how deep the water is at each vertex, and which of the chunk's cells it
// covers. A chunk may hold one layer of each type.
type Liquid struct {
	// IndexX and IndexY place the chunk in its tile, 0 to 15 (or in a block of tiles, for a region).
	IndexX int `json:"indexX"`
	IndexY int `json:"indexY"`
	// Type is the liquid, as LiquidType.dbc numbers it: LiquidWater, LiquidOcean, LiquidMagma or
	// LiquidSlime.
	Type int `json:"type"`
	// Heights are the surface heights at the chunk's 9x9 vertices, row-major, in absolute yards.
	Heights [liquidVerts]float32 `json:"heights"`
	// Depth is each vertex's opacity, 0 (clear, at the shore) to 255 (deep). Magma and slime keep
	// texture coordinates there instead, so theirs read as 255.
	Depth [liquidVerts]uint8 `json:"depth"`
	// Cells is the chunk's 8x8 cells, row-major: true where the liquid covers the cell.
	Cells [CellsPerChunk * CellsPerChunk]bool `json:"cells"`
}

// liquidDataSize is the bytes of an MCLQ entry the reader needs: the level pair, the vertices and
// the cell flags. The MCNK header gives the entries' real size, which is at least this.
const liquidDataSize = 8 + liquidVerts*8 + CellsPerChunk*CellsPerChunk

// ParseLiquids returns the liquid layers of every chunk of a tile that has some. A layer that covers
// no cell is left out.
//
// The client stores each chunk's MCLQ right after the MCNK header's liquid offset, without the
// usual chunk id and size. The header's liquid size counts 8 bytes plus a full entry per layer. Each
// entry is a level pair, 81 vertices of 8 bytes (the height is the second float), and 64 cell
// flags, where a flag of cellNoLiquid means the cell is dry and the low three bits of any other
// name the liquid.
func ParseLiquids(root []byte) ([]Liquid, error) {
	var out []Liquid
	err := eachChunk(root, 0, len(root), func(c chunk) error {
		if c.id != "MCNK" {
			return nil
		}
		h := c.start
		if h+mcnkHeaderSize > c.end {
			return errTruncated
		}
		offset := u32(root, h+mcnkLiquidOfs)
		size := int(u32(root, h+mcnkLiquidSize))
		if offset == 0 || size < liquidDataSize {
			return nil
		}
		cx, cy := int(u32(root, h+0x04)), int(u32(root, h+0x08))
		if cx >= ChunksPerTile || cy >= ChunksPerTile {
			return nil
		}
		n := max(1, (size-8)/liquidEntry)
		flags := u32(root, h) & mcnkLiquidMask
		start := h - 8 + int(offset) + 8
		for k := 0; k < n; k++ {
			entry := start + k*liquidEntry
			if entry < 0 || entry+liquidDataSize > len(root) {
				break
			}
			if l, ok := parseLayer(root, entry, k, flags); ok {
				l.IndexX, l.IndexY = cx, cy
				out = append(out, l)
			}
		}
		return nil
	})
	return out, err
}

// parseLayer reads the MCLQ entry at entry, the chunk's layer k. A layer's type comes from its cells;
// when they don't name one, it's the chunk's k-th liquid flag.
func parseLayer(root []byte, entry, k int, flags uint32) (Liquid, bool) {
	var l Liquid
	level := f32(root, entry)
	cellsAt := entry + 8 + liquidVerts*8
	covered := false
	for i := range l.Cells {
		b := root[cellsAt+i]
		if b&cellNoLiquid == cellNoLiquid {
			continue
		}
		l.Cells[i] = true
		covered = true
		if l.Type == 0 {
			l.Type = typeOfCell(b)
		}
	}
	if !covered {
		return l, false
	}
	if l.Type == 0 {
		for f := flags; f != 0; f &= f - 1 {
			if k == 0 {
				l.Type = typeOfFlag(1 << bits.TrailingZeros32(f))
				break
			}
			k--
		}
	}
	if l.Type == 0 {
		l.Type = LiquidWater
	}
	for v := range l.Heights {
		y := f32(root, entry+8+v*8+4)
		if math.IsNaN(float64(y)) || math.Abs(float64(y)) > 1e5 {
			// A vertex the client left unset takes the entry's level.
			y = level
		}
		l.Heights[v] = y
		if textured(l.Type) {
			l.Depth[v] = 255
		} else {
			l.Depth[v] = root[entry+8+v*8]
		}
	}
	return l, true
}

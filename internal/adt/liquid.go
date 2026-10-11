package adt

import "math"

// Liquid is one chunk's water as the client stores it: the surface heights, what kind of liquid it
// is, and which of the chunk's cells it covers.
type Liquid struct {
	// IndexX and IndexY place the chunk in its tile, 0 to 15.
	IndexX int `json:"indexX"`
	IndexY int `json:"indexY"`
	// Kind is the liquid bits of the chunk's flags: 0x04 river or lake, 0x08 ocean, 0x10 magma, 0x20 slime.
	Kind uint32 `json:"kind"`
	// Heights are the surface heights at the chunk's 9x9 vertices, row-major, in absolute yards.
	Heights [liquidVerts]float32 `json:"heights"`
	// Cells is the chunk's 8x8 cells, row-major: true where the liquid covers the cell.
	Cells [CellsPerChunk * CellsPerChunk]bool `json:"cells"`
}

// liquidDataSize is the bytes of an MCLQ entry the reader needs: the level pair, the vertices and
// the cell flags. The MCNK header gives the entry's real size, which is at least this.
const liquidDataSize = 8 + liquidVerts*8 + CellsPerChunk*CellsPerChunk

// ParseLiquids returns the water of every chunk of a tile that has some. A chunk without liquid,
// or whose liquid covers no cell, is left out.
//
// The client stores each chunk's MCLQ right after the MCNK header's liquid offset, without the
// usual chunk id and size. The entry is a level pair, 81 vertices of 8 bytes (the height is the
// second float), and 64 cell flags, where a flag of cellNoLiquid means the cell is dry.
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
		entry := h - 8 + int(offset) + 8
		if entry < 0 || entry+size > len(root) {
			return nil
		}
		level := f32(root, entry)
		liquid := Liquid{
			IndexX: int(u32(root, h+0x04)),
			IndexY: int(u32(root, h+0x08)),
			Kind:   u32(root, h) & mcnkLiquidMask,
		}
		if liquid.IndexX >= ChunksPerTile || liquid.IndexY >= ChunksPerTile {
			return nil
		}
		for v := range liquid.Heights {
			y := f32(root, entry+8+v*8+4)
			if math.IsNaN(float64(y)) || math.Abs(float64(y)) > 1e5 {
				// A vertex the client left unset takes the entry's level.
				y = level
			}
			liquid.Heights[v] = y
		}
		covered := false
		cellsAt := entry + 8 + liquidVerts*8
		for i := range liquid.Cells {
			// A cell the liquid doesn't cover is marked cellNoLiquid; anything else is water.
			if root[cellsAt+i]&cellNoLiquid != cellNoLiquid {
				liquid.Cells[i] = true
				covered = true
			}
		}
		if covered {
			out = append(out, liquid)
		}
		return nil
	})
	return out, err
}

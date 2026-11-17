package adt

import (
	"encoding/binary"
	"math"
)

func u16(data []byte, off int) uint16 { return binary.LittleEndian.Uint16(data[off:]) }

// The 3.3.5a client's tiles keep their liquids in one MH2O chunk of the tile's root instead of an
// MCLQ in each MCNK (#1068). It starts with a header per chunk of the tile (12 bytes, row-major:
// where the chunk's layers are, how many, and where its attributes are, each from the start of the
// MH2O's data), and each layer is 24 bytes:
//
//	uint16  the liquid, a LiquidType.dbc row
//	uint16  the vertex format
//	float32 the least and the greatest height
//	uint8   the first cell's column and row in the chunk, and how many cells wide and high it is
//	uint32  where its cells' bitmap is (0: every cell of the rectangle is covered)
//	uint32  where its vertex data is (0: flat at the least height)
//
// The vertices are the rectangle's, (width+1) by (height+1), row-major. Format 0 holds a float32
// height each and then a depth byte each; format 1 the heights and then two uint16 texture
// coordinates each; format 2 the depth bytes alone, the surface at the layer's least height (the
// sea). The bitmap is a bit a cell, row-major over the rectangle, the low bit first. After the
// layout wowdev.wiki gives and Benilla-WotLK's reader (benilla-adt, MIT/Apache-2.0).
//
// A layer reads into the same Liquid a 1.12 MCLQ layer does, its rectangle placed in the chunk's
// 9x9 vertices and 8x8 cells, so the page draws both alike.

const (
	mh2oChunkHeader = 12
	mh2oLayer       = 24
	mh2oHeightDepth = 0
	mh2oHeightUV    = 1
	mh2oDepth       = 2
)

// liquidKind3 is the kind (water, ocean, magma or slime) of each row the 3.3.5a client's
// LiquidType.dbc holds, by ID: its type column, which is 0 water, 1 ocean, 2 magma, 3 slime there.
// A row a patch added is not here; kindOfLiquid then goes by the layer's vertex format.
var liquidKind3 = map[int]int{
	1: LiquidWater, 5: LiquidWater, 9: LiquidWater, 13: LiquidWater, 17: LiquidWater, 41: LiquidWater, 61: LiquidWater, 81: LiquidWater, 181: LiquidWater,
	2: LiquidOcean, 6: LiquidOcean, 10: LiquidOcean, 14: LiquidOcean, 100: LiquidOcean,
	3: LiquidMagma, 7: LiquidMagma, 11: LiquidMagma, 15: LiquidMagma, 19: LiquidMagma, 121: LiquidMagma, 141: LiquidMagma,
	4: LiquidSlime, 8: LiquidSlime, 12: LiquidSlime, 20: LiquidSlime, 21: LiquidSlime,
}

// LiquidKind is the kind (LiquidWater, LiquidOcean, LiquidMagma or LiquidSlime) of a row of the
// 3.3.5a client's LiquidType.dbc, for a liquid named by its ID outside a tile (a building's, whose
// root says so); false for a row that client does not have.
func LiquidKind(id int) (int, bool) {
	k, ok := liquidKind3[id]
	return k, ok
}

// kindOfLiquid is the kind of the LiquidType.dbc row id for a layer of the given vertex format.
func kindOfLiquid(id, format int) int {
	if k, ok := liquidKind3[id]; ok {
		return k
	}
	switch format {
	case mh2oDepth:
		return LiquidOcean
	case mh2oHeightUV:
		return LiquidMagma
	}
	return LiquidWater
}

// parseMH2O reads the layers of the MH2O chunk c of a tile's root. A layer its data cannot hold
// ends its chunk's list, and one that covers no cell is left out.
func parseMH2O(root []byte, c chunk) []Liquid {
	data := root[c.start:c.end]
	if len(data) < ChunksPerTile*ChunksPerTile*mh2oChunkHeader {
		return nil
	}
	var out []Liquid
	for i := 0; i < ChunksPerTile*ChunksPerTile; i++ {
		ofs, n := int(u32(data, i*mh2oChunkHeader)), int(u32(data, i*mh2oChunkHeader+4))
		for k := 0; k < n && k < 16; k++ {
			at := ofs + k*mh2oLayer
			if ofs <= 0 || at+mh2oLayer > len(data) {
				break
			}
			l, ok := parseMH2OLayer(data, at)
			if !ok {
				continue
			}
			l.IndexX, l.IndexY = i%ChunksPerTile, i/ChunksPerTile
			out = append(out, l)
		}
	}
	return out
}

// parseMH2OLayer reads the layer at at of an MH2O's data.
func parseMH2OLayer(data []byte, at int) (Liquid, bool) {
	var l Liquid
	id, format := int(u16(data, at)), int(u16(data, at+2))
	level := f32(data, at+4)
	x0, y0, w, h := int(data[at+12]), int(data[at+13]), int(data[at+14]), int(data[at+15])
	if w == 0 || h == 0 || x0+w > CellsPerChunk || y0+h > CellsPerChunk {
		return l, false
	}
	l.LiquidID = id
	l.Type = kindOfLiquid(id, format)
	if math.IsNaN(float64(level)) || math.Abs(float64(level)) > 1e5 {
		level = 0
	}

	bitmap := int(u32(data, at+16))
	if bitmap != 0 && bitmap+(w*h+7)/8 > len(data) {
		return l, false
	}
	covered := false
	for r := 0; r < h; r++ {
		for col := 0; col < w; col++ {
			i := r*w + col
			if bitmap == 0 || data[bitmap+i/8]&(1<<(i%8)) != 0 {
				l.Cells[(y0+r)*CellsPerChunk+x0+col] = true
				covered = true
			}
		}
	}
	if !covered {
		return l, false
	}

	// Every vertex starts at the layer's level, fully deep: the ones outside its rectangle, and all
	// of them when it holds no vertex data.
	for v := range l.Heights {
		l.Heights[v], l.Depth[v] = level, 255
	}
	verts := (w + 1) * (h + 1)
	vd := int(u32(data, at+20))
	heights, depths := -1, -1
	switch {
	case vd == 0:
	case format == mh2oHeightDepth && vd+verts*5 <= len(data):
		heights, depths = vd, vd+verts*4
	case format == mh2oHeightUV && vd+verts*8 <= len(data):
		heights = vd
	case format == mh2oDepth && vd+verts <= len(data):
		depths = vd
	}
	for r := 0; r <= h; r++ {
		for col := 0; col <= w; col++ {
			i, v := r*(w+1)+col, (y0+r)*(CellsPerChunk+1)+x0+col
			if heights >= 0 {
				if y := f32(data, heights+i*4); !math.IsNaN(float64(y)) && math.Abs(float64(y)) < 1e5 {
					l.Heights[v] = y
				}
			}
			if depths >= 0 && !textured(l.Type) {
				l.Depth[v] = data[depths+i]
			}
		}
	}
	return l, true
}

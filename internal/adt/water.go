package adt

import (
	"encoding/binary"
	"math"
	"sort"
)

// Liquids as the 1.12 client stores them: an MCLQ per chunk, holding one entry per liquid layer. Each
// entry has the layer's height range, each vertex's depth (or texture coordinates, for magma and
// slime) and height, and a flag per cell saying which liquid covers it, if any. The chunk's MCNK flags
// say which kinds it holds, and its layers are written in the order of those flags. This follows
// noggit3's MCLQ writer (liquid_layer::to_mclq, liquid_chunk::save_mclq).

// Liquid types, as the 1.12 client's LiquidType.dbc numbers them.
const (
	LiquidWater = 1
	LiquidOcean = 2
	LiquidMagma = 3
	LiquidSlime = 4
)

const (
	// mcnkLiquidMask is the MCNK flags' liquid bits, which a chunk clears before it's given liquids.
	mcnkLiquidMask = 0x3c
	// cellNoLiquid is an MCLQ cell's flags where no liquid covers it.
	cellNoLiquid = 0x0f
	// cellFishable and cellFatigue are the cell flags noggit sets: fishing works there, and (deep
	// ocean only) swimmers tire.
	cellFishable = 0x40
	cellFatigue  = 0x80
	// liquidVerts is the 9x9 vertices an MCLQ holds, at 8 bytes each.
	liquidVerts = 81
	// liquidEntry is the size of one MCLQ entry: a level pair, the vertices, 64 cell flags, and flow data.
	liquidEntry = 8 + liquidVerts*8 + 64 + 4 + 2*40
	// OceanOpacity is noggit's depth factor for oceans: a vertex's depth is (water - ground + 1)
	// times it, clamped to 0..1, stored as a byte.
	OceanOpacity = 0.007
)

// liquidKinds is how each type is written: its MCNK flag and its cell type, in the order the
// client wants the layers (by flag).
var liquidKinds = map[int]struct {
	flag uint32
	cell byte
}{
	LiquidWater: {0x04, 4},
	LiquidOcean: {0x08, 1},
	LiquidMagma: {0x10, 6},
	LiquidSlime: {0x20, 3},
}

// typeOfCell is the liquid type of an MCLQ cell's low three bits, or 0 when they name none.
func typeOfCell(b byte) int {
	switch b & 7 {
	case 4:
		return LiquidWater
	case 1:
		return LiquidOcean
	case 6:
		return LiquidMagma
	case 3:
		return LiquidSlime
	}
	return 0
}

// typeOfFlag is the liquid type of an MCNK liquid flag bit.
func typeOfFlag(bit uint32) int {
	for t, k := range liquidKinds {
		if k.flag == bit {
			return t
		}
	}
	return 0
}

// textured says whether a type stores texture coordinates at its vertices rather than a depth.
func textured(t int) bool { return t == LiquidMagma || t == LiquidSlime }

// liquidRecord encodes one layer as an MCLQ entry.
func liquidRecord(l *Liquid) []byte {
	rec := make([]byte, liquidEntry)
	lo, hi := float32(math.MaxFloat32), float32(-math.MaxFloat32)
	for r := 0; r < CellsPerChunk; r++ {
		for c := 0; c < CellsPerChunk; c++ {
			if !l.Cells[r*CellsPerChunk+c] {
				continue
			}
			for _, v := range [4]int{r*9 + c, r*9 + c + 1, (r+1)*9 + c, (r+1)*9 + c + 1} {
				lo = min(lo, l.Heights[v])
				hi = max(hi, l.Heights[v])
			}
		}
	}
	if lo > hi {
		lo, hi = 0, 0
	}
	binary.LittleEndian.PutUint32(rec[0:], math.Float32bits(lo))
	binary.LittleEndian.PutUint32(rec[4:], math.Float32bits(hi))
	for v := 0; v < liquidVerts; v++ {
		o := 8 + v*8
		if textured(l.Type) {
			// noggit's default texture coordinates: a quarter of the texture per cell, in 1/255ths.
			x, z := v%9, v/9
			binary.LittleEndian.PutUint16(rec[o:], uint16(x*255/4))
			binary.LittleEndian.PutUint16(rec[o+2:], uint16(z*255/4))
		} else {
			rec[o] = l.Depth[v]
		}
		binary.LittleEndian.PutUint32(rec[o+4:], math.Float32bits(l.Heights[v]))
	}
	kind := liquidKinds[l.Type]
	flags := 8 + liquidVerts*8
	for i, on := range l.Cells {
		if !on {
			rec[flags+i] = cellNoLiquid
			continue
		}
		b := kind.cell | cellFishable
		if l.Type == LiquidOcean && atMaxDepth(l, i%CellsPerChunk, i/CellsPerChunk) {
			b |= cellFatigue
		}
		rec[flags+i] = b
	}
	return rec
}

// atMaxDepth says whether all four corners of cell (x, z) are as deep as a depth byte goes.
func atMaxDepth(l *Liquid, x, z int) bool {
	for _, v := range [4]int{z*9 + x, z*9 + x + 1, (z+1)*9 + x, (z+1)*9 + x + 1} {
		if l.Depth[v] < 255 {
			return false
		}
	}
	return true
}

// MergeLiquids returns a chunk's layers with those of one type joined into one, since the client
// reads one MCLQ entry per MCNK liquid flag and so drops a second layer of a type (two LiquidType.dbc
// rows of one kind painted side by side, or a painted ocean beside the sea). The joined layer covers
// every cell any of them covers, and takes each vertex from the first layer, in order, with a covered
// cell at it: a cell covered twice keeps the first layer's surface. The order of the types is kept.
func MergeLiquids(layers []Liquid) []Liquid {
	out := make([]Liquid, 0, len(layers))
	// owned[k] marks the vertices out[k] has from a covered cell.
	var owned [][liquidVerts]bool
	for _, l := range layers {
		k := 0
		for k < len(out) && out[k].Type != l.Type {
			k++
		}
		if k == len(out) {
			out = append(out, l)
			owned = append(owned, [liquidVerts]bool{})
			markCorners(&owned[k], &l)
			continue
		}
		m := &out[k]
		for i, on := range l.Cells {
			if !on || m.Cells[i] {
				continue
			}
			m.Cells[i] = true
			r, c := i/CellsPerChunk, i%CellsPerChunk
			for _, v := range [4]int{r*9 + c, r*9 + c + 1, (r+1)*9 + c, (r+1)*9 + c + 1} {
				if !owned[k][v] {
					m.Heights[v], m.Depth[v] = l.Heights[v], l.Depth[v]
					owned[k][v] = true
				}
			}
		}
	}
	return out
}

// markCorners marks in owned the corner vertices of every cell l covers.
func markCorners(owned *[liquidVerts]bool, l *Liquid) {
	for i, on := range l.Cells {
		if !on {
			continue
		}
		r, c := i/CellsPerChunk, i%CellsPerChunk
		for _, v := range [4]int{r*9 + c, r*9 + c + 1, (r+1)*9 + c, (r+1)*9 + c + 1} {
			owned[v] = true
		}
	}
}

// liquidRecords encodes a chunk's layers as its MCLQ payload, in the order of their MCNK flags, and
// returns the flags to set. Layers of one type are joined first (MergeLiquids). Layers of an unknown
// type, or that cover no cell, are left out. It returns nil when nothing is left.
func liquidRecords(layers []Liquid) ([]byte, uint32) {
	layers = MergeLiquids(layers)
	kept := make([]*Liquid, 0, len(layers))
	for i := range layers {
		l := &layers[i]
		if _, ok := liquidKinds[l.Type]; !ok || !covers(l) {
			continue
		}
		kept = append(kept, l)
	}
	if len(kept) == 0 {
		return nil, 0
	}
	// A lava layer ahead of a river layer doesn't show in game, so they go in flag order.
	sort.SliceStable(kept, func(i, j int) bool { return liquidKinds[kept[i].Type].flag < liquidKinds[kept[j].Type].flag })
	var out []byte
	var flags uint32
	for _, l := range kept {
		out = append(out, liquidRecord(l)...)
		flags |= liquidKinds[l.Type].flag
	}
	return out, flags
}

func covers(l *Liquid) bool {
	for _, on := range l.Cells {
		if on {
			return true
		}
	}
	return false
}

// seaLayer returns a chunk's sea: ocean at a level over each cell whose ground lies below it and
// that no layer in taken covers. m is the chunk's MCNK payload, mcvt its MCVT region with the header.
// It returns nil when no cell is left.
func seaLayer(m []byte, mcvt []byte, level float32, taken []Liquid) *Liquid {
	if len(mcvt) < 8+HeightCount*4 || len(m) < 0x74 {
		return nil
	}
	base := f32(m, 0x70)
	// The ground at outer sample i of the chunk (rows of 17 samples: 9 outer, then 8 inner).
	ground := func(i int) float32 { return base + f32(mcvt, 8+i*4) }

	sea := &Liquid{Type: LiquidOcean}
	covered := false
	for r := 0; r < CellsPerChunk; r++ {
		for c := 0; c < CellsPerChunk; c++ {
			i := r*CellsPerChunk + c
			if anyCovers(taken, i) {
				continue
			}
			avg := (ground(r*17+c) + ground(r*17+c+1) + ground((r+1)*17+c) + ground((r+1)*17+c+1)) / 4
			if avg < level {
				sea.Cells[i] = true
				covered = true
			}
		}
	}
	if !covered {
		return nil
	}
	for r := 0; r <= CellsPerChunk; r++ {
		for c := 0; c <= CellsPerChunk; c++ {
			v := r*(CellsPerChunk+1) + c
			sea.Heights[v] = level
			sea.Depth[v] = DepthByte(level-ground(r*17+c), OceanOpacity)
		}
	}
	return sea
}

func anyCovers(layers []Liquid, cell int) bool {
	for i := range layers {
		if layers[i].Cells[cell] {
			return true
		}
	}
	return false
}

// DepthByte is noggit's opacity for water diff yards above the ground: (diff + 1) times factor,
// clamped to 0..1, as a byte.
func DepthByte(diff, factor float32) byte {
	d := (diff + 1) * factor
	return byte(math.Round(float64(max(0, min(1, d))) * 255))
}

package adt

import (
	"encoding/binary"
	"errors"
	"math"
	"sort"
)

// Writing a 3.3.5a tile's liquids (#1068). A tile's MH2O is written whole whenever a chunk's
// liquids change: the chunks that keep theirs are carried over layer by layer, with their bitmaps,
// vertex data and attributes as the client has them, and the changed ones are written from the
// editor's layers the way the client's own tiles are:
//
//   - Water holds a height and a depth at each vertex (format 0). Magma and slime hold a height
//     and texture coordinates (format 1).
//   - The sea, an ocean layer flat at height 0, holds depths alone (format 2), and nothing at all
//     where it is deep throughout; every ocean layer of the client's own tiles is one of these. An
//     ocean layer at another height is written as water is, with its heights: the client draws a
//     layer without heights at its least height, but AzerothCore's map extractor reads its
//     surface as 0, so swimming and breath would be off by the layer's height.
//   - A layer covers the rectangle of cells around the ones it has, with a bitmap of them when it
//     does not cover every one.
//   - A chunk's attributes are two 8x8 bitmaps, of the cells one can fish in and of the deep ones,
//     where swimmers tire. A chunk without them is read as fishable and deep all over (the open
//     sea of the client's tiles has none), so every other chunk is given them. The client's tiles
//     call a cell fishable where the water stands a yard or more over the ground at each of its
//     corners (that rule gives 98 of 100 cells of the tiles surveyed as they are), and so does
//     the writer; deep is the sea at a depth byte's most, as an MCLQ's cells are flagged.
//
// A layer names its liquid by its LiquidType.dbc row. The editor's layers name only a kind, so a
// layer takes the row its chunk's own layer of that kind had, else the row the tile's layers of the
// kind mostly have, else the one the client's own tiles use outdoors (mh2oDefaultID).

// mh2oDefaultID is the LiquidType.dbc row of each kind in the 3.3.5a client's own outdoor tiles:
// a survey of every tile of Northrend, Azeroth and Kalimdor finds water as row 5 in nine layers of
// ten, the sea always as row 2 and magma always as row 7; no tile of them holds slime, which takes
// the row beside those.
var mh2oDefaultID = map[int]uint16{LiquidWater: 5, LiquidOcean: 2, LiquidMagma: 7, LiquidSlime: 8}

// mh2oUVStep is a cell's width in a magma layer's texture coordinates: about what the client's
// own magma (the Burning Steppes') steps a cell, half the texture.
const mh2oUVStep = 43

// waterLayer is one MH2O layer as the file holds it: bitmap is nil when every cell of the rectangle
// is covered, verts when the layer holds no vertex data.
type waterLayer struct {
	id, format    uint16
	lo, hi        float32
	x, y, w, h    uint8
	bitmap, verts []byte
}

// waterChunk is a chunk's layers and its attributes (16 bytes, or nil).
type waterChunk struct {
	layers []waterLayer
	attrs  []byte
}

var errMH2O = errors.New("adt: the tile's MH2O is not one Meld can rewrite")

// vertexBytes is how many bytes a layer's vertex data takes for n vertices, or false for a format
// Meld does not know.
func vertexBytes(format uint16, n int) (int, bool) {
	switch format {
	case mh2oHeightDepth:
		return n * 5, true
	case mh2oHeightUV:
		return n * 8, true
	case mh2oDepth:
		return n, true
	case 3: // height, texture coordinates and depth
		return n * 9, true
	}
	return 0, false
}

// readMH2O reads an MH2O's data into its chunks' layers, as they are.
func readMH2O(data []byte) (*[ChunkCount]waterChunk, error) {
	var out [ChunkCount]waterChunk
	if len(data) == 0 {
		return &out, nil
	}
	if len(data) < ChunkCount*mh2oChunkHeader {
		return nil, errMH2O
	}
	part := func(ofs, n int) ([]byte, error) {
		if ofs <= 0 || n < 0 || ofs+n > len(data) {
			return nil, errMH2O
		}
		return append([]byte(nil), data[ofs:ofs+n]...), nil
	}
	for i := range out {
		ofs, n, attrs := int(u32(data, i*mh2oChunkHeader)), int(u32(data, i*mh2oChunkHeader+4)), int(u32(data, i*mh2oChunkHeader+8))
		if n == 0 {
			continue
		}
		if ofs <= 0 || n > 64 || ofs+n*mh2oLayer > len(data) {
			return nil, errMH2O
		}
		c := &out[i]
		var err error
		if attrs != 0 {
			if c.attrs, err = part(attrs, 16); err != nil {
				return nil, err
			}
		}
		for k := 0; k < n; k++ {
			at := ofs + k*mh2oLayer
			l := waterLayer{
				id: u16(data, at), format: u16(data, at+2), lo: f32(data, at+4), hi: f32(data, at+8),
				x: data[at+12], y: data[at+13], w: data[at+14], h: data[at+15],
			}
			cells, verts := int(l.w)*int(l.h), (int(l.w)+1)*(int(l.h)+1)
			if bitmap := int(u32(data, at+16)); bitmap != 0 {
				if l.bitmap, err = part(bitmap, (cells+7)/8); err != nil {
					return nil, err
				}
			}
			if vd := int(u32(data, at+20)); vd != 0 {
				size, ok := vertexBytes(l.format, verts)
				if !ok {
					return nil, errMH2O
				}
				if l.verts, err = part(vd, size); err != nil {
					return nil, err
				}
			}
			c.layers = append(c.layers, l)
		}
	}
	return &out, nil
}

// buildMH2O writes chunks as an MH2O's data: the 256 chunk headers, then each chunk's layers, its
// attributes and its layers' bitmaps and vertex data. Nil when no chunk has a layer: such a tile
// has no MH2O.
func buildMH2O(chunks *[ChunkCount]waterChunk) []byte {
	out := make([]byte, ChunkCount*mh2oChunkHeader)
	any := false
	put := func(at int, v uint32) { binary.LittleEndian.PutUint32(out[at:], v) }
	for i := range chunks {
		c := &chunks[i]
		if len(c.layers) == 0 {
			continue
		}
		any = true
		layersAt := len(out)
		put(i*mh2oChunkHeader, uint32(layersAt))
		put(i*mh2oChunkHeader+4, uint32(len(c.layers)))
		out = append(out, make([]byte, len(c.layers)*mh2oLayer)...)
		if c.attrs != nil {
			put(i*mh2oChunkHeader+8, uint32(len(out)))
			out = append(out, c.attrs...)
		}
		for k, l := range c.layers {
			at := layersAt + k*mh2oLayer
			binary.LittleEndian.PutUint16(out[at:], l.id)
			binary.LittleEndian.PutUint16(out[at+2:], l.format)
			put(at+4, math.Float32bits(l.lo))
			put(at+8, math.Float32bits(l.hi))
			out[at+12], out[at+13], out[at+14], out[at+15] = l.x, l.y, l.w, l.h
			if l.bitmap != nil {
				put(at+16, uint32(len(out)))
				out = append(out, l.bitmap...)
			}
			if l.verts != nil {
				put(at+20, uint32(len(out)))
				out = append(out, l.verts...)
			}
		}
	}
	if !any {
		return nil
	}
	// A reader may take a bitmap as eight bytes whatever its rectangle (AzerothCore's map extractor
	// does), so the last one must not end the chunk short of that.
	return append(out, make([]byte, 8)...)
}

// rewriteMH2O is a tile's MH2O data with the liquids of the chunks in water (by chunk index,
// y*16 + x) replaced by their layers, and the other chunks' carried over from own, the tile's
// MH2O data as it is (nil for a tile without one). Nil when the tile is left without liquid.
func rewriteMH2O(own []byte, water map[int]*chunkWater) ([]byte, error) {
	chunks, err := readMH2O(own)
	if err != nil {
		return nil, err
	}
	// The row the tile's layers of each kind mostly have.
	count := map[int]map[uint16]int{}
	for i := range chunks {
		for _, l := range chunks[i].layers {
			kind := kindOfLiquid(int(l.id), int(l.format))
			if count[kind] == nil {
				count[kind] = map[uint16]int{}
			}
			count[kind][l.id]++
		}
	}
	usual := map[int]uint16{}
	for kind, ids := range count {
		best := uint16(0)
		for id, n := range ids {
			if best == 0 || n > ids[best] || n == ids[best] && id < best {
				best = id
			}
		}
		usual[kind] = best
	}
	for idx, w := range water {
		if idx < 0 || idx >= ChunkCount {
			continue
		}
		ids := map[int]uint16{}
		for kind, id := range mh2oDefaultID {
			ids[kind] = id
			if u, ok := usual[kind]; ok {
				ids[kind] = u
			}
		}
		for k := len(chunks[idx].layers) - 1; k >= 0; k-- {
			l := chunks[idx].layers[k]
			ids[kindOfLiquid(int(l.id), int(l.format))] = l.id
		}
		chunks[idx] = waterChunkOf(w.layers, ids, w.ground)
	}
	return buildMH2O(chunks), nil
}

// waterChunkOf is a chunk's MH2O layers and attributes from the editor's layers: those of one kind
// joined (MergeLiquids), the ones of an unknown kind or without a cell left out, in the order an
// MCLQ has them. ids is the LiquidType.dbc row for each kind a layer does not name its own for,
// and ground the ground at the chunk's 9x9 outer samples (nil when not known), for the cells too
// shallow to fish in.
func waterChunkOf(layers []Liquid, ids map[int]uint16, ground *[liquidVerts]float32) waterChunk {
	layers = MergeLiquids(layers)
	kept := make([]*Liquid, 0, len(layers))
	for i := range layers {
		if _, ok := liquidKinds[layers[i].Type]; ok && covers(&layers[i]) {
			kept = append(kept, &layers[i])
		}
	}
	sort.SliceStable(kept, func(i, j int) bool { return liquidKinds[kept[i].Type].flag < liquidKinds[kept[j].Type].flag })
	var c waterChunk
	if len(kept) == 0 {
		return c
	}
	var fishable, deep uint64
	open := true // every layer is deep sea all over, written as the client's open sea is
	for _, l := range kept {
		id := ids[l.Type]
		if l.LiquidID > 0 && l.LiquidID <= math.MaxUint16 {
			if kind, known := liquidKind3[l.LiquidID]; !known || kind == l.Type {
				id = uint16(l.LiquidID)
			}
		}
		w := waterLayerOf(l, id)
		c.layers = append(c.layers, w)
		for i, on := range l.Cells {
			if !on {
				continue
			}
			if !textured(l.Type) && fishDepth(l, ground, i) {
				fishable |= 1 << i
			}
			if l.Type == LiquidOcean && atMaxDepth(l, i%CellsPerChunk, i/CellsPerChunk) {
				deep |= 1 << i
			}
		}
		if w.format != mh2oDepth || w.bitmap != nil || w.verts != nil || w.w != CellsPerChunk || w.h != CellsPerChunk {
			open = false
		}
	}
	if !open || len(kept) > 1 {
		c.attrs = make([]byte, 16)
		binary.LittleEndian.PutUint64(c.attrs, fishable)
		binary.LittleEndian.PutUint64(c.attrs[8:], deep)
	}
	return c
}

// fishDepth says the layer stands a yard or more over the ground at each corner of cell i.
func fishDepth(l *Liquid, ground *[liquidVerts]float32, i int) bool {
	if ground == nil {
		return true
	}
	r, c := i/CellsPerChunk, i%CellsPerChunk
	for _, v := range [4]int{r*9 + c, r*9 + c + 1, (r+1)*9 + c, (r+1)*9 + c + 1} {
		if l.Heights[v]-ground[v] < 1 {
			return false
		}
	}
	return true
}

// waterLayerOf writes one of the editor's layers as an MH2O layer of the row id.
func waterLayerOf(l *Liquid, id uint16) waterLayer {
	// The rectangle around the layer's cells, and the heights over them.
	x0, y0, x1, y1 := CellsPerChunk, CellsPerChunk, -1, -1
	lo, hi := float32(math.MaxFloat32), float32(-math.MaxFloat32)
	flat0, deepest := true, true
	for i, on := range l.Cells {
		if !on {
			continue
		}
		r, c := i/CellsPerChunk, i%CellsPerChunk
		x0, y0, x1, y1 = min(x0, c), min(y0, r), max(x1, c), max(y1, r)
		for _, v := range [4]int{r*9 + c, r*9 + c + 1, (r+1)*9 + c, (r+1)*9 + c + 1} {
			lo, hi = min(lo, l.Heights[v]), max(hi, l.Heights[v])
			if l.Heights[v] != 0 {
				flat0 = false
			}
			if l.Depth[v] != 255 {
				deepest = false
			}
		}
	}
	w, h := x1-x0+1, y1-y0+1
	out := waterLayer{id: id, lo: lo, hi: hi, x: uint8(x0), y: uint8(y0), w: uint8(w), h: uint8(h)}

	all := true
	bitmap := make([]byte, (w*h+7)/8)
	// corner marks the rectangle's vertices at a covered cell; the rest take the least height.
	corner := make([]bool, (w+1)*(h+1))
	for r := 0; r < h; r++ {
		for c := 0; c < w; c++ {
			if !l.Cells[(y0+r)*CellsPerChunk+x0+c] {
				all = false
				continue
			}
			bitmap[(r*w+c)/8] |= 1 << ((r*w + c) % 8)
			for _, v := range [4]int{r*(w+1) + c, r*(w+1) + c + 1, (r+1)*(w+1) + c, (r+1)*(w+1) + c + 1} {
				corner[v] = true
			}
		}
	}
	if !all {
		out.bitmap = bitmap
	}

	n := (w + 1) * (h + 1)
	// at is where vertex i of the rectangle is among the chunk's 9x9.
	at := func(i int) int { return (y0+i/(w+1))*(CellsPerChunk+1) + x0 + i%(w+1) }
	heights := func() []byte {
		b := make([]byte, 0, n*4)
		for i := 0; i < n; i++ {
			y := lo
			if corner[i] {
				y = l.Heights[at(i)]
			}
			b = binary.LittleEndian.AppendUint32(b, math.Float32bits(y))
		}
		return b
	}
	depths := func(b []byte) []byte {
		for i := 0; i < n; i++ {
			b = append(b, l.Depth[at(i)])
		}
		return b
	}
	switch {
	case textured(l.Type):
		out.format = mh2oHeightUV
		out.verts = heights()
		for i := 0; i < n; i++ {
			out.verts = binary.LittleEndian.AppendUint16(out.verts, uint16((x0+i%(w+1))*mh2oUVStep))
			out.verts = binary.LittleEndian.AppendUint16(out.verts, uint16((y0+i/(w+1))*mh2oUVStep))
		}
	case l.Type == LiquidOcean && flat0:
		out.format = mh2oDepth
		out.lo, out.hi = 0, 0
		if !deepest {
			out.verts = depths(nil)
		}
	default:
		out.format = mh2oHeightDepth
		out.verts = depths(heights())
	}
	return out
}

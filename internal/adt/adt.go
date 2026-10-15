// Package adt reads World of Warcraft 1.12 map tiles (ADT files) from the client's archives. A
// 1.12 tile is one file holding its terrain heights and holes, texture layers and alpha maps, and
// its M2 and WMO placements; the split _tex0 and _obj0 files only exist in later clients. Ported
// from Ironforge's parser, so both editors read the same bytes the server's map extractor does.
package adt

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

const (
	// ChunksPerTile is the number of MCNK chunks per side of a tile.
	ChunksPerTile = 16
	// ChunkCount is the number of MCNK chunks in a full tile.
	ChunkCount = ChunksPerTile * ChunksPerTile
	// TileSize is the width of a tile in yards.
	TileSize = 1600.0 / 3.0
	// CellsPerChunk is the number of cells per side of a chunk.
	CellsPerChunk = 8
	// HeightCount is the height samples per chunk: 9x9 outer, then 8x8 inner, alternating rows.
	HeightCount = 145
	// AlphaSize is the side of an alpha map.
	AlphaSize = 64

	mcnkHeaderSize   = 0x80
	mcnkFlagNoFix    = 0x8000
	mcnkFlagHighHole = 0x10000
	layerUseAlpha    = 0x100
	layerAlphaRLE    = 0x200
	mphdBigAlpha     = 0x4 | 0x80
)

var errTruncated = errors.New("adt: truncated chunk")

// Chunk is one MCNK: an 8x8-cell piece of a tile.
type Chunk struct {
	// IndexX and IndexY place the chunk in its tile, 0 to 15.
	IndexX, IndexY int
	Flags          uint32
	AreaID         uint32
	// Holes has one byte per cell row; bit n set means cell n of that row is a hole.
	Holes [CellsPerChunk]uint8
	// NoEffect has one byte per cell row; bit n set means cell n of that row grows no ground
	// effect doodads (the header's noEffectDoodad bits: no grass under a building or a road).
	NoEffect [CellsPerChunk]uint8
	// Position is the chunk's corner in world space. Position[2] is the base height that every
	// height sample is stored relative to.
	Position [3]float32
	// Heights are absolute heights for the 145 samples (see HeightCount).
	Heights [HeightCount]float32
}

// Terrain is the geometry of one tile. Chunks are kept in file order, which the texture file
// also uses, so chunk i here and chunk i in Textures describe the same piece of ground.
type Terrain struct {
	Chunks []Chunk
}

// At returns the chunk at (x, y) in the tile, or nil if the tile has none there.
func (t *Terrain) At(x, y int) *Chunk {
	for i := range t.Chunks {
		if t.Chunks[i].IndexX == x && t.Chunks[i].IndexY == y {
			return &t.Chunks[i]
		}
	}
	return nil
}

// TexLayer is one texture layer of a chunk.
type TexLayer struct {
	// Texture is the texture's archive path, from the tile's MTEX names: the layer's texture ID is
	// an index into that list, not a byte offset.
	Texture string
	Flags   uint32
	// Effect is the GroundEffectTexture ID that grows on this layer (0 for none).
	Effect uint32
}

// TexChunk holds one chunk's layers. Alpha[i] is the 64x64 alpha map of Layers[i+1], row-major.
// The base layer has none.
type TexChunk struct {
	Layers []TexLayer
	Alpha  [][]byte
}

// Textures is the texture data of one tile.
type Textures struct {
	Chunks []TexChunk
}

// Kind is what a placement refers to.
type Kind int

const (
	// M2 is a doodad, read from MDDF.
	M2 Kind = iota
	// WMO is a building, read from MODF.
	WMO
)

// Placement is one model placed on the tile.
type Placement struct {
	Kind Kind
	// Name is the model's archive path, such as World\...\Tree.m2.
	Name string
	UID  uint32
	// Position is in the file's own space.
	Position [3]float32
	// Rotation is in degrees, as the file stores it.
	Rotation [3]float32
	// Scale is 1 for WMOs, which are always full size in 1.12.
	Scale float32
	// DoodadSet and NameSet select the WMO's doodad and name sets (WMOs only).
	DoodadSet uint16
	NameSet   uint16
}

// TilePath is the archive path of a tile's file, for example
// World\Maps\Azeroth\Azeroth_32_48.adt. suffix is "" for the root file, or "_tex0" and "_obj0"
// for the split files.
func TilePath(mapName string, x, y int, suffix string) string {
	return fmt.Sprintf(`World\Maps\%s\%s_%d_%d%s.adt`, mapName, mapName, x, y, suffix)
}

// chunk is one IFF-style chunk: its id, and where its payload starts and ends.
type chunk struct {
	id         string
	start, end int
}

// eachChunk walks the chunks in data[start:end]. Ids are stored byte-reversed on disk.
func eachChunk(data []byte, start, end int, fn func(c chunk) error) error {
	for pos := start; pos+8 <= end; {
		id := string([]byte{data[pos+3], data[pos+2], data[pos+1], data[pos]})
		size := int(binary.LittleEndian.Uint32(data[pos+4:]))
		payload := pos + 8
		if size < 0 || payload+size > end {
			return fmt.Errorf("adt: chunk %s at %d runs past its parent", id, pos)
		}
		if err := fn(chunk{id: id, start: payload, end: payload + size}); err != nil {
			return err
		}
		pos = payload + size
	}
	return nil
}

// subChunk finds the sub-chunk an MCNK header points at. The header's offsets count from the start
// of the MCNK chunk (its 8-byte id and size included), and are used rather than walking the
// sub-chunks in order, because MCNR is stored with 13 bytes of padding its size doesn't count.
func subChunk(data []byte, h, end int, off uint32, id string) (chunk, bool) {
	if off == 0 {
		return chunk{}, false
	}
	pos := h - 8 + int(off)
	if pos+8 > end {
		return chunk{}, false
	}
	size := int(binary.LittleEndian.Uint32(data[pos+4:]))
	payload := pos + 8
	if payload+size > end || string([]byte{data[pos+3], data[pos+2], data[pos+1], data[pos]}) != id {
		return chunk{}, false
	}
	return chunk{id: id, start: payload, end: payload + size}, true
}

func u32(data []byte, off int) uint32 { return binary.LittleEndian.Uint32(data[off:]) }

func f32(data []byte, off int) float32 { return math.Float32frombits(u32(data, off)) }

// readU32s reads a chunk whose payload is a list of uint32 values.
func readU32s(data []byte, c chunk) []uint32 {
	out := make([]uint32, (c.end-c.start)/4)
	for i := range out {
		out[i] = u32(data, c.start+i*4)
	}
	return out
}

// cstring reads the zero-terminated string at off in a string table.
func cstring(table []byte, off uint32) string {
	if int(off) >= len(table) {
		return ""
	}
	end := int(off)
	for end < len(table) && table[end] != 0 {
		end++
	}
	return string(table[off:end])
}

// ParseTerrain reads the root file's MCNK chunks: heights, holes and area IDs.
func ParseTerrain(root []byte) (*Terrain, error) {
	t := &Terrain{}
	err := eachChunk(root, 0, len(root), func(c chunk) error {
		if c.id != "MCNK" {
			return nil
		}
		ch, err := parseChunk(root, c.start, c.end)
		if err != nil {
			return err
		}
		t.Chunks = append(t.Chunks, ch)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(t.Chunks) == 0 {
		return nil, errors.New("adt: no MCNK chunks")
	}
	return t, nil
}

func parseChunk(data []byte, h, end int) (Chunk, error) {
	if h+mcnkHeaderSize > end {
		return Chunk{}, errTruncated
	}
	ch := Chunk{
		Flags:    u32(data, h),
		IndexX:   int(u32(data, h+0x04)),
		IndexY:   int(u32(data, h+0x08)),
		AreaID:   u32(data, h+0x34),
		Position: [3]float32{f32(data, h+0x68), f32(data, h+0x6c), f32(data, h+0x70)},
	}
	if ch.IndexX >= ChunksPerTile || ch.IndexY >= ChunksPerTile {
		return Chunk{}, fmt.Errorf("adt: chunk index %d,%d outside the tile", ch.IndexX, ch.IndexY)
	}
	if ch.Flags&mcnkFlagHighHole != 0 {
		// 8x8 bitmap, one byte per row, stored where older files kept the MCVT offset.
		for row := 0; row < CellsPerChunk; row++ {
			ch.Holes[row] = data[h+0x14+row]
		}
	} else {
		// 4x4 bitmap; each bit covers a 2x2 block of cells.
		low := binary.LittleEndian.Uint16(data[h+0x3c:])
		for row := 0; row < CellsPerChunk; row++ {
			for col := 0; col < CellsPerChunk; col++ {
				if low&(1<<((row>>1)*4+(col>>1))) != 0 {
					ch.Holes[row] |= 1 << col
				}
			}
		}
	}
	for row := 0; row < CellsPerChunk; row++ {
		ch.NoEffect[row] = data[h+mcnkNoEffect+row]
	}
	mcvt, ok := subChunk(data, h, end, u32(data, h+0x14), "MCVT")
	if !ok || mcvt.end-mcvt.start < HeightCount*4 {
		return Chunk{}, errors.New("adt: chunk without heights")
	}
	for i := 0; i < HeightCount; i++ {
		ch.Heights[i] = ch.Position[2] + f32(data, mcvt.start+i*4)
	}
	return ch, nil
}

// ReadBigAlpha reports whether the map's WDT file uses 8-bit alpha maps instead of 4-bit.
func ReadBigAlpha(wdt []byte) bool {
	bigAlpha := false
	_ = eachChunk(wdt, 0, len(wdt), func(c chunk) error {
		if c.id == "MPHD" && c.end-c.start >= 4 {
			bigAlpha = u32(wdt, c.start)&mphdBigAlpha != 0
			return errStop
		}
		return nil
	})
	return bigAlpha
}

var errStop = errors.New("stop")

// ParseTextures reads a tile's texture layers and alpha maps: from the root file on 1.12, or from
// the _tex0 file in split tiles. bigAlpha comes from the WDT (see ReadBigAlpha). terrain is the
// tile's terrain, whose chunk flags say which 4-bit alpha maps need their last row and column
// repeated. Pass nil to assume they all do.
func ParseTextures(tex []byte, bigAlpha bool, terrain *Terrain) (*Textures, error) {
	var mtex []byte
	var mcnks []chunk
	err := eachChunk(tex, 0, len(tex), func(c chunk) error {
		switch c.id {
		case "MTEX":
			mtex = tex[c.start:c.end]
		case "MCNK":
			mcnks = append(mcnks, c)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	names := splitNames(mtex)
	out := &Textures{}
	for i, c := range mcnks {
		fix := true
		if terrain != nil && i < len(terrain.Chunks) {
			fix = terrain.Chunks[i].Flags&mcnkFlagNoFix == 0
		}
		tc, err := parseTexChunk(tex, names, c, bigAlpha, fix)
		if err != nil {
			return nil, err
		}
		out.Chunks = append(out.Chunks, tc)
	}
	return out, nil
}

// splitNames splits MTEX into its zero-terminated texture paths.
func splitNames(mtex []byte) []string {
	var names []string
	start := 0
	for i, b := range mtex {
		if b == 0 {
			names = append(names, string(mtex[start:i]))
			start = i + 1
		}
	}
	return names
}

func parseTexChunk(data []byte, names []string, c chunk, bigAlpha, fix bool) (TexChunk, error) {
	var tc TexChunk
	var alphaOffsets []uint32
	h := c.start
	if mcly, ok := subChunk(data, h, c.end, u32(data, h+0x1c), "MCLY"); ok {
		for o := mcly.start; o+16 <= mcly.end; o += 16 {
			id := int(u32(data, o))
			texture := ""
			if id < len(names) {
				texture = names[id]
			}
			tc.Layers = append(tc.Layers, TexLayer{
				Texture: texture,
				Flags:   u32(data, o+4),
				Effect:  u32(data, o+12),
			})
			alphaOffsets = append(alphaOffsets, u32(data, o+8))
		}
	}
	mcal, hasAlpha := subChunk(data, h, c.end, u32(data, h+0x24), "MCAL")
	for l := 1; l < len(tc.Layers); l++ {
		alpha := make([]byte, AlphaSize*AlphaSize)
		layer := tc.Layers[l]
		if hasAlpha && layer.Flags&layerUseAlpha != 0 && int(alphaOffsets[l]) < mcal.end-mcal.start {
			src := data[mcal.start+int(alphaOffsets[l]) : mcal.end]
			switch {
			case layer.Flags&layerAlphaRLE != 0:
				decodeRLE(src, alpha)
			case bigAlpha:
				copy(alpha, src)
			default:
				decode4Bit(src, alpha, fix)
			}
		}
		tc.Alpha = append(tc.Alpha, alpha)
	}
	return tc, nil
}

// decodeRLE expands run-length alpha: a header with the high bit set repeats the next byte, one
// with it clear copies the bytes that follow.
func decodeRLE(src, out []byte) {
	i, o := 0, 0
	for o < len(out) && i < len(src) {
		header := src[i]
		i++
		count := int(header & 0x7f)
		if header&0x80 != 0 {
			if i >= len(src) {
				return
			}
			for k := o; k < min(len(out), o+count); k++ {
				out[k] = src[i]
			}
			i++
		} else {
			n := min(count, len(out)-o, len(src)-i)
			copy(out[o:], src[i:i+n])
			i += count
		}
		o += count
	}
}

// decode4Bit expands 4-bit alpha (two texels a byte, low nibble first). When fix is set, the map
// is the 63x63 kind, so its last column and row are repeated to fill 64x64.
func decode4Bit(src, out []byte, fix bool) {
	for i := 0; i < len(out)/2 && i < len(src); i++ {
		out[i*2] = (src[i] & 0x0f) * 17
		out[i*2+1] = (src[i] >> 4) * 17
	}
	if !fix {
		return
	}
	for y := 0; y < AlphaSize; y++ {
		out[y*AlphaSize+63] = out[y*AlphaSize+62]
	}
	copy(out[63*AlphaSize:], out[62*AlphaSize:63*AlphaSize])
}

// ParsePlacements reads a tile's M2 (MDDF) and WMO (MODF) placements: from the root file on 1.12,
// or from the _obj0 file in split tiles. A placement's
// name ID indexes MMID or MWID, whose entries are offsets into the MMDX or MWMO name table.
func ParsePlacements(obj []byte) ([]Placement, error) {
	var mmdx, mwmo []byte
	var mmid, mwid []uint32
	var mddf, modf []chunk
	err := eachChunk(obj, 0, len(obj), func(c chunk) error {
		switch c.id {
		case "MMDX":
			mmdx = obj[c.start:c.end]
		case "MMID":
			mmid = readU32s(obj, c)
		case "MWMO":
			mwmo = obj[c.start:c.end]
		case "MWID":
			mwid = readU32s(obj, c)
		case "MDDF":
			mddf = append(mddf, c)
		case "MODF":
			modf = append(modf, c)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	var out []Placement
	for _, c := range mddf {
		for o := c.start; o+36 <= c.end; o += 36 {
			out = append(out, Placement{
				Kind:     M2,
				Name:     nameFor(mmdx, mmid, u32(obj, o)),
				UID:      u32(obj, o+4),
				Position: [3]float32{f32(obj, o+8), f32(obj, o+12), f32(obj, o+16)},
				Rotation: [3]float32{f32(obj, o+20), f32(obj, o+24), f32(obj, o+28)},
				Scale:    float32(binary.LittleEndian.Uint16(obj[o+32:])) / 1024,
			})
		}
	}
	for _, c := range modf {
		for o := c.start; o+64 <= c.end; o += 64 {
			out = append(out, Placement{
				Kind:      WMO,
				Name:      nameFor(mwmo, mwid, u32(obj, o)),
				UID:       u32(obj, o+4),
				Position:  [3]float32{f32(obj, o+8), f32(obj, o+12), f32(obj, o+16)},
				Rotation:  [3]float32{f32(obj, o+20), f32(obj, o+24), f32(obj, o+28)},
				Scale:     1,
				DoodadSet: binary.LittleEndian.Uint16(obj[o+58:]),
				NameSet:   binary.LittleEndian.Uint16(obj[o+60:]),
			})
		}
	}
	return out, nil
}

// nameFor resolves a placement's name ID through its offsets table into the name table.
func nameFor(table []byte, offsets []uint32, id uint32) string {
	if int(id) >= len(offsets) {
		return ""
	}
	return cstring(table, offsets[id])
}

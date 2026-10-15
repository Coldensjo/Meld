package adt

import "encoding/binary"

// mcnkAreaID is where the chunk header keeps the chunk's zone: an AreaTable.dbc ID.
const mcnkAreaID = 0x34

// ChunkHeader is what the editor sets in a chunk's header: the zone it belongs to, whether players
// can walk it, and the cells that grow no ground effect doodads.
type ChunkHeader struct {
	// AreaID is the chunk's AreaTable.dbc ID; 0 keeps the chunk's own.
	AreaID uint32
	// Impassable sets the header's impassable flag (0x2); false clears it.
	Impassable bool
	// NoEffect, one byte per cell row with a bit per cell, replaces the chunk's noEffectDoodad bits,
	// including any a ChunkPaint added; nil keeps them.
	NoEffect []uint8
	// Holes, when set, replaces the chunk's holes: the 1.12 4x4 bitmap, bit row*4+col for the 2x2-cell
	// block (col, row). See HoleBits.
	Holes *uint16
}

// mcnkHoles is where a 1.12 chunk header keeps its 4x4 hole bitmap.
const mcnkHoles = 0x3c

// HoleBits is a chunk's 1.12 hole bitmap from its holes per cell (8 rows, bit n of a row for cell n):
// a 2x2-cell block is a hole when any of its cells is.
func HoleBits(rows []uint8) uint16 {
	var bits uint16
	for r, row := range rows {
		if r >= CellsPerChunk {
			break
		}
		for c := 0; c < CellsPerChunk; c++ {
			if row&(1<<c) != 0 {
				bits |= 1 << ((r>>1)*4 + c>>1)
			}
		}
	}
	return bits
}

// apply writes h into a chunk header and returns the chunk's flags with the impassable bit set
// as h has it.
func (h ChunkHeader) apply(header []byte, flags uint32) uint32 {
	if h.AreaID != 0 {
		binary.LittleEndian.PutUint32(header[mcnkAreaID:], h.AreaID)
	}
	if len(h.NoEffect) == CellsPerChunk {
		copy(header[mcnkNoEffect:mcnkNoEffect+CellsPerChunk], h.NoEffect)
	}
	if h.Holes != nil {
		// 1.12 knows only the low-resolution holes; the high-resolution flag of later clients goes.
		binary.LittleEndian.PutUint16(header[mcnkHoles:], *h.Holes)
		flags &^= mcnkFlagHighHole
	}
	if h.Impassable {
		return flags | mcnkFlagImpass
	}
	return flags &^ mcnkFlagImpass
}

// Impassable says whether the chunk's header flags it as impassable.
func (c Chunk) Impassable() bool { return c.Flags&mcnkFlagImpass != 0 }

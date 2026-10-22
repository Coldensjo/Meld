package adt

import "encoding/binary"

// mcnkAreaID is where the chunk header keeps the chunk's zone: an AreaTable.dbc ID.
const mcnkAreaID = 0x34

// ChunkHeader is what the editor sets in a chunk's header: the zone it belongs to, whether players
// can walk it, and the cells that grow no ground effect doodads.
type ChunkHeader struct {
	// AreaID is the chunk's AreaTable.dbc ID; 0 keeps the chunk's own.
	AreaID uint32
	// Impassable, when set, sets the header's impassable flag (0x2) or, false, clears it; nil keeps
	// the chunk's own (a map without chunk data of its own, which still sends holes and shadows).
	Impassable *bool
	// NoEffect, one byte per cell row with a bit per cell, replaces the chunk's noEffectDoodad bits,
	// including any a ChunkPaint added; nil keeps them.
	NoEffect []uint8
	// Holes, when set, replaces the chunk's holes: the 1.12 4x4 bitmap, bit row*4+col for the 2x2-cell
	// block (col, row). See HoleBits.
	Holes *uint16
	// HolesAdd adds Holes to the chunk's own instead of replacing them: a map that doesn't know the
	// client's holes (one saved before the file kept them, #663) must not fill them in.
	HolesAdd bool
	// Shadow, when set, replaces the chunk's baked shadow map (MCSH): ShadowBytes bytes, laid out as
	// Chunk.Shadow. See shadowPiece.
	Shadow []byte
}

// ShadowBytes is the size of a chunk's baked shadow map: 64x64 bits.
const ShadowBytes = ShadowSize * ShadowSize / 8

// mcnkFlagShadow is the header flag that says the chunk has a baked shadow map, and mcnkShadowSize
// where the header keeps that map's size.
const (
	mcnkFlagShadow = 0x1
	mcnkShadowSize = 0x30
)

// shadowPiece is the MCSH payload to write for a chunk's new shadow map, and its header flags. The
// client's own tiles give every chunk a 512-byte MCSH, even an empty one, and every chunk with a
// shadow bit set has the shadow flag (0x1), while many empty ones have it too (a survey of every
// tile of Azeroth, Kalimdor, the Deadmines and Warsong Gulch). So the map is always written; a bit
// set sets the flag, and an empty map leaves the flag as the chunk had it.
func shadowPiece(shadow []byte, flags uint32) ([]byte, uint32) {
	out := make([]byte, ShadowBytes)
	copy(out, shadow)
	for _, b := range out {
		if b != 0 {
			return out, flags | mcnkFlagShadow
		}
	}
	return out, flags
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
// as h has it (kept when h leaves it nil).
func (h ChunkHeader) apply(header []byte, flags uint32) uint32 {
	if h.AreaID != 0 {
		binary.LittleEndian.PutUint32(header[mcnkAreaID:], h.AreaID)
	}
	if len(h.NoEffect) == CellsPerChunk {
		copy(header[mcnkNoEffect:mcnkNoEffect+CellsPerChunk], h.NoEffect)
	}
	if h.Holes != nil {
		// 1.12 knows only the low-resolution holes; the high-resolution flag of later clients goes.
		bits := *h.Holes
		if h.HolesAdd {
			bits |= binary.LittleEndian.Uint16(header[mcnkHoles:])
		}
		binary.LittleEndian.PutUint16(header[mcnkHoles:], bits)
		flags &^= mcnkFlagHighHole
	}
	if h.Impassable == nil {
		return flags
	}
	if *h.Impassable {
		return flags | mcnkFlagImpass
	}
	return flags &^ mcnkFlagImpass
}

// Impassable says whether the chunk's header flags it as impassable.
func (c Chunk) Impassable() bool { return c.Flags&mcnkFlagImpass != 0 }

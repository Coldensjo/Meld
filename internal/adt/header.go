package adt

import "encoding/binary"

// mcnkAreaID is where the chunk header keeps the chunk's zone: an AreaTable.dbc ID.
const mcnkAreaID = 0x34

// ChunkHeader is what the editor sets in a chunk's header: the zone it belongs to and whether
// players can walk it.
type ChunkHeader struct {
	// AreaID is the chunk's AreaTable.dbc ID; 0 keeps the chunk's own.
	AreaID uint32
	// Impassable sets the header's impassable flag (0x2); false clears it.
	Impassable bool
}

// apply writes h into a chunk header and returns the chunk's flags with the impassable bit set
// as h has it.
func (h ChunkHeader) apply(header []byte, flags uint32) uint32 {
	if h.AreaID != 0 {
		binary.LittleEndian.PutUint32(header[mcnkAreaID:], h.AreaID)
	}
	if h.Impassable {
		return flags | mcnkFlagImpass
	}
	return flags &^ mcnkFlagImpass
}

// Impassable says whether the chunk's header flags it as impassable.
func (c Chunk) Impassable() bool { return c.Flags&mcnkFlagImpass != 0 }

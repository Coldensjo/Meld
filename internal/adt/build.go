package adt

import (
	"encoding/binary"
	"fmt"
)

// ZeroPoint is the world coordinate of a map's first tile, as the 1.12 chunk positions measure
// from: a map is 64 tiles, centred on it.
const ZeroPoint = 32 * TileSize

// BuildTile writes a new tile: the ground's outer heights (129 x 129, row-major, rows running south)
// and the paint and models in ch. The tile starts flat, so its chunks, normals and references are
// all made here; nothing comes from a client's file. Inner height samples are the average of the four
// outer corners around them, as a regular grid has them. ring is the neighbouring tiles' heights just
// across the border (an empty side for none), so the normals there match the neighbours' (#492).
func BuildTile(outer []float32, ring Ring, ch Changes) ([]byte, error) {
	if len(outer) != (ChunksPerTile*CellsPerChunk+1)*(ChunksPerTile*CellsPerChunk+1) {
		return nil, fmt.Errorf("adt: %d heights for a tile", len(outer))
	}
	root := newTileRoot(ch.TileX, ch.TileY)
	terrain, err := ParseTerrain(root)
	if err != nil {
		return nil, err
	}
	for i := range terrain.Chunks {
		c := &terrain.Chunks[i]
		c.Heights = chunkHeights(outer, c.IndexX, c.IndexY)
	}
	withHeights, err := WriteHeights(root, terrain, &Edges{Now: ring})
	if err != nil {
		return nil, err
	}
	return Rewrite(withHeights, ch)
}

// chunkHeights returns the 145 samples of chunk (cx, cy) from the tile's outer grid.
func chunkHeights(outer []float32, cx, cy int) [HeightCount]float32 {
	const lattice = ChunksPerTile*CellsPerChunk + 1
	at := func(r, c int) float32 { return outer[(cy*CellsPerChunk+r)*lattice+cx*CellsPerChunk+c] }
	var out [HeightCount]float32
	for row := 0; row < CellsPerChunk+1; row++ {
		for col := 0; col < CellsPerChunk+1; col++ {
			out[row*17+col] = at(row, col)
		}
		if row < CellsPerChunk {
			for col := 0; col < CellsPerChunk; col++ {
				out[row*17+9+col] = (at(row, col) + at(row, col+1) + at(row+1, col) + at(row+1, col+1)) / 4
			}
		}
	}
	return out
}

// newTileRoot returns a flat tile with no textures or models: the file's chunks in the game's order,
// with each chunk's header placed as the game places it.
func newTileRoot(tileX, tileY int) []byte {
	var out []byte
	add := func(id string, data []byte) {
		var head [8]byte
		head[0], head[1], head[2], head[3] = id[3], id[2], id[1], id[0]
		binary.LittleEndian.PutUint32(head[4:], uint32(len(data)))
		out = append(out, head[:]...)
		out = append(out, data...)
	}
	add("MVER", []byte{18, 0, 0, 0})
	add("MHDR", make([]byte, 64))
	add("MCIN", make([]byte, ChunkCount*16))
	for _, id := range []string{"MTEX", "MMDX", "MMID", "MWMO", "MWID", "MDDF", "MODF"} {
		add(id, nil)
	}
	const (
		heightLen = 8 + HeightCount*4 // MCVT with its header
		normalLen = 8 + 448           // MCNR with the 13 bytes of padding the game's files carry
	)
	for cy := 0; cy < ChunksPerTile; cy++ {
		for cx := 0; cx < ChunksPerTile; cx++ {
			payload := make([]byte, mcnkHeaderLen)
			put := func(off int, v uint32) { binary.LittleEndian.PutUint32(payload[off:], v) }
			put(0x04, uint32(cx))
			put(0x08, uint32(cy))
			ofsHeight := mcnkHeaderLen + 8
			ofsNormal := ofsHeight + heightLen
			ofsRefs := ofsNormal + normalLen
			put(0x14, uint32(ofsHeight))
			put(0x18, uint32(ofsNormal))
			put(0x20, uint32(ofsRefs))
			// The chunk's corner, as the game measures it: from the map's zero point, minus the
			// tile and chunk offsets.
			pos := [3]float32{
				float32(ZeroPoint - float64(tileY)*TileSize - float64(cy)*chunkWidth),
				float32(ZeroPoint - float64(tileX)*TileSize - float64(cx)*chunkWidth),
				0,
			}
			putVec(payload[0x68:], pos)
			mcvt := make([]byte, HeightCount*4)
			// Flat ground faces straight up: normal (0, 0, 127) at every sample.
			mcnr := make([]byte, 448)
			for s := 0; s < HeightCount; s++ {
				mcnr[s*3+2] = 127
			}
			chunk := append([]byte(nil), payload...)
			chunk = appendSub(chunk, "MCVT", mcvt, HeightCount*4)
			chunk = appendSub(chunk, "MCNR", mcnr, HeightCount*3)
			chunk = appendSub(chunk, "MCRF", nil, 0)
			add("MCNK", chunk)
		}
	}
	return out
}

// appendSub adds a sub-chunk to an MCNK payload: its header, which says size bytes, then its data,
// which may be longer (MCNR's is padded past its size, as the game's files are).
func appendSub(payload []byte, id string, data []byte, size int) []byte {
	var head [8]byte
	head[0], head[1], head[2], head[3] = id[3], id[2], id[1], id[0]
	binary.LittleEndian.PutUint32(head[4:], uint32(size))
	return append(append(payload, head[:]...), data...)
}

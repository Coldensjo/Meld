package wow

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"strings"

	"Meld/internal/adt"
)

// The world view (#15) streams a map's tiles around the camera, each read on its own: the ground of
// one tile, without its paint or models, which the minimap image stands in for.

// GroundSide is the outer height samples a side of a tile: 16 chunks of 8 cells, and the far edge.
const GroundSide = adt.ChunksPerTile*adt.CellsPerChunk + 1

// groundCells is the cells a side of a tile.
const groundCells = GroundSide - 1

// TileGround reads a tile's ground: its outer height samples, GroundSide x GroundSide, row by row
// (rows run south, samples east), in absolute yards, and its holes, a byte a cell (1 for a hole) in
// the same order. A chunk the tile lacks leaves its samples at 0.
func TileGround(root []byte) (heights []float32, holes []byte, err error) {
	ter, err := adt.ParseTerrain(root)
	if err != nil {
		return nil, nil, err
	}
	heights = make([]float32, GroundSide*GroundSide)
	holes = make([]byte, groundCells*groundCells)
	for _, ch := range ter.Chunks {
		if ch.IndexX < 0 || ch.IndexY < 0 || ch.IndexX >= adt.ChunksPerTile || ch.IndexY >= adt.ChunksPerTile {
			continue
		}
		// The 9x9 outer samples sit at the even rows of the 17 interleaved rows (9 + 8).
		for r := 0; r <= adt.CellsPerChunk; r++ {
			for q := 0; q <= adt.CellsPerChunk; q++ {
				x := ch.IndexX*adt.CellsPerChunk + q
				y := ch.IndexY*adt.CellsPerChunk + r
				heights[y*GroundSide+x] = ch.Heights[r*17+q]
			}
		}
		for r, bits := range ch.Holes {
			for q := 0; q < adt.CellsPerChunk; q++ {
				if bits&(1<<q) != 0 {
					holes[(ch.IndexY*adt.CellsPerChunk+r)*groundCells+ch.IndexX*adt.CellsPerChunk+q] = 1
				}
			}
		}
	}
	return heights, holes, nil
}

// EncodeGround is the /wow/ground reply: "GRND", the heights as little-endian float32, then the holes.
func EncodeGround(heights []float32, holes []byte) []byte {
	out := make([]byte, 4+len(heights)*4+len(holes))
	copy(out, "GRND")
	for i, h := range heights {
		binary.LittleEndian.PutUint32(out[4+i*4:], math.Float32bits(h))
	}
	copy(out[4+len(heights)*4:], holes)
	return out
}

// Ground is tile (x, y) of map mapName (its folder name) as EncodeGround writes it, read through
// Meld's patch as the client reads it. A tile the map lacks is mpq.ErrNotFound.
func (c *Client) Ground(mapName string, x, y int) ([]byte, error) {
	if mapName == "" || strings.ContainsAny(mapName, `\/`) {
		return nil, errors.New("bad map name")
	}
	if x < 0 || y < 0 || x >= MapTilesPerSide || y >= MapTilesPerSide {
		return nil, fmt.Errorf("tile %d_%d is off the map", x, y)
	}
	path := adt.TilePath(mapName, x, y, "")
	return c.cached("ground:"+strings.ToLower(path), func() ([]byte, error) {
		raw, err := c.read(path)
		if err != nil {
			return nil, err
		}
		h, holes, err := TileGround(raw)
		if err != nil {
			return nil, fmt.Errorf("tile %d_%d: %w", x, y, err)
		}
		return EncodeGround(h, holes), nil
	})
}

package wow

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	"Meld/internal/adt"
)

// The world view (#15) streams a map's tiles around the camera, each read on its own: the ground of
// one tile, without its paint, which the minimap image stands in for, and its models.

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

// tilePath is the archive path of tile (x, y) of map mapName (its folder name), checked.
func tilePath(mapName string, x, y int) (string, error) {
	if mapName == "" || strings.ContainsAny(mapName, `\/`) {
		return "", errors.New("bad map name")
	}
	if x < 0 || y < 0 || x >= MapTilesPerSide || y >= MapTilesPerSide {
		return "", fmt.Errorf("tile %d_%d is off the map", x, y)
	}
	return adt.TilePath(mapName, x, y, ""), nil
}

// Ground is tile (x, y) of map mapName (its folder name) as EncodeGround writes it, read through
// Meld's patch as the client reads it. A tile the map lacks is mpq.ErrNotFound.
func (c *Client) Ground(mapName string, x, y int) ([]byte, error) {
	path, err := tilePath(mapName, x, y)
	if err != nil {
		return nil, err
	}
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

// TileModel is a model a tile places, as the world view places it: in the map's editor coordinates
// (vmangos.ObjectView's for a block at tile 0_0, so x and z run east and south from the map's
// north-west corner) with y its absolute height, its turn as adt.Placement.EditorTurn gives it, and
// UID the file's unique ID, under which every tile its bounds overlap lists it.
type TileModel struct {
	UID   uint32  `json:"uid"`
	Type  string  `json:"type"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
	RotY  float32 `json:"rotY"`
	TiltX float32 `json:"tiltX"`
	TiltZ float32 `json:"tiltZ"`
	Scale float32 `json:"scale"`
}

// TileModels reads the M2 and WMO placements of a tile's root file as TileModels.
func TileModels(root []byte) ([]TileModel, error) {
	ps, err := adt.ParsePlacements(root)
	if err != nil {
		return nil, err
	}
	out := make([]TileModel, 0, len(ps))
	for _, p := range ps {
		if p.Name == "" {
			continue
		}
		m := TileModel{UID: p.UID, Type: adt.ModelType(p.Kind, p.Name, p.DoodadSet), X: p.Position[0], Y: p.Position[1], Z: p.Position[2], Scale: p.Scale}
		m.RotY, m.TiltX, m.TiltZ = p.EditorTurn()
		out = append(out, m)
	}
	return out, nil
}

// GroundModels is tile (x, y)'s models as JSON (TileModels), read through Meld's patch as Ground is.
func (c *Client) GroundModels(mapName string, x, y int) ([]byte, error) {
	path, err := tilePath(mapName, x, y)
	if err != nil {
		return nil, err
	}
	return c.cached("groundmodels:"+strings.ToLower(path), func() ([]byte, error) {
		raw, err := c.read(path)
		if err != nil {
			return nil, err
		}
		models, err := TileModels(raw)
		if err != nil {
			return nil, fmt.Errorf("tile %d_%d: %w", x, y, err)
		}
		return json.Marshal(models)
	})
}

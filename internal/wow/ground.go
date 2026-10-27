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

// Ground is a tile's ground as the world view reads it. Heights is its outer height samples,
// GroundSide x GroundSide, row by row (rows run south, samples east), in absolute yards. Holes and
// NoEffect are a byte a cell in the same order, groundCells squared: 1 for a hole, and 1 where the
// chunk's noEffectDoodad bit says no ground effect grows (the "no tufts" bit). Areas and Impassable
// are a value a chunk, 16x16 chunks row by row: its AreaTable ID, and 1 where its header flags it
// impassable. A chunk the tile lacks leaves its samples, area and bits at 0.
type Ground struct {
	Heights    []float32
	Holes      []byte
	NoEffect   []byte
	Areas      []uint32
	Impassable []byte
}

// TileGround reads a tile's ground (Ground).
func TileGround(root []byte) (Ground, error) {
	ter, err := adt.ParseTerrain(root)
	if err != nil {
		return Ground{}, err
	}
	const chunks = adt.ChunksPerTile * adt.ChunksPerTile
	g := Ground{
		Heights:    make([]float32, GroundSide*GroundSide),
		Holes:      make([]byte, groundCells*groundCells),
		NoEffect:   make([]byte, groundCells*groundCells),
		Areas:      make([]uint32, chunks),
		Impassable: make([]byte, chunks),
	}
	for _, ch := range ter.Chunks {
		if ch.IndexX < 0 || ch.IndexY < 0 || ch.IndexX >= adt.ChunksPerTile || ch.IndexY >= adt.ChunksPerTile {
			continue
		}
		// The 9x9 outer samples sit at the even rows of the 17 interleaved rows (9 + 8).
		for r := 0; r <= adt.CellsPerChunk; r++ {
			for q := 0; q <= adt.CellsPerChunk; q++ {
				x := ch.IndexX*adt.CellsPerChunk + q
				y := ch.IndexY*adt.CellsPerChunk + r
				g.Heights[y*GroundSide+x] = ch.Heights[r*17+q]
			}
		}
		for r := 0; r < adt.CellsPerChunk; r++ {
			row := (ch.IndexY*adt.CellsPerChunk+r)*groundCells + ch.IndexX*adt.CellsPerChunk
			for q := 0; q < adt.CellsPerChunk; q++ {
				if ch.Holes[r]&(1<<q) != 0 {
					g.Holes[row+q] = 1
				}
				if ch.NoEffect[r]&(1<<q) != 0 {
					g.NoEffect[row+q] = 1
				}
			}
		}
		c := ch.IndexY*adt.ChunksPerTile + ch.IndexX
		g.Areas[c] = ch.AreaID
		if ch.Impassable() {
			g.Impassable[c] = 1
		}
	}
	return g, nil
}

// EncodeGround is the /wow/ground reply: "GRND", the heights as little-endian float32, the holes,
// the chunks' area IDs as little-endian uint32 (at a 4-byte offset, since the holes are a multiple
// of 4 bytes), the chunks' impassable bytes, then the no-effect bytes.
func EncodeGround(g Ground) []byte {
	out := make([]byte, 4+len(g.Heights)*4+len(g.Holes)+len(g.Areas)*4+len(g.Impassable)+len(g.NoEffect))
	copy(out, "GRND")
	at := 4
	for _, h := range g.Heights {
		binary.LittleEndian.PutUint32(out[at:], math.Float32bits(h))
		at += 4
	}
	at += copy(out[at:], g.Holes)
	for _, a := range g.Areas {
		binary.LittleEndian.PutUint32(out[at:], a)
		at += 4
	}
	at += copy(out[at:], g.Impassable)
	copy(out[at:], g.NoEffect)
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
		g, err := TileGround(raw)
		if err != nil {
			return nil, fmt.Errorf("tile %d_%d: %w", x, y, err)
		}
		return EncodeGround(g), nil
	})
}

// PaintPerChunk is the paint texels a side of a chunk, as the editor holds a chunk's paint: each the
// box average of a 2x2 block of the 64x64 alpha maps (tilePaint in frontend/src/lib/io/tileImport.ts).
const PaintPerChunk = adt.AlphaSize / 2

// PaintSide is the paint texels a side of a tile.
const PaintSide = adt.ChunksPerTile * PaintPerChunk

// NoSlot marks an empty slot of a chunk (the editor's NO_TEXTURE).
const NoSlot = 255

// TilePaint reads a tile's texture layers as the world view draws them near the camera (#15): the
// textures the tile names, each chunk's four slots (an index into them, NoSlot for none; 16x16 chunks,
// rows running south) and every texel's four weights, PaintSide squared, as the editor reads them
// (adt.ClientWeights, the same as tilePaint gives a region). A chunk with no layer has no slot and its
// first weight full, which the world view draws in a bare colour.
func TilePaint(root []byte, bigAlpha bool) (names []string, slots, weights []byte, err error) {
	ter, err := adt.ParseTerrain(root)
	if err != nil {
		return nil, nil, nil, err
	}
	tex, err := adt.ParseTextures(root, bigAlpha, ter)
	if err != nil {
		return nil, nil, nil, err
	}
	slots = make([]byte, adt.ChunksPerTile*adt.ChunksPerTile*4)
	for i := range slots {
		slots[i] = NoSlot
	}
	weights = make([]byte, PaintSide*PaintSide*4)
	for i := 0; i < len(weights); i += 4 {
		weights[i] = 255
	}
	index := map[string]int{}
	for i, ch := range ter.Chunks {
		if i >= len(tex.Chunks) || ch.IndexX < 0 || ch.IndexY < 0 || ch.IndexX >= adt.ChunksPerTile || ch.IndexY >= adt.ChunksPerTile {
			continue
		}
		own := tex.Chunks[i]
		n := min(len(own.Layers), 4)
		if n == 0 {
			continue
		}
		c := ch.IndexY*adt.ChunksPerTile + ch.IndexX
		for k, l := range own.Layers[:n] {
			at, ok := index[l.Texture]
			if !ok {
				if len(names) >= NoSlot {
					return nil, nil, nil, fmt.Errorf("the tile names more than %d textures", NoSlot)
				}
				at = len(names)
				index[l.Texture] = at
				names = append(names, l.Texture)
			}
			slots[c*4+k] = byte(at)
		}
		w := adt.ClientWeights(own, PaintPerChunk)
		for v := 0; v < PaintPerChunk; v++ {
			row := ((ch.IndexY*PaintPerChunk+v)*PaintSide + ch.IndexX*PaintPerChunk) * 4
			copy(weights[row:row+PaintPerChunk*4], w[v*PaintPerChunk*4:(v+1)*PaintPerChunk*4])
		}
	}
	return names, slots, weights, nil
}

// EncodePaint is the /wow/groundpaint reply: "PANT", a uint16 count of names, each name as a uint16
// length and its bytes, then the chunks' slots, then the weights (little-endian).
func EncodePaint(names []string, slots, weights []byte) []byte {
	n := 6
	for _, s := range names {
		n += 2 + len(s)
	}
	out := make([]byte, n, n+len(slots)+len(weights))
	copy(out, "PANT")
	binary.LittleEndian.PutUint16(out[4:], uint16(len(names)))
	at := 6
	for _, s := range names {
		binary.LittleEndian.PutUint16(out[at:], uint16(len(s)))
		at += 2 + copy(out[at+2:], s)
	}
	out = append(out, slots...)
	return append(out, weights...)
}

// GroundPaint is tile (x, y)'s texture layers as EncodePaint writes them, read through Meld's patch as
// Ground is.
func (c *Client) GroundPaint(mapName string, x, y int) ([]byte, error) {
	path, err := tilePath(mapName, x, y)
	if err != nil {
		return nil, err
	}
	return c.cached("groundpaint:"+strings.ToLower(path), func() ([]byte, error) {
		raw, err := c.read(path)
		if err != nil {
			return nil, err
		}
		// The WDT says whether the alpha maps are 8-bit; a map with tiles has one.
		bigAlpha := false
		if wdt, err := c.read(fmt.Sprintf(`World\Maps\%s\%s.wdt`, mapName, mapName)); err == nil {
			bigAlpha = adt.ReadBigAlpha(wdt)
		}
		names, slots, weights, err := TilePaint(raw, bigAlpha)
		if err != nil {
			return nil, fmt.Errorf("tile %d_%d: %w", x, y, err)
		}
		return EncodePaint(names, slots, weights), nil
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

// LiquidLayerSize is the bytes of one layer in EncodeLiquids' reply: the chunk's place, the type and a
// pad byte, the 81 surface heights (float32), the 81 depths and the 64 cells (1 where covered).
const LiquidLayerSize = 4 + liquidVerts*4 + liquidVerts + adt.CellsPerChunk*adt.CellsPerChunk

// liquidVerts is the 9x9 vertices of a liquid layer.
const liquidVerts = len(adt.Liquid{}.Heights)

// EncodeLiquids is the /wow/groundliquids reply: "LIQD", a uint16 count of layers, then each layer as
// LiquidLayerSize bytes (little-endian): indexX, indexY, type, 0, the heights, the depths, the cells.
func EncodeLiquids(layers []adt.Liquid) []byte {
	out := make([]byte, 6+len(layers)*LiquidLayerSize)
	copy(out, "LIQD")
	binary.LittleEndian.PutUint16(out[4:], uint16(len(layers)))
	at := 6
	for _, l := range layers {
		out[at], out[at+1], out[at+2] = byte(l.IndexX), byte(l.IndexY), byte(l.Type)
		at += 4
		for _, h := range l.Heights {
			binary.LittleEndian.PutUint32(out[at:], math.Float32bits(h))
			at += 4
		}
		at += copy(out[at:], l.Depth[:])
		for _, on := range l.Cells {
			if on {
				out[at] = 1
			}
			at++
		}
	}
	return out
}

// GroundLiquids is tile (x, y)'s liquids (MCLQ, adt.ParseLiquids: each chunk's layers as the client
// stores them) as EncodeLiquids writes them, read through Meld's patch as Ground is.
func (c *Client) GroundLiquids(mapName string, x, y int) ([]byte, error) {
	path, err := tilePath(mapName, x, y)
	if err != nil {
		return nil, err
	}
	return c.cached("groundliquids:"+strings.ToLower(path), func() ([]byte, error) {
		raw, err := c.read(path)
		if err != nil {
			return nil, err
		}
		layers, err := adt.ParseLiquids(raw)
		if err != nil {
			return nil, fmt.Errorf("tile %d_%d: %w", x, y, err)
		}
		if len(layers) > math.MaxUint16 {
			return nil, fmt.Errorf("tile %d_%d: %d liquid layers", x, y, len(layers))
		}
		return EncodeLiquids(layers), nil
	})
}

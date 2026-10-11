package vmangos

import (
	"fmt"

	"WorldEditor/internal/adt"
	"WorldEditor/internal/mpq"
)

// LatticeSize is the side of a tile's outer height grid: 129 samples across.
const LatticeSize = adt.ChunksPerTile*adt.CellsPerChunk + 1

// LayerView is one texture layer of a chunk, for the editor.
type LayerView struct {
	Texture string `json:"texture"`
	Effect  uint32 `json:"effect"`
	// Alpha is the 64x64 alpha map of every layer but the first, row-major. Nil for the base layer.
	Alpha []byte `json:"alpha,omitempty"`
}

// ChunkView is one 8x8-cell chunk of a tile, for the editor.
type ChunkView struct {
	IndexX int         `json:"indexX"`
	IndexY int         `json:"indexY"`
	AreaID uint32      `json:"areaId"`
	Layers []LayerView `json:"layers"`
}

// TileView is a tile as the editor reads it. Heights is the outer grid (LatticeSize squared,
// row-major, rows running south); the inner samples stay in the file.
type TileView struct {
	MapName    string          `json:"mapName"`
	X          int             `json:"x"`
	Y          int             `json:"y"`
	Heights    []float32       `json:"heights"`
	Chunks     []ChunkView     `json:"chunks"`
	Placements []adt.Placement `json:"placements"`
}

// ReadTile opens a client's data folder and reads the tile at (x, y) of the named map.
func ReadTile(dataDir, mapName string, x, y int) (*TileView, []byte, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, nil, err
	}
	defer set.Close()
	root, err := set.ReadFile(adt.TilePath(mapName, x, y, ""))
	if err != nil {
		return nil, nil, err
	}
	wdt, err := set.ReadFile(fmt.Sprintf(`World\Maps\%s\%s.wdt`, mapName, mapName))
	if err != nil {
		return nil, nil, err
	}
	view, err := viewOf(root, adt.ReadBigAlpha(wdt))
	if err != nil {
		return nil, nil, err
	}
	view.MapName, view.X, view.Y = mapName, x, y
	return view, root, nil
}

// viewOf turns a tile's root file into what the editor shows.
func viewOf(root []byte, bigAlpha bool) (*TileView, error) {
	terrain, err := adt.ParseTerrain(root)
	if err != nil {
		return nil, err
	}
	textures, err := adt.ParseTextures(root, bigAlpha, terrain)
	if err != nil {
		return nil, err
	}
	placements, err := adt.ParsePlacements(root)
	if err != nil {
		return nil, err
	}
	view := &TileView{Heights: make([]float32, LatticeSize*LatticeSize), Placements: placements}
	for i, c := range terrain.Chunks {
		for r := 0; r <= adt.CellsPerChunk; r++ {
			for col := 0; col <= adt.CellsPerChunk; col++ {
				gr, gc := c.IndexY*adt.CellsPerChunk+r, c.IndexX*adt.CellsPerChunk+col
				view.Heights[gr*LatticeSize+gc] = c.Heights[r*17+col]
			}
		}
		cv := ChunkView{IndexX: c.IndexX, IndexY: c.IndexY, AreaID: c.AreaID}
		for l, layer := range textures.Chunks[i].Layers {
			lv := LayerView{Texture: layer.Texture, Effect: layer.Effect}
			if l > 0 {
				lv.Alpha = textures.Chunks[i].Alpha[l-1]
			}
			cv.Layers = append(cv.Layers, lv)
		}
		view.Chunks = append(view.Chunks, cv)
	}
	return view, nil
}

// PatchTileHeights returns root with its outer heights replaced by outer (LatticeSize squared,
// as TileView has them). Shared edge samples are written into both chunks that hold them.
func PatchTileHeights(root []byte, outer []float32) ([]byte, error) {
	if len(outer) != LatticeSize*LatticeSize {
		return nil, fmt.Errorf("vmangos: %d heights for a tile, want %d", len(outer), LatticeSize*LatticeSize)
	}
	terrain, err := adt.ParseTerrain(root)
	if err != nil {
		return nil, err
	}
	for i := range terrain.Chunks {
		c := &terrain.Chunks[i]
		for r := 0; r <= adt.CellsPerChunk; r++ {
			for col := 0; col <= adt.CellsPerChunk; col++ {
				gr, gc := c.IndexY*adt.CellsPerChunk+r, c.IndexX*adt.CellsPerChunk+col
				c.Heights[r*17+col] = outer[gr*LatticeSize+gc]
			}
		}
	}
	return adt.WriteHeights(root, terrain)
}

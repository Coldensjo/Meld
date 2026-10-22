package vmangos

import (
	"fmt"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// LatticeSize is the side of a tile's outer height grid: 129 samples across.
const LatticeSize = adt.ChunksPerTile*adt.CellsPerChunk + 1

// AlphaBytes is the size of a layer's alpha map: 64x64, row-major, 0-255.
const AlphaBytes = adt.AlphaSize * adt.AlphaSize

// LayerView is one texture layer of a chunk, for the editor. Every layer but a chunk's first has an
// alpha map, kept apart in the view's Alpha (TileView, RegionView).
type LayerView struct {
	Texture string `json:"texture"`
	Effect  uint32 `json:"effect"`
}

// ChunkView is one 8x8-cell chunk of a tile, for the editor.
type ChunkView struct {
	IndexX int    `json:"indexX"`
	IndexY int    `json:"indexY"`
	AreaID uint32 `json:"areaId"`
	// Impassable says the chunk's header flags it as impassable.
	Impassable bool        `json:"impassable,omitempty"`
	Layers     []LayerView `json:"layers"`
	// Holes has one entry per cell row; bit n set means cell n of that row is a hole (a cave mouth).
	// Ints rather than bytes, since a byte slice would travel as base64.
	Holes []int `json:"holes,omitempty"`
	// NoEffect has one entry per cell row; bit n set means cell n grows no ground effect doodads.
	NoEffect []int `json:"noEffect,omitempty"`
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
	// Liquids are the chunks with water, in the tile's chunk indexes.
	Liquids []adt.Liquid `json:"liquids"`
	// Alpha is the alpha maps of every layer but each chunk's first, AlphaBytes each, in chunk then
	// layer order.
	Alpha []byte `json:"-"`
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
	liquids, err := adt.ParseLiquids(root)
	if err != nil {
		return nil, err
	}
	view := &TileView{Heights: make([]float32, LatticeSize*LatticeSize), Placements: placements, Liquids: liquids}
	for i, c := range terrain.Chunks {
		for r := 0; r <= adt.CellsPerChunk; r++ {
			for col := 0; col <= adt.CellsPerChunk; col++ {
				gr, gc := c.IndexY*adt.CellsPerChunk+r, c.IndexX*adt.CellsPerChunk+col
				view.Heights[gr*LatticeSize+gc] = c.Heights[r*17+col]
			}
		}
		cv := ChunkView{IndexX: c.IndexX, IndexY: c.IndexY, AreaID: c.AreaID, Impassable: c.Impassable()}
		cv.Holes = rowBits(c.Holes)
		cv.NoEffect = rowBits(c.NoEffect)
		for l, layer := range textures.Chunks[i].Layers {
			cv.Layers = append(cv.Layers, LayerView{Texture: layer.Texture, Effect: layer.Effect})
			if l > 0 {
				view.Alpha = append(view.Alpha, textures.Chunks[i].Alpha[l-1]...)
			}
		}
		view.Chunks = append(view.Chunks, cv)
	}
	return view, nil
}

// rowBits turns a chunk's per-row cell bits into ints for the bridge; nil when no bit is set.
func rowBits(rows [adt.CellsPerChunk]uint8) []int {
	for _, row := range rows {
		if row != 0 {
			out := make([]int, len(rows))
			for i, r := range rows {
				out[i] = int(r)
			}
			return out
		}
	}
	return nil
}

// SculptedEps is how far (in yards) a cell's corner must move from the client's tile for the cell to
// count as sculpted, above float noise (#380).
const SculptedEps = 1e-3

// PatchTileHeights returns root with its outer heights replaced by outer (LatticeSize squared,
// as TileView has them). Shared edge samples are written into both chunks that hold them. A cell
// whose corners all keep the client's heights keeps its inner sample (the client's detail at the
// cell's middle); a sculpted one, any corner moved by more than SculptedEps, has it at the corners'
// mean, as the editor shows the cell (#380). edges is the neighbouring tiles' heights just across the
// border, as they will be and as the tile's normals were made against (adt.Edges, #492), or nil.
func PatchTileHeights(root []byte, outer []float32, edges *adt.Edges) ([]byte, error) {
	if len(outer) != LatticeSize*LatticeSize {
		return nil, fmt.Errorf("vmangos: %d heights for a tile, want %d", len(outer), LatticeSize*LatticeSize)
	}
	terrain, err := adt.ParseTerrain(root)
	if err != nil {
		return nil, err
	}
	patchHeights(terrain, outer)
	return adt.WriteHeights(root, terrain, edges)
}

// patchHeights puts outer into terrain's chunks as PatchTileHeights writes them, with each cell's inner
// sample kept or set to its corners' mean. blockEdges runs it on a neighbour in the block too, for the
// inner samples across a tile's border, so both tiles see the same heights to the bit.
func patchHeights(terrain *adt.Terrain, outer []float32) {
	for i := range terrain.Chunks {
		c := &terrain.Chunks[i]
		// The change at each outer sample. The inner samples sit between four outer ones: an
		// untouched cell's moves by the (float noise) average change of those four, so an unedited
		// tile keeps its detail exactly, and a sculpted cell's goes to the four's mean.
		var delta [adt.CellsPerChunk + 1][adt.CellsPerChunk + 1]float32
		for r := 0; r <= adt.CellsPerChunk; r++ {
			for col := 0; col <= adt.CellsPerChunk; col++ {
				gr, gc := c.IndexY*adt.CellsPerChunk+r, c.IndexX*adt.CellsPerChunk+col
				next := outer[gr*LatticeSize+gc]
				delta[r][col] = next - c.Heights[r*17+col]
				c.Heights[r*17+col] = next
			}
		}
		for r := 0; r < adt.CellsPerChunk; r++ {
			for col := 0; col < adt.CellsPerChunk; col++ {
				d0, d1, d2, d3 := delta[r][col], delta[r][col+1], delta[r+1][col], delta[r+1][col+1]
				if sculpted(d0) || sculpted(d1) || sculpted(d2) || sculpted(d3) {
					h := &c.Heights
					c.Heights[r*17+9+col] = (h[r*17+col] + h[r*17+col+1] + h[(r+1)*17+col] + h[(r+1)*17+col+1]) / 4
					continue
				}
				c.Heights[r*17+9+col] += (d0 + d1 + d2 + d3) / 4
			}
		}
	}
}

// sculpted says a corner's change d moves it off the client's height (#380).
func sculpted(d float32) bool { return d > SculptedEps || d < -SculptedEps }

// BaseTileRoot returns a tile's file as the client has it without Meld's patch (Blizzard's patch.MPQ
// and patch-2.MPQ still apply), the file a save rebuilds from.
func BaseTileRoot(dataDir, mapName string, x, y int) ([]byte, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	return readUnpatched(set, adt.TilePath(mapName, x, y, ""))
}

// readUnpatched reads name from the client's archives as if Meld's patch weren't there: the game's
// files with Blizzard's own patches applied, without Meld's earlier exports (#273).
func readUnpatched(set *mpq.Set, name string) ([]byte, error) {
	return set.ReadFileExcept(name, PatchName)
}

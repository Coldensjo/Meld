package vmangos

import (
	"errors"
	"fmt"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// MinimapSide is the size of a client minimap tile in pixels.
const MinimapSide = 256

// MinimapTile is a rendered map tile for the client's minimap (B-129): its place on the 64x64 grid
// and its picture, MinimapSide pixels a side of RGBA (base64 in JSON), row 0 at the tile's north
// edge and column 0 at its west.
type MinimapTile struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Pixels []byte `json:"pixels" ts_type:"string"`
}

// MinimapFiles are the patch files that put tiles into the client's minimap for the map whose folder
// is mapDir: each tile as a BLP stored under the md5 of its bytes (textures\Minimap\<md5>.blp, so
// identical tiles share a file, as the client's do), and md5translate.trs with the tiles' rows set,
// read from the client first so every other map keeps its rows.
func MinimapFiles(dataDir, mapDir string, tiles []MinimapTile) ([]mpq.File, error) {
	if mapDir == "" {
		return nil, errors.New("no map folder for the minimap")
	}
	if len(tiles) == 0 {
		return nil, errors.New("no minimap tiles")
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	raw, err := set.ReadFile(wow.MinimapIndexPath)
	set.Close()
	if err != nil {
		return nil, fmt.Errorf("the client's minimap index: %w", err)
	}
	index := wow.ParseMinimapIndex(raw)
	var files []mpq.File
	stored := map[string]bool{}
	for _, t := range tiles {
		if t.X < 0 || t.X >= MapTiles || t.Y < 0 || t.Y >= MapTiles {
			return nil, fmt.Errorf("minimap tile %d,%d is outside the 64x64 map", t.X, t.Y)
		}
		if len(t.Pixels) != MinimapSide*MinimapSide*4 {
			return nil, fmt.Errorf("minimap tile %d,%d is %d bytes, want %d", t.X, t.Y, len(t.Pixels), MinimapSide*MinimapSide*4)
		}
		blp, err := wow.EncodeMinimapBLP(t.Pixels, MinimapSide, MinimapSide)
		if err != nil {
			return nil, err
		}
		name := wow.MinimapFileName(blp)
		index.Set(wow.MinimapTileName(mapDir, t.X, t.Y), name)
		if !stored[name] {
			stored[name] = true
			files = append(files, mpq.File{Name: `textures\Minimap\` + name, Data: blp})
		}
	}
	return append(files, mpq.File{Name: wow.MinimapIndexPath, Data: index.Bytes()}), nil
}

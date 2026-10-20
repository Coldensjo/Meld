package vmangos

import (
	"encoding/base64"
	"encoding/binary"
	"math"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// RegionInner is how far each cell's middle (its MCVT inner sample) lies above the mean of the cell's
// four corners in a region's tiles, which the editor's grid doesn't hold (#284). The server's map is
// built with four triangles a cell about that middle, and the export moves it by the mean change of
// the corners (PatchTileHeights), so the middle of a cell the editor shows is that mean plus its lift,
// sculpted or not. Side cells a side, rows running south; Lifts is base64 of Side*Side little-endian
// float32s, empty when every middle is its corners' mean (a tile Meld built).
type RegionInner struct {
	Side  int    `json:"side"`
	Lifts string `json:"lifts"`
}

// ReadRegionInner reads the inner height lifts of the size x size block of tiles at (x, y) of the
// named map, from the tiles a save starts from (without Meld's patch, or Meld's own where only it has
// the tile), so they are the ones the export keeps.
func ReadRegionInner(dataDir, mapName string, x, y, size int) (*RegionInner, error) {
	if err := checkRegion(x, y, size); err != nil {
		return nil, err
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	side := size * tileCells
	lifts := make([]float32, side*side)
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			name := adt.TilePath(mapName, x+i, y+j, "")
			root, err := readUnpatched(set, name)
			if err != nil {
				root, err = set.ReadFile(name)
			}
			if err != nil {
				return nil, err
			}
			terrain, err := adt.ParseTerrain(root)
			if err != nil {
				return nil, err
			}
			innerLifts(terrain, lifts, side, i*tileCells, j*tileCells)
		}
	}
	out := &RegionInner{Side: side}
	b := make([]byte, 4*len(lifts))
	any := false
	for k, v := range lifts {
		if v != 0 {
			any = true
		}
		binary.LittleEndian.PutUint32(b[4*k:], math.Float32bits(v))
	}
	if any {
		out.Lifts = base64.StdEncoding.EncodeToString(b)
	}
	return out, nil
}

// innerLifts writes each cell's inner sample less its corners' mean, for the tile's chunks, into out
// (side cells a side) with the tile's north-west cell at (ox, oy).
func innerLifts(t *adt.Terrain, out []float32, side, ox, oy int) {
	for _, c := range t.Chunks {
		for r := 0; r < adt.CellsPerChunk; r++ {
			for col := 0; col < adt.CellsPerChunk; col++ {
				h := &c.Heights
				mean := (h[r*17+col] + h[r*17+col+1] + h[(r+1)*17+col] + h[(r+1)*17+col+1]) / 4
				gx := ox + c.IndexX*adt.CellsPerChunk + col
				gy := oy + c.IndexY*adt.CellsPerChunk + r
				out[gy*side+gx] = h[r*17+9+col] - mean
			}
		}
	}
}

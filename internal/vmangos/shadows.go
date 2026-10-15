package vmangos

import (
	"encoding/base64"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// RegionShadows is a region's baked terrain shadows (each chunk's MCSH) stitched into one map for the
// editor to draw: Side texels a side (64 a chunk, 8 a cell), one bit a texel, rows running south, bit n
// of a byte the texel n columns into it, as the tiles keep them. Bits is base64 (a byte slice would
// travel as base64 anyway); empty when no chunk of the region has a shadow map.
type RegionShadows struct {
	Side int    `json:"side"`
	Bits string `json:"bits"`
}

// ReadRegionShadows reads the baked shadows of the size x size block of tiles at (x, y) of the named
// map. A chunk without a shadow map stays lit, as the client draws it.
func ReadRegionShadows(dataDir, mapName string, x, y, size int) (*RegionShadows, error) {
	if err := checkRegion(x, y, size); err != nil {
		return nil, err
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	side := size * adt.ChunksPerTile * adt.ShadowSize
	rowBytes := side / 8
	bits := make([]byte, side*rowBytes)
	any := false
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			root, err := set.ReadFile(adt.TilePath(mapName, x+i, y+j, ""))
			if err != nil {
				return nil, err
			}
			terrain, err := adt.ParseTerrain(root)
			if err != nil {
				return nil, err
			}
			for _, c := range terrain.Chunks {
				if c.Shadow == nil {
					continue
				}
				any = true
				gx := (i*adt.ChunksPerTile + c.IndexX) * adt.ShadowSize / 8
				gy := (j*adt.ChunksPerTile + c.IndexY) * adt.ShadowSize
				for r := 0; r < adt.ShadowSize; r++ {
					copy(bits[(gy+r)*rowBytes+gx:], c.Shadow[r*adt.ShadowSize/8:(r+1)*adt.ShadowSize/8])
				}
			}
		}
	}
	out := &RegionShadows{Side: side}
	if any {
		out.Bits = base64.StdEncoding.EncodeToString(bits)
	}
	return out, nil
}

package vmangos

import (
	"fmt"
	"sort"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// TextureUse is a ground texture of a zone and the share of the zone's ground it covers (0 to 1).
type TextureUse struct {
	Path  string  `json:"path"`
	Share float64 `json:"share"`
}

// alphaStep samples every alphaStep-th alpha texel each way: a quarter of them is plenty for shares.
const alphaStep = 2

// ReadZoneTextures reads the ground textures a zone's own tiles use (#733): every chunk of the tiles
// in the zone's rectangle whose area is the zone or one of its subzones, each texture weighted by how
// much of the chunk it shows through the layers above it. Cells under a liquid are left out: the
// seabed is not the zone's look (Tanaris's coast is a third Wetlands dirt). The list is by share,
// largest first.
func ReadZoneTextures(dataDir, mapDir string, z Zone) ([]TextureUse, error) {
	cover := map[string]float64{}
	err := eachZoneTile(dataDir, mapDir, z, func(root []byte, bigAlpha bool, in map[uint32]bool) error {
		return addTileCover(cover, root, bigAlpha, in)
	})
	if err != nil {
		return nil, err
	}
	return sharesOf(cover), nil
}

// eachZoneTile calls fn with the root file of every tile in the zone's rectangle, whether the map's
// alpha maps are big, and the zone's areas (the zone and its subzones).
func eachZoneTile(dataDir, mapDir string, z Zone, fn func(root []byte, bigAlpha bool, in map[uint32]bool) error) error {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return err
	}
	defer set.Close()
	in := map[uint32]bool{z.AreaID: true}
	if b, err := set.ReadFile(`DBFilesClient\AreaTable.dbc`); err == nil {
		if areas, err := ReadAreas(b); err == nil {
			in = zoneAreas(areas, z.AreaID)
		}
	}
	bigAlpha := false
	if wdt, err := set.ReadFile(fmt.Sprintf(`World\Maps\%s\%s.wdt`, mapDir, mapDir)); err == nil {
		bigAlpha = adt.ReadBigAlpha(wdt)
	}
	for y := z.Y0; y < z.Y1; y++ {
		for x := z.X0; x < z.X1; x++ {
			root, err := set.ReadFile(adt.TilePath(mapDir, x, y, ""))
			if err != nil {
				continue
			}
			if err := fn(root, bigAlpha, in); err != nil {
				return fmt.Errorf("tile %d,%d: %w", x, y, err)
			}
		}
	}
	return nil
}

// zoneAreas is the area and every area below it (subzones, and theirs).
func zoneAreas(areas []Area, id uint32) map[uint32]bool {
	in := map[uint32]bool{id: true}
	for grew := true; grew; {
		grew = false
		for _, a := range areas {
			if !in[a.ID] && in[a.Parent] && a.Parent != 0 {
				in[a.ID] = true
				grew = true
			}
		}
	}
	return in
}

// addTileCover adds to cover each texture's visible texels in the tile's chunks of the areas in `in`.
func addTileCover(cover map[string]float64, root []byte, bigAlpha bool, in map[uint32]bool) error {
	terrain, err := adt.ParseTerrain(root)
	if err != nil {
		return err
	}
	textures, err := adt.ParseTextures(root, bigAlpha, terrain)
	if err != nil {
		return err
	}
	wet, err := wetCells(root)
	if err != nil {
		return err
	}
	for i, c := range textures.Chunks {
		if i >= len(terrain.Chunks) || !in[terrain.Chunks[i].AreaID] || len(c.Layers) == 0 {
			continue
		}
		ch := terrain.Chunks[i]
		addChunkCover(cover, c, wet[[2]int{ch.IndexX, ch.IndexY}])
	}
	return nil
}

// wetCells is the cells under a liquid of each chunk of the tile that has one, by the chunk's place.
func wetCells(root []byte) (map[[2]int]*[cellCount]bool, error) {
	liquids, err := adt.ParseLiquids(root)
	if err != nil {
		return nil, err
	}
	wet := map[[2]int]*[cellCount]bool{}
	for _, l := range liquids {
		k := [2]int{l.IndexX, l.IndexY}
		if wet[k] == nil {
			wet[k] = &[cellCount]bool{}
		}
		for c, on := range l.Cells {
			wet[k][c] = wet[k][c] || on
		}
	}
	return wet, nil
}

// cellCount is a chunk's cells, 8 by 8.
const cellCount = adt.CellsPerChunk * adt.CellsPerChunk

// addChunkCover adds a chunk's visible texels per texture: each layer shows its alpha of what the
// layers above it leave, and the base layer the rest. Texels in the cells marked in `wet` (if any)
// are left out.
func addChunkCover(cover map[string]float64, c adt.TexChunk, wet *[cellCount]bool) {
	shown := make([]float64, len(c.Layers))
	per := adt.AlphaSize / adt.CellsPerChunk
	for r := 0; r < adt.AlphaSize; r += alphaStep {
		for col := 0; col < adt.AlphaSize; col += alphaStep {
			if wet != nil && wet[(r/per)*adt.CellsPerChunk+col/per] {
				continue
			}
			left := 1.0
			for l := len(c.Layers) - 1; l >= 1; l-- {
				if l-1 >= len(c.Alpha) {
					continue
				}
				v := left * float64(c.Alpha[l-1][r*adt.AlphaSize+col]) / 255
				shown[l] += v
				left -= v
			}
			shown[0] += left
		}
	}
	for l, s := range shown {
		if p := c.Layers[l].Texture; p != "" && s > 0 {
			cover[p] += s
		}
	}
}

// sharesOf turns texel counts into shares of their total, largest first (then by path).
func sharesOf(cover map[string]float64) []TextureUse {
	total := 0.0
	for _, v := range cover {
		total += v
	}
	out := make([]TextureUse, 0, len(cover))
	if total <= 0 {
		return out
	}
	for p, v := range cover {
		out = append(out, TextureUse{Path: p, Share: v / total})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Share != out[j].Share {
			return out[i].Share > out[j].Share
		}
		return out[i].Path < out[j].Path
	})
	return out
}

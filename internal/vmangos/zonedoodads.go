package vmangos

import (
	"math"
	"sort"

	"Meld/internal/adt"
)

// DoodadUse is a model (M2) placed in a zone: how many times, and at what scales.
type DoodadUse struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
	// ScaleMin and ScaleMax are the smallest and largest scale it is placed at.
	ScaleMin float64 `json:"scaleMin"`
	ScaleMax float64 `json:"scaleMax"`
}

// ZoneDoodadList is the models a zone's tiles place on its dry ground, and that ground's area, so a
// count over the area is how thickly the zone is covered.
type ZoneDoodadList struct {
	Doodads []DoodadUse `json:"doodads"`
	// LandArea is the zone's ground not under a liquid, in square yards.
	LandArea float64 `json:"landArea"`
}

// chunkWidth and cellWidth are a chunk's and a cell's side in yards.
const (
	chunkWidth = adt.TileSize / adt.ChunksPerTile
	cellWidth  = chunkWidth / adt.CellsPerChunk
)

// ReadZoneDoodads reads the models a zone's own tiles place (#758): every M2 placement standing on a
// chunk of the zone or one of its subzones, on a cell no liquid covers, counted by model path (a
// placement listed by two tiles, by its unique ID, once). The list is by count, largest first. Which
// of them are trees, bushes or rocks is the frontend's to sort (wow/zoneTrees.ts).
func ReadZoneDoodads(dataDir, mapDir string, z Zone) (ZoneDoodadList, error) {
	uses := map[string]*DoodadUse{}
	seen := map[uint32]bool{}
	cells := 0
	err := eachZoneTile(dataDir, mapDir, z, func(root []byte, _ bool, in map[uint32]bool) error {
		terrain, err := adt.ParseTerrain(root)
		if err != nil {
			return err
		}
		wet, err := wetCells(root)
		if err != nil {
			return err
		}
		for _, ch := range terrain.Chunks {
			if !in[ch.AreaID] {
				continue
			}
			w := wet[[2]int{ch.IndexX, ch.IndexY}]
			for c := 0; c < cellCount; c++ {
				if w == nil || !w[c] {
					cells++
				}
			}
		}
		placements, err := adt.ParsePlacements(root)
		if err != nil {
			return err
		}
		for _, p := range placements {
			if p.Kind != adt.M2 || p.Name == "" || seen[p.UID] {
				continue
			}
			ch, cell := placementCell(terrain, p.Position)
			if ch == nil || !in[ch.AreaID] {
				continue
			}
			if w := wet[[2]int{ch.IndexX, ch.IndexY}]; w != nil && w[cell] {
				continue
			}
			seen[p.UID] = true
			addDoodadUse(uses, p.Name, float64(p.Scale))
		}
		return nil
	})
	if err != nil {
		return ZoneDoodadList{}, err
	}
	return ZoneDoodadList{Doodads: doodadList(uses), LandArea: float64(cells) * cellWidth * cellWidth}, nil
}

// placementCell is the tile's chunk under a placement at pos (MDDF's own space: x and z across the
// map from its corner) and the cell of it, or nil when the point lies outside the tile.
func placementCell(t *adt.Terrain, pos [3]float32) (*adt.Chunk, int) {
	fx := float64(pos[0]) / chunkWidth
	fz := float64(pos[2]) / chunkWidth
	gx := int(math.Floor(fx))
	gz := int(math.Floor(fz))
	ch := t.At(gx%adt.ChunksPerTile, gz%adt.ChunksPerTile)
	if ch == nil || gx < 0 || gz < 0 {
		return nil, 0
	}
	// The chunk must be this tile's: its corner (the server's x and y) is the placement's chunk corner.
	wantX := adt.ZeroPoint - float64(gz)*chunkWidth
	wantY := adt.ZeroPoint - float64(gx)*chunkWidth
	if math.Abs(float64(ch.Position[0])-wantX) > 1 || math.Abs(float64(ch.Position[1])-wantY) > 1 {
		return nil, 0
	}
	cx := min(adt.CellsPerChunk-1, int((fx-float64(gx))*adt.CellsPerChunk))
	cz := min(adt.CellsPerChunk-1, int((fz-float64(gz))*adt.CellsPerChunk))
	return ch, cz*adt.CellsPerChunk + cx
}

// addDoodadUse counts one placement of path at scale.
func addDoodadUse(uses map[string]*DoodadUse, path string, scale float64) {
	u := uses[path]
	if u == nil {
		uses[path] = &DoodadUse{Path: path, Count: 1, ScaleMin: scale, ScaleMax: scale}
		return
	}
	u.Count++
	u.ScaleMin = math.Min(u.ScaleMin, scale)
	u.ScaleMax = math.Max(u.ScaleMax, scale)
}

// doodadList is the uses by count, largest first (then by path).
func doodadList(uses map[string]*DoodadUse) []DoodadUse {
	out := make([]DoodadUse, 0, len(uses))
	for _, u := range uses {
		out = append(out, *u)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Path < out[j].Path
	})
	return out
}

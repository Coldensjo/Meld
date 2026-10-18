package vmangos

import (
	"encoding/base64"
	"fmt"
	"math"
	"path/filepath"
	"strings"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// tileCells is the cells a side of a 1.12 tile.
const tileCells = adt.ChunksPerTile * adt.CellsPerChunk

// MaxRegion is the most tiles a side a region can have. Past it the editor's paint arrays get too
// large to edit smoothly.
const MaxRegion = 16

// RegionView is a square block of a client map, Size tiles a side from tile (X, Y), as the
// editor shows it. Positions are in yards from the block's north-west corner, so the editor's
// coordinates start at zero.
type RegionView struct {
	MapName string `json:"mapName"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	Size    int    `json:"size"`
	// Heights is the block's outer grid: (Size*128+1) squared, row-major, rows running south.
	Heights []float32 `json:"heights"`
	// Chunks index across the whole block: 16*Size chunks a side.
	Chunks  []ChunkView  `json:"chunks"`
	Objects []ObjectView `json:"objects"`
	// Liquids index across the whole block, like Chunks.
	Liquids []adt.Liquid `json:"liquids"`
	// WMOOnly says the map is one building with no tiles (wmoonly.go): Heights are flat ground under
	// it, which the editor hides, and Objects is the building, its UID GlobalUID.
	WMOOnly bool `json:"wmoOnly"`
	// Bounds, for a WMO-only map, is the building's box in the block's coordinates as the WDT gives it:
	// its lowest corner, then its highest.
	Bounds []float32 `json:"bounds,omitempty"`
}

// ObjectView is a placed model in the block's coordinates. UID is the file's unique ID, or 0 for
// a model that isn't in the client yet. Y is the model's absolute height.
type ObjectView struct {
	UID  uint32  `json:"uid"`
	Type string  `json:"type"`
	X    float32 `json:"x"`
	Y    float32 `json:"y"`
	Z    float32 `json:"z"`
	RotY float32 `json:"rotY"`
	// TiltX and TiltZ are the model's tilt forward and back, and side to side, in radians.
	TiltX float32 `json:"tiltX"`
	TiltZ float32 `json:"tiltZ"`
	Scale float32 `json:"scale"`
}

// RegionEdit is what the editor saves back over a region: its heights and its models.
type RegionEdit struct {
	MapName string       `json:"mapName"`
	X       int          `json:"x"`
	Y       int          `json:"y"`
	Size    int          `json:"size"`
	Heights []float32    `json:"heights"`
	Objects []ObjectView `json:"objects"`
	// Paint is the painted chunks of the block, by block chunk index: the block's chunks in rows of
	// 16*Size, row-major. Chunks not listed keep the paint the client has.
	Paint []RegionPaint `json:"paint"`
	// HasLiquids says Liquids holds the block's liquids: every layer of every chunk, placed in the
	// block like Chunks. A chunk whose layers differ from the client's is rewritten with them, and
	// one left out loses its liquid. Without it, the client's liquids stay as they are.
	HasLiquids bool         `json:"hasLiquids"`
	Liquids    []adt.Liquid `json:"liquids"`
	// PartialLiquids says Liquids holds only some chunks' liquids (a map saved before maps kept
	// them): chunks it has layers for are rewritten, and the rest keep the client's.
	PartialLiquids bool `json:"partialLiquids"`
	// Headers are the zones and impassable flags of the block's chunks, by block chunk index.
	// Chunks not listed keep the client's.
	Headers []HeaderSpec `json:"headers"`
}

// RegionPaint is a painted chunk of a region: its index in the block (rows of 16*Size chunks), its
// textures in slot order, and its weights as PaintSpec has them.
type RegionPaint struct {
	Chunk    int      `json:"chunk"`
	Textures []string `json:"textures"`
	Weights  string   `json:"weights"`
	// Effects is the GroundEffectTexture ID per texture (0 for none, or the tile's own); optional.
	Effects []uint32 `json:"effects,omitempty"`
	// Flags is each texture's look flags (animation, overbright), or -1 to keep the tile's own; optional.
	Flags []int `json:"flags,omitempty"`
	// NoEffect is one entry per cell row, a bit per cell set where no ground effect doodads grow;
	// optional, added to the tile's own bits.
	NoEffect []int `json:"noEffect,omitempty"`
}

// chunkPaint is a chunk's layers from the bridge's textures, effects and weights, with the per-cell
// predominant layer the game grows the effects on and the cells it grows none on.
func chunkPaint(textures []string, effects []uint32, flags []int, noEffect []int, weights []byte, perSide int) adt.ChunkPaint {
	layers := adt.LayersFromWeights(textures, weights, perSide)
	for k := range layers {
		if k < len(effects) {
			layers[k].Effect = effects[k]
		}
		if k < len(flags) && flags[k] >= 0 {
			f := uint32(flags[k]) & adt.LayerLookFlags
			layers[k].Flags = &f
		}
	}
	paint := adt.ChunkPaint{Layers: layers, Predominant: adt.PredominantFromWeights(len(textures), weights, perSide)}
	if len(noEffect) == adt.CellsPerChunk {
		paint.NoEffect = make([]uint8, adt.CellsPerChunk)
		for i, v := range noEffect {
			paint.NoEffect[i] = uint8(v)
		}
	}
	return paint
}

// ChunksPerTileSide is the chunks a side of a tile.
const ChunksPerTileSide = adt.ChunksPerTile

// checkRegion rejects a block that isn't on the 64x64 map or is too big to edit.
func checkRegion(x, y, size int) error {
	if size < 1 || size > MaxRegion {
		return fmt.Errorf("a region is 1 to %d tiles a side, not %d", MaxRegion, size)
	}
	if x < 0 || y < 0 || x+size > MapTiles || y+size > MapTiles {
		return fmt.Errorf("the region at %d,%d of %d tiles is off the 64x64 map", x, y, size)
	}
	return nil
}

// ReadRegion reads the square block of size tiles at (x, y) of the named map, stitching the
// tiles' heights, paint and models together.
func ReadRegion(dataDir, mapName string, x, y, size int) (*RegionView, error) {
	if err := checkRegion(x, y, size); err != nil {
		return nil, err
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	wdt, err := set.ReadFile(fmt.Sprintf(`World\Maps\%s\%s.wdt`, mapName, mapName))
	if err != nil {
		return nil, err
	}
	bigAlpha := adt.ReadBigAlpha(wdt)

	side := size*tileCells + 1
	// Empty, not nil, so a block with no models or no liquid (Naxxramas has none) sends [] and not null.
	view := &RegionView{MapName: mapName, X: x, Y: y, Size: size, Heights: make([]float32, side*side),
		Chunks: []ChunkView{}, Objects: []ObjectView{}, Liquids: []adt.Liquid{}}
	if w, ok := wmoOnlyBuilding(wdt); ok {
		wmoOnlyView(view, w)
		return view, nil
	}
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			tx, ty := x+i, y+j
			root, err := set.ReadFile(adt.TilePath(mapName, tx, ty, ""))
			if err != nil {
				return nil, err
			}
			tile, err := viewOf(root, bigAlpha)
			if err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", tx, ty, err)
			}
			for r := 0; r < LatticeSize; r++ {
				row := (j*tileCells+r)*side + i*tileCells
				copy(view.Heights[row:row+LatticeSize], tile.Heights[r*LatticeSize:(r+1)*LatticeSize])
			}
			for _, c := range tile.Chunks {
				c.IndexX += i * adt.ChunksPerTile
				c.IndexY += j * adt.ChunksPerTile
				view.Chunks = append(view.Chunks, c)
			}
			for _, l := range tile.Liquids {
				l.IndexX += i * adt.ChunksPerTile
				l.IndexY += j * adt.ChunksPerTile
				view.Liquids = append(view.Liquids, l)
			}
			for _, p := range tile.Placements {
				if o, ok := objectView(p, x, y); ok {
					view.Objects = append(view.Objects, o)
				}
			}
		}
	}
	return view, nil
}

// objectView converts a placement in a file to the block's coordinates (the block starts at tile
// (x, y)). The editor's yaw is the file's middle rotation less 90 degrees, as objectIn writes it.
func objectView(p adt.Placement, x, y int) (ObjectView, bool) {
	var o ObjectView
	if p.Kind != adt.M2 && p.Kind != adt.WMO {
		return o, false
	}
	o.Type = modelType(p.Kind, p.Name, p.DoodadSet)
	o.UID = p.UID
	o.X = p.Position[0] - float32(x)*adt.TileSize
	o.Y = p.Position[1]
	o.Z = p.Position[2] - float32(y)*adt.TileSize
	o.RotY = float32((float64(p.Rotation[1]) - 90) * math.Pi / 180)
	o.TiltX = fromDegrees(p.Rotation[0])
	o.TiltZ = fromDegrees(p.Rotation[2])
	o.Scale = p.Scale
	return o, true
}

// placementFromView converts an object of the block back to a file placement, for the tile at (e.X, e.Y)
// of the block. With orig, the placement keeps the original's tilt and set numbers, and only its
// yaw changes.
func placementFromView(o ObjectView, e RegionEdit, orig *adt.Placement) (adt.Object, error) {
	var out adt.Object
	kind, name, set, hasSet, err := parseModelType(o.Type)
	if err != nil {
		return out, err
	}
	out.Kind, out.Name = kind, name
	out.UID = o.UID
	out.Position = [3]float32{o.X + float32(e.X)*adt.TileSize, o.Y, o.Z + float32(e.Y)*adt.TileSize}
	yaw := float64(o.RotY)*180/math.Pi + 90
	out.Rotation = [3]float32{toDegrees(o.TiltX), float32(yaw), toDegrees(o.TiltZ)}
	out.Scale = o.Scale
	if orig != nil {
		out.DoodadSet, out.NameSet = orig.DoodadSet, orig.NameSet
	}
	// A WMO's doodad set is the one its name carries (objectView writes it for every set but 0); a
	// name without one keeps the original's, or 0 for a new model.
	if kind == adt.WMO && (hasSet || orig == nil) {
		out.DoodadSet = set
	}
	if out.Scale == 0 {
		out.Scale = 1
	}
	return out, nil
}

const (
	// posEpsilon and angleEpsilon are how far a model may move or turn before it counts as edited.
	posEpsilon   = 0.01
	angleEpsilon = 0.01
)

// toDegrees converts a tilt in radians to the degrees a placement stores.
func toDegrees(r float32) float32 {
	return float32(float64(r) * 180 / math.Pi)
}

// fromDegrees converts a placement's stored degrees to a tilt in radians.
func fromDegrees(d float32) float32 {
	return float32(float64(d) * math.Pi / 180)
}

// angleDiff is the smallest difference between two angles in degrees.
func angleDiff(a, b float64) float64 {
	d := math.Mod(math.Abs(a-b), 360)
	if d > 180 {
		d = 360 - d
	}
	return d
}

// unchanged reports whether an object still sits as its placement in the file does.
func unchanged(o ObjectView, e RegionEdit, orig adt.Placement) bool {
	kind, name, set, hasSet, err := parseModelType(o.Type)
	if err != nil || kind != orig.Kind || name != orig.Name || (hasSet && set != orig.DoodadSet) {
		return false
	}
	wx := o.X + float32(e.X)*adt.TileSize
	wz := o.Z + float32(e.Y)*adt.TileSize
	yaw := float64(o.RotY)*180/math.Pi + 90
	return math.Abs(float64(wx-orig.Position[0])) < posEpsilon &&
		math.Abs(float64(o.Y-orig.Position[1])) < posEpsilon &&
		math.Abs(float64(wz-orig.Position[2])) < posEpsilon &&
		angleDiff(yaw, float64(orig.Rotation[1])) < angleEpsilon &&
		angleDiff(float64(toDegrees(o.TiltX)), float64(orig.Rotation[0])) < angleEpsilon &&
		angleDiff(float64(toDegrees(o.TiltZ)), float64(orig.Rotation[2])) < angleEpsilon &&
		math.Abs(float64(o.Scale-orig.Scale)) < 0.001
}

// tileOf is the tile of the block an object's position falls in, clamped to the block.
func tileOf(o ObjectView, size int) int {
	i := clampTile(int(math.Floor(float64(o.X)/adt.TileSize)), size)
	j := clampTile(int(math.Floor(float64(o.Z)/adt.TileSize)), size)
	return j*size + i
}

func clampTile(i, size int) int {
	return max(0, min(size-1, i))
}

// BuildRegion writes the edited block into copies of its tiles' files and returns them. Heights
// go into every tile. Models that are unchanged keep their placements exactly; changed ones are
// rewritten in the tile they came from; new ones go into the tile they fall in; and placements
// that were removed in the editor are dropped. Painted chunks are rewritten from their weights; the rest
// keep the paint the client has. The map's WDL comes last, its block's horizon redrawn from the heights.
func BuildRegion(dataDir string, e RegionEdit) ([]mpq.File, error) {
	if err := checkRegion(e.X, e.Y, e.Size); err != nil {
		return nil, err
	}
	side := e.Size*tileCells + 1
	if len(e.Heights) != side*side {
		return nil, fmt.Errorf("%d heights for a region, want %d", len(e.Heights), side*side)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	// A WMO-only map is checked against its WDT as the client has it now, as ReadRegion read it.
	if wdt, err := set.ReadFile(fmt.Sprintf(`World\Maps\%s\%s.wdt`, e.MapName, e.MapName)); err == nil {
		if w, ok := wmoOnlyBuilding(wdt); ok {
			return buildWMOOnly(set, e, wdt, w)
		}
	}

	type tileEdit struct {
		name   string
		root   []byte
		orig   map[uint32]adt.Placement
		change adt.Changes
	}
	tiles := make([]tileEdit, e.Size*e.Size)
	owner := map[uint32]int{}
	for j := 0; j < e.Size; j++ {
		for i := 0; i < e.Size; i++ {
			k := j*e.Size + i
			tx, ty := e.X+i, e.Y+j
			name := adt.TilePath(e.MapName, tx, ty, "")
			// The save starts from each tile as the client has it without Meld's patch (Blizzard's patches
			// still apply): the editor already holds the whole block's heights, paint and models, so earlier
			// exports are rebuilt from the original. A tile only Meld's patch has (one it made) starts from that.
			root, err := readUnpatched(set, name)
			if err != nil {
				root, err = set.ReadFile(name)
			}
			if err != nil {
				return nil, err
			}
			placements, err := adt.ParsePlacements(root)
			if err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", tx, ty, err)
			}
			t := tileEdit{name: name, root: root, orig: map[uint32]adt.Placement{}}
			t.change = adt.Changes{TileX: tx, TileY: ty, Remove: map[uint32]bool{}, Paint: map[int]adt.ChunkPaint{}}
			for _, p := range placements {
				if p.Kind != adt.M2 && p.Kind != adt.WMO {
					continue
				}
				t.orig[p.UID] = p
				owner[p.UID] = k
			}
			tiles[k] = t
		}
	}

	rc := newReaches(set)
	seen := map[uint32]bool{}
	for _, o := range e.Objects {
		if k, ok := owner[o.UID]; o.UID != 0 && ok {
			seen[o.UID] = true
			orig := tiles[k].orig[o.UID]
			if unchanged(o, e, orig) {
				continue
			}
			obj, err := placementFromView(o, e, &orig)
			if err != nil {
				return nil, err
			}
			rc.bound(&obj)
			tiles[k].change.Remove[o.UID] = true
			tiles[k].change.Add = append(tiles[k].change.Add, obj)
			continue
		}
		k := tileOf(o, e.Size)
		o.UID = 0
		obj, err := placementFromView(o, e, nil)
		if err != nil {
			return nil, err
		}
		rc.bound(&obj)
		tiles[k].change.Add = append(tiles[k].change.Add, obj)
	}
	for uid, k := range owner {
		if !seen[uid] {
			tiles[k].change.Remove[uid] = true
		}
	}

	// Painted chunks: each block chunk belongs to one tile, at its index within that tile.
	perRow := ChunksPerTileSide * e.Size
	for _, p := range e.Paint {
		if p.Chunk < 0 || p.Chunk >= perRow*perRow {
			return nil, fmt.Errorf("paint chunk %d is outside the block", p.Chunk)
		}
		if len(p.Textures) == 0 || len(p.Textures) > 4 {
			return nil, fmt.Errorf("chunk %d has %d textures; a chunk takes one to four", p.Chunk, len(p.Textures))
		}
		weights, err := base64.StdEncoding.DecodeString(p.Weights)
		if err != nil {
			return nil, fmt.Errorf("chunk %d weights: %w", p.Chunk, err)
		}
		perSide := adt.AlphaSize / 2
		if len(weights) != perSide*perSide*4 {
			return nil, fmt.Errorf("chunk %d has %d weights, want %d", p.Chunk, len(weights), perSide*perSide*4)
		}
		gx, gy := p.Chunk%perRow, p.Chunk/perRow
		k := (gy/ChunksPerTileSide)*e.Size + gx/ChunksPerTileSide
		local := (gy%ChunksPerTileSide)*ChunksPerTileSide + gx%ChunksPerTileSide
		tiles[k].change.Paint[local] = chunkPaint(p.Textures, p.Effects, p.Flags, p.NoEffect, weights, perSide)
	}

	for _, h := range e.Headers {
		if h.Chunk < 0 || h.Chunk >= perRow*perRow {
			return nil, fmt.Errorf("header chunk %d is outside the block", h.Chunk)
		}
		gx, gy := h.Chunk%perRow, h.Chunk/perRow
		k := (gy/ChunksPerTileSide)*e.Size + gx/ChunksPerTileSide
		if tiles[k].change.Headers == nil {
			tiles[k].change.Headers = map[int]adt.ChunkHeader{}
		}
		tiles[k].change.Headers[(gy%ChunksPerTileSide)*ChunksPerTileSide+gx%ChunksPerTileSide] = h.chunkHeader()
	}

	if e.HasLiquids {
		want, err := liquidsByChunk(e.Liquids, perRow)
		if err != nil {
			return nil, err
		}
		for k := range tiles {
			if err := changeLiquids(&tiles[k].change, tiles[k].root, want, k%e.Size, k/e.Size, perRow, e.PartialLiquids); err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", e.X+k%e.Size, e.Y+k/e.Size, err)
			}
		}
	}

	files := make([]mpq.File, 0, len(tiles))
	for k := range tiles {
		t := &tiles[k]
		i, j := k%e.Size, k/e.Size
		outer := make([]float32, LatticeSize*LatticeSize)
		for r := 0; r < LatticeSize; r++ {
			row := (j*tileCells+r)*side + i*tileCells
			copy(outer[r*LatticeSize:(r+1)*LatticeSize], e.Heights[row:row+LatticeSize])
		}
		patched, err := PatchTileHeights(t.root, outer)
		if err != nil {
			return nil, err
		}
		rewritten, err := adt.Rewrite(patched, t.change)
		if err != nil {
			return nil, fmt.Errorf("tile %d_%d: %w", e.X+i, e.Y+j, err)
		}
		files = append(files, mpq.File{Name: t.name, Data: rewritten})
	}
	// The far horizon follows the new heights. A map without a WDL is left without one.
	if b, err := set.ReadFile(wdlPath(e.MapName)); err == nil {
		horizon, err := ParseWDL(b)
		if err != nil {
			return nil, err
		}
		for j := 0; j < e.Size; j++ {
			for i := 0; i < e.Size; i++ {
				horizon[(e.Y+j)*MapTiles+e.X+i] = WDLTileOf(e.Heights[j*tileCells*side+i*tileCells:], side)
			}
		}
		files = append(files, mpq.File{Name: wdlPath(e.MapName), Data: BuildWDL(horizon)})
	}
	return files, nil
}

// changeLiquids lists in ch the chunks of tile (i, j) of the block whose liquids differ from the
// tile's own: want holds the block's layers by block chunk index. Unchanged chunks keep their bytes,
// flow data and flags as the client has them, and so do the chunks want has no layers for when
// partial is set.
func changeLiquids(ch *adt.Changes, root []byte, want map[int][]adt.Liquid, i, j, perRow int, partial bool) error {
	have, err := adt.ParseLiquids(root)
	if err != nil {
		return err
	}
	own := map[int][]adt.Liquid{}
	for _, l := range have {
		k := l.IndexY*adt.ChunksPerTile + l.IndexX
		own[k] = append(own[k], l)
	}
	ch.Liquids = map[int][]adt.Liquid{}
	for cy := 0; cy < adt.ChunksPerTile; cy++ {
		for cx := 0; cx < adt.ChunksPerTile; cx++ {
			local := cy*adt.ChunksPerTile + cx
			layers := want[(j*adt.ChunksPerTile+cy)*perRow+i*adt.ChunksPerTile+cx]
			if partial && len(layers) == 0 {
				continue
			}
			if !sameLiquids(own[local], layers) {
				ch.Liquids[local] = layers
			}
		}
	}
	return nil
}

// sameLiquids says whether two chunks' layers are the same, in any order.
func sameLiquids(a, b []adt.Liquid) bool {
	if len(a) != len(b) {
		return false
	}
	for _, x := range a {
		found := false
		for _, y := range b {
			if x.Type == y.Type && x.Cells == y.Cells && x.Depth == y.Depth && sameHeights(x, y) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// sameHeights compares the heights of the vertices around covered cells; the rest aren't shown.
func sameHeights(a, b adt.Liquid) bool {
	for r := 0; r < adt.CellsPerChunk; r++ {
		for c := 0; c < adt.CellsPerChunk; c++ {
			if !a.Cells[r*adt.CellsPerChunk+c] {
				continue
			}
			for _, v := range [4]int{r*9 + c, r*9 + c + 1, (r+1)*9 + c, (r+1)*9 + c + 1} {
				if math.Abs(float64(a.Heights[v]-b.Heights[v])) > 1e-3 {
					return false
				}
			}
		}
	}
	return true
}

// RegionResult says what a region save wrote: the patch, the block's tile count, and how many of
// them differed from the patch's copies and were written. Changed 0 with no Patch means nothing at
// all changed (nor the WDL), so the patch was left alone.
type RegionResult struct {
	Patch   string `json:"patch"`
	Tiles   int    `json:"tiles"`
	Changed int    `json:"changed"`
	// ChangedTiles names the written tiles as "x_y", as the map extractor's -t takes them, and MapID is
	// the client map they belong to (0 Azeroth, 1 Kalimdor; -1 for any other). TilesCurrent says the
	// server's map data matched the patch before this write, so only those tiles need extracting again.
	ChangedTiles []string `json:"changedTiles"`
	MapID        int      `json:"mapId"`
	TilesCurrent bool     `json:"tilesCurrent"`
	// Building says the map is a single building (WMO-only, #271): it has no tiles, so Tiles is 0, and
	// its WDT, which places the building, is the one file a save can write.
	Building bool `json:"building"`
	// WDT says the map's WDT was among the files written.
	WDT bool `json:"wdt"`
	// Files is how many of the block's files (tiles, WDL, WDT) differ from the patch's copies: 0 means
	// the client already has the block as the editor holds it.
	Files int `json:"files"`
}

// ClientMapID is the ID of a continent the client holds, by its folder name; ok is false for others.
func ClientMapID(name string) (uint32, bool) {
	switch strings.ToLower(name) {
	case "azeroth":
		return 0, true
	case "kalimdor":
		return 1, true
	}
	return 0, false
}

// fileTileName names a map tile file ("World\Maps\Azeroth\Azeroth_32_48.adt") as "32_48", or "" for
// another file.
func fileTileName(name string) string {
	if !strings.EqualFold(filepath.Ext(name), ".adt") {
		return ""
	}
	parts := strings.Split(strings.TrimSuffix(filepath.Base(strings.ReplaceAll(name, `\`, "/")), filepath.Ext(name)), "_")
	if len(parts) < 3 {
		return ""
	}
	return parts[len(parts)-2] + "_" + parts[len(parts)-1]
}

// RegionChanges builds the edited block's files and keeps those that differ from the patch's copies.
func RegionChanges(dataDir string, e RegionEdit) ([]mpq.File, RegionResult, error) {
	res := RegionResult{Tiles: e.Size * e.Size}
	files, err := BuildRegion(dataDir, e)
	if err != nil {
		return nil, res, err
	}
	changed, err := ChangedFiles(dataDir, files)
	if err != nil {
		return nil, res, err
	}
	res.Changed = countTiles(changed)
	res.Files = len(changed)
	if countTiles(files) == 0 {
		res.Building, res.Tiles = true, 0
	}
	for _, f := range changed {
		if strings.EqualFold(filepath.Ext(f.Name), ".wdt") {
			res.WDT = true
		}
	}
	res.MapID = -1
	if id, ok := ClientMapID(e.MapName); ok {
		res.MapID = int(id)
	}
	for _, f := range changed {
		if t := fileTileName(f.Name); t != "" {
			res.ChangedTiles = append(res.ChangedTiles, t)
		}
	}
	return changed, res, nil
}

// SaveRegion writes the edited block's changed files into the client's patch.
func SaveRegion(dataDir string, e RegionEdit) (RegionResult, error) {
	files, res, err := RegionChanges(dataDir, e)
	if err != nil || len(files) == 0 {
		return res, err
	}
	res.Patch, err = InstallPatch(dataDir, files)
	return res, err
}

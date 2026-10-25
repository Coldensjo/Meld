package vmangos

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
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
	Heights HeightGrid `json:"heights" ts_type:"string"`
	// Chunks index across the whole block: 16*Size chunks a side.
	Chunks  []ChunkView  `json:"chunks"`
	Objects []ObjectView `json:"objects"`
	// Liquids index across the whole block, like Chunks.
	Liquids []adt.Liquid `json:"liquids"`
	// Alpha is the chunks' alpha maps as TileView has them, in the order of Chunks: every layer but
	// each chunk's first, AlphaBytes each. It stays out of the JSON, which it made 33 of a 3x3 block's
	// 36.5 MB as base64 strings: the app hands it to the page as one GET, at AlphaURL (#636).
	Alpha []byte `json:"-"`
	// AlphaURL is where the page fetches Alpha from (App.LoadRegion sets it, internal/handoff), or
	// "" when there is none.
	AlphaURL string `json:"alphaUrl"`
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
	MapName string `json:"mapName"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	Size    int    `json:"size"`
	// Heights is the block's outer grid as RegionView has it, as base64 of little-endian float32s, as
	// mapfile.MapData keeps it: a 3x3 block's 148,225 heights as JSON numbers cost the bridge far more (#531).
	Heights string       `json:"heights"`
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
	// Headers are the zones, impassable flags, holes and baked shadows of the block's chunks, by block
	// chunk index. Chunks not listed keep the client's, and so do the fields a header leaves unset.
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

// EncodeHeights is heights as RegionEdit.Heights carries them: base64 of little-endian float32s.
func EncodeHeights(h []float32) string {
	b := make([]byte, 4*len(h))
	for i, v := range h {
		binary.LittleEndian.PutUint32(b[4*i:], math.Float32bits(v))
	}
	return base64.StdEncoding.EncodeToString(b)
}

// HeightGrid is heights Go keeps as floats that cross the Wails bridge as EncodeHeights does: a
// 3x3 block's 148,225 heights are 2.68 MB as JSON numbers and 0.79 MB as base64, and far quicker to
// encode and parse (#632). The page reads them with base64.ts's base64ToFloats.
type HeightGrid []float32

// MarshalJSON writes the heights as a base64 string.
func (h HeightGrid) MarshalJSON() ([]byte, error) {
	return json.Marshal(EncodeHeights(h))
}

// UnmarshalJSON reads the heights from a base64 string; null leaves them empty.
func (h *HeightGrid) UnmarshalJSON(b []byte) error {
	var s *string
	if err := json.Unmarshal(b, &s); err != nil {
		return fmt.Errorf("heights: %w", err)
	}
	if s == nil {
		*h = nil
		return nil
	}
	f, err := DecodeHeights(*s)
	if err != nil {
		return err
	}
	*h = f
	return nil
}

// DecodeHeights reads RegionEdit.Heights back into floats.
func DecodeHeights(s string) ([]float32, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("region heights: %w", err)
	}
	if len(b)%4 != 0 {
		return nil, fmt.Errorf("region heights are %d bytes, not whole float32s", len(b))
	}
	h := make([]float32, len(b)/4)
	for i := range h {
		h[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[4*i:]))
	}
	return h, nil
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
	listed := map[uint32]bool{}
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
			view.Alpha = append(view.Alpha, tile.Alpha...)
			for _, l := range tile.Liquids {
				l.IndexX += i * adt.ChunksPerTile
				l.IndexY += j * adt.ChunksPerTile
				view.Liquids = append(view.Liquids, l)
			}
			for _, p := range tile.Placements {
				// A model whose bounds cross a tile border is listed by each tile it overlaps under one
				// ID; the editor holds it once (#646).
				if p.UID != 0 && listed[p.UID] {
					continue
				}
				if o, ok := objectView(p, x, y); ok {
					listed[p.UID] = true
					view.Objects = append(view.Objects, o)
				}
			}
		}
	}
	return view, nil
}

// ReadBaseRegionPaint reads the texture layers and alpha maps of the block's chunks as the client has
// them without Meld's patch (BaseTileRoot, the tiles a compile compares the paint against), for Restore
// the Client's Paint (#645): compiles before #526 left the patch's chunks at half the alpha resolution,
// and a region read from the patch keeps them so. The view has Chunks and Alpha only, in ReadRegion's
// order; a WMO-only map, or a tile only Meld's patch has (a new map), is an error.
func ReadBaseRegionPaint(dataDir, mapName string, x, y, size int) (*RegionView, error) {
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
	if !wdtHasTiles(wdt) {
		return nil, fmt.Errorf("%s is a single building with no ground to paint", mapName)
	}
	bigAlpha := adt.ReadBigAlpha(wdt)
	view := &RegionView{MapName: mapName, X: x, Y: y, Size: size, Chunks: []ChunkView{}, Objects: []ObjectView{}, Liquids: []adt.Liquid{}}
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			tx, ty := x+i, y+j
			root, err := readUnpatched(set, adt.TilePath(mapName, tx, ty, ""))
			if err != nil {
				return nil, fmt.Errorf("tile %d_%d is not in the client without Meld's patch: %w", tx, ty, err)
			}
			terrain, err := adt.ParseTerrain(root)
			if err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", tx, ty, err)
			}
			textures, err := adt.ParseTextures(root, bigAlpha, terrain)
			if err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", tx, ty, err)
			}
			for k, c := range terrain.Chunks {
				cv := ChunkView{IndexX: c.IndexX + i*adt.ChunksPerTile, IndexY: c.IndexY + j*adt.ChunksPerTile, AreaID: c.AreaID}
				for l, layer := range textures.Chunks[k].Layers {
					cv.Layers = append(cv.Layers, LayerView{Texture: layer.Texture, Effect: layer.Effect})
					if l > 0 {
						view.Alpha = append(view.Alpha, textures.Chunks[k].Alpha[l-1]...)
					}
				}
				view.Chunks = append(view.Chunks, cv)
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
	o.Type = adt.ModelType(p.Kind, p.Name, p.DoodadSet)
	o.UID = p.UID
	o.X = p.Position[0] - float32(x)*adt.TileSize
	o.Y = p.Position[1]
	o.Z = p.Position[2] - float32(y)*adt.TileSize
	o.RotY, o.TiltX, o.TiltZ = p.EditorTurn()
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

// blockTilesOf is the tiles of the block a placement's bounds reach into, as the client's tiles list a
// model in each tile it overlaps (#646), by the same test Rewrite uses for a tile's chunks. A model
// whose bounds reach no tile of the block (it sits off its edge) goes into the tile tileOf gives it.
// The tiles outside the block it reaches are BuildRegion's outside tiles (#647).
func blockTilesOf(obj adt.Object, o ObjectView, e RegionEdit) []int {
	lo, hi := obj.Bounds()
	var out []int
	for j := 0; j < e.Size; j++ {
		for i := 0; i < e.Size; i++ {
			if reachesTile(lo, hi, e.X+i, e.Y+j) {
				out = append(out, j*e.Size+i)
			}
		}
	}
	if len(out) == 0 {
		out = append(out, tileOf(o, e.Size))
	}
	return out
}

// reachesTile says whether a model's bounds, lo to hi in the file's space, touch map tile tx,ty, by the
// same test Rewrite uses for a tile's chunks.
func reachesTile(lo, hi [3]float32, tx, ty int) bool {
	left := float32(tx) * adt.TileSize
	top := float32(ty) * adt.TileSize
	return hi[0] >= left && lo[0] <= left+adt.TileSize && hi[2] >= top && lo[2] <= top+adt.TileSize
}

func clampTile(i, size int) int {
	return max(0, min(size-1, i))
}

// BuildRegion writes the edited block into copies of its tiles' files and returns them. Heights
// go into every tile. Models that are unchanged keep their placements exactly; changed and new ones
// are written into every tile of the block their bounds reach, under one ID, after a changed one is
// taken out of every tile that listed it; and placements that were removed in the editor are dropped
// from every tile that listed them. A tile outside the block that lists such a model, or that a moved or
// added one now reaches, is written too, after the block's tiles, with only its placements changed
// (#647), and so is one beside the block whose border normals its heights move, with only those
// changed (#666). Painted chunks are rewritten from their weights; the rest keep the paint the client has.
// The map's WDL comes last, its block's horizon redrawn from the heights.
func BuildRegion(dataDir string, e RegionEdit) ([]mpq.File, error) {
	if err := checkRegion(e.X, e.Y, e.Size); err != nil {
		return nil, err
	}
	side := e.Size*tileCells + 1
	heights, err := DecodeHeights(e.Heights)
	if err != nil {
		return nil, err
	}
	if len(heights) != side*side {
		return nil, fmt.Errorf("%d heights for a region, want %d", len(heights), side*side)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	// A WMO-only map is checked against its WDT as the client has it now, as ReadRegion read it.
	bigAlpha := false
	if wdt, err := set.ReadFile(fmt.Sprintf(`World\Maps\%s\%s.wdt`, e.MapName, e.MapName)); err == nil {
		if w, ok := wmoOnlyBuilding(wdt); ok {
			return buildWMOOnly(set, e, wdt, w)
		}
		bigAlpha = adt.ReadBigAlpha(wdt)
	}

	type tileEdit struct {
		name string
		root []byte
		orig map[uint32]adt.Placement
		// patched is the tile's models as Meld's patch has them, when it has the tile and root is the
		// client's own: an earlier compile may have moved, deleted or added models there.
		patched map[uint32]adt.Placement
		change  adt.Changes
	}
	tiles := make([]tileEdit, e.Size*e.Size)
	// owners is the block's tiles that list each model, by ID: a model whose bounds cross a tile border
	// is listed by every tile it overlaps under the one ID (#646).
	owners := map[uint32][]int{}
	for j := 0; j < e.Size; j++ {
		for i := 0; i < e.Size; i++ {
			k := j*e.Size + i
			tx, ty := e.X+i, e.Y+j
			name := adt.TilePath(e.MapName, tx, ty, "")
			// The save starts from each tile as the client has it without Meld's patch (Blizzard's patches
			// still apply): the editor already holds the whole block's heights, paint and models, so earlier
			// exports are rebuilt from the original. A tile only Meld's patch has (one it made) starts from that.
			root, err := readUnpatched(set, name)
			own := err == nil
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
			if own && patchHolds(set, name) {
				b, err := set.ReadFile(name)
				if err != nil {
					return nil, err
				}
				ps, err := adt.ParsePlacements(b)
				if err != nil {
					return nil, fmt.Errorf("tile %d_%d in %s: %w", tx, ty, PatchName, err)
				}
				t.patched = map[uint32]adt.Placement{}
				for _, p := range ps {
					if p.Kind == adt.M2 || p.Kind == adt.WMO {
						t.patched[p.UID] = p
					}
				}
			}
			t.change = adt.Changes{TileX: tx, TileY: ty, Remove: map[uint32]bool{}, Paint: map[int]adt.ChunkPaint{}}
			for _, p := range placements {
				if p.Kind != adt.M2 && p.Kind != adt.WMO {
					continue
				}
				t.orig[p.UID] = p
				if o := owners[p.UID]; len(o) == 0 || o[len(o)-1] != k {
					owners[p.UID] = append(o, k)
				}
			}
			tiles[k] = t
		}
	}

	// fix is the models whose copies in tiles outside the block the save brings in line with it (#647):
	// first those an earlier compile moved, deleted or added, which the block's tiles in Meld's patch
	// list otherwise than the client's own do; then, below, those this save moves, deletes or adds.
	fix := map[uint32]*outsideFix{}
	fixOf := func(uid uint32) *outsideFix {
		f := fix[uid]
		if f == nil {
			f = &outsideFix{}
			fix[uid] = f
		}
		return f
	}
	for k := range tiles {
		t := &tiles[k]
		if t.patched == nil {
			continue
		}
		for uid, p := range t.patched {
			if o, ok := t.orig[uid]; !ok || !samePlace(p, objectOf(o)) {
				fixOf(uid).saw(k, p)
			}
		}
		for uid := range t.orig {
			if _, ok := t.patched[uid]; !ok {
				fixOf(uid)
			}
		}
	}
	// One object an ID: a map saved before ReadRegion handed out a border model once may hold it once
	// per tile that lists it. A copy moved in the editor wins over one left in place.
	pick := map[uint32]int{}
	for i, o := range e.Objects {
		ks, ok := owners[o.UID]
		if o.UID == 0 || !ok {
			continue
		}
		orig := tiles[ks[0]].orig[o.UID]
		if j, ok := pick[o.UID]; !ok || unchanged(e.Objects[j], e, orig) && !unchanged(o, e, orig) {
			pick[o.UID] = i
		}
	}

	// A changed model is taken out of every tile that lists it and an added or changed one goes into
	// every tile of the block its bounds reach, under one ID, so no tile keeps a copy at the old spot
	// and the neighbour's chunks list a model that crosses into them (#646). Added models, and those an
	// earlier compile added (the client's own tiles lack their IDs), are numbered below, rather than by
	// Rewrite, so each one's copies share their ID. now is where every model the save places stands,
	// with those of fix it leaves in the block's tiles as they are, for the tiles outside the block;
	// block is set on those the block's tiles take.
	rc := newReaches(set)
	type placed struct {
		obj   adt.Object
		view  ObjectView
		fresh bool
		block bool
	}
	var now []placed
	for i, o := range e.Objects {
		var orig *adt.Placement
		fresh := false
		if ks, ok := owners[o.UID]; o.UID != 0 && ok {
			if pick[o.UID] != i {
				continue
			}
			p := tiles[ks[0]].orig[o.UID]
			if unchanged(o, e, p) {
				// The block's tiles keep it as the client has it; a tile outside where an earlier compile
				// moved or deleted it gets it back.
				if fix[o.UID] != nil {
					obj := objectOf(p)
					rc.bound(&obj)
					now = append(now, placed{obj: obj, view: o})
				}
				continue
			}
			orig = &p
			for _, k := range ks {
				tiles[k].change.Remove[o.UID] = true
			}
			fixOf(o.UID)
		} else {
			o.UID = 0
			fresh = true
		}
		obj, err := placementFromView(o, e, orig)
		if err != nil {
			return nil, err
		}
		rc.bound(&obj)
		now = append(now, placed{obj: obj, view: o, fresh: fresh, block: true})
	}
	for uid, ks := range owners {
		if _, picked := pick[uid]; !picked {
			for _, k := range ks {
				tiles[k].change.Remove[uid] = true
			}
			fixOf(uid)
		}
	}
	for uid, f := range fix {
		for _, k := range owners[uid] {
			f.saw(k, tiles[k].orig[uid])
		}
	}
	for i := range now {
		if !now[i].fresh {
			fixOf(now[i].obj.UID).final = &now[i].obj
		}
	}

	// The tiles outside the block that may list a model of fix, or that a moved or added model now
	// reaches: the neighbours of the block tiles that list it, and those its old bounds reach.
	inBlock := func(x, y int) bool { return x >= e.X && x < e.X+e.Size && y >= e.Y && y < e.Y+e.Size }
	want := map[[2]int]bool{}
	for _, f := range fix {
		for _, k := range f.near {
			x, y := e.X+k%e.Size, e.Y+k/e.Size
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					if x+dx >= 0 && y+dy >= 0 && x+dx < MapTiles && y+dy < MapTiles {
						want[[2]int{x + dx, y + dy}] = true
					}
				}
			}
		}
		for _, p := range f.old {
			obj := objectOf(p)
			rc.bound(&obj)
			lo, hi := obj.Bounds()
			tilesReached(want, lo, hi, outsidePad)
		}
	}
	for _, p := range now {
		lo, hi := p.obj.Bounds()
		tilesReached(want, lo, hi, 0)
	}
	for k := range want {
		if inBlock(k[0], k[1]) {
			delete(want, k)
		}
	}
	outside, err := readOutside(set, e.MapName, want)
	if err != nil {
		return nil, err
	}

	// Added models take IDs above every one of the map: the block's tiles as the client has them
	// without Meld's patch, and the map's other tiles as it reads them now (#491), but for the copies the
	// save takes out of the tiles outside the block. Those of the models an earlier compile added are
	// among them, so a compile with nothing new numbers its added models as the one before did.
	nextUID, err := mapUIDMax(set, e.MapName, func(x, y int) bool { return inBlock(x, y) || want[[2]int{x, y}] })
	if err != nil {
		return nil, err
	}
	take := func(uid uint32) {
		if uid != GlobalUID {
			nextUID = max(nextUID, uid)
		}
	}
	for i := range outside {
		outside[i].removals(fix)
		for uid := range outside[i].placed {
			if !outside[i].remove[uid] {
				take(uid)
			}
		}
	}
	for uid := range owners {
		take(uid)
	}
	nextUID++
	for i := range now {
		if now[i].fresh {
			now[i].obj.UID = nextUID
			nextUID++
		}
	}
	for _, p := range now {
		if p.block {
			for _, k := range blockTilesOf(p.obj, p.view, e) {
				tiles[k].change.Add = append(tiles[k].change.Add, p.obj)
			}
		}
	}

	// Painted chunks: each block chunk belongs to one tile, at its index within that tile. The editor
	// sends every chunk at half the client's alpha resolution, so each keeps the client's own alpha
	// wherever its weights are still the ones read from it (#526).
	perRow := ChunksPerTileSide * e.Size
	own := make([]map[int]adt.TexChunk, len(tiles))
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
		paint := chunkPaint(p.Textures, p.Effects, p.Flags, p.NoEffect, weights, perSide)
		if own[k] == nil {
			if own[k], err = ownTextures(tiles[k].root, bigAlpha); err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", e.X+k%e.Size, e.Y+k/e.Size, err)
			}
		}
		if c, ok := own[k][local]; ok {
			paint.KeepClientAlpha(c, weights, perSide)
		}
		tiles[k].change.Paint[local] = paint
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

	// The normals on each tile's border read the heights across it: the next tile's in the block, the
	// client's beyond it (#492).
	roots := make([][]byte, len(tiles))
	for k := range tiles {
		roots[k] = tiles[k].root
	}
	edges, beside, err := blockEdges(set, e.MapName, e.X, e.Y, e.Size, heights, roots)
	if err != nil {
		return nil, err
	}
	// The client's tiles beside the block whose normals along it the block's heights one in from its
	// edge move get those normals redone, their heights and the rest of their bytes kept (#666).
	normals := map[[2]int][]byte{}
	for _, b := range beside {
		terrain, err := adt.ParseTerrain(b.root)
		if err != nil {
			return nil, fmt.Errorf("tile %d_%d: %w", b.x, b.y, err)
		}
		root, err := adt.WriteHeights(b.root, terrain, &b.edges)
		if err != nil {
			return nil, fmt.Errorf("tile %d_%d: %w", b.x, b.y, err)
		}
		if !bytes.Equal(root, b.root) {
			normals[[2]int{b.x, b.y}] = root
		}
	}
	files := make([]mpq.File, 0, len(tiles))
	for k := range tiles {
		t := &tiles[k]
		i, j := k%e.Size, k/e.Size
		patched, err := PatchTileHeights(t.root, blockTile(heights, side, i, j), &edges[k])
		if err != nil {
			return nil, err
		}
		rewritten, err := adt.Rewrite(patched, t.change)
		if err != nil {
			return nil, fmt.Errorf("tile %d_%d: %w", e.X+i, e.Y+j, err)
		}
		files = append(files, mpq.File{Name: t.name, Data: rewritten})
	}
	// The tiles outside the block that list a model as it no longer stands, or that a moved or added one
	// now reaches, keep everything else as the client reads them now (#647). One whose normals the save
	// redoes too is written once, its placements changed over the new normals.
	objs := make([]adt.Object, len(now))
	for i, p := range now {
		objs[i] = p.obj
	}
	for _, t := range outside {
		key := [2]int{t.x, t.y}
		root, redone := normals[key]
		if !redone {
			root = t.root
		}
		delete(normals, key)
		if ch, ok := t.changes(objs); ok {
			if root, err = adt.Rewrite(root, ch); err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", t.x, t.y, err)
			}
		} else if !redone {
			continue
		}
		files = append(files, mpq.File{Name: t.name, Data: root})
	}
	for _, b := range beside {
		if root, ok := normals[[2]int{b.x, b.y}]; ok {
			files = append(files, mpq.File{Name: b.name, Data: root})
		}
	}
	// The far horizon follows the new heights. A map without a WDL is left without one.
	if b, err := set.ReadFile(wdlPath(e.MapName)); err == nil {
		horizon, err := ParseWDL(b)
		if err != nil {
			return nil, err
		}
		for j := 0; j < e.Size; j++ {
			for i := 0; i < e.Size; i++ {
				horizon[(e.Y+j)*MapTiles+e.X+i] = WDLTileOf(heights[j*tileCells*side+i*tileCells:], side)
			}
		}
		files = append(files, mpq.File{Name: wdlPath(e.MapName), Data: BuildWDL(horizon)})
	}
	return files, nil
}

// ownTextures is a tile's texture layers and alpha maps by chunk index (y*16 + x), as ReadRegion's
// view gives them to the editor.
func ownTextures(root []byte, bigAlpha bool) (map[int]adt.TexChunk, error) {
	terrain, err := adt.ParseTerrain(root)
	if err != nil {
		return nil, err
	}
	textures, err := adt.ParseTextures(root, bigAlpha, terrain)
	if err != nil {
		return nil, err
	}
	out := make(map[int]adt.TexChunk, len(textures.Chunks))
	for i, c := range terrain.Chunks {
		if i < len(textures.Chunks) {
			out[c.IndexY*adt.ChunksPerTile+c.IndexX] = textures.Chunks[i]
		}
	}
	return out, nil
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
	// Outside is how many tiles outside the block were written, for the copies of the models by its
	// edge that they list (#647). ChangedTiles names them too.
	Outside int `json:"outside"`
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
	// Waiting says the written files wait for the game to close, which holds the patch open on
	// Windows: Meld never closes it (#661).
	Waiting bool `json:"waiting"`
}

// ClientMapID is the ID of the map the client's Map.dbc gives the folder name (case-insensitive); ok is
// false for a folder the table lacks or when it cannot be read.
func ClientMapID(dataDir, name string) (uint32, bool) {
	entries, err := LoadMapEntries(dataDir)
	if err != nil {
		return 0, false
	}
	return mapIDByDir(entries, name)
}

// mapIDByDir finds the entry whose folder is name.
func mapIDByDir(entries []MapEntry, name string) (uint32, bool) {
	for _, e := range entries {
		if strings.EqualFold(e.Dir, name) {
			return e.ID, true
		}
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
	for _, f := range changed {
		if fileTileName(f.Name) == "" {
			continue
		}
		if regionTile(f.Name, e) {
			res.Changed++
		} else {
			res.Outside++
		}
	}
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
	if id, ok := ClientMapID(dataDir, e.MapName); ok {
		res.MapID = int(id)
	}
	for _, f := range changed {
		if t := fileTileName(f.Name); t != "" {
			res.ChangedTiles = append(res.ChangedTiles, t)
		}
	}
	return changed, res, nil
}

package vmangos

import (
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"strings"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// Chunks and tiles here use the tile grid of the 1.12 client.
const chunkCells = adt.CellsPerChunk

// ObjectSpec is a model to place, in the editor's terms: X and Z in yards from the tile's corner,
// Y the world height, RotY in radians about the vertical axis.
type ObjectSpec struct {
	// Type is "m2:<path>" or "wmo:<path>", as the editor names a model.
	Type    string
	X, Y, Z float32
	RotY    float32
	// TiltX and TiltZ are the model's tilt forward and back, and side to side, in radians.
	TiltX, TiltZ float32
	Scale        float32
}

// TileSpec is one tile of a map to write.
type TileSpec struct {
	X, Y int
	// Outer is the tile's ground: 129 x 129 heights, row-major, rows running south; base64 in JSON.
	Outer HeightGrid `ts_type:"string"`
	// Paint holds the chunks that have paint: their textures (up to four, base first) and weights.
	Paint []PaintSpec
	// Objects are the models on the tile.
	Objects []ObjectSpec
	// Liquids are the tile's painted liquid layers, each placed by its chunk in the tile.
	Liquids []adt.Liquid
	// Headers are the chunks' zones, impassable flags, holes and baked shadows; chunks not listed keep the new tile's.
	Headers []HeaderSpec
}

// HeaderSpec is a chunk's header fields: its index (in the tile for a TileSpec, in the block for a
// RegionEdit), its AreaTable.dbc ID (0 keeps the chunk's own) and whether it is impassable (nil keeps
// the chunk's own: a map without chunk data of its own still sends its holes and shadows, #644).
// NoEffect, one entry per cell row with a bit per cell, replaces the chunk's noEffectDoodad bits;
// empty keeps them (with a PaintSpec's added). Holes, in the same form, replaces the chunk's holes,
// each 2x2-cell block a hole when any of its cells is; empty keeps them. HolesAdd adds them to the
// chunk's own instead, for a map that doesn't know the client's holes (#663). Shadow (base64 in JSON),
// adt.ShadowBytes long, replaces the chunk's baked shadow map; empty keeps it.
type HeaderSpec struct {
	Chunk      int    `json:"chunk"`
	AreaID     uint32 `json:"areaId"`
	Impassable *bool  `json:"impassable,omitempty"`
	NoEffect   []int  `json:"noEffect,omitempty"`
	Holes      []int  `json:"holes,omitempty"`
	HolesAdd   bool   `json:"holesAdd,omitempty"`
	Shadow     []byte `json:"shadow,omitempty"`
}

// chunkHeader is the adt form of a HeaderSpec.
func (h HeaderSpec) chunkHeader() adt.ChunkHeader {
	ch := adt.ChunkHeader{AreaID: h.AreaID, Impassable: h.Impassable}
	if len(h.NoEffect) == adt.CellsPerChunk {
		ch.NoEffect = make([]uint8, adt.CellsPerChunk)
		for i, v := range h.NoEffect {
			ch.NoEffect[i] = uint8(v)
		}
	}
	if len(h.Holes) == adt.CellsPerChunk {
		rows := make([]uint8, adt.CellsPerChunk)
		for i, v := range h.Holes {
			rows[i] = uint8(v)
		}
		bits := adt.HoleBits(rows)
		ch.Holes = &bits
		ch.HolesAdd = h.HolesAdd
	}
	if len(h.Shadow) == adt.ShadowBytes {
		ch.Shadow = h.Shadow
	}
	return ch
}

// PaintSpec is a chunk's paint: its index in the tile (y*16 + x), its textures in slot order, and
// four weights per texel (32 texels a side, row-major, base64 of bytes), each texel summing to 255.
type PaintSpec struct {
	Chunk    int
	Textures []string
	Weights  string
	// Effects is the GroundEffectTexture ID per texture (0 for none, or the tile's own); optional.
	Effects []uint32
	// Flags is each texture's look flags (adt.LayerLookFlags: animation and overbright), or -1 to keep
	// what the tile's own layers of that texture have; optional.
	Flags []int
	// NoEffect is one entry per cell row, a bit per cell set where no ground effect doodads grow
	// (under a building); optional. The bits are added to the tile's own.
	NoEffect []int
}

// MapSpec is a map to write: its folder and ID, and the tiles that have a file.
type MapSpec struct {
	// Dir is the map's folder under World\Maps, which is also its internal name.
	Dir   string
	MapID uint32
	Tiles []TileSpec
	// Water, when set, puts sea (ocean) at WaterLevel yards into every cell the ground lies below
	// and no painted liquid covers.
	Water      bool
	WaterLevel float32
	// Info, when set, is written into the map's Map.dbc row and the server's map_template; without it
	// a new row is a world map like the continents.
	Info *MapInfo
	// Global, when set, makes a WMO-only map: the WDT places this building and the map has no tiles,
	// as the client's Blackfathom Deeps. Its X and Z are left out: the building goes at the world's
	// middle, where the client and the server's vmaps both put a WDT's building at 0 (#272).
	Global *ObjectSpec
}

// ExportResult says what was written.
type ExportResult struct {
	// Patch is the client's patch archive the files went into.
	Patch string
	// Server is the server's Map.dbc, when a server folder was given.
	Server string
	// Tiles is the map's tile count, and Changed how many of them differed from the patch's copies
	// and were written. With nothing changed at all, Patch is empty and the patch was left alone.
	Tiles   int
	Changed int
	// ChangedTiles names the written tiles as "x_y", as the map extractor's -t takes them, and Layout
	// says the WDT was written too, so the map's set of tiles may have changed.
	ChangedTiles []string
	Layout       bool
}

// ExportMap writes a map's tiles, WDT, WDL (its far horizon) and Map.dbc row into the client's patch
// archive, only the files that changed since the last export. readDir is the client's Data folder, which the template files come from; patchDir is where the patch goes (the same
// folder in the game). When serverDir is set, the server's copy of Map.dbc is updated too, which the
// map extractor (update-maps.bat) reads the map from.
func ExportMap(readDir, patchDir, serverDir string, m MapSpec) (ExportResult, error) {
	var res ExportResult
	if m.Dir == "" || strings.ContainsAny(m.Dir, `\/`) {
		return res, fmt.Errorf("map folder %q must be a single name", m.Dir)
	}
	if m.MapID == 0 || m.MapID > MaxGameMap {
		return res, fmt.Errorf("map id %d is not one the editor can use", m.MapID)
	}
	if len(m.Tiles) == 0 && m.Global == nil {
		return res, errors.New("the map has no tiles")
	}
	set, err := mpq.OpenDataDir(readDir)
	if err != nil {
		return res, err
	}

	dbc, err := set.ReadFile(`DBFilesClient\Map.dbc`)
	if err != nil {
		return res, err
	}
	switch existing := MapRowDir(dbc, m.MapID); {
	case existing == "":
		if dbc, err = AddMapRow(dbc, m.MapID, m.Dir); err != nil {
			return res, err
		}
	case !strings.EqualFold(existing, m.Dir):
		return res, fmt.Errorf("map id %d is %q in the client; pick another id", m.MapID, existing)
	}
	if m.Info != nil {
		if dbc, err = SetMapRowInfo(dbc, m.MapID, *m.Info); err != nil {
			return res, err
		}
	}

	var files []mpq.File
	present := map[[2]int]bool{}
	horizon := map[int]*WDLTile{}
	for _, t := range m.Tiles {
		if t.X < 0 || t.X > 63 || t.Y < 0 || t.Y > 63 {
			return res, fmt.Errorf("tile %d,%d is outside the 64x64 map", t.X, t.Y)
		}
		if present[[2]int{t.X, t.Y}] {
			return res, fmt.Errorf("tile %d,%d is listed twice", t.X, t.Y)
		}
		present[[2]int{t.X, t.Y}] = true
	}
	// The models take IDs from one counter for the whole map, above any tile of the folder the export
	// doesn't rewrite (a new map has none), so no two share one (#491).
	nextUID, err := mapUIDMax(set, m.Dir, func(x, y int) bool { return present[[2]int{x, y}] })
	if err != nil {
		return res, err
	}
	nextUID++
	// Each model takes its ID here and goes into every tile of the map its bounds reach, under that one
	// ID, as the client's tiles list a model that crosses a border in each tile it overlaps (#646,
	// #648); its size is read from the model, as the writer's default reach cuts a large one short. A
	// model whose bounds reach no tile of the map stays in the tile it was sent in.
	rc := newReaches(set)
	index := make(map[[2]int]int, len(m.Tiles))
	for i, t := range m.Tiles {
		index[[2]int{t.X, t.Y}] = i
	}
	adds := make([][]adt.Object, len(m.Tiles))
	for i, t := range m.Tiles {
		for _, o := range t.Objects {
			obj, err := objectIn(t.X, t.Y, o)
			if err != nil {
				return res, fmt.Errorf("tile %d,%d: %w", t.X, t.Y, err)
			}
			rc.bound(&obj)
			obj.UID = nextUID
			nextUID++
			lo, hi := obj.Bounds()
			reached := false
			// A bound exactly on a border touches the tile before it too, hence the one tile more.
			for ty := max(0, tileFloor(lo[2])-1); ty <= min(MapTiles-1, tileFloor(hi[2])); ty++ {
				for tx := max(0, tileFloor(lo[0])-1); tx <= min(MapTiles-1, tileFloor(hi[0])); tx++ {
					k, ok := index[[2]int{tx, ty}]
					if ok && reachesTile(lo, hi, tx, ty) {
						adds[k] = append(adds[k], obj)
						reached = true
					}
				}
			}
			if !reached {
				adds[i] = append(adds[i], obj)
			}
		}
	}
	for i, t := range m.Tiles {
		var water *adt.Water
		if m.Water {
			water = &adt.Water{Level: m.WaterLevel}
		}
		data, err := buildTile(t, tileRing(m.Tiles, index, t), adds[i], water)
		if err != nil {
			return res, fmt.Errorf("tile %d,%d: %w", t.X, t.Y, err)
		}
		files = append(files, mpq.File{Name: adt.TilePath(m.Dir, t.X, t.Y, ""), Data: data})
		if len(t.Outer) == LatticeSize*LatticeSize {
			horizon[t.Y*MapTiles+t.X] = WDLTileOf(t.Outer, LatticeSize)
		}
	}

	wdtTemplate, err := set.ReadFile(`World\Maps\Azeroth\Azeroth.wdt`)
	if err != nil {
		return res, err
	}
	if m.Global != nil {
		// A WMO-only map: one building in the WDT, no tiles and no horizon.
		obj, err := objectIn(0, 0, *m.Global)
		if err != nil {
			return res, err
		}
		if obj.Kind != adt.WMO {
			return res, errors.New("a WMO-only map's building must be a WMO")
		}
		// At the world's middle, as every client dungeon has it (wmoonly.go): X and Z 0 in the WDT's
		// frame, with the bounds round it in the same frame. Its height and turn are kept.
		obj.Position[0], obj.Position[2] = 0, 0
		rc.bound(&obj)
		wdt, err := BuildWMOOnlyWDT(wdtTemplate, GlobalWMO{Name: obj.Name, Position: obj.Position, Rotation: obj.Rotation, Min: obj.Min, Max: obj.Max, DoodadSet: obj.DoodadSet})
		if err != nil {
			return res, err
		}
		files = append(files,
			mpq.File{Name: fmt.Sprintf(`World\Maps\%s\%s.wdt`, m.Dir, m.Dir), Data: wdt},
			mpq.File{Name: `DBFilesClient\Map.dbc`, Data: dbc},
		)
	} else {
		wdt, err := BuildWDT(wdtTemplate, func(x, y int) bool { return present[[2]int{x, y}] })
		if err != nil {
			return res, err
		}
		files = append(files,
			mpq.File{Name: fmt.Sprintf(`World\Maps\%s\%s.wdt`, m.Dir, m.Dir), Data: wdt},
			mpq.File{Name: wdlPath(m.Dir), Data: BuildWDL(horizon)},
			mpq.File{Name: `DBFilesClient\Map.dbc`, Data: dbc},
		)
	}

	// The read archives hold the patch open, so they close before anything is written.
	set.Close()
	res.Tiles = len(m.Tiles)
	if files, err = ChangedFiles(patchDir, files); err != nil {
		return res, err
	}
	res.Changed = countTiles(files)
	res.ChangedTiles, res.Layout = changedTiles(m, files)
	// The client files waiting for the game to close go along (#657): Publish closes the game around
	// this write, so the watcher would otherwise write them at the same time. Patch stays "" when the
	// map itself is unchanged, so Publish still leaves an up-to-date server alone.
	patch, err := InstallWithPending(patchDir, files)
	if err != nil {
		return res, err
	}
	if len(files) > 0 {
		res.Patch = patch
	}
	if serverDir != "" {
		res.Server, err = installServerMapTable(serverDir, dbc)
		if err != nil {
			return res, err
		}
	}
	return res, nil
}

// changedTiles names the map's tiles among the files as "x_y", and says whether its WDT is among them.
func changedTiles(m MapSpec, files []mpq.File) ([]string, bool) {
	written := map[string]bool{}
	layout := false
	for _, f := range files {
		written[strings.ToLower(f.Name)] = true
		if strings.EqualFold(filepath.Ext(f.Name), ".wdt") {
			layout = true
		}
	}
	var tiles []string
	for _, t := range m.Tiles {
		if written[strings.ToLower(adt.TilePath(m.Dir, t.X, t.Y, ""))] {
			tiles = append(tiles, fmt.Sprintf("%d_%d", t.X, t.Y))
		}
	}
	return tiles, layout
}

// tileFloor is the map tile a coordinate in the file's space falls in, unclamped.
func tileFloor(v float32) int {
	return int(math.Floor(float64(v) / adt.TileSize))
}

// tileRing is the heights just across t's border from the map's other tiles (index finds them by
// position), so the normals there match theirs (#492). A side without a tile stays one-sided.
func tileRing(tiles []TileSpec, index map[[2]int]int, t TileSpec) adt.Ring {
	var ring adt.Ring
	for _, s := range []struct {
		side   string
		dx, dy int
		line   *[]float32
	}{
		{"north", 0, -1, &ring.North},
		{"south", 0, 1, &ring.South},
		{"west", -1, 0, &ring.West},
		{"east", 1, 0, &ring.East},
	} {
		if k, ok := index[[2]int{t.X + s.dx, t.Y + s.dy}]; ok && len(tiles[k].Outer) == LatticeSize*LatticeSize {
			*s.line = ringOf(tiles[k].Outer, s.side)
		}
	}
	return ring
}

// buildTile writes one tile: its ground and paint from t, the ring of heights around it from its
// neighbours (tileRing), and the models it lists (objs, already numbered and bounded, which may include
// ones placed in a neighbour that reach into it).
func buildTile(t TileSpec, ring adt.Ring, objs []adt.Object, water *adt.Water) ([]byte, error) {
	ch := adt.Changes{TileX: t.X, TileY: t.Y, Paint: map[int]adt.ChunkPaint{}, Water: water, Add: objs}
	liquids, err := liquidsByChunk(t.Liquids, adt.ChunksPerTile)
	if err != nil {
		return nil, err
	}
	ch.Liquids = liquids
	if len(t.Headers) > 0 {
		ch.Headers = map[int]adt.ChunkHeader{}
		for _, h := range t.Headers {
			if h.Chunk < 0 || h.Chunk >= adt.ChunkCount {
				return nil, fmt.Errorf("header chunk %d is outside the tile", h.Chunk)
			}
			ch.Headers[h.Chunk] = h.chunkHeader()
		}
	}
	for _, p := range t.Paint {
		if p.Chunk < 0 || p.Chunk >= adt.ChunkCount {
			return nil, fmt.Errorf("chunk %d is outside the tile", p.Chunk)
		}
		if len(p.Textures) == 0 {
			continue
		}
		if len(p.Textures) > 4 {
			return nil, fmt.Errorf("chunk %d has %d textures; a chunk takes four", p.Chunk, len(p.Textures))
		}
		weights, err := base64.StdEncoding.DecodeString(p.Weights)
		if err != nil {
			return nil, fmt.Errorf("chunk %d weights: %w", p.Chunk, err)
		}
		perSide := adt.AlphaSize / 2
		if len(weights) != perSide*perSide*4 {
			return nil, fmt.Errorf("chunk %d has %d weights, want %d", p.Chunk, len(weights), perSide*perSide*4)
		}
		ch.Paint[p.Chunk] = chunkPaint(p.Textures, p.Effects, p.Flags, p.NoEffect, weights, perSide)
	}
	return adt.BuildTile(t.Outer, ring, ch)
}

// liquidsByChunk groups liquid layers by their chunk's index, in a grid of perRow chunks a side,
// with a chunk's layers of one type joined (adt.MergeLiquids).
func liquidsByChunk(layers []adt.Liquid, perRow int) (map[int][]adt.Liquid, error) {
	out := map[int][]adt.Liquid{}
	for _, l := range layers {
		if l.IndexX < 0 || l.IndexY < 0 || l.IndexX >= perRow || l.IndexY >= perRow {
			return nil, fmt.Errorf("liquid in chunk %d,%d is outside the grid of %d", l.IndexX, l.IndexY, perRow)
		}
		if l.Type < adt.LiquidWater || l.Type > adt.LiquidSlime {
			return nil, fmt.Errorf("chunk %d,%d: liquid type %d is not one the 1.12 client has", l.IndexX, l.IndexY, l.Type)
		}
		k := l.IndexY*perRow + l.IndexX
		out[k] = append(out[k], l)
	}
	// Joined here as the writer joins them, so a region save compares the chunk the client will hold.
	for k, ls := range out {
		out[k] = adt.MergeLiquids(ls)
	}
	return out, nil
}

// objectIn converts a placed model to the file's terms: the tile's corner is added to X and Z, and
// the rotation is the one the client's placement matrix undoes (yaw is the Y angle minus 90).
func objectIn(tileX, tileY int, o ObjectSpec) (adt.Object, error) {
	var out adt.Object
	kind, name, set, _, err := parseModelType(o.Type)
	if err != nil {
		return out, err
	}
	out.Kind, out.Name, out.DoodadSet = kind, name, set
	out.Position = [3]float32{float32(tileX)*adt.TileSize + o.X, o.Y, float32(tileY)*adt.TileSize + o.Z}
	yaw := float64(o.RotY) * 180 / math.Pi
	out.Rotation = [3]float32{float32(float64(o.TiltX) * 180 / math.Pi), float32(yaw + 90), float32(float64(o.TiltZ) * 180 / math.Pi)}
	out.Scale = o.Scale
	if out.Scale == 0 {
		out.Scale = 1
	}
	return out, nil
}

// installServerMapTable copies the map table into the server's data, keeping the first copy it
// replaces as a backup.
func installServerMapTable(serverDir string, dbc []byte) (string, error) {
	return installServerDBC(serverDir, "Map.dbc", dbc)
}

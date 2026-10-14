package vmangos

import (
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"os"
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
	// Outer is the tile's ground: 129 x 129 heights, row-major, rows running south.
	Outer []float32
	// Paint holds the chunks that have paint: their textures (up to four, base first) and weights.
	Paint []PaintSpec
	// Objects are the models on the tile.
	Objects []ObjectSpec
	// Liquids are the tile's painted liquid layers, each placed by its chunk in the tile.
	Liquids []adt.Liquid
}

// PaintSpec is a chunk's paint: its index in the tile (y*16 + x), its textures in slot order, and
// four weights per texel (32 texels a side, row-major, base64 of bytes), each texel summing to 255.
type PaintSpec struct {
	Chunk    int
	Textures []string
	Weights  string
	// Effects is the GroundEffectTexture ID per texture (0 for none, or the tile's own); optional.
	Effects []uint32
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
}

// ExportResult says what was written.
type ExportResult struct {
	// Patch is the client's patch archive the files went into.
	Patch string
	// Server is the server's Map.dbc, when a server folder was given.
	Server string
	Tiles  int
}

// ExportMap writes a map's tiles, WDT and Map.dbc row into the client's patch archive. readDir is the
// client's Data folder, which the template files come from; patchDir is where the patch goes (the same
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
	if len(m.Tiles) == 0 {
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

	var files []mpq.File
	present := map[[2]int]bool{}
	for _, t := range m.Tiles {
		if t.X < 0 || t.X > 63 || t.Y < 0 || t.Y > 63 {
			return res, fmt.Errorf("tile %d,%d is outside the 64x64 map", t.X, t.Y)
		}
		if present[[2]int{t.X, t.Y}] {
			return res, fmt.Errorf("tile %d,%d is listed twice", t.X, t.Y)
		}
		present[[2]int{t.X, t.Y}] = true
		var water *adt.Water
		if m.Water {
			water = &adt.Water{Level: m.WaterLevel}
		}
		data, err := buildTile(t, water)
		if err != nil {
			return res, fmt.Errorf("tile %d,%d: %w", t.X, t.Y, err)
		}
		files = append(files, mpq.File{Name: adt.TilePath(m.Dir, t.X, t.Y, ""), Data: data})
	}

	wdtTemplate, err := set.ReadFile(`World\Maps\Azeroth\Azeroth.wdt`)
	if err != nil {
		return res, err
	}
	wdt, err := BuildWDT(wdtTemplate, func(x, y int) bool { return present[[2]int{x, y}] })
	if err != nil {
		return res, err
	}
	files = append(files,
		mpq.File{Name: fmt.Sprintf(`World\Maps\%s\%s.wdt`, m.Dir, m.Dir), Data: wdt},
		mpq.File{Name: `DBFilesClient\Map.dbc`, Data: dbc},
	)

	// The read archives hold the patch open, so they close before anything is written.
	set.Close()
	res.Patch, err = InstallPatch(patchDir, files)
	if err != nil {
		return res, err
	}
	res.Tiles = len(m.Tiles)
	if serverDir != "" {
		res.Server, err = installServerMapTable(serverDir, dbc)
		if err != nil {
			return res, err
		}
	}
	return res, nil
}

// buildTile writes one tile: its ground, paint and models.
func buildTile(t TileSpec, water *adt.Water) ([]byte, error) {
	ch := adt.Changes{TileX: t.X, TileY: t.Y, Paint: map[int]adt.ChunkPaint{}, Water: water}
	liquids, err := liquidsByChunk(t.Liquids, adt.ChunksPerTile)
	if err != nil {
		return nil, err
	}
	ch.Liquids = liquids
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
		ch.Paint[p.Chunk] = chunkPaint(p.Textures, p.Effects, weights, perSide)
	}
	for _, o := range t.Objects {
		obj, err := objectIn(t.X, t.Y, o)
		if err != nil {
			return nil, err
		}
		ch.Add = append(ch.Add, obj)
	}
	return adt.BuildTile(t.Outer, ch)
}

// liquidsByChunk groups liquid layers by their chunk's index, in a grid of perRow chunks a side.
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
	return out, nil
}

// objectIn converts a placed model to the file's terms: the tile's corner is added to X and Z, and
// the rotation is the one the client's placement matrix undoes (yaw is the Y angle minus 90).
func objectIn(tileX, tileY int, o ObjectSpec) (adt.Object, error) {
	var out adt.Object
	switch {
	case strings.HasPrefix(o.Type, "m2:"):
		out.Kind = adt.M2
		out.Name = strings.TrimPrefix(o.Type, "m2:")
	case strings.HasPrefix(o.Type, "wmo:"):
		out.Kind = adt.WMO
		out.Name = strings.TrimPrefix(o.Type, "wmo:")
	default:
		return out, fmt.Errorf("%q is not a model", o.Type)
	}
	if out.Name == "" {
		return out, fmt.Errorf("%q has no path", o.Type)
	}
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
	if err := CheckServer(serverDir); err != nil {
		return "", err
	}
	dir := filepath.Join(serverDir, "data", "5875", "dbc")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	target := filepath.Join(dir, "Map.dbc")
	if err := checkFree(target); err != nil {
		return "", err
	}
	if _, err := os.Stat(target); err == nil {
		if err := backup(target, target+BackupSuffix); err != nil {
			return "", err
		}
	}
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, dbc, 0o644); err != nil {
		return "", err
	}
	if err := replaceFile(tmp, target); err != nil {
		return "", err
	}
	return target, nil
}

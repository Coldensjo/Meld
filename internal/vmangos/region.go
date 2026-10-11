package vmangos

import (
	"fmt"
	"math"
	"strings"

	"WorldEditor/internal/adt"
	"WorldEditor/internal/mpq"
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
}

// ObjectView is a placed model in the block's coordinates. UID is the file's unique ID, or 0 for
// a model that isn't in the client yet. Y is the model's absolute height.
type ObjectView struct {
	UID   uint32  `json:"uid"`
	Type  string  `json:"type"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
	RotY  float32 `json:"rotY"`
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
}

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
	view := &RegionView{MapName: mapName, X: x, Y: y, Size: size, Heights: make([]float32, side*side)}
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
	switch p.Kind {
	case adt.M2:
		o.Type = "m2:" + p.Name
	case adt.WMO:
		o.Type = "wmo:" + p.Name
	default:
		return o, false
	}
	o.UID = p.UID
	o.X = p.Position[0] - float32(x)*adt.TileSize
	o.Y = p.Position[1]
	o.Z = p.Position[2] - float32(y)*adt.TileSize
	o.RotY = float32((float64(p.Rotation[1]) - 90) * math.Pi / 180)
	o.Scale = p.Scale
	return o, true
}

// placementFromView converts an object of the block back to a file placement, for the tile at (e.X, e.Y)
// of the block. With orig, the placement keeps the original's tilt and set numbers, and only its
// yaw changes.
func placementFromView(o ObjectView, e RegionEdit, orig *adt.Placement) (adt.Object, error) {
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
	out.UID = o.UID
	out.Position = [3]float32{o.X + float32(e.X)*adt.TileSize, o.Y, o.Z + float32(e.Y)*adt.TileSize}
	yaw := float64(o.RotY)*180/math.Pi + 90
	out.Rotation = [3]float32{0, float32(yaw), 0}
	out.Scale = o.Scale
	if orig != nil {
		out.DoodadSet, out.NameSet = orig.DoodadSet, orig.NameSet
		if angleDiff(yaw, float64(orig.Rotation[1])) < angleEpsilon {
			out.Rotation = orig.Rotation
		} else {
			out.Rotation[0], out.Rotation[2] = orig.Rotation[0], orig.Rotation[2]
		}
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
	typ := "m2:" + orig.Name
	if orig.Kind == adt.WMO {
		typ = "wmo:" + orig.Name
	}
	if o.Type != typ {
		return false
	}
	wx := o.X + float32(e.X)*adt.TileSize
	wz := o.Z + float32(e.Y)*adt.TileSize
	yaw := float64(o.RotY)*180/math.Pi + 90
	return math.Abs(float64(wx-orig.Position[0])) < posEpsilon &&
		math.Abs(float64(o.Y-orig.Position[1])) < posEpsilon &&
		math.Abs(float64(wz-orig.Position[2])) < posEpsilon &&
		angleDiff(yaw, float64(orig.Rotation[1])) < angleEpsilon &&
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
// that were removed in the editor are dropped. Paint isn't written, so it stays as the client has it.
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
			root, err := set.ReadFile(name)
			if err != nil {
				return nil, err
			}
			placements, err := adt.ParsePlacements(root)
			if err != nil {
				return nil, fmt.Errorf("tile %d_%d: %w", tx, ty, err)
			}
			t := tileEdit{name: name, root: root, orig: map[uint32]adt.Placement{}}
			t.change = adt.Changes{TileX: tx, TileY: ty, Remove: map[uint32]bool{}}
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
		tiles[k].change.Add = append(tiles[k].change.Add, obj)
	}
	for uid, k := range owner {
		if !seen[uid] {
			tiles[k].change.Remove[uid] = true
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
	return files, nil
}

// SaveRegion writes the edited block into the client's patch. Returns the patch's path.
func SaveRegion(dataDir string, e RegionEdit) (string, error) {
	files, err := BuildRegion(dataDir, e)
	if err != nil {
		return "", err
	}
	return InstallPatch(dataDir, files)
}

package vmangos

import (
	"math"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// Tiles outside the block (#647). The client lists a model in every tile its bounds overlap, under one
// ID, so a model by the edge of a compiled block is often listed by a tile outside it too. When a save
// moves, deletes or adds such a model, it writes those tiles as well, changing only their placements
// (MDDF/MODF and the chunks' MCRF) and starting from each as the client reads it now (Meld's patch
// included), since the rest of an outside tile is not the editor's: the owner's choice A on #647.

// outsideFix is a model whose copies in tiles outside the block a save brings in line with the block:
// one it moves, deletes or adds again, or one an earlier compile moved, deleted or added, which the
// block's tiles in Meld's patch list otherwise than the client's own tiles do.
type outsideFix struct {
	// final is where the model stands after the save, or nil when it is gone.
	final *adt.Object
	// near is the block tiles that list it, with Meld's patch or without, and old where they had it.
	near []int
	old  []adt.Placement
}

// saw notes that block tile k listed the model at p.
func (f *outsideFix) saw(k int, p adt.Placement) {
	f.old = append(f.old, p)
	for _, n := range f.near {
		if n == k {
			return
		}
	}
	f.near = append(f.near, k)
}

// objectOf is a placement as the object Rewrite writes for it.
func objectOf(p adt.Placement) adt.Object {
	return adt.Object{Kind: p.Kind, Name: p.Name, UID: p.UID, Position: p.Position, Rotation: p.Rotation,
		Scale: p.Scale, DoodadSet: p.DoodadSet, NameSet: p.NameSet}
}

// samePlace says whether a placement stands as an object does, within the tolerances unchanged uses.
func samePlace(p adt.Placement, o adt.Object) bool {
	if p.Kind != o.Kind || !strings.EqualFold(p.Name, o.Name) || p.DoodadSet != o.DoodadSet || p.NameSet != o.NameSet {
		return false
	}
	for k := 0; k < 3; k++ {
		if math.Abs(float64(p.Position[k]-o.Position[k])) >= posEpsilon || angleDiff(float64(p.Rotation[k]), float64(o.Rotation[k])) >= angleEpsilon {
			return false
		}
	}
	scale := o.Scale
	if scale == 0 {
		scale = 1
	}
	return math.Abs(float64(p.Scale-scale)) < 0.001
}

// patchHolds says whether Meld's patch has the named file.
func patchHolds(set *mpq.Set, name string) bool {
	for _, a := range set.Archives() {
		if strings.EqualFold(filepath.Base(a.Path), PatchName) && a.Has(name) {
			return true
		}
	}
	return false
}

// outsidePad is how far past a model's old bounds (from its size, as reaches.bound gives it) a tile
// outside the block is still looked at for a copy of it. A WMO's bounds in the client's tiles reach up
// to 7 yards past it on Azeroth; the M2s whose reach the size misses most (particle emitters, 250
// yards) are found as the neighbours of the block tiles that list them.
const outsidePad = adt.TileSize / adt.ChunksPerTile

// tilesReached adds to into the tiles of the map that the bounds lo..hi reach (reachesTile), pad yards
// wider each way.
func tilesReached(into map[[2]int]bool, lo, hi [3]float32, pad float32) {
	for k := 0; k < 3; k += 2 {
		lo[k] -= pad
		hi[k] += pad
	}
	x0 := max(0, int(math.Floor(float64(lo[0]/adt.TileSize)))-1)
	x1 := min(MapTiles-1, int(math.Floor(float64(hi[0]/adt.TileSize)))+1)
	y0 := max(0, int(math.Floor(float64(lo[2]/adt.TileSize)))-1)
	y1 := min(MapTiles-1, int(math.Floor(float64(hi[2]/adt.TileSize)))+1)
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			if reachesTile(lo, hi, x, y) {
				into[[2]int{x, y}] = true
			}
		}
	}
}

// outsideTile is a tile outside the block that may list a model the save changes, as the client reads
// it now.
type outsideTile struct {
	x, y   int
	name   string
	root   []byte
	placed map[uint32]adt.Placement
	// remove is the placements the save takes out (removals).
	remove map[uint32]bool
}

// readOutside reads the tiles of want the map has, in rows from the north-west.
func readOutside(set *mpq.Set, mapName string, want map[[2]int]bool) ([]outsideTile, error) {
	keys := make([][2]int, 0, len(want))
	for k := range want {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(a, b int) bool {
		if keys[a][1] != keys[b][1] {
			return keys[a][1] < keys[b][1]
		}
		return keys[a][0] < keys[b][0]
	})
	var out []outsideTile
	for _, k := range keys {
		name := adt.TilePath(mapName, k[0], k[1], "")
		if !set.Has(name) {
			continue
		}
		root, err := set.ReadFile(name)
		if err != nil {
			return nil, err
		}
		ps, err := adt.ParsePlacements(root)
		if err != nil {
			return nil, err
		}
		t := outsideTile{x: k[0], y: k[1], name: name, root: root, placed: map[uint32]adt.Placement{}}
		for _, p := range ps {
			if p.Kind == adt.M2 || p.Kind == adt.WMO {
				t.placed[p.UID] = p
			}
		}
		out = append(out, t)
	}
	return out, nil
}

// isCopy says whether a placement under the model's ID is a copy of it: the same model as the block's
// tiles have, or had, under that ID. A different model under it is another placement whose ID an old
// compile (before #491) handed out twice, which the save leaves alone.
func (f *outsideFix) isCopy(p adt.Placement) bool {
	same := func(kind adt.Kind, name string) bool { return kind == p.Kind && strings.EqualFold(name, p.Name) }
	if f.final != nil && same(f.final.Kind, f.final.Name) {
		return true
	}
	for _, o := range f.old {
		if same(o.Kind, o.Name) {
			return true
		}
	}
	return false
}

// removals works out which of the tile's placements the save takes out: the copies of the models in fix
// that don't stand where the block now has them. A copy already there is left as it is, whatever bounds
// listed it in this tile.
func (t *outsideTile) removals(fix map[uint32]*outsideFix) {
	t.remove = map[uint32]bool{}
	for uid, p := range t.placed {
		f := fix[uid]
		if f == nil || !f.isCopy(p) || f.final != nil && samePlace(p, *f.final) {
			continue
		}
		t.remove[uid] = true
	}
}

// changes is what the save writes into the tile: the removals, and every model of now (where the
// block's models stand after it, for those it moved, added or brought back) that reaches the tile and
// that it doesn't list already. ok is false when the tile stays as it is.
func (t *outsideTile) changes(now []adt.Object) (ch adt.Changes, ok bool) {
	ch = adt.Changes{TileX: t.x, TileY: t.y, Remove: t.remove}
	for _, o := range now {
		if _, listed := t.placed[o.UID]; listed && !t.remove[o.UID] {
			continue
		}
		if lo, hi := o.Bounds(); reachesTile(lo, hi, t.x, t.y) {
			ch.Add = append(ch.Add, o)
		}
	}
	return ch, len(ch.Remove) > 0 || len(ch.Add) > 0
}

// regionTile says whether a file is a tile of the block.
func regionTile(name string, e RegionEdit) bool {
	xs, ys, ok := strings.Cut(fileTileName(name), "_")
	if !ok {
		return false
	}
	x, errX := strconv.Atoi(xs)
	y, errY := strconv.Atoi(ys)
	return errX == nil && errY == nil && x >= e.X && x < e.X+e.Size && y >= e.Y && y < e.Y+e.Size
}

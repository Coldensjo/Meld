package vmangos

import (
	"encoding/binary"
	"fmt"
	"math"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// A WMO-only map (most 1.12 dungeons and raids: Molten Core, the Stockade, Blackfathom Deeps) is one
// building placed by its WDT and no tiles. The editor opens it as a region over the tiles the
// building covers, with flat ground under it that it hides, and the building as the region's one
// model (#271).
//
// The client's WDTs all place the building at 0,0,0, and the server's creatures stand in it as if
// that were the world's origin: the middle of the map, ZeroPoint yards from its corner in the tile
// files' frame. vmangos' vmap extractor does the same, and only for a building at exactly 0 on the
// ground plane (wmo.cpp, WMOInstance). So the WDT's position is the file frame less ZeroPoint on X
// and Z, and the editor reads it that way; a building moved off 0 would be placed by the client and
// the server's collision data differently, which is why a save refuses to move it, and why a new
// WMO-only map (ExportMap, MapSpec.Global) writes its building at 0 on X and Z whatever its spot in
// the editor (the owner's choice on #272; the editor's frame for such a map follows the building).

// globalGroundDrop is how far below the building's lowest point the hidden ground lies, in yards.
const globalGroundDrop = 20

// globalBlockMargin is how far past the building's bounds the opened block reaches, in yards, so
// creatures standing at its very edge are in the block too.
const globalBlockMargin = 30

// wdtHasTiles says whether a WDT's MAIN table marks any tile as having an ADT.
func wdtHasTiles(wdt []byte) bool {
	for o := 0; o+8 <= len(wdt); {
		id := string([]byte{wdt[o+3], wdt[o+2], wdt[o+1], wdt[o]})
		size := int(binary.LittleEndian.Uint32(wdt[o+4:]))
		if size < 0 || o+8+size > len(wdt) {
			return false
		}
		if id == "MAIN" {
			for i := 0; i+8 <= size; i += 8 {
				if wdt[o+8+i]&1 != 0 {
					return true
				}
			}
			return false
		}
		o += 8 + size
	}
	return false
}

// wmoOnlyBuilding returns the building of a WMO-only map's WDT; ok is false for a map with tiles.
func wmoOnlyBuilding(wdt []byte) (GlobalWMO, bool) {
	if wdtHasTiles(wdt) {
		return GlobalWMO{}, false
	}
	return ParseGlobalWMO(wdt)
}

// globalToFile converts a WDT position to the tile files' frame (see the note at the top).
func globalToFile(p [3]float32) [3]float32 {
	return [3]float32{p[0] + adt.ZeroPoint, p[1], p[2] + adt.ZeroPoint}
}

// GlobalBlock is the square block of tiles a WMO-only map's building covers, with a margin: the
// region the editor opens for the map.
func GlobalBlock(w GlobalWMO) (x, y, size int) {
	lo, hi := globalToFile(w.Min), globalToFile(w.Max)
	tile := func(v float32) int {
		return clampTile(int(math.Floor(float64(v)/adt.TileSize)), MapTiles)
	}
	x0, x1 := tile(lo[0]-globalBlockMargin), tile(hi[0]+globalBlockMargin)
	y0, y1 := tile(lo[2]-globalBlockMargin), tile(hi[2]+globalBlockMargin)
	size = min(max(x1-x0, y1-y0)+1, MaxRegion)
	// Square, grown evenly round the narrower side's middle and kept on the map.
	x = min(max(0, (x0+x1+1-size)/2), MapTiles-size)
	y = min(max(0, (y0+y1+1-size)/2), MapTiles-size)
	return x, y, size
}

// ReadWMOOnlyRegion reads a WMO-only map as a region over its building's block (GlobalBlock).
func ReadWMOOnlyRegion(dataDir, mapName string) (*RegionView, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	wdt, err := set.ReadFile(fmt.Sprintf(`World\Maps\%s\%s.wdt`, mapName, mapName))
	set.Close()
	if err != nil {
		return nil, err
	}
	w, ok := wmoOnlyBuilding(wdt)
	if !ok {
		return nil, fmt.Errorf("%s is not a single building: it has terrain tiles, or its WDT places no building", mapName)
	}
	x, y, size := GlobalBlock(w)
	return ReadRegion(dataDir, mapName, x, y, size)
}

// globalPlacement is a WMO-only map's building as a tile placement in the file frame.
func globalPlacement(w GlobalWMO) adt.Placement {
	return adt.Placement{Kind: adt.WMO, Name: w.Name, UID: GlobalUID, Position: globalToFile(w.Position),
		Rotation: w.Rotation, Scale: 1, DoodadSet: w.DoodadSet}
}

// wmoOnlyView fills an empty region view of a WMO-only map: flat ground below the building and the
// building as its one model.
func wmoOnlyView(view *RegionView, w GlobalWMO) {
	view.WMOOnly = true
	ground := w.Min[1] - globalGroundDrop
	for i := range view.Heights {
		view.Heights[i] = ground
	}
	if o, ok := objectView(globalPlacement(w), view.X, view.Y); ok {
		view.Objects = append(view.Objects, o)
	}
	lo, hi := globalToFile(w.Min), globalToFile(w.Max)
	ox, oz := float32(view.X)*adt.TileSize, float32(view.Y)*adt.TileSize
	view.Bounds = []float32{lo[0] - ox, lo[1], lo[2] - oz, hi[0] - ox, hi[1], hi[2] - oz}
}

// buildWMOOnly is BuildRegion for a WMO-only map: the region's one model is the building, and the map's
// WDT is its only file, written only when the building differs from wdt (the client's WDT with every
// patch, as ReadRegion read it). The ground is not written, since the map has no tiles. The building may change
// its model or doodad set, but not move, turn or scale (see the note at the top), and the map can hold
// no other models.
func buildWMOOnly(set *mpq.Set, e RegionEdit, wdt []byte, w GlobalWMO) ([]mpq.File, error) {
	name := fmt.Sprintf(`World\Maps\%s\%s.wdt`, e.MapName, e.MapName)
	orig := globalPlacement(w)
	var building *ObjectView
	others := 0
	for i := range e.Objects {
		if e.Objects[i].UID == GlobalUID && building == nil {
			building = &e.Objects[i]
		} else {
			others++
		}
	}
	if building == nil {
		return nil, fmt.Errorf("%s is its building: put the building back (Undo) before saving, since the map can't be without it", e.MapName)
	}
	if others > 0 {
		return nil, fmt.Errorf("%s is a single building with no ground tiles, which hold every other model: remove the %d models placed on it", e.MapName, others)
	}
	kind, model, doodadSet, hasSet, err := parseModelType(building.Type)
	if err != nil {
		return nil, err
	}
	if kind != adt.WMO {
		return nil, fmt.Errorf("%s's building must be a WMO, not %s", e.MapName, model)
	}
	if !hasSet {
		doodadSet = 0 // adt.ModelType leaves set 0 out of the name
	}
	moved := ObjectView{Type: adt.ModelType(adt.WMO, orig.Name, orig.DoodadSet), X: building.X, Y: building.Y, Z: building.Z,
		RotY: building.RotY, TiltX: building.TiltX, TiltZ: building.TiltZ, Scale: building.Scale}
	if !unchanged(moved, e, orig) {
		return nil, fmt.Errorf("%s's building can't be moved, turned or scaled: the server's creatures and collision stand where the client has it. Put it back (Undo) to save", e.MapName)
	}
	if model == orig.Name && doodadSet == orig.DoodadSet {
		return nil, nil // as the client has it
	}
	out := w
	out.Name, out.DoodadSet = model, doodadSet
	if model != orig.Name {
		obj := adt.Object{Kind: adt.WMO, Name: model, Position: orig.Position, Rotation: orig.Rotation, Scale: 1}
		newReaches(set).bound(&obj)
		for k := 0; k < 3; k++ {
			out.Min[k], out.Max[k] = obj.Min[k]-(orig.Position[k]-w.Position[k]), obj.Max[k]-(orig.Position[k]-w.Position[k])
		}
	}
	b, err := BuildWMOOnlyWDT(wdt, out)
	if err != nil {
		return nil, err
	}
	return []mpq.File{{Name: name, Data: b}}, nil
}

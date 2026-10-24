package otbm

import (
	"errors"
	"fmt"
	"sort"

	"Meld/internal/worldfile"
)

const (
	// TextureBase is the texture id item 0 would be painted with: item n is texture TextureBase + n, so
	// a Tibia item id never takes the id of a texture the game has or will have soon.
	TextureBase = 0x8000
	// FloorLayer is the layer of Tibia's floor 0: floor z's cubes are in layer z + FloorLayer. Floor 7,
	// Tibia's ground floor, lands on layer 9, where a player of the game stands on the ground layer, and
	// floor 15, the deepest, on layer 17, above the lava cavern.
	FloorLayer = 2
	// Floors is how many floors a Tibia map has, 0 (the highest) to 15.
	Floors = 16

	// The OTBM node types and tile attributes the import reads.
	nodeMapData  = 2
	nodeTileArea = 4
	nodeTile     = 5
	nodeItem     = 6
	nodeTowns    = 12
	nodeTown     = 13
	nodeHouse    = 14

	tileAttrFlags = 3
	tileAttrItem  = 9

	// The cubes a tile becomes (crates/world KINDS and SHAPES).
	kindDirt       = 1
	kindStone      = 2
	kindWood       = 4
	shapeFull      = 0
	shapeFloorSlab = 21
)

// What an item became, as Report.Items tells it.
const (
	AsFloor    = "floor"    // a walkable ground: a floor slab
	AsRock     = "rock"     // a ground nothing passes or sees through (earth, mountain): a full cube
	AsWall     = "wall"     // an item that blocks walking and sight: a full cube
	AsObstacle = "obstacle" // an item that blocks walking only (a tree, a bush, a statue, furniture): a full wooden cube
	AsBorder   = "border"   // a border: drawn over the top of the tile's cube, see-through (3dgame #226)
	AsDropped  = "dropped"  // a loose item, a border under another, or one under a wall or an obstacle
	AsUnknown  = "unknown"  // an id items.otb has not got
)

// Outcomes is every way an item can go, in the order the item list gives them.
var Outcomes = []string{AsFloor, AsRock, AsWall, AsObstacle, AsBorder, AsDropped, AsUnknown}

// ItemUse is how often an item stands on the map's tiles, and how often it became each outcome.
type ItemUse struct {
	Count int
	As    map[string]int
}

// Painted says whether the item became a cube's texture on any tile.
func (u *ItemUse) Painted() bool {
	return u.As[AsFloor]+u.As[AsRock]+u.As[AsWall]+u.As[AsObstacle]+u.As[AsBorder] > 0
}

// Report says what an import read and made.
type Report struct {
	Tiles int
	Cubes int
	// Floors is the tiles on each floor.
	Floors [Floors]int
	// Items is every item id on the map's tiles.
	Items map[uint16]*ItemUse
	// MinX and MinY are the Tibia position of the world's cube (0, 0).
	MinX, MinY int
	// Spawn is the first town's temple, when the map has one.
	Spawn string
	// Warnings are what the import could not take as it is.
	Warnings []string
}

// tile is the tile being read: where it is and the items that matter, its border the topmost.
type tile struct {
	x, y, z                        int
	ground, wall, obstacle, border uint16
}

// chunk is a chunk being built, by its absolute chunk position.
type chunk struct {
	cubes   []byte
	paint   []uint16
	overlay []uint16
}

// Convert imports the OTBM map in data, made with the item table items, into a cube world: each tile
// of floor z at (x, y) becomes the cube at (x - MinX, y - MinY) of layer z + FloorLayer, painted on
// every face with the texture TextureBase + the id of the item it shows, and the world gets a hint (a
// name and the item's minimap colour) for each such texture.
func Convert(data []byte, items Items) (*worldfile.World, *Report, error) {
	rep := &Report{Items: map[uint16]*ItemUse{}}
	chunks := map[[3]int]*chunk{}
	var areaX, areaY, areaZ int
	var cur *tile
	tileDepth := -1
	type town struct{ x, y, z int }
	var temple *town
	inTowns := false
	use := func(id uint16, as string) {
		u := rep.Items[id]
		if u == nil {
			u = &ItemUse{As: map[string]int{}}
			rep.Items[id] = u
		}
		u.Count++
		u.As[as]++
	}
	// item sorts an item of the tile being read: its ground, its wall or its obstacle, or dropped.
	item := func(id uint16) {
		it := items[id]
		switch {
		case it == nil:
			use(id, AsUnknown)
		case it.Ground():
			cur.ground = id
		case it.Border():
			// Only the topmost border is kept: 98% of a map's bordered tiles have one.
			if cur.border != 0 {
				use(cur.border, AsDropped)
			}
			cur.border = id
		case it.Opaque():
			cur.wall = id
		case it.Blocks():
			cur.obstacle = id
		default:
			use(id, AsDropped)
		}
	}
	visit := func(depth int, typ byte, b []byte) error {
		p := &props{b: b}
		switch {
		case depth == 0:
			if v := p.u32(); v > 4 {
				rep.Warnings = append(rep.Warnings, fmt.Sprintf("OTBM version %d is newer than this import knows (4)", v))
			}
		case typ == nodeTileArea && depth == 2:
			areaX, areaY, areaZ = int(p.u16()), int(p.u16()), int(p.u8())
		case (typ == nodeTile || typ == nodeHouse) && depth == 3:
			cur = &tile{x: areaX + int(p.u8()), y: areaY + int(p.u8()), z: areaZ}
			tileDepth = depth
			if typ == nodeHouse {
				p.u32() // the house's id, which a cube world has no place for
			}
			for p.left() > 0 && !p.short {
				switch p.u8() {
				case tileAttrFlags:
					p.u32() // protection zone and the like
				case tileAttrItem:
					item(p.u16())
				default:
					p.b = nil
				}
			}
		case typ == nodeItem && cur != nil && depth == tileDepth+1:
			item(p.u16())
		case typ == nodeTowns && depth == 2:
			inTowns = true
		case typ == nodeTown && inTowns && temple == nil:
			p.u32()
			name := p.str()
			temple = &town{x: int(p.u16()), y: int(p.u16()), z: int(p.u8())}
			rep.Spawn = fmt.Sprintf("the temple of %s (%d, %d, floor %d)", name, temple.x, temple.y, temple.z)
		}
		return nil
	}
	leave := func(depth int, typ byte) error {
		if typ == nodeTowns {
			inTowns = false
		}
		if cur == nil || depth != tileDepth {
			return nil
		}
		t := cur
		cur, tileDepth = nil, -1
		rep.Tiles++
		if t.z < 0 || t.z >= Floors {
			return nil
		}
		rep.Floors[t.z]++
		var kind, shape byte
		var shown uint16
		g := items[t.ground]
		switch {
		case t.ground != 0 && g.Opaque():
			kind, shape, shown = kindStone, shapeFull, t.ground
			use(t.ground, AsRock)
			if t.wall != 0 {
				use(t.wall, AsDropped)
			}
		case t.wall != 0:
			kind, shape, shown = kindStone, shapeFull, t.wall
			use(t.wall, AsWall)
		case t.obstacle != 0:
			kind, shape, shown = kindWood, shapeFull, t.obstacle
			use(t.obstacle, AsObstacle)
		case t.ground != 0:
			kind, shape, shown = kindDirt, shapeFloorSlab, t.ground
			use(t.ground, AsFloor)
		default:
			return nil
		}
		// The ground under a wall or an obstacle, and an obstacle under a wall, are not shown.
		if t.ground != 0 && shown != t.ground && !g.Opaque() {
			use(t.ground, AsDropped)
		}
		if t.obstacle != 0 && shown != t.obstacle {
			use(t.obstacle, AsDropped)
		}
		if int(shown) >= 0x10000-TextureBase {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("item %d is past the texture ids and is left out", shown))
			return nil
		}
		layer := t.z + FloorLayer
		key := [3]int{t.x >> 4, t.y >> 4, layer}
		c := chunks[key]
		if c == nil {
			c = &chunk{cubes: make([]byte, worldfile.PlanesLen), paint: make([]uint16, worldfile.PaintLen)}
			chunks[key] = c
		}
		i := (t.y&15)*worldfile.ChunkSize + t.x&15
		if c.cubes[i] == 0 {
			rep.Cubes++
		}
		c.cubes[i], c.cubes[worldfile.ChunkArea+i], c.cubes[2*worldfile.ChunkArea+i] = kind, shape, 0
		for f := range worldfile.FaceCount {
			c.paint[f*worldfile.ChunkArea+i] = TextureBase + shown
		}
		// The border lies over the top of whatever the tile became.
		if t.border != 0 && int(t.border) < 0x10000-TextureBase {
			if c.overlay == nil {
				c.overlay = make([]uint16, worldfile.OverlayLen)
			}
			c.overlay[i] = TextureBase + t.border
			use(t.border, AsBorder)
		}
		return nil
	}
	if err := walk(data, visit, leave); err != nil {
		return nil, nil, err
	}
	if len(chunks) == 0 {
		return nil, nil, errors.New("the map has no tiles")
	}

	// The world is the chunks the tiles touch, from the least chunk position.
	minCX, minCZ, maxCX, maxCZ := 1<<30, 1<<30, -1, -1
	for k := range chunks {
		minCX, minCZ = min(minCX, k[0]), min(minCZ, k[1])
		maxCX, maxCZ = max(maxCX, k[0]), max(maxCZ, k[1])
	}
	rep.MinX, rep.MinY = minCX*worldfile.ChunkSize, minCZ*worldfile.ChunkSize
	w := &worldfile.World{ChunksX: uint32(maxCX - minCX + 1), ChunksZ: uint32(maxCZ - minCZ + 1)}
	for k, c := range chunks {
		w.Chunks = append(w.Chunks, worldfile.Chunk{CX: int32(k[0] - minCX), CZ: int32(k[1] - minCZ), Layer: uint8(k[2]), Cubes: c.cubes, Paint: c.paint, Overlay: c.overlay})
	}
	if temple != nil && temple.z >= 0 && temple.z < Floors {
		x, z := temple.x-rep.MinX, temple.y-rep.MinY
		if x >= 0 && z >= 0 && x < int(w.ChunksX)*worldfile.ChunkSize && z < int(w.ChunksZ)*worldfile.ChunkSize {
			w.Spawn = &worldfile.CubePos{X: int32(x), Z: int32(z), Layer: uint8(temple.z + FloorLayer)}
		}
	}

	// A hint for every texture painted: the item's name and minimap colour.
	shown := map[uint16]bool{}
	for _, c := range w.Chunks {
		for _, t := range append(c.Paint, c.Overlay...) {
			if t != 0 {
				shown[t-TextureBase] = true
			}
		}
	}
	ids := make([]int, 0, len(shown))
	for id := range shown {
		ids = append(ids, int(id))
	}
	sort.Ints(ids)
	for _, id := range ids {
		w.Hints = append(w.Hints, Hint(uint16(id), items))
	}
	return w, rep, nil
}

// Hint is the texture hint of item `id` painted as a texture (TextureBase + id): its name from
// items.xml with its id, "grass (item 4526)", so the editor's searches find it by either, and its
// minimap colour.
func Hint(id uint16, items Items) worldfile.TextureHint {
	it := items[id]
	name := fmt.Sprintf("item %d", id)
	if it != nil && it.Name != "" {
		name = fmt.Sprintf("%s (item %d)", it.Name, id)
	}
	return worldfile.TextureHint{ID: TextureBase + id, Colour: itemColour(id, it), Name: name}
}

// TextureItems is every item of the table that can be a cube's texture: the grounds and floors, the
// walls (blocking walking and sight) and the borders, in id order (3dgame #227).
func TextureItems(items Items) []uint16 {
	var ids []uint16
	for id, it := range items {
		if int(id) < 0x10000-TextureBase && (it.Ground() || it.Opaque() || it.Border()) {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

// itemColour is an item's colour as 0xRRGGBB: its minimap colour, one of Tibia's 216 (six levels each
// of red, green and blue), or, for an item without one, a muted colour of its own made from its id, but
// dark brown for earth (item 101), the filler of a map's underground, which has none.
func itemColour(id uint16, it *Item) uint32 {
	if it != nil && it.Colour >= 0 && it.Colour < 216 {
		c := uint32(it.Colour)
		return (c/36%6*51)<<16 | (c/6%6*51)<<8 | c%6*51
	}
	if id == 101 {
		return 0x4a3a2c
	}
	h := uint32(id) * 2654435761
	return (70+h>>8%120)<<16 | (70+h>>16%120)<<8 | (70 + h>>24%120)
}

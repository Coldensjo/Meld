package wow

import (
	"encoding/binary"
	"math"
	"testing"

	"Meld/internal/adt"
)

// A tile Meld builds reads back as the heights it was built from, its holes in the right cells, and
// EncodeGround lays them out as the world view reads them (world/worldGround.ts).
func TestTileGroundReadsABuiltTile(t *testing.T) {
	outer := make([]float32, GroundSide*GroundSide)
	for y := 0; y < GroundSide; y++ {
		for x := 0; x < GroundSide; x++ {
			outer[y*GroundSide+x] = float32(x)*0.5 - float32(y)*0.25 + 40
		}
	}
	// One 2x2-cell hole block in chunk (3, 2): block (1, 2) of its 4x4 bitmap, cells 2-3 x 4-5.
	bits := uint16(1 << (2*4 + 1))
	// Chunk (3, 2) also takes area 1519, the impassable flag and no tufts on cells (1, 6) and (7, 0).
	impassable := true
	noEffect := []uint8{1 << 7, 0, 0, 0, 0, 0, 1 << 1, 0}
	root, err := adt.BuildTile(outer, adt.Ring{}, adt.Changes{TileX: 30, TileY: 40, Headers: map[int]adt.ChunkHeader{2*16 + 3: {Holes: &bits, AreaID: 1519, Impassable: &impassable, NoEffect: noEffect}}})
	if err != nil {
		t.Fatal(err)
	}
	g, err := TileGround(root)
	if err != nil {
		t.Fatal(err)
	}
	h, holes := g.Heights, g.Holes
	if len(h) != GroundSide*GroundSide || len(holes) != groundCells*groundCells {
		t.Fatalf("%d heights and %d hole cells", len(h), len(holes))
	}
	for i, v := range outer {
		if math.Abs(float64(h[i]-v)) > 1e-3 {
			t.Fatalf("sample %d (%d, %d): %v, built %v", i, i%GroundSide, i/GroundSide, h[i], v)
		}
	}
	want := map[int]bool{}
	for _, c := range [][2]int{{2, 4}, {3, 4}, {2, 5}, {3, 5}} {
		want[(2*8+c[1])*groundCells+3*8+c[0]] = true
	}
	for i, v := range holes {
		if (v == 1) != want[i] {
			t.Fatalf("cell (%d, %d): hole %d", i%groundCells, i/groundCells, v)
		}
	}
	const chunk = 2*16 + 3
	if len(g.Areas) != 256 || len(g.Impassable) != 256 || len(g.NoEffect) != len(holes) {
		t.Fatalf("%d areas, %d impassable, %d no-effect cells", len(g.Areas), len(g.Impassable), len(g.NoEffect))
	}
	for i := range g.Areas {
		if (g.Areas[i] == 1519) != (i == chunk) || (g.Impassable[i] == 1) != (i == chunk) {
			t.Fatalf("chunk %d: area %d, impassable %d", i, g.Areas[i], g.Impassable[i])
		}
	}
	tufts := map[int]bool{(2*8+6)*groundCells + 3*8 + 1: true, (2*8+0)*groundCells + 3*8 + 7: true}
	for i, v := range g.NoEffect {
		if (v == 1) != tufts[i] {
			t.Fatalf("cell (%d, %d): no effect %d", i%groundCells, i/groundCells, v)
		}
	}
	b := EncodeGround(g)
	if string(b[:4]) != "GRND" || len(b) != 4+len(h)*4+len(holes)+256*4+256+len(holes) {
		t.Fatalf("reply %q, %d bytes", b[:4], len(b))
	}
	at := GroundSide*7 + 5
	if got := math.Float32frombits(binary.LittleEndian.Uint32(b[4+at*4:])); got != h[at] {
		t.Fatalf("encoded sample %d: %v, want %v", at, got, h[at])
	}
	if b[4+len(h)*4+(2*8+4)*groundCells+3*8+2] != 1 {
		t.Fatal("encoded holes are not after the heights")
	}
	areas := 4 + len(h)*4 + len(holes)
	if areas%4 != 0 || binary.LittleEndian.Uint32(b[areas+chunk*4:]) != 1519 || b[areas+256*4+chunk] != 1 || b[areas+256*5+(2*8+6)*groundCells+3*8+1] != 1 {
		t.Fatal("encoded areas, flags or no-effect bits are not after the holes")
	}
}

// A tile's models read back in the map's editor coordinates under the editor's names: a WMO's doodad
// set in its name, and the turn the region reader gives it (yaw the file's middle angle less 90°).
func TestTileModelsReadABuiltTile(t *testing.T) {
	outer := make([]float32, GroundSide*GroundSide)
	tx, ty := 30, 40
	x0, z0 := float32(tx)*adt.TileSize, float32(ty)*adt.TileSize
	set := adt.Changes{TileX: tx, TileY: ty, Add: []adt.Object{
		{Kind: adt.M2, Name: `World\Tree.m2`, UID: 7, Position: [3]float32{x0 + 10, 55, z0 + 20}, Rotation: [3]float32{0, 180, 0}, Scale: 1.5},
		{Kind: adt.WMO, Name: `World\wmo\Inn.wmo`, UID: 9, Position: [3]float32{x0 + 100, 60, z0 + 200}, Rotation: [3]float32{10, 90, -5}, Scale: 1, DoodadSet: 2},
	}}
	root, err := adt.BuildTile(outer, adt.Ring{}, set)
	if err != nil {
		t.Fatal(err)
	}
	models, err := TileModels(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 {
		t.Fatalf("%d models: %+v", len(models), models)
	}
	near := func(a, b float32) bool { return math.Abs(float64(a-b)) < 1e-3 }
	tree, inn := models[0], models[1]
	if tree.Type != `m2:World\Tree.m2` || tree.UID != 7 || !near(tree.X, x0+10) || !near(tree.Y, 55) || !near(tree.Z, z0+20) ||
		!near(tree.RotY, math.Pi/2) || !near(tree.Scale, 1.5) {
		t.Fatalf("tree %+v", tree)
	}
	if inn.Type != `wmo:World\wmo\Inn.wmo?set=2` || inn.UID != 9 || !near(inn.X, x0+100) || !near(inn.Z, z0+200) ||
		!near(inn.RotY, 0) || !near(inn.TiltX, 10*math.Pi/180) || !near(inn.TiltZ, -5*math.Pi/180) {
		t.Fatalf("inn %+v", inn)
	}
}

// A tile's texture layers read back as the world view draws them: the textures it names, each chunk's
// slots naming them in layer order, and the weights adt.ClientWeights gives at the chunk's place in the
// tile; a chunk with no layer has no slot and its first weight full. EncodePaint lays them out as
// world/worldPaint.ts reads them.
func TestTilePaintReadsABuiltTile(t *testing.T) {
	outer := make([]float32, GroundSide*GroundSide)
	alpha := make([]byte, adt.AlphaSize*adt.AlphaSize)
	for i := range alpha {
		alpha[i] = byte(i % 251)
	}
	grass, dirt := `Tileset\Elwynn\ElwynnGrassBase.blp`, `Tileset\Elwynn\ElwynnDirtBase2.blp`
	// Chunk (5, 2): the 37th in the file's order.
	painted := adt.ChunkPaint{Layers: []adt.Layer{{Texture: grass}, {Texture: dirt, Alpha: alpha}}}
	root, err := adt.BuildTile(outer, adt.Ring{}, adt.Changes{TileX: 30, TileY: 40, Paint: map[int]adt.ChunkPaint{2*16 + 5: painted}})
	if err != nil {
		t.Fatal(err)
	}
	names, slots, weights, err := TilePaint(root, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(slots) != 16*16*4 || len(weights) != PaintSide*PaintSide*4 {
		t.Fatalf("%d slots and %d weights", len(slots), len(weights))
	}
	c := 2*16 + 5
	if slots[c*4] == NoSlot || slots[c*4+1] == NoSlot || slots[c*4+2] != NoSlot || names[slots[c*4]] != grass || names[slots[c*4+1]] != dirt {
		t.Fatalf("chunk (5, 2) slots %v of %q", slots[c*4:c*4+4], names)
	}
	if slots[0] != NoSlot || weights[0] != 255 || weights[1] != 0 {
		t.Fatalf("an unpainted chunk: slots %v, weights %v", slots[:4], weights[:4])
	}
	ter, err := adt.ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	tex, err := adt.ParseTextures(root, false, ter)
	if err != nil {
		t.Fatal(err)
	}
	var own adt.TexChunk
	for i, ch := range ter.Chunks {
		if ch.IndexX == 5 && ch.IndexY == 2 {
			own = tex.Chunks[i]
		}
	}
	want := adt.ClientWeights(own, PaintPerChunk)
	for v := 0; v < PaintPerChunk; v++ {
		for u := 0; u < PaintPerChunk; u++ {
			at := ((2*PaintPerChunk+v)*PaintSide + 5*PaintPerChunk + u) * 4
			for k := 0; k < 4; k++ {
				if weights[at+k] != want[(v*PaintPerChunk+u)*4+k] {
					t.Fatalf("texel (%d, %d) weight %d: %d, want %d", u, v, k, weights[at+k], want[(v*PaintPerChunk+u)*4+k])
				}
			}
		}
	}
	b := EncodePaint(names, slots, weights)
	head := 6
	for _, s := range names {
		head += 2 + len(s)
	}
	if string(b[:4]) != "PANT" || int(binary.LittleEndian.Uint16(b[4:])) != len(names) || len(b) != head+len(slots)+len(weights) {
		t.Fatalf("reply %q, %d bytes", b[:4], len(b))
	}
	if l := int(binary.LittleEndian.Uint16(b[6:])); string(b[8:8+l]) != names[0] {
		t.Fatalf("first name %q", b[8:8+l])
	}
	if b[head+c*4+1] != slots[c*4+1] || b[head+len(slots)+4] != weights[4] {
		t.Fatal("the slots and weights are not after the names")
	}
}

// A tile's liquids encode as the world view reads them (world/worldLiquid.ts): each layer's chunk,
// type, heights, depths and cells, in the order ParseLiquids reads them.
func TestEncodeLiquidsOfABuiltTile(t *testing.T) {
	outer := make([]float32, GroundSide*GroundSide)
	lake := adt.Liquid{Type: adt.LiquidWater}
	for v := range lake.Heights {
		lake.Heights[v] = 2 + float32(v%9)*0.25
		lake.Depth[v] = byte(v)
	}
	lake.Cells[0], lake.Cells[9] = true, true
	root, err := adt.BuildTile(outer, adt.Ring{}, adt.Changes{TileX: 30, TileY: 40, Liquids: map[int][]adt.Liquid{3*16 + 7: {lake}}})
	if err != nil {
		t.Fatal(err)
	}
	layers, err := adt.ParseLiquids(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(layers) != 1 {
		t.Fatalf("%d layers", len(layers))
	}
	b := EncodeLiquids(layers)
	if string(b[:4]) != "LIQD" || binary.LittleEndian.Uint16(b[4:]) != 1 || len(b) != 6+LiquidLayerSize {
		t.Fatalf("reply %q, %d bytes", b[:4], len(b))
	}
	l := b[6:]
	if l[0] != 7 || l[1] != 3 || l[2] != adt.LiquidWater {
		t.Fatalf("chunk (%d, %d) type %d", l[0], l[1], l[2])
	}
	if h := math.Float32frombits(binary.LittleEndian.Uint32(l[4+10*4:])); h != lake.Heights[10] {
		t.Fatalf("vertex 10 at %v, want %v", h, lake.Heights[10])
	}
	depth := l[4+liquidVerts*4:]
	cells := depth[liquidVerts:]
	if depth[10] != 10 || cells[0] != 1 || cells[9] != 1 || cells[1] != 0 {
		t.Fatalf("depth %d, cells %v", depth[10], cells[:10])
	}
}

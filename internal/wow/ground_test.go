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
	root, err := adt.BuildTile(outer, adt.Ring{}, adt.Changes{TileX: 30, TileY: 40, Headers: map[int]adt.ChunkHeader{2*16 + 3: {Holes: &bits}}})
	if err != nil {
		t.Fatal(err)
	}
	h, holes, err := TileGround(root)
	if err != nil {
		t.Fatal(err)
	}
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
	b := EncodeGround(h, holes)
	if string(b[:4]) != "GRND" || len(b) != 4+len(h)*4+len(holes) {
		t.Fatalf("reply %q, %d bytes", b[:4], len(b))
	}
	at := GroundSide*7 + 5
	if got := math.Float32frombits(binary.LittleEndian.Uint32(b[4+at*4:])); got != h[at] {
		t.Fatalf("encoded sample %d: %v, want %v", at, got, h[at])
	}
	if b[4+len(h)*4+(2*8+4)*groundCells+3*8+2] != 1 {
		t.Fatal("encoded holes are not after the heights")
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

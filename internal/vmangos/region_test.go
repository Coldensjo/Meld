package vmangos

import (
	"math"
	"os"
	"testing"

	"WorldEditor/internal/adt"
	"WorldEditor/internal/wow"
)

func TestPlacementRoundTrip(t *testing.T) {
	p := adt.Placement{
		Kind:     adt.M2,
		Name:     `World\Azeroth\Tree.m2`,
		UID:      7,
		Position: [3]float32{33*adt.TileSize + 40, 120, 48*adt.TileSize + 90},
		Rotation: [3]float32{0, 120, 0},
		Scale:    1.5,
	}
	const x, y = 32, 47
	e := RegionEdit{X: x, Y: y, Size: 2}
	o, ok := objectView(p, x, y)
	if !ok {
		t.Fatal("an M2 placement must convert")
	}
	if math.Abs(float64(o.RotY)-30*math.Pi/180) > 1e-5 {
		t.Fatalf("yaw 120 should read as 30 degrees, got %v radians", o.RotY)
	}
	if !unchanged(o, e, p) {
		t.Fatal("a placement read from a file must be unchanged")
	}
	back, err := placementFromView(o, e, &p)
	if err != nil {
		t.Fatal(err)
	}
	if back.Position != p.Position || back.Rotation != p.Rotation || back.Scale != p.Scale || back.Name != `World\Azeroth\Tree.m2` {
		t.Fatalf("round trip changed the placement: %+v", back)
	}
}

func TestEditedPlacementKeepsTilt(t *testing.T) {
	orig := adt.Placement{
		Kind:     adt.WMO,
		Name:     `World\wmo\House.wmo`,
		UID:      9,
		Position: [3]float32{100, 50, 200},
		Rotation: [3]float32{10, 90, 5},
		Scale:    1,
		NameSet:  2,
	}
	e := RegionEdit{Size: 1}
	o, _ := objectView(orig, 0, 0)
	o.RotY = float32(180 * math.Pi / 180)
	if unchanged(o, e, orig) {
		t.Fatal("a turned model is an edit")
	}
	obj, err := placementFromView(o, e, &orig)
	if err != nil {
		t.Fatal(err)
	}
	if obj.Rotation[0] != 10 || obj.Rotation[2] != 5 {
		t.Fatalf("tilt was lost: rotation %v", obj.Rotation)
	}
	if obj.Rotation[1] != 270 {
		t.Fatalf("yaw should be 180+90, got %v", obj.Rotation[1])
	}
	if obj.NameSet != 2 {
		t.Fatalf("WMO name set was lost: %d", obj.NameSet)
	}
}

func TestMovedPlacementIsEdited(t *testing.T) {
	orig := adt.Placement{Kind: adt.M2, Name: `World\Tree.m2`, Position: [3]float32{10, 20, 30}, Rotation: [3]float32{0, 90, 0}, Scale: 1}
	o, _ := objectView(orig, 0, 0)
	o.X += 1
	if unchanged(o, RegionEdit{Size: 1}, orig) {
		t.Fatal("a moved model is an edit")
	}
}

func TestNewObjectGoesToItsTile(t *testing.T) {
	e := RegionEdit{Size: 3}
	o := ObjectView{Type: "m2:x.m2", X: 2.5 * adt.TileSize, Z: 0.5 * adt.TileSize}
	if got := tileOf(o, e.Size); got != 0*3+2 {
		t.Fatalf("tile index %d, want column 2 of row 0", got)
	}
	o.X = -50
	if got := tileOf(o, e.Size); got != 0 {
		t.Fatalf("an object left of the block belongs to its first tile, got %d", got)
	}
}

// TestRegionNoEditRoundTrip reads a real region of the client and writes it back unedited. The
// placements and heights must come out as they went in. It needs WOW_DIR set to the client.
func TestRegionNoEditRoundTrip(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 2)
	if err != nil {
		t.Fatal(err)
	}
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: view.Heights, Objects: view.Objects}
	files, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 4 {
		t.Fatalf("a 2x2 region writes 4 tiles, got %d", len(files))
	}
	// Each tile's heights must sit at its place in the stitched block, checked against a tile read on its own.
	side := view.Size*tileCells + 1
	for k := 0; k < view.Size*view.Size; k++ {
		i, j := k%view.Size, k/view.Size
		tile, _, err := ReadTile(dataDir, "Azeroth", view.X+i, view.Y+j)
		if err != nil {
			t.Fatal(err)
		}
		for r := 0; r < LatticeSize; r++ {
			for c := 0; c < LatticeSize; c++ {
				got := view.Heights[(j*tileCells+r)*side+i*tileCells+c]
				if got != tile.Heights[r*LatticeSize+c] {
					t.Fatalf("tile %d,%d sample %d,%d: block has %v, tile has %v", i, j, r, c, got, tile.Heights[r*LatticeSize+c])
				}
			}
		}
	}
	for k, f := range files {
		tx, ty := view.X+k%view.Size, view.Y+k/view.Size
		_, original, err := ReadTile(dataDir, "Azeroth", tx, ty)
		if err != nil {
			t.Fatal(err)
		}
		before, err := adt.ParsePlacements(original)
		if err != nil {
			t.Fatal(err)
		}
		after, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatal(err)
		}
		if len(after) != len(before) {
			t.Fatalf("tile %d_%d: %d models after the write, %d before", tx, ty, len(after), len(before))
		}
		byUID := map[uint32]adt.Placement{}
		for _, p := range before {
			byUID[p.UID] = p
		}
		for _, p := range after {
			q, ok := byUID[p.UID]
			if !ok || q.Position != p.Position || q.Rotation != p.Rotation || q.Name != p.Name {
				t.Fatalf("tile %d_%d: model %d changed by an unedited write", tx, ty, p.UID)
			}
		}
		t0, err := adt.ParseTerrain(original)
		if err != nil {
			t.Fatal(err)
		}
		t1, err := adt.ParseTerrain(f.Data)
		if err != nil {
			t.Fatal(err)
		}
		for c := range t0.Chunks {
			for h := range t0.Chunks[c].Heights {
				if math.Abs(float64(t0.Chunks[c].Heights[h]-t1.Chunks[c].Heights[h])) > 1e-3 {
					t.Fatalf("tile %d_%d chunk %d: height %d changed by an unedited write", tx, ty, c, h)
				}
			}
		}
	}
}

// TestRegionMoveRoundTrip moves one model of a real region and checks that the write puts it at
// the new place, under the same unique ID and with its tilt kept. It needs WOW_DIR set.
func TestRegionMoveRoundTrip(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Objects) == 0 {
		t.Skip("no models in the region")
	}
	moved := view.Objects[0]
	moved.X += 5
	objects := append([]ObjectView{moved}, view.Objects[1:]...)
	files, err := BuildRegion(dataDir, RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: view.Heights, Objects: objects})
	if err != nil {
		t.Fatal(err)
	}
	placements, err := adt.ParsePlacements(files[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range placements {
		if p.UID != moved.UID {
			continue
		}
		want := view.Objects[0].X + 5 + float32(view.X)*adt.TileSize
		if math.Abs(float64(p.Position[0]-want)) > 0.01 {
			t.Fatalf("model %d at x %v, want %v", p.UID, p.Position[0], want)
		}
		_, original, err := ReadTile(dataDir, "Azeroth", view.X, view.Y)
		if err != nil {
			t.Fatal(err)
		}
		before, err := adt.ParsePlacements(original)
		if err != nil {
			t.Fatal(err)
		}
		for _, q := range before {
			if q.UID == moved.UID && (q.Rotation[0] != p.Rotation[0] || q.Rotation[2] != p.Rotation[2]) {
				t.Fatalf("model %d lost its tilt: %v became %v", p.UID, q.Rotation, p.Rotation)
			}
		}
		return
	}
	t.Fatalf("model %d is missing after the move", moved.UID)
}

package vmangos

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// TestRegionBorderModelsInEveryTile saves a 2x2 block of a made-up map whose tiles 0_0 and 1_0 both list
// three models by their border, as the client's tiles list a model in each tile it overlaps (#646). The
// editor gets each once; a moved one leaves both tiles and goes only where it now reaches, a deleted one
// leaves both, an unchanged one stays in both, and one added on the block's middle corner goes into all
// four tiles under one ID.
func TestRegionBorderModelsInEveryTile(t *testing.T) {
	dir := t.TempDir()
	at := func(uid uint32, x, z float32) adt.Object {
		return adt.Object{Kind: adt.M2, Name: `World\Test\Tree.m2`, UID: uid, Position: [3]float32{x, 0, z}, Rotation: [3]float32{0, 90, 0}, Scale: 1}
	}
	moved, deleted, kept := at(30, adt.TileSize-5, 50), at(40, adt.TileSize-5, 150), at(50, adt.TileSize+5, 300)
	tile := func(x, y int, objs ...adt.Object) mpq.File {
		root, err := adt.BuildTile(flatTile(0), adt.Changes{TileX: x, TileY: y, Add: objs})
		if err != nil {
			t.Fatal(err)
		}
		return mpq.File{Name: adt.TilePath("Border", x, y, ""), Data: root}
	}
	// A WDT with every tile of the block, from a template that is only its MPHD.
	mphd := binary.LittleEndian.AppendUint32([]byte("DHPM"), 32)
	wdt, err := BuildWDT(append(mphd, make([]byte, 32)...), func(x, y int) bool { return x < 2 && y < 2 })
	if err != nil {
		t.Fatal(err)
	}
	files := []mpq.File{
		{Name: `World\Maps\Border\Border.wdt`, Data: wdt},
		tile(0, 0, moved, deleted, kept),
		tile(1, 0, moved, deleted, kept),
		tile(0, 1),
		tile(1, 1),
	}
	if err := os.WriteFile(filepath.Join(dir, "terrain.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}

	view, err := ReadRegion(dir, "Border", 0, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Objects) != 3 {
		t.Fatalf("the editor got %d models, want the 3 the two tiles list, once each", len(view.Objects))
	}
	var objects []ObjectView
	for _, o := range view.Objects {
		switch o.UID {
		case 30:
			o.X, o.Z = 50, 50 // into tile 0_0 alone
		case 40:
			continue
		}
		objects = append(objects, o)
	}
	objects = append(objects, ObjectView{Type: `m2:World\Test\Rock.m2`, X: adt.TileSize, Z: adt.TileSize, Scale: 1})
	side := 2*tileCells + 1
	out, err := BuildRegion(dir, RegionEdit{MapName: "Border", X: 0, Y: 0, Size: 2, Heights: EncodeHeights(make([]float32, side*side)), Objects: objects})
	if err != nil {
		t.Fatal(err)
	}

	byTile := map[string]map[uint32]adt.Placement{}
	for _, f := range out {
		name := fileTileName(f.Name)
		if name == "" {
			continue
		}
		placed, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		byTile[name] = map[uint32]adt.Placement{}
		for _, p := range placed {
			if _, twice := byTile[name][p.UID]; twice {
				t.Fatalf("tile %s lists ID %d twice", name, p.UID)
			}
			byTile[name][p.UID] = p
		}
	}
	has := func(tile string, uid uint32) bool {
		_, ok := byTile[tile][uid]
		return ok
	}
	if p, ok := byTile["0_0"][30]; !ok || p.Position[0] != 50 {
		t.Fatalf("the moved model in 0_0 is %+v (listed %v), want it at x 50", p, ok)
	}
	if has("1_0", 30) {
		t.Fatal("tile 1_0 kept the moved model at its old place")
	}
	if has("0_0", 40) || has("1_0", 40) {
		t.Fatal("a tile kept the deleted model")
	}
	if !has("0_0", 50) || !has("1_0", 50) {
		t.Fatal("the unchanged border model left a tile that listed it")
	}
	var added uint32
	for uid := range byTile["0_0"] {
		if uid != 30 && uid != 50 {
			added = uid
		}
	}
	if added <= 50 {
		t.Fatalf("the added model's ID is %d, want one above the block's", added)
	}
	for _, name := range []string{"0_0", "1_0", "0_1", "1_1"} {
		if !has(name, added) {
			t.Fatalf("tile %s lacks the model added on its corner (ID %d)", name, added)
		}
		if n := len(byTile[name]); name != "0_0" && name != "1_0" && n != 1 {
			t.Fatalf("tile %s lists %d models, want only the added one", name, n)
		}
	}
}

// TestClientRegionBorderModels opens Azeroth's 2x2 block at 32_48, whose tiles list some models twice
// (by their borders), moves one such model a few yards and deletes another, and checks the written
// tiles: the editor got each once, the moved one is in every tile its bounds reach at its new place and
// in no tile at the old one, and the deleted one is in none. It needs WOW_DIR.
func TestClientRegionBorderModels(t *testing.T) {
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
	inView := map[uint32]int{}
	for i, o := range view.Objects {
		if _, twice := inView[o.UID]; twice && o.UID != 0 {
			t.Fatalf("the editor got model %d twice", o.UID)
		}
		inView[o.UID] = i
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	listed := map[uint32]int{}
	orig := map[uint32]adt.Placement{}
	for y := 48; y < 50; y++ {
		for x := 32; x < 34; x++ {
			root, err := readUnpatched(set, adt.TilePath("Azeroth", x, y, ""))
			if err != nil {
				t.Fatal(err)
			}
			placed, err := adt.ParsePlacements(root)
			if err != nil {
				t.Fatal(err)
			}
			for _, p := range placed {
				listed[p.UID]++
				orig[p.UID] = p
			}
		}
	}
	set.Close()
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights)}
	// Two models the client's own tiles list twice, as the editor still has them.
	var border []uint32
	for uid, n := range listed {
		if i, ok := inView[uid]; ok && n > 1 && orig[uid].Kind == adt.M2 && unchanged(view.Objects[i], edit, orig[uid]) {
			border = append(border, uid)
		}
	}
	if len(border) < 2 {
		t.Fatalf("%d models of the block are listed by two of its tiles, want at least 2", len(border))
	}
	movedUID, deletedUID := border[0], border[1]
	for _, o := range view.Objects {
		switch o.UID {
		case movedUID:
			o.X += 3
		case deletedUID:
			continue
		}
		edit.Objects = append(edit.Objects, o)
	}
	files, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	want := orig[movedUID].Position[0] + 3
	movedIn := 0
	for _, f := range files {
		if fileTileName(f.Name) == "" {
			continue
		}
		placed, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		for _, p := range placed {
			switch p.UID {
			case deletedUID:
				t.Fatalf("%s kept the deleted model %d", f.Name, p.UID)
			case movedUID:
				if math.Abs(float64(p.Position[0]-want)) > 0.01 {
					t.Fatalf("%s lists the moved model %d at x %v, want %v", f.Name, p.UID, p.Position[0], want)
				}
				movedIn++
			}
		}
	}
	if movedIn == 0 {
		t.Fatalf("no tile lists the moved model %d", movedUID)
	}
	t.Logf("%d models listed by two or more tiles; moved %d (now in %d tiles), deleted %d", len(border), movedUID, movedIn, deletedUID)
}

// TestClientBorderTilesAgree checks blockTilesOf, with the model sizes reaches reads, against the tiles
// the client's own files list each model in, over Azeroth 28-35 x 44-51 (models 200 yards inside it):
// nearly every M2 and every WMO gets at least the client's tiles. It needs WOW_DIR.
func TestClientBorderTilesAgree(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	const x0, y0, size = 28, 44, 8
	e := RegionEdit{X: x0, Y: y0, Size: size}
	listedIn := map[uint32]int{}
	placements := map[uint32]adt.Placement{}
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			root, err := readUnpatched(set, adt.TilePath("Azeroth", x0+i, y0+j, ""))
			if err != nil {
				t.Fatal(err)
			}
			placed, err := adt.ParsePlacements(root)
			if err != nil {
				t.Fatal(err)
			}
			for _, p := range placed {
				listedIn[p.UID]++
				placements[p.UID] = p
			}
		}
	}
	rc := newReaches(set)
	total, fewer := map[adt.Kind]int{}, map[adt.Kind]int{}
	const margin = 200
	for uid, n := range listedIn {
		p := placements[uid]
		v := ObjectView{X: p.Position[0] - x0*adt.TileSize, Z: p.Position[2] - y0*adt.TileSize}
		if v.X < margin || v.Z < margin || v.X > size*adt.TileSize-margin || v.Z > size*adt.TileSize-margin {
			continue
		}
		o := adt.Object{Kind: p.Kind, Name: p.Name, Position: p.Position, Scale: p.Scale}
		rc.bound(&o)
		total[p.Kind]++
		if len(blockTilesOf(o, v, e)) < n {
			fewer[p.Kind]++
		}
	}
	t.Logf("M2s: %d of %d in fewer tiles than the client's; WMOs: %d of %d", fewer[adt.M2], total[adt.M2], fewer[adt.WMO], total[adt.WMO])
	if total[adt.M2] == 0 || fewer[adt.M2]*50 > total[adt.M2] || fewer[adt.WMO] > 0 {
		t.Fatal("the tile rule misses too many of the client's tiles")
	}
}

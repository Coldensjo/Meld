package vmangos

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
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
		root, err := adt.BuildTile(flatTile(0), adt.Ring{}, adt.Changes{TileX: x, TileY: y, Add: objs})
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

// TestRegionBorderModelsOutsideBlock compiles the 1x1 block 0_0 of a made-up 2x1 map whose tile 1_0,
// outside the block, lists three of its border models too (#647). The outside tile drops the one moved
// away and the one deleted, keeps the unchanged one and its own model as they were, and takes a model
// moved or added so that it reaches it, under the block's ID, with its ground untouched. Compiled again
// from the patch, nothing changes; and a model moved back where the client had it, or one added and
// then deleted, leaves the outside tile as it should.
func TestRegionBorderModelsOutsideBlock(t *testing.T) {
	dir := t.TempDir()
	at := func(uid uint32, x, z float32) adt.Object {
		return adt.Object{Kind: adt.M2, Name: `World\Test\Tree.m2`, UID: uid, Position: [3]float32{x, 0, z}, Rotation: [3]float32{0, 90, 0}, Scale: 1}
	}
	moved, deleted, kept := at(30, adt.TileSize-5, 50), at(40, adt.TileSize-5, 150), at(50, adt.TileSize+5, 300)
	theirs, inward := at(60, adt.TileSize+200, 200), at(70, 100, 400)
	tile := func(x, y int, h float32, objs ...adt.Object) mpq.File {
		root, err := adt.BuildTile(flatTile(h), adt.Ring{}, adt.Changes{TileX: x, TileY: y, Add: objs})
		if err != nil {
			t.Fatal(err)
		}
		return mpq.File{Name: adt.TilePath("Edge", x, y, ""), Data: root}
	}
	mphd := binary.LittleEndian.AppendUint32([]byte("DHPM"), 32)
	wdt, err := BuildWDT(append(mphd, make([]byte, 32)...), func(x, y int) bool { return x < 2 && y == 0 })
	if err != nil {
		t.Fatal(err)
	}
	outsideFile := tile(1, 0, 7, moved, deleted, kept, theirs)
	files := []mpq.File{{Name: `World\Maps\Edge\Edge.wdt`, Data: wdt}, tile(0, 0, 0, moved, deleted, kept, inward), outsideFile}
	if err := os.WriteFile(filepath.Join(dir, "terrain.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	clientOutside, err := adt.ParsePlacements(outsideFile.Data)
	if err != nil {
		t.Fatal(err)
	}
	listedBy := func(placed []adt.Placement) map[uint32]adt.Placement {
		m := map[uint32]adt.Placement{}
		for _, p := range placed {
			if _, twice := m[p.UID]; twice {
				t.Fatalf("ID %d listed twice", p.UID)
			}
			m[p.UID] = p
		}
		return m
	}
	client := listedBy(clientOutside)
	tiles := func(out []mpq.File) map[string]map[uint32]adt.Placement {
		by := map[string]map[uint32]adt.Placement{}
		for _, f := range out {
			if name := fileTileName(f.Name); name != "" {
				placed, err := adt.ParsePlacements(f.Data)
				if err != nil {
					t.Fatalf("%s: %v", f.Name, err)
				}
				by[name] = listedBy(placed)
			}
		}
		return by
	}

	view, err := ReadRegion(dir, "Edge", 0, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	var objects []ObjectView
	for _, o := range view.Objects {
		switch o.UID {
		case 30:
			o.X = 50 // off the border, into 0_0 alone
		case 40:
			continue
		case 70:
			o.X = adt.TileSize - 3 // now reaching 1_0
		}
		objects = append(objects, o)
	}
	objects = append(objects, ObjectView{Type: `m2:World\Test\Rock.m2`, X: adt.TileSize - 4, Z: 450, Scale: 1})
	heights := EncodeHeights(make([]float32, LatticeSize*LatticeSize))
	edit := RegionEdit{MapName: "Edge", X: 0, Y: 0, Size: 1, Heights: heights, Objects: objects}
	out, res, err := RegionChanges(dir, edit)
	if err != nil {
		t.Fatal(err)
	}
	if res.Changed != 1 || res.Outside != 1 || len(res.ChangedTiles) != 2 {
		t.Fatalf("the compile wrote %d block tiles and %d outside (%v), want 1 and 1", res.Changed, res.Outside, res.ChangedTiles)
	}
	by := tiles(out)
	var added uint32
	for uid := range by["0_0"] {
		if uid != 30 && uid != 50 && uid != 70 {
			added = uid
		}
	}
	if added <= 70 {
		t.Fatalf("the added model's ID is %d, want one above the map's", added)
	}
	outside := by["1_0"]
	for _, uid := range []uint32{30, 40} {
		if _, ok := outside[uid]; ok {
			t.Fatalf("the tile outside the block kept model %d at its old place", uid)
		}
	}
	for _, uid := range []uint32{50, 60} {
		if outside[uid] != client[uid] {
			t.Fatalf("the tile outside the block changed model %d: %+v, was %+v", uid, outside[uid], client[uid])
		}
	}
	if p, ok := outside[70]; !ok || p.Position[0] != adt.TileSize-3 {
		t.Fatalf("model 70, moved to reach the tile outside, is %+v there (listed %v)", p, ok)
	}
	if _, ok := outside[added]; !ok {
		t.Fatal("the tile outside the block lacks the model added by its edge")
	}
	if len(outside) != 4 {
		t.Fatalf("the tile outside lists %d models, want 4", len(outside))
	}
	for _, f := range out {
		if fileTileName(f.Name) != "1_0" {
			continue
		}
		before, err := viewOf(outsideFile.Data, false)
		if err != nil {
			t.Fatal(err)
		}
		after, err := viewOf(f.Data, false)
		if err != nil {
			t.Fatal(err)
		}
		for i := range before.Heights {
			if before.Heights[i] != after.Heights[i] {
				t.Fatalf("the tile outside the block's height %d is %v, was %v", i, after.Heights[i], before.Heights[i])
			}
		}
	}

	// Compiled into the patch, the same edit and the block read back from it both change nothing.
	if _, err := InstallPatch(dir, out); err != nil {
		t.Fatal(err)
	}
	if _, res, err := RegionChanges(dir, edit); err != nil || res.Files != 0 {
		t.Fatalf("the same edit again changes %d files (%v, err %v), want none", res.Files, res.ChangedTiles, err)
	}
	view, err = ReadRegion(dir, "Edge", 0, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	reread := RegionEdit{MapName: "Edge", X: 0, Y: 0, Size: 1, Heights: heights, Objects: view.Objects}
	if _, res, err := RegionChanges(dir, reread); err != nil || res.Files != 0 {
		t.Fatalf("the block read back from the patch changes %d files (%v, err %v), want none", res.Files, res.ChangedTiles, err)
	}

	// Model 30 back where the client had it and the added one deleted: the outside tile lists 30 there
	// again, and not the added one.
	objects = nil
	for _, o := range view.Objects {
		switch o.UID {
		case 30:
			o.X = adt.TileSize - 5
		case added:
			continue
		}
		objects = append(objects, o)
	}
	out, err = BuildRegion(dir, RegionEdit{MapName: "Edge", X: 0, Y: 0, Size: 1, Heights: heights, Objects: objects})
	if err != nil {
		t.Fatal(err)
	}
	by = tiles(out)
	if p, ok := by["1_0"][30]; !ok || p.Position != moved.Position {
		t.Fatalf("model 30, moved back, is %+v in the tile outside (listed %v), want it at %v", p, ok, moved.Position)
	}
	if _, ok := by["1_0"][added]; ok {
		t.Fatal("the tile outside kept the deleted model an earlier compile added")
	}
	if _, ok := by["0_0"][added]; ok {
		t.Fatal("the block kept the deleted model an earlier compile added")
	}
}

// TestClientRegionBorderModels opens Azeroth's 2x2 block at 32_48, whose tiles list some models twice
// (by their borders), moves one such model a few yards and deletes another, and checks the written
// tiles: the editor got each once, the moved one is in every tile its bounds reach at its new place and
// in no tile at the old one, and the deleted one is in none. It needs WOW_DIR.
func TestClientRegionBorderModels(t *testing.T) {
	dir := testclient.DataDir(t)
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

// TestClientRegionOutsideTiles compiles Azeroth's 1x1 block at 32_48 with two models that a tile
// outside it lists too moved a few yards and deleted (#647), and checks the outside tiles written
// against the client's: the moved model is in every one its bounds reach at its new place and in none
// at the old one, the deleted one is in none, and their ground, paint, liquids and every other model
// are as the client reads them now. It needs WOW_DIR.
func TestClientRegionOutsideTiles(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	const x0, y0 = 32, 48
	view, err := ReadRegion(dataDir, "Azeroth", x0, y0, 1)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	// The tiles around the block as the client reads them now, and the models they list.
	before := map[string][]byte{}
	listedOutside := map[uint32]int{}
	for y := y0 - 1; y <= y0+1; y++ {
		for x := x0 - 1; x <= x0+1; x++ {
			name := adt.TilePath("Azeroth", x, y, "")
			if x == x0 && y == y0 || !set.Has(name) {
				continue
			}
			root, err := set.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			before[fileTileName(name)] = root
			placed, err := adt.ParsePlacements(root)
			if err != nil {
				t.Fatal(err)
			}
			for _, p := range placed {
				listedOutside[p.UID]++
			}
		}
	}
	set.Close()
	edit := RegionEdit{MapName: view.MapName, X: x0, Y: y0, Size: 1, Heights: EncodeHeights(view.Heights)}
	var border []uint32
	for _, o := range view.Objects {
		if listedOutside[o.UID] > 0 && o.UID != 0 && strings.HasPrefix(o.Type, "m2:") {
			border = append(border, o.UID)
		}
	}
	if len(border) < 2 {
		t.Fatalf("%d M2s of the block are listed by a tile outside it, want at least 2", len(border))
	}
	movedUID, deletedUID := border[0], border[1]
	var want [3]float32
	for _, o := range view.Objects {
		switch o.UID {
		case movedUID:
			o.Z += 3
			want = [3]float32{o.X + x0*adt.TileSize, o.Y, o.Z + y0*adt.TileSize}
		case deletedUID:
			continue
		}
		edit.Objects = append(edit.Objects, o)
	}
	start := time.Now()
	files, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	took := time.Since(start)
	written := 0
	for _, f := range files {
		name := fileTileName(f.Name)
		was, outside := before[name]
		if !outside {
			continue
		}
		written++
		old, err := adt.ParsePlacements(was)
		if err != nil {
			t.Fatal(err)
		}
		placed, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		others := func(ps []adt.Placement) []adt.Placement {
			var out []adt.Placement
			for _, p := range ps {
				if p.UID != movedUID && p.UID != deletedUID {
					out = append(out, p)
				}
			}
			return out
		}
		if !reflect.DeepEqual(others(old), others(placed)) {
			t.Fatalf("%s changed models the save didn't touch", f.Name)
		}
		for _, p := range placed {
			if p.UID == deletedUID {
				t.Fatalf("%s kept the deleted model %d", f.Name, p.UID)
			}
			if p.UID == movedUID && (math.Abs(float64(p.Position[0]-want[0])) > 0.01 || math.Abs(float64(p.Position[2]-want[2])) > 0.01) {
				t.Fatalf("%s lists the moved model %d at %v, want %v", f.Name, p.UID, p.Position, want)
			}
		}
		a, err := viewOf(was, false)
		if err != nil {
			t.Fatal(err)
		}
		b, err := viewOf(f.Data, false)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(a.Heights, b.Heights) || !reflect.DeepEqual(a.Chunks, b.Chunks) || !bytes.Equal(a.Alpha, b.Alpha) || !reflect.DeepEqual(a.Liquids, b.Liquids) {
			t.Fatalf("%s's ground, paint or liquids changed", f.Name)
		}
	}
	if written == 0 {
		t.Fatal("no tile outside the block was written")
	}
	t.Logf("moved %d, deleted %d; %d tiles outside written; the build took %v", movedUID, deletedUID, written, took)
}

// TestClientBorderTilesAgree checks blockTilesOf, with the model sizes reaches reads, against the tiles
// the client's own files list each model in, over Azeroth 28-35 x 44-51 (models 200 yards inside it):
// nearly every M2 and every WMO gets at least the client's tiles. It needs WOW_DIR.
func TestClientBorderTilesAgree(t *testing.T) {
	dir := testclient.DataDir(t)
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

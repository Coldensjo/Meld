package vmangos

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestRegionAddedModelsGetMapWideIDs saves a 2x2 block of a made-up map with a model added in three
// of its tiles. Each tile numbered its own after its highest ID, so the client and the server's vmaps
// dropped all but the first loaded of a shared ID (#491); now they take IDs above every placement of
// the map: the block's tiles without Meld's patch, and the map's other tiles as the client reads them
// (here 3_3's 900, from Meld's patch).
func TestRegionAddedModelsGetMapWideIDs(t *testing.T) {
	dir := t.TempDir()
	tile := func(x, y int, objs ...adt.Object) mpq.File {
		root, err := adt.BuildTile(flatTile(0), adt.Ring{}, adt.Changes{TileX: x, TileY: y, Add: objs})
		if err != nil {
			t.Fatal(err)
		}
		return mpq.File{Name: adt.TilePath("UIDTest", x, y, ""), Data: root}
	}
	at := func(uid uint32, x, z float32) adt.Object {
		return adt.Object{Kind: adt.M2, Name: `World\Test\Tree.m2`, UID: uid, Position: [3]float32{x, 0, z}, Scale: 1}
	}
	base := []mpq.File{
		tile(0, 0, at(10, 50, 50)),
		tile(1, 0, at(20, adt.TileSize+50, 50)),
		tile(0, 1),
		tile(1, 1),
		tile(3, 3, at(700, 3*adt.TileSize+50, 3*adt.TileSize+50)),
	}
	// Meld's patch holds earlier saves: of tile 0_0, which this save rebuilds from the client's own
	// (its 5000 doesn't count), and of 3_3, which it leaves as the client now reads it (its 900 does).
	patch := []mpq.File{
		tile(0, 0, at(10, 50, 50), at(5000, 60, 60)),
		tile(3, 3, at(700, 3*adt.TileSize+50, 3*adt.TileSize+50), at(900, 3*adt.TileSize+60, 3*adt.TileSize+60)),
	}
	for name, files := range map[string][]mpq.File{"terrain.MPQ": base, PatchName: patch} {
		if err := os.WriteFile(filepath.Join(dir, name), mpq.Write(files), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	added := func(x, z float32) ObjectView {
		return ObjectView{Type: `m2:World\Test\Rock.m2`, X: x, Z: z, Scale: 1}
	}
	kept := func(uid uint32, x, z float32) ObjectView {
		o, _ := objectView(adt.Placement{Kind: adt.M2, Name: `World\Test\Tree.m2`, UID: uid, Position: [3]float32{x, 0, z}, Rotation: [3]float32{0, 90, 0}, Scale: 1}, 0, 0)
		return o
	}
	side := 2*tileCells + 1
	files, err := BuildRegion(dir, RegionEdit{MapName: "UIDTest", X: 0, Y: 0, Size: 2, Heights: EncodeHeights(make([]float32, side*side)), Objects: []ObjectView{
		kept(10, 50, 50), kept(20, adt.TileSize+50, 50),
		added(100, 100), added(adt.TileSize-1, 100), added(adt.TileSize+1, 100), added(adt.TileSize+100, adt.TileSize+100),
	}})
	if err != nil {
		t.Fatal(err)
	}
	// The two added by the border between 0_0 and 1_0 are listed by both tiles, under one ID (#646).
	var uids []uint32
	for _, f := range files {
		placed, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		for _, p := range placed {
			uids = append(uids, p.UID)
		}
	}
	slices.Sort(uids)
	uids = slices.Compact(uids)
	if want := []uint32{10, 20, 901, 902, 903, 904}; !slices.Equal(uids, want) {
		t.Fatalf("IDs %v, want %v: the kept ones and four above the map's highest", uids, want)
	}
}

// TestClientTileUIDMax checks the quick read of a client tile's highest ID (the start of the file
// only, its compressed sectors unpacked as far as needed) against parsing the whole tile, on a
// quarter of Azeroth's tiles. It needs WOW_DIR.
func TestClientTileUIDMax(t *testing.T) {
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
	checked := 0
	for y := 0; y < MapTiles; y++ {
		for x := 0; x < MapTiles; x += 4 {
			name := adt.TilePath("Azeroth", x, y, "")
			if !set.Has(name) {
				continue
			}
			whole, err := set.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			head, err := set.ReadPrefix(name, 5000)
			if err != nil || len(head) < min(5000, len(whole)) || !bytes.Equal(head, whole[:len(head)]) {
				t.Fatalf("%s: the first %d bytes differ from the whole file's (%v)", name, len(head), err)
			}
			placed, err := adt.ParsePlacements(whole)
			if err != nil {
				t.Fatal(err)
			}
			var want uint32
			for _, p := range placed {
				if p.UID != GlobalUID {
					want = max(want, p.UID)
				}
			}
			if got, err := tileUIDMax(set, name); err != nil || got != want {
				t.Fatalf("%s: highest ID %d (%v), want %d", name, got, err, want)
			}
			checked++
		}
	}
	if checked == 0 {
		t.Fatal("no Azeroth tiles in the client")
	}
}

// TestClientRegionAddedModelIDs saves Azeroth's 2x2 block at 32_48 with a model added in two tiles and
// checks the written tiles: every model of the client's own tiles keeps its ID, and the added ones (with
// any an earlier compile added, which Meld's patch holds) have IDs of their own, above every placement of
// the map's other tiles. It needs WOW_DIR.
func TestClientRegionAddedModelIDs(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 2)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	var others uint32
	own := map[uint32]bool{}
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
				own[p.UID] = true
				others = max(others, p.UID)
			}
		}
	}
	rock := `m2:World\Generic\Passive Doodads\Rocks\Rock01.m2`
	objects := append(view.Objects[:len(view.Objects):len(view.Objects)],
		ObjectView{Type: rock, X: adt.TileSize - 5, Y: 60, Z: 100, Scale: 1},
		ObjectView{Type: rock, X: adt.TileSize + 5, Y: 60, Z: 100, Scale: 1})
	files, err := BuildRegion(dataDir, RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights), Objects: objects})
	if err != nil {
		t.Fatal(err)
	}
	before := map[uint32]bool{}
	renumbered := 0
	for _, o := range view.Objects {
		if own[o.UID] {
			before[o.UID] = true
		} else {
			renumbered++
		}
	}
	seen := map[uint32]bool{}
	addedAt := map[uint32][3]float32{}
	var added []uint32
	// Only the block's tiles, which come first: a tile outside it (#647) lists its own models too.
	for _, f := range files[:view.Size*view.Size] {
		placed, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		for _, p := range placed {
			if !before[p.UID] {
				// A model added by a border is listed by each tile it reaches, at the one place (#646).
				if q, ok := addedAt[p.UID]; ok {
					if q != p.Position {
						t.Fatalf("two added models share ID %d", p.UID)
					}
					continue
				}
				addedAt[p.UID] = p.Position
				added = append(added, p.UID)
			}
			seen[p.UID] = true
		}
	}
	// The tiles outside the block the save rewrote (#647) list copies of the block's models, which must
	// stand where the block's tiles have them, and their own models, whose IDs the added ones must be
	// above, as must those of every tile the save leaves alone.
	outside := map[string]bool{}
	for _, f := range files[view.Size*view.Size:] {
		if !strings.EqualFold(filepath.Ext(f.Name), ".adt") {
			continue
		}
		outside[strings.ToLower(f.Name)] = true
		placed, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		for _, p := range placed {
			if q, ok := addedAt[p.UID]; ok {
				if q != p.Position {
					t.Fatalf("%s: model %d shares an added model's ID", f.Name, p.UID)
				}
			} else if !before[p.UID] {
				others = max(others, p.UID)
			}
		}
	}
	rest, err := mapUIDMax(set, "Azeroth", func(x, y int) bool {
		return x >= 32 && x < 34 && y >= 48 && y < 50 || outside[strings.ToLower(adt.TilePath("Azeroth", x, y, ""))]
	})
	if err != nil {
		t.Fatal(err)
	}
	others = max(others, rest)
	if len(added) != renumbered+2 {
		t.Fatalf("added IDs %v, want %d", added, renumbered+2)
	}
	for _, uid := range added {
		if uid <= others {
			t.Fatalf("added ID %d is not above the map's highest, %d", uid, others)
		}
	}
	for uid := range before {
		if !seen[uid] {
			t.Fatalf("model %d of the block is missing", uid)
		}
	}
}

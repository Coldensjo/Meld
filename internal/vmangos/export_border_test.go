package vmangos

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// TestExportBorderModelsInEveryTile publishes a made-up 2x1 map (tiles 10_10 and 11_10) and checks that
// each model is listed in every tile its bounds reach, under one ID, as the client's tiles list a
// model that crosses a border (#648): a tree 5 yards from the border on either side is in both tiles,
// a WMO 120 yards from it is in both by its real size (read from its MOHD; the writer's 64-yard default
// would leave it out), a rock in the middle of a tile is in that tile alone, and a tree by the map's
// outer edge stays in its own tile. No client needed.
func TestExportBorderModelsInEveryTile(t *testing.T) {
	readDir := t.TempDir()
	// A WMO root that is only its MOHD, with a box 300 yards across: a reach of about 212 yards.
	mohd := make([]byte, 64)
	for k, v := range []float32{-150, -150, 0, 150, 150, 20} {
		binary.LittleEndian.PutUint32(mohd[0x24+4*k:], math.Float32bits(v))
	}
	hall := append(binary.LittleEndian.AppendUint32([]byte("DHOM"), uint32(len(mohd))), mohd...)
	mphd := binary.LittleEndian.AppendUint32([]byte("DHPM"), 32)
	files := []mpq.File{
		{Name: `DBFilesClient\Map.dbc`, Data: testMapDBC(t)},
		{Name: `World\Maps\Azeroth\Azeroth.wdt`, Data: append(mphd, make([]byte, 32)...)},
		{Name: `World\Test\Hall.wmo`, Data: hall},
	}
	if err := os.WriteFile(filepath.Join(readDir, "base.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}

	model := func(typ string, x, z float32) ObjectSpec {
		return ObjectSpec{Type: typ, X: x, Z: z, Scale: 1}
	}
	const tree, rock, wmo = `m2:World\Test\Tree.m2`, `m2:World\Test\Rock.m2`, `wmo:World\Test\Hall.wmo`
	spec := MapSpec{Dir: "BorderPub", MapID: 1902, Tiles: []TileSpec{
		{X: 10, Y: 10, Outer: flatTile(0), Objects: []ObjectSpec{
			model(tree, adt.TileSize-5, 50),
			model(rock, 100, 100),
			model(wmo, adt.TileSize-120, 300),
		}},
		{X: 11, Y: 10, Outer: flatTile(0), Objects: []ObjectSpec{
			model(tree, 5, 150),
			model(tree, adt.TileSize-3, 250),
		}},
	}}
	patchDir := t.TempDir()
	res, err := ExportMap(readDir, patchDir, "", spec)
	if err != nil {
		t.Fatal(err)
	}
	arch, err := mpq.Open(res.Patch)
	if err != nil {
		t.Fatal(err)
	}
	defer arch.Close()

	// The models by their position, a key of name and x, with the tiles that list each and its IDs.
	type listing struct {
		tiles []int
		uids  map[uint32]bool
	}
	seen := map[string]*listing{}
	key := func(name string, x float32) string {
		return fmt.Sprintf("%s@%d", strings.ToLower(name), int(math.Round(float64(x))))
	}
	for _, tx := range []int{10, 11} {
		data, err := arch.ReadFile(adt.TilePath("BorderPub", tx, 10, ""))
		if err != nil {
			t.Fatal(err)
		}
		placed, err := adt.ParsePlacements(data)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range placed {
			k := key(p.Name, p.Position[0])
			if seen[k] == nil {
				seen[k] = &listing{uids: map[uint32]bool{}}
			}
			seen[k].tiles = append(seen[k].tiles, tx)
			seen[k].uids[p.UID] = true
		}
	}
	allIDs := map[uint32]string{}
	for k, l := range seen {
		if len(l.uids) != 1 {
			t.Fatalf("%s is listed under IDs %v, want one", k, l.uids)
		}
		for uid := range l.uids {
			if other, ok := allIDs[uid]; ok {
				t.Fatalf("%s and %s share ID %d", k, other, uid)
			}
			allIDs[uid] = k
		}
	}
	want := []struct {
		name  string
		x     float32
		tiles []int
	}{
		{`World\Test\Tree.m2`, 10*adt.TileSize + adt.TileSize - 5, []int{10, 11}},
		{`World\Test\Rock.m2`, 10*adt.TileSize + 100, []int{10}},
		{`World\Test\Hall.wmo`, 10*adt.TileSize + adt.TileSize - 120, []int{10, 11}},
		{`World\Test\Tree.m2`, 11*adt.TileSize + 5, []int{10, 11}},
		{`World\Test\Tree.m2`, 11*adt.TileSize + adt.TileSize - 3, []int{11}},
	}
	if len(seen) != len(want) {
		t.Fatalf("the tiles list %d models, want %d: %v", len(seen), len(want), seen)
	}
	for _, w := range want {
		l := seen[key(w.name, w.x)]
		if l == nil {
			t.Fatalf("%s at x %v is in no tile", w.name, w.x)
		}
		if len(l.tiles) != len(w.tiles) || l.tiles[0] != w.tiles[0] || l.tiles[len(l.tiles)-1] != w.tiles[len(w.tiles)-1] {
			t.Fatalf("%s at x %v is in tiles %v, want %v", w.name, w.x, l.tiles, w.tiles)
		}
	}
}

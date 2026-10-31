package vmangos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestDescribeFilesGroupsAndMarksNew lists files as the Changes window shows them (#959): grouped and
// sorted, with each one's reason, and New for the files the patch has no copy of yet.
func TestDescribeFilesGroupsAndMarksNew(t *testing.T) {
	dir := t.TempDir()
	in := `World\Maps\Azeroth\Azeroth_32_48.adt`
	if _, err := InstallPatch(dir, []mpq.File{{Name: in, Data: []byte("old")}}); err != nil {
		t.Fatal(err)
	}
	edit := RegionEdit{MapName: "Azeroth", X: 32, Y: 48, Size: 1}
	files := []mpq.File{
		{Name: `World\Maps\Azeroth\Azeroth.wdl`},
		{Name: `textures\Minimap\map32_48.blp`},
		{Name: `World\Maps\Azeroth\Azeroth_33_48.adt`},
		{Name: in},
		{Name: `DBFilesClient\Map.dbc`},
	}
	got := DescribeFiles(dir, files, RegionFileReason(edit, nil))
	var order []string
	for _, c := range got {
		order = append(order, c.Group+":"+c.Tile)
	}
	if strings.Join(order, ",") != "tile:32_48,tile:33_48,wdl:,dbc:,minimap:" {
		t.Fatalf("order = %v", order)
	}
	if got[0].New || !got[1].New {
		t.Errorf("new: the patch's tile %v, the other %v", got[0].New, got[1].New)
	}
	if got[0].Reason != "changed in the region" || !strings.Contains(got[1].Reason, "beside the region") || !strings.Contains(got[2].Reason, "far horizon") {
		t.Errorf("reasons = %q, %q, %q", got[0].Reason, got[1].Reason, got[2].Reason)
	}
}

// TestRegionFileReasonTellsEdgeTiles tells a region's tile the author edited from one rewritten only for
// its neighbour's edge, and one copied into the patch as it is, by the copy the client reads now (#976).
func TestRegionFileReasonTellsEdgeTiles(t *testing.T) {
	was, err := adt.BuildTile(flatTile(1), adt.Ring{}, adt.Changes{TileX: 32, TileY: 48})
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := adt.ParseTerrain(was)
	if err != nil {
		t.Fatal(err)
	}
	// The east neighbour, past a flat border, rises.
	east := flatTile(1)[:LatticeSize]
	for i := range east {
		east[i] = 9
	}
	edge, err := adt.WriteHeights(was, terrain, &adt.Edges{Now: adt.Ring{East: east}})
	if err != nil {
		t.Fatal(err)
	}
	raised, err := PatchTileHeights(was, func() []float32 { h := flatTile(1); h[LatticeSize*64+64] = 6; return h }(), nil)
	if err != nil {
		t.Fatal(err)
	}
	edit := RegionEdit{MapName: "Azeroth", X: 32, Y: 48, Size: 2}
	in, out := `World\Maps\Azeroth\Azeroth_32_48.adt`, `World\Maps\Azeroth\Azeroth_34_48.adt`
	before := func(string) []byte { return was }
	reason := RegionFileReason(edit, before)
	for _, c := range []struct {
		name string
		data []byte
		want string
	}{
		{in, edge, edgeReason},
		{in, raised, "changed in the region"},
		{in, was, copiedReason},
		{out, edge, besideEdgeReason},
		{out, raised, besideModelReason},
	} {
		if got := reason(mpq.File{Name: c.name, Data: c.data}); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
	if got := RegionFileReason(edit, nil)(mpq.File{Name: in, Data: edge}); got != "changed in the region" {
		t.Errorf("without the client's copy: %q", got)
	}
}

// TestWaitingFilesListed lists the files already waiting for the game to close.
func TestWaitingFilesListed(t *testing.T) {
	root := t.TempDir()
	old := pendingRoot
	pendingRoot = func() string { return root }
	defer func() { pendingRoot = old }()
	dir := t.TempDir()
	if err := AddPending(dir, []mpq.File{{Name: `DBFilesClient\Spell.dbc`, Data: []byte("x")}}); err != nil {
		t.Fatal(err)
	}
	got, err := WaitingFiles(dir)
	if err != nil || len(got) != 1 || !got[0].Waiting || got[0].Group != "dbc" || got[0].Name != `DBFilesClient\Spell.dbc` {
		t.Fatalf("waiting = %+v, %v", got, err)
	}
}

// TestExportListsEachSpawn has the spawn SQL name each spawn it adds, changes or deletes, with what
// changed and its own statements, for the Changes window (#959).
func TestExportListsEachSpawn(t *testing.T) {
	orig := Spawn{Kind: Creature, GUID: 42, Entry: 3, Name: "Guard", X: 1, Y: 2, Z: 3, Scale: 1, Equipment: -1, SheathState: 1}
	moved := orig
	moved.X = 10
	moved.StandState = 1
	moved.Path = []PathPoint{{X: 1, Y: 1}}
	added := Spawn{Kind: GameObject, GUID: 900000, Entry: 7, Name: "Chest", X: 4, Y: 5, Z: 6, Scale: 1}
	gone := Spawn{Kind: Creature, GUID: 43, Entry: 4, Name: "Rat"}
	res := ExportSQL([]Edit{
		{Spawn: gone, Original: &gone, Deleted: true},
		{Spawn: moved, Original: &orig},
		{Spawn: added, Created: true},
		{Spawn: Spawn{GUID: 5, Entry: 9}, Created: true, Deleted: true}, // never in the database: not listed
		{Spawn: Spawn{GUID: 6, Map: MaxGameMap + 1}, Created: true},     // skipped: not listed
	}, fixedTime)
	if len(res.Spawns) != 3 {
		t.Fatalf("spawns = %+v", res.Spawns)
	}
	byGUID := map[int]SpawnChange{}
	for _, s := range res.Spawns {
		byGUID[s.GUID] = s
		if !strings.Contains(res.SQL, s.SQL) {
			t.Errorf("guid %d's SQL is not part of the script", s.GUID)
		}
	}
	if c := byGUID[42]; c.Action != "change" || strings.Join(c.Fields, ",") != "position,path,pose" || !strings.HasPrefix(c.SQL, "-- Change Guard") ||
		!strings.Contains(c.SQL, "creature_movement") || strings.Contains(c.SQL, "900000") {
		t.Errorf("changed = %+v", c)
	}
	if c := byGUID[900000]; c.Action != "add" || !c.Object || !strings.Contains(c.SQL, "INSERT INTO `gameobject`") {
		t.Errorf("added = %+v", c)
	}
	if c := byGUID[43]; c.Action != "delete" || !strings.Contains(c.SQL, "DELETE FROM `creature` WHERE `guid` = 43;") {
		t.Errorf("deleted = %+v", c)
	}
}

// TestPreviewPublish lists what Publish would write without writing it, then nothing once the map is
// in the patch. It needs WOW_DIR.
func TestPreviewPublish(t *testing.T) {
	readDir, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	patchDir := t.TempDir()
	spec := MapSpec{Dir: "MeldPreview", MapID: 1902, Tiles: []TileSpec{{X: 5, Y: 6, Outer: flatTile(1)}, {X: 6, Y: 6, Outer: flatTile(2)}}}
	p, err := PreviewPublish(readDir, patchDir, spec)
	if err != nil {
		t.Fatal(err)
	}
	var groups []string
	for _, f := range p.Files {
		groups = append(groups, f.Group)
		if !f.New || f.Reason == "" {
			t.Errorf("%s: new %v, reason %q", f.Name, f.New, f.Reason)
		}
	}
	if strings.Join(groups, ",") != "tile,tile,wdt,wdl,dbc" || p.Tiles != 2 {
		t.Fatalf("files = %+v", p.Files)
	}
	if r := p.Files[4].Reason; !strings.Contains(r, "adds the row of map 1902") {
		t.Errorf("Map.dbc reason %q", r)
	}
	if len(p.Rows) != 1 || p.Rows[0].Table != "map_template" || !strings.Contains(p.Rows[0].SQL, "1902") {
		t.Errorf("rows = %+v", p.Rows)
	}
	if _, err := os.Stat(filepath.Join(patchDir, PatchName)); err == nil {
		t.Fatal("the preview wrote the patch")
	}
	if _, err := ExportMap(readDir, patchDir, "", spec); err != nil {
		t.Fatal(err)
	}
	spec.Tiles[1].Outer = flatTile(3)
	p, err = PreviewPublish(readDir, patchDir, spec)
	if err != nil {
		t.Fatal(err)
	}
	// The second tile and the horizon it draws changed, and the first tile with it, since its edge's
	// normals take the neighbour's heights (#492); the layout and the table did not.
	var names []string
	for _, f := range p.Files {
		names = append(names, f.Group+":"+f.Tile)
		if f.New {
			t.Errorf("%s is in the patch already", f.Name)
		}
	}
	if strings.Join(names, ",") != "tile:5_6,tile:6_6,wdl:" {
		t.Fatalf("after the export: %v", names)
	}
	// The first tile reads as rewritten for its edge only, the second as a tile of the map (#976).
	if p.Files[0].Reason != edgeReason || p.Files[1].Reason != "a tile of the map" {
		t.Errorf("reasons = %q, %q", p.Files[0].Reason, p.Files[1].Reason)
	}
}

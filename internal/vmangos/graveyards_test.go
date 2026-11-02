package vmangos

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// safeLocDBC builds a 1.12 WorldSafeLocs.dbc of rows, each named in the first locale, with the
// locale mask 0x3F007E.
func safeLocDBC(rows ...Graveyard) []byte {
	var recs []byte
	strs := []byte{0}
	f := math.Float32bits
	for _, g := range rows {
		name := uint32(len(strs))
		strs = append(append(strs, g.Name...), 0)
		recs = appendFields(recs, g.ID, g.MapID, f(g.X), f(g.Y), f(g.Z), name, 0, 0, 0, 0, 0, 0, 0, 0x3F007E)
	}
	return dbcFile(safeLocFields, len(rows), recs, strs)
}

func TestSetGraveyardsEditsAddsAndRemoves(t *testing.T) {
	a := Graveyard{ID: 1, MapID: 0, X: -9115, Y: 423, Z: 96, Name: "Stormwind"}
	b := Graveyard{ID: 2, MapID: 1, X: 10, Y: 20, Z: 30, Name: "Kalimdor"}
	dbc := safeLocDBC(a, b)
	same, err := SetGraveyards(dbc, nil, nil)
	if err != nil || !bytes.Equal(same, dbc) {
		t.Fatalf("unchanged write differs: %v", err)
	}
	// A row saved as it is (links and facing are the database's) leaves the table as it was.
	if same, err = SetGraveyards(dbc, []Graveyard{a}, nil); err != nil || !bytes.Equal(same, dbc) {
		t.Fatalf("a row saved unchanged changed the table: %v", err)
	}
	a2 := a
	a2.X = -9000
	a2.Name = "Stormwind, the Valley"
	c := Graveyard{ID: 930, MapID: 0, X: 1, Y: 2, Z: 3, Name: "Brightwood", Links: []GraveyardLink{{Zone: 5000, Faction: GraveyardAlliance}}}
	out, err := SetGraveyards(dbc, []Graveyard{c, a2}, []uint32{2})
	if err != nil {
		t.Fatal(err)
	}
	on0, err := ReadGraveyards(out, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(on0) != 2 || on0[0].ID != 1 || on0[0].X != -9000 || on0[0].Name != "Stormwind, the Valley" || on0[1].ID != 930 || on0[1].Name != "Brightwood" || on0[1].Z != 3 {
		t.Fatalf("read back %+v", on0)
	}
	if on1, _ := ReadGraveyards(out, 1); len(on1) != 0 {
		t.Fatalf("graveyard 2 is still there: %+v", on1)
	}
	tab, _ := safeLocTable(out)
	r, _ := tab.row(930)
	if tab.u32(r, safeLocMask) != 0x3F007E {
		t.Fatal("a new row did not take the first row's locale mask")
	}
	for name, rows := range map[string][]Graveyard{
		"no name":          {{ID: 931, Name: " "}},
		"no ID":            {{ID: 0, Name: "x"}},
		"a zone twice":     {{ID: 931, Name: "x", Links: []GraveyardLink{{Zone: 12}, {Zone: 12, Faction: GraveyardHorde}}}},
		"an odd faction":   {{ID: 931, Name: "x", Links: []GraveyardLink{{Zone: 12, Faction: 1}}}},
		"a link to zone 0": {{ID: 931, Name: "x", Links: []GraveyardLink{{Zone: 0}}}},
		"a NaN facing":     {{ID: 931, Name: "x", O: float32(math.NaN())}},
		"listed twice":     {{ID: 931, Name: "x"}, {ID: 931, Name: "y"}},
	} {
		if _, err := SetGraveyards(dbc, rows, nil); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	if _, err := SetGraveyards(dbc, []Graveyard{a}, []uint32{1}); err == nil {
		t.Error("a graveyard both saved and removed was accepted")
	}
	if _, err := SetGraveyards(dbc, nil, []uint32{77}); err == nil {
		t.Error("removing a graveyard the table lacks was accepted")
	}
}

func TestNewGraveyardID(t *testing.T) {
	client := safeLocDBC(Graveyard{ID: 927, Name: "a"})
	server := safeLocDBC(Graveyard{ID: 940, Name: "b"})
	for _, c := range []struct {
		server []byte
		max    uint32
		want   uint32
	}{{nil, 0, 928}, {server, 0, 941}, {server, 990, 991}} {
		if id, err := NewGraveyardID(client, c.server, c.max); err != nil || id != c.want {
			t.Errorf("new ID %d (%v), want %d", id, err, c.want)
		}
	}
}

func TestGraveyardSQL(t *testing.T) {
	sql := GraveyardSQL([]Graveyard{
		{ID: 930, O: 1.5, Name: "Brightwood", Links: []GraveyardLink{{Zone: 5000, Faction: GraveyardAlliance}, {Zone: 5001}}},
		{ID: 931, Name: "Bare"},
	}, []uint32{12, 11})
	for _, want := range []string{
		"DELETE FROM `game_graveyard_zone` WHERE `id` IN (11, 12);",
		"DELETE FROM `world_safe_locs_facing` WHERE `id` IN (11, 12);",
		"REPLACE INTO `world_safe_locs_facing` (`id`, `orientation`) VALUES (930, 1.5);",
		"DELETE FROM `game_graveyard_zone` WHERE `id` = 930 AND `patch_max` >= 10 AND (`ghost_zone`, `faction`) NOT IN ((5000, 469), (5001, 0));",
		"INSERT IGNORE INTO `game_graveyard_zone` (`id`, `ghost_zone`, `faction`, `patch_min`, `patch_max`) VALUES (930, 5000, 469, 0, 10), (930, 5001, 0, 0, 10);",
		"REPLACE INTO `world_safe_locs_facing` (`id`, `orientation`) VALUES (931, 0);",
		"DELETE FROM `game_graveyard_zone` WHERE `id` = 931 AND `patch_max` >= 10;",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("missing %q in:\n%s", want, sql)
		}
	}
	if strings.Count(sql, "INSERT") != 1 {
		t.Errorf("a graveyard without links got an INSERT:\n%s", sql)
	}
}

func TestGraveyardExtras(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		switch {
		case strings.Contains(sql, "GREATEST"):
			return []byte("927\n"), nil
		case strings.Contains(sql, "FROM `world_safe_locs_facing` WHERE"):
			return []byte("3\t1.25\n"), nil
		case strings.Contains(sql, "FROM `game_graveyard_zone` WHERE"):
			if !strings.Contains(sql, "`patch_max` >= 10") {
				t.Errorf("links read for every patch: %s", sql)
			}
			return []byte("3\t10\t0\n3\t40\t469\n4\t12\t67\n"), nil
		}
		t.Errorf("unexpected query %s", sql)
		return nil, nil
	}
	gs := []Graveyard{{ID: 3, Links: []GraveyardLink{}}, {ID: 4, Links: []GraveyardLink{}}, {ID: 5, Links: []GraveyardLink{}}}
	top, err := graveyardExtras(worldDB{}, gs)
	if err != nil || top != 927 {
		t.Fatalf("top %d, %v", top, err)
	}
	if gs[0].O != 1.25 || len(gs[0].Links) != 2 || gs[0].Links[1] != (GraveyardLink{Zone: 40, Faction: GraveyardAlliance}) {
		t.Fatalf("graveyard 3: %+v", gs[0])
	}
	if len(gs[1].Links) != 1 || gs[1].Links[0].Faction != GraveyardHorde || len(gs[2].Links) != 0 {
		t.Fatalf("graveyards 4 and 5: %+v %+v", gs[1], gs[2])
	}
}

func TestInstallServerSafeLocs(t *testing.T) {
	dir := t.TempDir()
	dbcDir := filepath.Join(dir, "data", "5875", "dbc")
	for _, d := range []string{filepath.Join(dir, "run"), dbcDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "run", "mangosd.conf"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if b, err := ReadServerSafeLocs(dir); b != nil || err != nil {
		t.Fatalf("a server without the table read %d bytes, %v", len(b), err)
	}
	dbc := safeLocDBC(Graveyard{ID: 1, Name: "a"})
	if _, err := InstallServerSafeLocs(dir, dbc); err != nil {
		t.Fatal(err)
	}
	if b, err := ReadServerSafeLocs(dir); !bytes.Equal(b, dbc) || err != nil {
		t.Fatalf("the server's copy differs (%v)", err)
	}
}

func TestClientGraveyards(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	dbc, err := LoadWorldSafeLocs(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	same, err := SetGraveyards(dbc, nil, nil)
	if err != nil || !bytes.Equal(same, dbc) {
		t.Fatalf("the client's table written back differs (%v)", err)
	}
	gs, err := ReadGraveyards(dbc, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(gs) == 0 || gs[0].ID != 1 || !strings.Contains(gs[0].Name, "Stormwind") {
		t.Fatalf("Eastern Kingdoms' first graveyard is %+v, want 1 Stormwind", gs[:min(1, len(gs))])
	}
	// Every graveyard saved as it is leaves the table unchanged.
	if out, err := SetGraveyards(dbc, gs, nil); err != nil || !bytes.Equal(out, dbc) {
		t.Fatalf("the map's graveyards saved as they are changed the table (%v)", err)
	}
	id, err := NewGraveyardID(dbc, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Eastern Kingdoms: %d graveyards, next ID %d", len(gs), id)
}

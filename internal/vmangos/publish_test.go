package vmangos

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/mpq"
)

// fakeRunner records the programs a publish runs, and fails the one named in failAt.
type fakeRunner struct {
	calls  []string
	failAt string
}

func (f *fakeRunner) Run(dir, name string, args []string, log func(string)) error {
	f.calls = append(f.calls, name+" "+strings.Join(args, " "))
	if f.failAt != "" && strings.Contains(name, f.failAt) {
		return errors.New("failed")
	}
	return nil
}

func (f *fakeRunner) Start(dir, name string, args ...string) error {
	f.calls = append(f.calls, "START "+name)
	return nil
}

func (f *fakeRunner) Running(image string) bool { return false }

// serverFolder makes a server folder with its configuration and map table.
func serverFolder(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "run"), 0o755)
	os.MkdirAll(filepath.Join(root, "data", "5875", "dbc"), 0o755)
	conf := "WorldDatabase.Info = \"127.0.0.1;3307;mangos;secret;mangos\"\n"
	os.WriteFile(filepath.Join(root, "run", "mangosd.conf"), []byte(conf), 0o644)
	return root
}

func TestPublishServerRunsStepsInOrder(t *testing.T) {
	server := serverFolder(t)
	client := t.TempDir()
	f := &fakeRunner{}
	p := PublishPlan{ClientRoot: client, ServerRoot: server, Mariadb: "mariadb", Run: f}
	spec := MapSpec{Dir: "MyMap", MapID: 1900}
	if err := publishServer(p, filepath.Join(client, "Data"), spec, nil, func(string) {}); err != nil {
		t.Fatal(err)
	}
	want := []string{"mariadb", "taskkill", "MapExtractor.exe", "VMapExtractor.exe", "VMapAssembler.exe", "START"}
	if len(f.calls) != len(want) {
		t.Fatalf("calls = %q", f.calls)
	}
	for i, w := range want {
		if !strings.Contains(f.calls[i], w) {
			t.Fatalf("call %d = %q, want %q", i, f.calls[i], w)
		}
	}
	if !strings.Contains(f.calls[0], "-p"+"secret") || !strings.Contains(f.calls[0], "INSERT IGNORE INTO map_template") || !strings.Contains(f.calls[0], "'MyMap'") {
		t.Fatalf("world database call = %q", f.calls[0])
	}
}

func TestPublishServerStopsBeforeStartingOnFailure(t *testing.T) {
	server := serverFolder(t)
	f := &fakeRunner{failAt: "MapExtractor"}
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: server, Run: f}
	err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), MapSpec{Dir: "MyMap", MapID: 1900}, nil, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "map extraction") {
		t.Fatalf("err = %v", err)
	}
	for _, c := range f.calls {
		if strings.HasPrefix(c, "START") {
			t.Fatal("the world server was started after a failed extraction")
		}
	}
}

// callOf is the recorded call that runs the program named, or "".
func callOf(calls []string, name string) string {
	for _, c := range calls {
		if strings.Contains(c, name) {
			return c
		}
	}
	return ""
}

func TestPublishServerExtractsEveryMapWithoutWholeVmaps(t *testing.T) {
	server := serverFolder(t)
	f := &fakeRunner{}
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: server, Run: f}
	if err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), MapSpec{Dir: "MyMap", MapID: 1900}, []string{"1_2"}, func(string) {}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"MapExtractor.exe", "VMapExtractor.exe"} {
		if c := callOf(f.calls, name); c == "" || strings.Contains(c, " -m ") {
			t.Fatalf("%s call = %q, want one with no map filter", name, c)
		}
	}
}

func TestPublishServerExtractsOnlyTheMap(t *testing.T) {
	server := serverFolder(t)
	data := filepath.Join(server, "data")
	os.MkdirAll(filepath.Join(data, "vmaps"), 0o755)
	os.MkdirAll(filepath.Join(data, "maps"), 0o755)
	keep := []string{"vmaps/temp_gameobject_models", "vmaps/000.vmtree", "vmaps/000_32_48.vmtile", "vmaps/Anvil.m2", "maps/0004832.map"}
	gone := []string{"vmaps/1900.vmtree", "vmaps/1900_01_02.vmtile"}
	for _, n := range append(append([]string{"maps/1900" + "0201.map"}, keep...), gone...) {
		os.WriteFile(filepath.Join(data, filepath.FromSlash(n)), []byte("x"), 0o644)
	}

	f := &fakeRunner{}
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: server, Run: f}
	spec := MapSpec{Dir: "MyMap", MapID: 1900}
	if err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), spec, []string{"1_2", "3_4"}, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if c := callOf(f.calls, "MapExtractor.exe"); !strings.HasSuffix(c, "-m 1900 -t 1_2,3_4") {
		t.Fatalf("map extractor call = %q", c)
	}
	if c := callOf(f.calls, "VMapExtractor.exe"); !strings.HasSuffix(c, "-m 1900") {
		t.Fatalf("vmap extractor call = %q", c)
	}
	for _, n := range append(keep, "maps/1900"+"0201.map") {
		if _, err := os.Stat(filepath.Join(data, filepath.FromSlash(n))); err != nil {
			t.Fatalf("%s was removed", n)
		}
	}
	for _, n := range gone {
		if _, err := os.Stat(filepath.Join(data, filepath.FromSlash(n))); err == nil {
			t.Fatalf("%s was kept", n)
		}
	}

	// With no tiles given, the whole map is extracted, its old tile files removed first.
	f.calls = nil
	if err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), spec, nil, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if c := callOf(f.calls, "MapExtractor.exe"); !strings.HasSuffix(c, "-m 1900") {
		t.Fatalf("map extractor call = %q", c)
	}
	if _, err := os.Stat(filepath.Join(data, "maps", "1900"+"0201.map")); err == nil {
		t.Fatal("the map's old tile file was kept")
	}
	if _, err := os.Stat(filepath.Join(data, "maps", "0004832.map")); err != nil {
		t.Fatal("another map's tile file was removed")
	}
}

func TestChangedTiles(t *testing.T) {
	m := MapSpec{Dir: "MyMap", Tiles: []TileSpec{{X: 1, Y: 2}, {X: 3, Y: 4}}}
	files := []mpq.File{{Name: `World\Maps\MyMap\MyMap_3_4.adt`}, {Name: `World\Maps\MyMap\MyMap.wdl`}}
	tiles, layout := changedTiles(m, files)
	if len(tiles) != 1 || tiles[0] != "3_4" || layout {
		t.Fatalf("tiles %q, layout %v", tiles, layout)
	}
	if _, layout = changedTiles(m, append(files, mpq.File{Name: `World\Maps\MyMap\MyMap.wdt`})); !layout {
		t.Fatal("a written WDT is not a layout change")
	}
}

func TestWorldDatabaseFromConfig(t *testing.T) {
	server := serverFolder(t)
	db, err := worldDatabase(server)
	if err != nil {
		t.Fatal(err)
	}
	if db.host != "127.0.0.1" || db.port != "3307" || db.user != "mangos" || db.password != "secret" || db.name != "mangos" {
		t.Fatalf("db = %+v", db)
	}
}

func TestTemplateSQLWithInfo(t *testing.T) {
	plain := templateSQL(MapSpec{Dir: "Test", MapID: 1901})
	if !strings.Contains(plain, "INSERT IGNORE") || !strings.Contains(plain, "'Test'") {
		t.Fatalf("plain SQL = %s", plain)
	}
	sql := templateSQL(MapSpec{Dir: "Test", MapID: 1901, Info: &MapInfo{Type: 1, AreaID: 12, MaxPlayers: 5, GhostMap: 0, GhostX: -9000.5, GhostY: 120, Name: "Meld's Keep"}})
	for _, want := range []string{`VALUES (1901, 0, 0, 1, 12, 5, 0, 0, -9000.5, 120, 'Meld\'s Keep', '')`, "ON DUPLICATE KEY UPDATE map_type = VALUES(map_type)"} {
		if !strings.Contains(sql, want) {
			t.Fatalf("SQL %s lacks %s", sql, want)
		}
	}
}

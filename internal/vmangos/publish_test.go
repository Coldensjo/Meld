package vmangos

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"Meld/internal/mpq"
)

// fakeRunner records the programs a publish runs, and fails the one named in failAt.
type fakeRunner struct {
	calls  []string
	failAt string
	// serverUp is whether mangosd.exe is running; stopsAfter, when above 0, is how many times Running
	// answers yes before the author stops it.
	serverUp   bool
	stopsAfter int
	// writes are the files (slash paths under the folder it runs in) a program whose name holds the
	// key writes before it returns, as an extractor would.
	writes map[string][]string
	// onRun, when set, is called as each program starts, so a test can look at the folders then.
	onRun func(name string, args []string)
	// envs are the environments RunEnv added, by program name.
	envs map[string][]string
}

func (f *fakeRunner) RunEnv(dir, name string, env, args []string, log func(string)) error {
	if f.envs == nil {
		f.envs = map[string][]string{}
	}
	f.envs[name] = env
	return f.Run(dir, name, args, log)
}

func (f *fakeRunner) Run(dir, name string, args []string, log func(string)) error {
	f.calls = append(f.calls, name+" "+strings.Join(args, " "))
	if f.onRun != nil {
		f.onRun(name, args)
	}
	for prog, files := range f.writes {
		if strings.Contains(name, prog) {
			for _, n := range files {
				path := filepath.Join(dir, filepath.FromSlash(n))
				os.MkdirAll(filepath.Dir(path), 0o755)
				os.WriteFile(path, []byte("new"), 0o644)
			}
		}
	}
	if f.failAt != "" && strings.Contains(name, f.failAt) {
		return errors.New("failed")
	}
	return nil
}

func (f *fakeRunner) Start(dir, name string, args ...string) error {
	f.calls = append(f.calls, "START "+name)
	return nil
}

func (f *fakeRunner) Running(image string) bool {
	if image != "mangosd.exe" || !f.serverUp {
		return false
	}
	if f.stopsAfter > 0 {
		f.stopsAfter--
		if f.stopsAfter == 0 {
			f.serverUp = false
		}
	}
	return true
}

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
	want := []string{"mariadb", "MapExtractor.exe", "VMapExtractor.exe", "VMapAssembler.exe"}
	if len(f.calls) != len(want) {
		t.Fatalf("calls = %q", f.calls)
	}
	for i, w := range want {
		if !strings.Contains(f.calls[i], w) {
			t.Fatalf("call %d = %q, want %q", i, f.calls[i], w)
		}
	}
	if strings.Contains(f.calls[0], "secret") || !strings.Contains(f.calls[0], "INSERT IGNORE INTO map_template") || !strings.Contains(f.calls[0], "'MyMap'") {
		t.Fatalf("world database call = %q (the password goes in MYSQL_PWD, not the arguments: #482)", f.calls[0])
	}
	if env := f.envs["mariadb"]; len(env) != 1 || env[0] != "MYSQL_PWD=secret" {
		t.Fatalf("world database env = %q, want MYSQL_PWD=secret", env)
	}
}

// fileText is a file's content, or "" when it can't be read.
func fileText(path string) string {
	b, _ := os.ReadFile(path)
	return string(b)
}

func TestPublishServerKeepsTheOldDataOnFailure(t *testing.T) {
	for _, step := range []string{"MapExtractor", "VMapExtractor", "VMapAssembler"} {
		server := serverFolder(t)
		data := filepath.Join(server, "data")
		os.MkdirAll(filepath.Join(data, "vmaps"), 0o755)
		os.MkdirAll(filepath.Join(data, "maps"), 0o755)
		old := []string{"maps/19000201.map", "vmaps/1900.vmtree", "vmaps/1900_01_02.vmtile", "vmaps/temp_gameobject_models"}
		for _, n := range old {
			os.WriteFile(filepath.Join(data, filepath.FromSlash(n)), []byte("old"), 0o644)
		}
		f := &fakeRunner{failAt: step, writes: map[string][]string{
			"MapExtractor":  {stagingDir + "/maps/19000201.map"},
			"VMapAssembler": {stagingDir + "/vmaps/1900.vmtree"},
		}}
		p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: server, Run: f}
		err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), MapSpec{Dir: "MyMap", MapID: 1900}, nil, func(string) {})
		if err == nil {
			t.Fatalf("%s: no error", step)
		}
		for _, n := range old {
			if got := fileText(filepath.Join(data, filepath.FromSlash(n))); got != "old" {
				t.Fatalf("%s failed: %s is %q, want the old file", step, n, got)
			}
		}
		if _, err := os.Stat(filepath.Join(data, stagingDir)); err == nil {
			t.Fatalf("%s failed: the staging folder was left", step)
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

	f := &fakeRunner{writes: map[string][]string{
		"MapExtractor":  {stagingDir + "/maps/19000403.map"},
		"VMapAssembler": {stagingDir + "/vmaps/1900_03_04.vmtile"},
	}}
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: server, Run: f}
	spec := MapSpec{Dir: "MyMap", MapID: 1900}
	if err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), spec, []string{"1_2", "3_4"}, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if c := callOf(f.calls, "VMapAssembler.exe"); !strings.HasSuffix(c, filepath.Join(stagingDir, "vmaps")) {
		t.Fatalf("assembler call = %q", c)
	}
	for _, n := range []string{"maps/19000403.map", "vmaps/1900_03_04.vmtile"} {
		if got := fileText(filepath.Join(data, filepath.FromSlash(n))); got != "new" {
			t.Fatalf("%s = %q, want the extracted file moved in", n, got)
		}
	}
	if _, err := os.Stat(filepath.Join(data, stagingDir)); err == nil {
		t.Fatal("the staging folder was left")
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

func TestPublishServerBuildsMoveMaps(t *testing.T) {
	server := serverFolder(t)
	data := filepath.Join(server, "data")
	extractors := filepath.Join(server, "run", "Extractors")
	os.MkdirAll(filepath.Join(data, "vmaps"), 0o755)
	os.MkdirAll(filepath.Join(data, "mmaps"), 0o755)
	os.MkdirAll(extractors, 0o755)
	for _, n := range []string{"MoveMapGenerator.exe", "config.json"} {
		os.WriteFile(filepath.Join(extractors, n), nil, 0o644)
	}
	os.WriteFile(filepath.Join(data, "vmaps", "temp_gameobject_models"), nil, 0o644)
	old := []string{"mmaps/1900.mmap", "mmaps/19000201.mmtile"}
	keep := []string{"mmaps/0002337.mmtile", "mmaps/go0042.mmtile"}
	for _, n := range append(old, keep...) {
		os.WriteFile(filepath.Join(data, filepath.FromSlash(n)), []byte("old"), 0o644)
	}
	f := &fakeRunner{}
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: server, Run: f}
	spec := MapSpec{Dir: "MyMap", MapID: 1900}

	// Compiled tiles: one run a tile, after the assembler, as --tile x,y.
	if err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), spec, []string{"1_2", "33_48"}, func(string) {}); err != nil {
		t.Fatal(err)
	}
	var gens []string
	for i, c := range f.calls {
		if strings.Contains(c, "MoveMapGenerator.exe") {
			if !strings.Contains(f.calls[i-1], "VMapAssembler.exe") && len(gens) == 0 {
				t.Fatalf("calls = %q, want the generator after the assembler", f.calls)
			}
			gens = append(gens, c)
		}
	}
	if len(gens) != 2 || !strings.Contains(gens[0], " 1900 --silent --threads ") || !strings.HasSuffix(gens[0], "--tile 1,2") || !strings.HasSuffix(gens[1], "--tile 33,48") {
		t.Fatalf("generator calls = %q", gens)
	}
	if !strings.Contains(gens[0], "--configInputPath "+filepath.Join(extractors, "config.json")) || strings.Contains(gens[0], "--offMeshInput") {
		t.Fatalf("generator call = %q, want config.json and no missing offmesh.txt", gens[0])
	}
	for _, n := range append(old, keep...) {
		if fileText(filepath.Join(data, filepath.FromSlash(n))) != "old" {
			t.Fatalf("a tile build removed %s", n)
		}
	}

	// The whole map: one run with no --tile, the map's own old mmap files removed first.
	f.calls = nil
	if err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), spec, nil, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if c := callOf(f.calls, "MoveMapGenerator.exe"); c == "" || strings.Contains(c, "--tile") {
		t.Fatalf("generator call = %q, want the whole map", c)
	}
	for _, n := range old {
		if fileExists(filepath.Join(data, filepath.FromSlash(n))) {
			t.Fatalf("%s was kept", n)
		}
	}
	for _, n := range keep {
		if !fileExists(filepath.Join(data, filepath.FromSlash(n))) {
			t.Fatalf("another map's %s was removed", n)
		}
	}

	// A failing generator leaves the publish passed; switched off, it doesn't run.
	f = &fakeRunner{failAt: "MoveMapGenerator"}
	p.Run = f
	if err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), spec, []string{"1_2"}, func(string) {}); err != nil {
		t.Fatalf("a failed movement map build failed the publish: %v", err)
	}
	f = &fakeRunner{}
	p.Run, p.SkipMoveMaps = f, true
	if err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), spec, []string{"1_2"}, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if c := callOf(f.calls, "MoveMapGenerator"); c != "" {
		t.Fatalf("ran %q with movement maps off", c)
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

func TestUpdateServerMapsWaitsForTheAuthorToStopTheServer(t *testing.T) {
	serverStopWait, serverPoll = 50*time.Millisecond, time.Millisecond
	defer func() { serverStopWait, serverPoll = 15*time.Minute, 250*time.Millisecond }()
	server := serverFolder(t)

	// Stopped by the author while it waits: the data is rebuilt, and the server is not started (#661).
	f := &fakeRunner{serverUp: true, stopsAfter: 3}
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: server, Run: f}
	if err := UpdateServerMaps(p, t.TempDir(), 1900, nil, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if callOf(f.calls, "MapExtractor") == "" {
		t.Fatalf("calls = %q, want the extractors", f.calls)
	}

	// Left running: nothing runs beside it, and it is never stopped or started.
	f = &fakeRunner{serverUp: true}
	p.Run = f
	err := UpdateServerMaps(p, t.TempDir(), 1900, nil, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "kept running") {
		t.Fatalf("err = %v, want the server kept running", err)
	}
	if len(f.calls) != 0 {
		t.Fatalf("ran %q beside a live server", f.calls)
	}
}

func TestUpdateServerMapsNeverStopsOrStartsTheServer(t *testing.T) {
	f := &fakeRunner{}
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: serverFolder(t), Run: f}
	if err := UpdateServerMaps(p, t.TempDir(), 1900, nil, func(string) {}); err != nil {
		t.Fatal(err)
	}
	for _, c := range f.calls {
		if strings.Contains(c, "taskkill") || strings.HasPrefix(c, "START") {
			t.Fatalf("called %q", c)
		}
	}
}

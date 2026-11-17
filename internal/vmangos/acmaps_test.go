package vmangos

import (
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"Meld/internal/mpq"
)

// acMapDBC is a Map.dbc of two fields a row (the ID and a name string), holding the maps given, whose
// names are "Map<id>".
func acMapDBC(ids ...uint32) []byte {
	var strs []byte
	strs = append(strs, 0)
	var rows []byte
	for _, id := range ids {
		rows = binary.LittleEndian.AppendUint32(rows, id)
		rows = binary.LittleEndian.AppendUint32(rows, uint32(len(strs)))
		strs = append(strs, []byte("Map"+strconv.Itoa(int(id))+"\x00")...)
	}
	out := []byte("WDBC")
	for _, v := range []uint32{uint32(len(ids)), 2, 8, uint32(len(strs))} {
		out = binary.LittleEndian.AppendUint32(out, v)
	}
	return append(append(out, rows...), strs...)
}

// acFixture is an AzerothCore install as `cmake --install` leaves it (bin, etc, a DataDir of data
// beside them) holding the old files of maps 571 and 0, and a 3.3.5a client whose patch holds Meld's
// AreaTable.dbc.
func acFixture(t *testing.T) (AzerothCoreServer, string) {
	t.Helper()
	root := t.TempDir()
	write := func(base, rel string, body []byte) {
		path := filepath.Join(base, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(root, "etc/worldserver.conf", []byte("# DataDir = \"elsewhere\"\nDataDir = \"../data\"\n"))
	write(root, "bin/map_extractor", []byte("\x7fELF...common.MPQ\x00patch-3.MPQ\x00patch-4.MPQ\x00patch-5.MPQ\x00"))
	for _, f := range []string{"bin/worldserver", "bin/vmap4_extractor", "bin/vmap4_assembler", "bin/mmaps_generator"} {
		write(root, f, []byte("\x7fELF"))
	}
	write(root, "bin/mmaps-config.yaml", []byte("mmapsConfig:\n  skipLiquid: false\n  dataDir: \"./\"\n  meshSettings:\n    walkableHeight: 6\n"))
	for _, f := range []string{"data/maps/5712130.map", "data/maps/5712131.map", "data/maps/0003030.map", "data/vmaps/571.vmtree", "data/vmaps/571_21_31.vmtile",
		"data/vmaps/000_30_30.vmtile", "data/vmaps/Shared.wmo.vmo", "data/mmaps/571.mmap", "data/mmaps/5712130.mmtile", "data/mmaps/5712131.mmtile",
		"data/mmaps/0003030.mmtile", "data/dbc/AreaTable.dbc", "data/dbc/Map.dbc"} {
		write(root, f, []byte("old"))
	}
	s, err := CheckAzerothCore(root)
	if err != nil {
		t.Fatal(err)
	}
	client := filepath.Join(t.TempDir(), "client")
	write(client, "Data/lichking.MPQ", mpq.Write([]mpq.File{{Name: `DBFilesClient\Map.dbc`, Data: acMapDBC(0, 1, 571)}}))
	write(client, "Data/common.MPQ", mpq.Write(nil))
	write(client, "Data/enUS/locale-enUS.MPQ", mpq.Write([]mpq.File{{Name: `DBFilesClient\AreaTable.dbc`, Data: []byte("stock")}}))
	write(client, "Data/enUS/patch-enUS-3.MPQ", mpq.Write(nil))
	write(client, "Data/patch-4.MPQ", mpq.Write([]mpq.File{{Name: `DBFilesClient\AreaTable.dbc`, Data: []byte("meld")}, {Name: `World\Maps\Map571\Map571_30_21.adt`, Data: []byte("tile")}}))
	return s, client
}

// acRunner fakes AzerothCore's tools run in the staging folder: the map extractor writes map 571's
// tiles (and map 0's when it read every map), the assembler map 571's tree, a tile and its models.
func acRunner(t *testing.T, s AzerothCoreServer) (*fakeRunner, *[]uint32) {
	var maps []uint32
	f := &fakeRunner{image: "worldserver.exe", writes: map[string][]string{
		"vmap4_extractor": {"Buildings/dir_bin"},
		"vmap4_assembler": {"vmaps/571.vmtree", "vmaps/571_21_30.vmtile", "vmaps/Shared.wmo.vmo", "vmaps/New.m2.vmo", "vmaps/000.vmtree", "vmaps/GameObjectModels.dtree"},
	}}
	f.onRun = func(name string, args []string) {
		if !strings.HasSuffix(name, "map_extractor") {
			return
		}
		// The extractor reads the maps the Map.dbc its input's archives give it lists.
		stage := filepath.Join(s.Data, stagingDir)
		input := args[1]
		if !filepath.IsAbs(input) {
			input = filepath.Join(stage, input)
		}
		set, err := mpq.OpenDataDir(filepath.Join(input, "Data"))
		if err != nil {
			t.Errorf("the extractor's client: %v", err)
			return
		}
		defer set.Close()
		dbc, err := set.ReadFile(`DBFilesClient\Map.dbc`)
		if err != nil {
			t.Errorf("the extractor's Map.dbc: %v", err)
			return
		}
		maps = MapRowIDs(dbc)
		for _, id := range maps {
			name := map[uint32]string{571: "5712130.map", 0: "0003030.map", 1: "0012020.map"}[id]
			os.MkdirAll(filepath.Join(stage, "maps"), 0o755)
			os.WriteFile(filepath.Join(stage, "maps", name), []byte("new"), 0o644)
		}
	}
	return f, &maps
}

func TestCheckAzerothCoreFindsTheConfAndDataDir(t *testing.T) {
	root := t.TempDir()
	if _, err := CheckAzerothCore(root); err == nil || !strings.Contains(err.Error(), "worldserver.conf") {
		t.Fatalf("a folder without worldserver.conf: %v", err)
	}
	os.MkdirAll(filepath.Join(root, "etc"), 0o755)
	os.WriteFile(filepath.Join(root, "etc", "worldserver.conf"), []byte("DataDir = \"nowhere\"\n"), 0o644)
	if _, err := CheckAzerothCore(root); err == nil || !strings.Contains(err.Error(), "DataDir") {
		t.Fatalf("a DataDir that isn't a folder: %v", err)
	}
	// Unset, DataDir is the world server's folder (its default "."), else the folder picked.
	os.WriteFile(filepath.Join(root, "etc", "worldserver.conf"), []byte("LogsDir = \"\"\n"), 0o644)
	s, err := CheckAzerothCore(root)
	if err != nil || s.Data != filepath.Clean(root) || s.Bin != "" {
		t.Fatalf("got %+v, %v", s, err)
	}
	os.MkdirAll(filepath.Join(root, "bin"), 0o755)
	os.WriteFile(filepath.Join(root, "bin", acProgram("worldserver")), []byte("x"), 0o755)
	s, err = CheckAzerothCore(root)
	if err != nil || s.Data != filepath.Join(root, "bin") || s.Bin != filepath.Join(root, "bin") || s.Conf != filepath.Join(root, "etc", "worldserver.conf") {
		t.Fatalf("got %+v, %v", s, err)
	}
	if err := acTools(s, t.TempDir()); err == nil || !strings.Contains(err.Error(), "TOOLS_BUILD") {
		t.Fatalf("no extractors: %v", err)
	}
}

func TestUpdateAzerothCoreMapsRebuildsOneMap(t *testing.T) {
	s, client := acFixture(t)
	run, maps := acRunner(t, s)
	var log []string
	if err := UpdateAzerothCoreMaps(s, client, 571, []string{"30_21", "31_21"}, false, run, func(l string) { log = append(log, l) }); err != nil {
		t.Fatalf("%v\n%s", err, strings.Join(log, "\n"))
	}
	// The extractors read the client through the staging folder, whose Map.dbc lists map 571 alone.
	if len(*maps) != 1 || (*maps)[0] != 571 {
		t.Errorf("the extractor read maps %v, want only 571", *maps)
	}
	bin := s.Bin
	want := []string{
		filepath.Join(bin, "map_extractor") + " -i client -o . -e 1",
		filepath.Join(bin, "vmap4_extractor") + " -d " + filepath.Join("client", "Data"),
		filepath.Join(bin, "vmap4_assembler") + " Buildings vmaps",
	}
	if len(run.calls) != 5 {
		t.Fatalf("calls: %q", run.calls)
	}
	for i, w := range want {
		if run.calls[i] != w {
			t.Errorf("call %d = %q, want %q", i, run.calls[i], w)
		}
	}
	cfg := filepath.Join(s.Data, "meld-mmaps-config.yaml")
	for i, tile := range []string{"30,21", "31,21"} {
		gen := run.calls[3+i]
		if !strings.HasPrefix(gen, filepath.Join(bin, "mmaps_generator")+" 571 --silent --threads ") || !strings.HasSuffix(gen, " --config "+cfg+" --tile "+tile) {
			t.Errorf("mmaps_generator: %q", gen)
		}
	}
	if fileExists(cfg) {
		t.Error("the generator's configuration is left")
	}
	data := s.Data
	for path, want := range map[string]string{
		"maps/5712130.map":                   "new",
		"maps/5712131.map":                   "(missing)", // the map lost the tile
		"maps/0003030.map":                   "old",       // another map's
		"vmaps/571.vmtree":                   "new",
		"vmaps/571_21_30.vmtile":             "new",
		"vmaps/571_21_31.vmtile":             "(missing)",
		"vmaps/000_30_30.vmtile":             "old",
		"vmaps/000.vmtree":                   "(missing)", // the assembler's other maps are not taken
		"vmaps/Shared.wmo.vmo":               "old",       // a model the server has stays its own
		"vmaps/New.m2.vmo":                   "new",
		"vmaps/GameObjectModels.dtree":       "new",
		"mmaps/5712130.mmtile":               "(missing)", // moved away for the generator, which skips a tile with a file
		"mmaps/5712131.mmtile":               "(missing)", // tile 31_21
		"mmaps/571.mmap":                     "(missing)", // written by each generator run
		"mmaps/0003030.mmtile":               "old",
		"dbc/AreaTable.dbc":                  "meld", // the table of Meld's patch, as the client reads it
		"dbc/Map.dbc":                        "old",
		"meld-backup/maps/5712130.map":       "old",
		"meld-backup/maps/5712131.map":       "old",
		"meld-backup/vmaps/571.vmtree":       "old",
		"meld-backup/vmaps/571_21_31.vmtile": "old",
		"meld-backup/mmaps/5712130.mmtile":   "old",
		"meld-backup/mmaps/5712131.mmtile":   "old",
		"meld-backup/mmaps/571.mmap":         "old",
		"meld-backup/dbc/AreaTable.dbc":      "old",
		"meld-backup/meld-tables.txt":        "AreaTable.dbc\n",
	} {
		if got := readText(t, filepath.Join(data, filepath.FromSlash(path))); got != want {
			t.Errorf("%s = %q, want %q", path, got, want)
		}
	}
	if _, err := os.Stat(filepath.Join(data, stagingDir)); !os.IsNotExist(err) {
		t.Errorf("the staging folder is left: %v", err)
	}
	// The client itself was never written.
	if fileExists(filepath.Join(client, "Data", "patch-5.MPQ")) {
		t.Error("the filtering archive went into the client")
	}

	// A second compile keeps the first backups, the server's own files, and puts back the server's
	// table once Meld's patch no longer holds it.
	os.WriteFile(filepath.Join(client, "Data", "patch-4.MPQ"), mpq.Write([]mpq.File{{Name: `World\Maps\Map571\Map571_30_21.adt`, Data: []byte("tile")}}), 0o644)
	run, _ = acRunner(t, s)
	if err := UpdateAzerothCoreMaps(s, client, 571, []string{"30_21"}, true, run, func(l string) { log = append(log, l) }); err != nil {
		t.Fatalf("%v\n%s", err, strings.Join(log, "\n"))
	}
	if len(run.calls) != 3 {
		t.Errorf("without movement maps: %q", run.calls)
	}
	for path, want := range map[string]string{
		"maps/5712130.map":              "new",
		"meld-backup/maps/5712130.map":  "old",
		"dbc/AreaTable.dbc":             "old",
		"meld-backup/dbc/AreaTable.dbc": "(missing)",
		"meld-backup/meld-tables.txt":   "\n",
	} {
		if got := readText(t, filepath.Join(data, filepath.FromSlash(path))); got != want {
			t.Errorf("after the second compile, %s = %q, want %q", path, got, want)
		}
	}
}

func TestUpdateAzerothCoreMapsExtractsEveryMapWhenItCannotFilter(t *testing.T) {
	s, client := acFixture(t)
	// The client's own patch-5.MPQ leaves no archive above the rest for the filter.
	os.WriteFile(filepath.Join(client, "Data", "patch-5.MPQ"), mpq.Write(nil), 0o644)
	run, maps := acRunner(t, s)
	var log []string
	if err := UpdateAzerothCoreMaps(s, client, 571, nil, true, run, func(l string) { log = append(log, l) }); err != nil {
		t.Fatalf("%v\n%s", err, strings.Join(log, "\n"))
	}
	if len(*maps) != 3 || !strings.Contains(strings.Join(log, "\n"), "Every map of the client is extracted") {
		t.Errorf("maps %v, log:\n%s", *maps, strings.Join(log, "\n"))
	}
	if run.calls[0] != filepath.Join(s.Bin, "map_extractor")+" -i "+client+" -o . -e 1" {
		t.Errorf("map extractor: %q", run.calls[0])
	}
	// Only map 571's files are taken.
	for path, want := range map[string]string{"maps/5712130.map": "new", "maps/0003030.map": "old", "maps/0012020.map": "(missing)"} {
		if got := readText(t, filepath.Join(s.Data, filepath.FromSlash(path))); got != want {
			t.Errorf("%s = %q, want %q", path, got, want)
		}
	}
}

func TestUpdateAzerothCoreMapsWholeMapMoveMaps(t *testing.T) {
	s, client := acFixture(t)
	run, _ := acRunner(t, s)
	if err := UpdateAzerothCoreMaps(s, client, 571, nil, false, run, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if gen := run.calls[len(run.calls)-1]; strings.Contains(gen, "--tile") || !strings.HasPrefix(gen, filepath.Join(s.Bin, "mmaps_generator")+" 571 ") {
		t.Errorf("mmaps_generator: %q", gen)
	}
	for path, want := range map[string]string{"mmaps/5712130.mmtile": "(missing)", "mmaps/5712131.mmtile": "(missing)", "mmaps/571.mmap": "(missing)", "mmaps/0003030.mmtile": "old"} {
		if got := readText(t, filepath.Join(s.Data, filepath.FromSlash(path))); got != want {
			t.Errorf("%s = %q, want %q", path, got, want)
		}
	}
}

func TestUpdateAzerothCoreMapsKeepsTheDataWhenAStepFails(t *testing.T) {
	s, client := acFixture(t)
	run, _ := acRunner(t, s)
	run.failAt = "vmap4_assembler"
	if err := UpdateAzerothCoreMaps(s, client, 571, []string{"30_21"}, false, run, func(string) {}); err == nil || !strings.Contains(err.Error(), "collision assembly") {
		t.Fatalf("err %v", err)
	}
	for _, path := range []string{"maps/5712131.map", "vmaps/571.vmtree", "dbc/AreaTable.dbc", "mmaps/5712130.mmtile"} {
		if got := readText(t, filepath.Join(s.Data, filepath.FromSlash(path))); got != "old" {
			t.Errorf("%s = %q, want it kept", path, got)
		}
	}
	if fileExists(filepath.Join(s.Data, acBackupDir)) {
		t.Error("a failed compile backed files up")
	}
}

func TestUpdateAzerothCoreMapsRefusesWhatItCannotRead(t *testing.T) {
	s, client := acFixture(t)
	run, _ := acRunner(t, s)
	if err := UpdateAzerothCoreMaps(s, client, 530, nil, false, run, func(string) {}); err == nil || !strings.Contains(err.Error(), "no map 530") || len(run.calls) != 0 {
		t.Errorf("a map the client lacks: %v, calls %q", err, run.calls)
	}
	if err := UpdateAzerothCoreMaps(s, client, 571, []string{"30-21"}, false, run, func(string) {}); err == nil || len(run.calls) != 0 {
		t.Errorf("a bad tile name: %v", err)
	}
	os.WriteFile(filepath.Join(s.Bin, "map_extractor"), []byte("\x7fELF...patch-3.MPQ\x00"), 0o755)
	if err := UpdateAzerothCoreMaps(s, client, 571, nil, false, run, func(string) {}); !errors.Is(err, ErrStockACExtractor) || len(run.calls) != 0 {
		t.Errorf("an extractor without patch-4.MPQ: %v", err)
	}
	// A 1.12 client.
	old := filepath.Join(t.TempDir(), "old")
	os.MkdirAll(filepath.Join(old, "Data"), 0o755)
	os.WriteFile(filepath.Join(old, "Data", "dbc.MPQ"), mpq.Write(nil), 0o644)
	if err := UpdateAzerothCoreMaps(s, old, 0, nil, false, run, func(string) {}); err == nil || !strings.Contains(err.Error(), "3.3.5a") {
		t.Errorf("a 1.12 client: %v", err)
	}
}

func TestUpdateAzerothCoreMapsWaitsForTheWorldServer(t *testing.T) {
	serverStopWait, serverPoll = 50*time.Millisecond, time.Millisecond
	defer func() { serverStopWait, serverPoll = 15*time.Minute, 250*time.Millisecond }()
	s, client := acFixture(t)
	run, _ := acRunner(t, s)
	run.serverUp, run.stopsAfter = true, 3
	if err := UpdateAzerothCoreMaps(s, client, 571, nil, true, run, func(string) {}); err != nil || len(run.calls) != 3 {
		t.Fatalf("after the author stopped it: %v, %q", err, run.calls)
	}
	run, _ = acRunner(t, s)
	run.serverUp = true
	if err := UpdateAzerothCoreMaps(s, client, 571, nil, true, run, func(string) {}); err == nil || len(run.calls) != 0 {
		t.Fatalf("a world server left running: %v, %q", err, run.calls)
	}
}

func TestMapDBCRowsKeepsOneRow(t *testing.T) {
	dbc := acMapDBC(0, 1, 571)
	only, ok := mapDBCRows(dbc, 571)
	if !ok || len(MapRowIDs(only)) != 1 || MapRowIDs(only)[0] != 571 {
		t.Fatalf("rows %v, %v", MapRowIDs(only), ok)
	}
	// The row's name still reads.
	off := binary.LittleEndian.Uint32(only[24:])
	strs := only[20+8:]
	if name := string(strs[off : off+uint32(strings.IndexByte(string(strs[off:]), 0))]); name != "Map571" {
		t.Errorf("name %q", name)
	}
	if _, ok := mapDBCRows(dbc, 530); ok {
		t.Error("a map the table lacks")
	}
}

func TestACMoveMapConfigSetsTheDataDir(t *testing.T) {
	got := string(acMoveMapConfigFor([]byte("mmapsConfig:\n  skipLiquid: false\n  dataDir: \"./\"\n  offmeshConnections: []\n"), "/srv/ac/data"))
	if !strings.Contains(got, "\n  dataDir: \"/srv/ac/data\"\n") || !strings.Contains(got, "skipLiquid: false") || !strings.Contains(got, "offmeshConnections") {
		t.Errorf("config:\n%s", got)
	}
}

// AzerothCore's source picked for the server: the install its CMake build names is taken instead.
func TestCheckAzerothCoreFollowsTheSourceToItsInstall(t *testing.T) {
	inst, _ := acFixture(t)
	src := t.TempDir()
	os.WriteFile(filepath.Join(src, "acore.sh"), []byte("#!/bin/bash"), 0o755)
	os.MkdirAll(filepath.Join(src, "build"), 0o755)
	cache := filepath.Join(src, "build", "CMakeCache.txt")
	os.WriteFile(cache, []byte("CMAKE_BUILD_TYPE:STRING=Release\nCMAKE_INSTALL_PREFIX:PATH="+inst.Root+"\n"), 0o644)
	s, err := CheckAzerothCore(src)
	if err != nil || s.Root != inst.Root || s.Data != inst.Data {
		t.Fatalf("got %+v, %v; want the install %s", s, err, inst.Root)
	}
	// A build that installs nowhere yet says where.
	os.WriteFile(cache, []byte("CMAKE_INSTALL_PREFIX:PATH="+filepath.Join(src, "nowhere")+"\n"), 0o644)
	if _, err := CheckAzerothCore(src); err == nil || !strings.Contains(err.Error(), "cmake --install") {
		t.Errorf("an install not made: %v", err)
	}
	// Not a source checkout: the plain refusal.
	if _, err := CheckAzerothCore(t.TempDir()); err == nil || !strings.Contains(err.Error(), "pick the folder with bin and etc") {
		t.Errorf("an empty folder: %v", err)
	}
}

package vmangos

import (
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// cmangosMapDBC is a Map.dbc of one field pair a row, holding the map IDs given.
func cmangosMapDBC(ids ...uint32) []byte {
	out := []byte("WDBC")
	for _, v := range []uint32{uint32(len(ids)), 2, 8, 1} {
		out = binary.LittleEndian.AppendUint32(out, v)
	}
	for _, id := range ids {
		out = binary.LittleEndian.AppendUint32(out, id)
		out = binary.LittleEndian.AppendUint32(out, 0)
	}
	return append(out, 0)
}

// cmangosFixture is a CMaNGOS server folder as a Visual Studio build leaves it: mangosd.conf with a
// DataDir of data, the extractors in Extractors (ad.exe holding patch-3.MPQ when patched), and data
// holding map 451's old files beside map 0's.
func cmangosFixture(t *testing.T, patched bool) (CMaNGOSServer, string) {
	t.Helper()
	root := t.TempDir()
	write := func(rel, body string) {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("mangosd.conf", "# DataDir = \"elsewhere\"\nDataDir = \"data\"\n")
	ad := "MZ...patch.MPQ\x00patch-2.MPQ\x00"
	if patched {
		ad += "patch-3.MPQ\x00"
	}
	write("Extractors/ad.exe", ad)
	for _, f := range []string{"Extractors/vmap_extractor.exe", "Extractors/vmap_assembler.exe", "Extractors/MoveMapGen.exe", "Extractors/offmesh.txt"} {
		write(f, "MZ")
	}
	for _, f := range []string{"data/maps/4513030.map", "data/maps/4513031.map", "data/maps/0003030.map", "data/vmaps/451.vmtree", "data/vmaps/451_30_31.vmtile",
		"data/vmaps/000_30_30.vmtile", "data/mmaps/451.mmap", "data/mmaps/4513031.mmtile", "data/mmaps/0003030.mmtile", "data/dbc/Map.dbc"} {
		write(f, "old")
	}
	s, err := CheckCMaNGOS(root)
	if err != nil {
		t.Fatal(err)
	}
	client := filepath.Join(t.TempDir(), "client")
	return s, client
}

// cmangosRunner fakes CMaNGOS's tools run in the server's DataDir data: ad writes a Map.dbc with
// mapIDs and map files, the assembler a tree and the game object model list.
func cmangosRunner(data string, mapIDs ...uint32) *fakeRunner {
	f := &fakeRunner{writes: map[string][]string{
		"ad.exe":             {"meld-staging/maps/4513030.map", "meld-staging/maps/0003030.map"},
		"vmap_extractor.exe": {"meld-staging/Buildings/dir_bin"},
		"vmap_assembler.exe": {"meld-staging/vmaps/451.vmtree", "meld-staging/vmaps/temp_gameobject_models"},
	}}
	f.onRun = func(name string, args []string) {
		if strings.HasSuffix(name, "ad.exe") {
			dbc := filepath.Join(data, stagingDir, "dbc")
			os.MkdirAll(dbc, 0o755)
			os.WriteFile(filepath.Join(dbc, "Map.dbc"), cmangosMapDBC(mapIDs...), 0o644)
		}
	}
	return f
}

func readText(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		return "(missing)"
	}
	return string(b)
}

func TestCheckCMaNGOSFindsTheConfAndDataDir(t *testing.T) {
	root := t.TempDir()
	if _, err := CheckCMaNGOS(root); err == nil || !strings.Contains(err.Error(), "mangosd.conf") {
		t.Fatalf("a folder without mangosd.conf: %v", err)
	}
	os.MkdirAll(filepath.Join(root, "etc"), 0o755)
	os.WriteFile(filepath.Join(root, "etc", "mangosd.conf"), []byte("DataDir = \"nowhere\"\n"), 0o644)
	if _, err := CheckCMaNGOS(root); err == nil || !strings.Contains(err.Error(), "DataDir") {
		t.Fatalf("a DataDir that isn't a folder: %v", err)
	}
	// Unset, DataDir is the folder itself, as mangosd's default ".".
	os.WriteFile(filepath.Join(root, "etc", "mangosd.conf"), []byte("LogsDir = \"\"\n"), 0o644)
	s, err := CheckCMaNGOS(root)
	if err != nil || s.Data != filepath.Clean(root) || s.Conf != filepath.Join(root, "etc", "mangosd.conf") {
		t.Fatalf("got %+v, %v", s, err)
	}
	if _, err := s.Tools(); err == nil || !strings.Contains(err.Error(), "BUILD_EXTRACTORS") {
		t.Fatalf("no extractors: %v", err)
	}
}

func TestUpdateCMaNGOSMapsRebuildsTheServersData(t *testing.T) {
	s, client := cmangosFixture(t, true)
	run := cmangosRunner(s.Data, 0, 451)
	var log []string
	if err := UpdateCMaNGOSMaps(s, client, 451, false, run, func(l string) { log = append(log, l) }); err != nil {
		t.Fatalf("%v\n%s", err, strings.Join(log, "\n"))
	}
	tools := filepath.Join(s.Root, "Extractors")
	want := []string{
		filepath.Join(tools, "ad.exe") + " -i " + client + " -o meld-staging -e 3",
		filepath.Join(tools, "vmap_extractor.exe") + " -d " + filepath.Join(client, "Data") + " -o meld-staging",
		filepath.Join(tools, "vmap_assembler.exe") + " " + filepath.Join("meld-staging", "Buildings") + " " + filepath.Join("meld-staging", "vmaps"),
	}
	if len(run.calls) != 4 {
		t.Fatalf("calls: %q", run.calls)
	}
	for i, w := range want {
		if run.calls[i] != w {
			t.Errorf("call %d = %q, want %q", i, run.calls[i], w)
		}
	}
	gen := run.calls[3]
	if !strings.HasPrefix(gen, filepath.Join(tools, "MoveMapGen.exe")+" 451 --silent --threads ") || !strings.Contains(gen, "--workdir "+s.Data) ||
		!strings.Contains(gen, "--offMeshInput "+filepath.Join(tools, "offmesh.txt")) || strings.Contains(gen, "--configInputPath") {
		t.Errorf("MoveMapGen: %q", gen)
	}
	data := s.Data
	for path, want := range map[string]string{
		"maps/4513030.map":              "new",
		"maps/4513031.map":              "(missing)", // the map lost the tile
		"maps/0003030.map":              "new",       // every map is extracted
		"vmaps/451.vmtree":              "new",
		"vmaps/451_30_31.vmtile":        "(missing)",
		"vmaps/000_30_30.vmtile":        "old",
		"vmaps/temp_gameobject_models":  "new",
		"mmaps/451.mmap":                "(missing)", // removed for MoveMapGen, which skips a tile with a file
		"mmaps/4513031.mmtile":          "(missing)",
		"mmaps/0003030.mmtile":          "old",
		"dbc/Map.dbc":                   string(cmangosMapDBC(0, 451)),
		"meld-staging/maps/4513030.map": "(missing)",
	} {
		if got := readText(t, filepath.Join(data, filepath.FromSlash(path))); got != want {
			t.Errorf("%s = %q, want %q", path, got, want)
		}
	}
	if _, err := os.Stat(filepath.Join(data, stagingDir)); !os.IsNotExist(err) {
		t.Errorf("the staging folder is left: %v", err)
	}
}

func TestUpdateCMaNGOSMapsRefusesAStockExtractor(t *testing.T) {
	s, client := cmangosFixture(t, false)
	run := cmangosRunner(s.Data, 0, 451)
	err := UpdateCMaNGOSMaps(s, client, 451, false, run, func(string) {})
	if !errors.Is(err, ErrStockExtractor) || len(run.calls) != 0 {
		t.Fatalf("err %v, calls %q", err, run.calls)
	}
}

func TestUpdateCMaNGOSMapsKeepsTheDataWhenTheMapIsMissing(t *testing.T) {
	s, client := cmangosFixture(t, true)
	// The extractor's Map.dbc lacks map 451: it read no patch-3 after all.
	run := cmangosRunner(s.Data, 0)
	err := UpdateCMaNGOSMaps(s, client, 451, false, run, func(string) {})
	if !errors.Is(err, ErrStockExtractor) || len(run.calls) != 1 {
		t.Fatalf("err %v, calls %q", err, run.calls)
	}
	for _, path := range []string{"maps/4513031.map", "vmaps/451_30_31.vmtile", "mmaps/451.mmap", "dbc/Map.dbc"} {
		if got := readText(t, filepath.Join(s.Data, filepath.FromSlash(path))); got != "old" {
			t.Errorf("%s = %q, want it kept", path, got)
		}
	}
}

func TestUpdateCMaNGOSMapsKeepsTheDataWhenAStepFails(t *testing.T) {
	s, client := cmangosFixture(t, true)
	run := cmangosRunner(s.Data, 0, 451)
	run.failAt = "vmap_assembler"
	if err := UpdateCMaNGOSMaps(s, client, 451, false, run, func(string) {}); err == nil || !strings.Contains(err.Error(), "collision assembly") {
		t.Fatalf("err %v", err)
	}
	for _, path := range []string{"maps/4513031.map", "vmaps/451.vmtree", "dbc/Map.dbc"} {
		if got := readText(t, filepath.Join(s.Data, filepath.FromSlash(path))); got != "old" {
			t.Errorf("%s = %q, want it kept", path, got)
		}
	}
}

func TestUpdateCMaNGOSMapsWaitsForTheWorldServer(t *testing.T) {
	serverStopWait, serverPoll = 50*time.Millisecond, time.Millisecond
	defer func() { serverStopWait, serverPoll = 15*time.Minute, 250*time.Millisecond }()
	s, client := cmangosFixture(t, true)
	run := cmangosRunner(s.Data, 0, 451)
	run.serverUp = true
	if err := UpdateCMaNGOSMaps(s, client, 451, true, run, func(string) {}); err == nil || len(run.calls) != 0 {
		t.Fatalf("a server that stays up: err %v, calls %q", err, run.calls)
	}
	run = cmangosRunner(s.Data, 0, 451)
	run.serverUp, run.stopsAfter = true, 3
	if err := UpdateCMaNGOSMaps(s, client, 451, true, run, func(string) {}); err != nil || len(run.calls) != 3 {
		t.Fatalf("a server stopped: err %v, calls %q (no MoveMapGen when skipped)", err, run.calls)
	}
}

func TestUpdateCMaNGOSMapsRefusesALongClientPath(t *testing.T) {
	s, _ := cmangosFixture(t, true)
	run := cmangosRunner(s.Data, 0, 451)
	err := UpdateCMaNGOSMaps(s, strings.Repeat("x", 128), 451, false, run, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "127") || len(run.calls) != 0 {
		t.Fatalf("err %v, calls %q", err, run.calls)
	}
}

package vmangos

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// Publish end to end (#405): ExportMap into the client's patch, with the files waiting for the game
// taken along, the server's Map.dbc, the map_template SQL, then the map data rebuilt from the patch,
// with serverMapsCurrent choosing between the changed tiles and the whole map (#211). The client is
// a temp folder with a made-up Map.dbc and WDT template and the server a temp folder whose programs
// are a fake runner, so no WOW_DIR, database or extractor is needed.

// chainMap and chainID are the published map's folder and ID.
const (
	chainMap = "ChainPub"
	chainID  = 1902
)

// chainClient makes a client folder (the one holding Data) whose base archive has the two files
// ExportMap reads from the client: Map.dbc and the WDT template.
func chainClient(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	mphd := binary.LittleEndian.AppendUint32([]byte("DHPM"), 32)
	files := []mpq.File{
		{Name: `DBFilesClient\Map.dbc`, Data: testMapDBC(t)},
		{Name: `World\Maps\Azeroth\Azeroth.wdt`, Data: append(mphd, make([]byte, 32)...)},
	}
	if err := os.WriteFile(filepath.Join(data, "base.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// chainRun is one Publish through a fake runner: the programs it ran (base names), MapExtractor's
// arguments, the log and the error.
type chainRun struct {
	steps   []string
	mapArgs string
	log     []string
	err     error
}

// ran says whether the run's programs were exactly want, in order.
func (r chainRun) ran(want ...string) bool {
	return strings.Join(r.steps, ",") == strings.Join(want, ",")
}

// patchFile is a file of the patch in dataDir, or nil.
func patchFile(t *testing.T, dataDir, name string) []byte {
	t.Helper()
	a, err := mpq.Open(filepath.Join(dataDir, PatchName))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := a.ReadFile(name)
	if err != nil {
		return nil
	}
	return b
}

// setServerMapsAge sets every file of the server's data/maps to the patch's time plus d: after it the
// server's map data is current (d > 0) or stale (d < 0).
func setServerMapsAge(t *testing.T, server, dataDir string, d time.Duration) {
	t.Helper()
	info, err := os.Stat(filepath.Join(dataDir, PatchName))
	if err != nil {
		t.Fatal(err)
	}
	maps := filepath.Join(server, "data", "maps")
	entries, err := os.ReadDir(maps)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		when := info.ModTime().Add(d)
		if err := os.Chtimes(filepath.Join(maps, e.Name()), when, when); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPublishChain(t *testing.T) {
	cache, oldRoot := t.TempDir(), pendingRoot
	pendingRoot = func() string { return cache }
	defer func() { pendingRoot = oldRoot }()

	root := chainClient(t)
	dataDir := filepath.Join(root, "Data")
	server := serverFolder(t)
	// A server whose collision data was built whole, so a publish extracts only its own map (#174).
	vmaps := filepath.Join(server, "data", "vmaps")
	if err := os.MkdirAll(vmaps, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vmaps, "temp_gameobject_models"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	tile := func(x int) TileSpec { return TileSpec{X: x, Y: 10, Outer: flatTile(0)} }
	spec := MapSpec{Dir: chainMap, MapID: chainID, Tiles: []TileSpec{tile(10), tile(11)}}
	tilePath := adt.TilePath(chainMap, 10, 10, "")

	// publish runs Publish, checking at the world database step that the client's share is done: the
	// map and the waiting files are in the patch, nothing waits, and the server has the map's row.
	publish := func(spec MapSpec) chainRun {
		t.Helper()
		var r chainRun
		f := &fakeRunner{writes: map[string][]string{
			// The extractors write into the staging folder, as the real ones are told to (#466).
			"MapExtractor":  {"meld-staging/maps/19021010.map", "meld-staging/maps/19021011.map"},
			"VMapAssembler": {"meld-staging/vmaps/1902.vmtree"},
		}}
		f.onRun = func(name string, args []string) {
			r.steps = append(r.steps, strings.TrimSuffix(filepath.Base(name), ".exe"))
			switch filepath.Base(name) {
			case "mariadb":
				sql := args[len(args)-1]
				if !strings.Contains(sql, "INSERT IGNORE INTO map_template") || !strings.Contains(sql, "1902") || !strings.Contains(sql, "'"+chainMap+"'") {
					t.Errorf("map_template SQL = %s", sql)
				}
				if patchFile(t, dataDir, tilePath) == nil {
					t.Error("the world database step ran before the map was in the patch")
				}
				if left, _ := PendingFiles(dataDir); len(left) != 0 {
					t.Errorf("%d files still wait at the world database step", len(left))
				}
				dbc, err := os.ReadFile(filepath.Join(server, "data", "5875", "dbc", "Map.dbc"))
				if err != nil || MapRowDir(dbc, chainID) != chainMap {
					t.Errorf("the server's Map.dbc lacks the map at the world database step: %v", err)
				}
			case "MapExtractor.exe":
				r.mapArgs = strings.Join(args, " ")
			}
		}
		p := PublishPlan{ClientRoot: root, ServerRoot: server, Mariadb: "mariadb", Run: f}
		r.err = Publish(p, spec, func(line string) { r.log = append(r.log, line) })
		return r
	}
	rebuild := []string{"mariadb", "MapExtractor", "VMapExtractor", "VMapAssembler"}

	// 1. A new map, with a Spell.dbc the spell editor queued while the game ran: it lands in this
	// patch, and the whole map is extracted, as the server never had it.
	if err := AddPending(dataDir, []mpq.File{{Name: SpellPath, Data: []byte("spell one")}}); err != nil {
		t.Fatal(err)
	}
	r := publish(spec)
	if r.err != nil {
		t.Fatal(r.err)
	}
	if !r.ran(rebuild...) {
		t.Fatalf("first publish ran %v, want %v", r.steps, rebuild)
	}
	if strings.Contains(r.mapArgs, "-t") || !strings.Contains(r.mapArgs, "-m 1902") {
		t.Fatalf("first publish extracted %q, want the whole map", r.mapArgs)
	}
	for _, name := range []string{tilePath, adt.TilePath(chainMap, 11, 10, ""), `World\Maps\ChainPub\ChainPub.wdt`, wdlPath(chainMap), `DBFilesClient\Map.dbc`} {
		if patchFile(t, dataDir, name) == nil {
			t.Errorf("the patch lacks %s", name)
		}
	}
	if b := patchFile(t, dataDir, SpellPath); string(b) != "spell one" {
		t.Errorf("the queued Spell.dbc in the patch = %q", b)
	}
	if _, err := os.Stat(filepath.Join(server, "data", "maps", "19021010.map")); err != nil {
		t.Fatalf("the staged map files did not replace the server's: %v", err)
	}

	// 2. Nothing changed and the server's data is newer than the patch: the server is left alone.
	setServerMapsAge(t, server, dataDir, time.Hour)
	if r = publish(spec); r.err != nil || len(r.steps) != 0 {
		t.Fatalf("an unchanged publish ran %v, %v", r.steps, r.err)
	}
	if !strings.Contains(strings.Join(r.log, "\n"), "Nothing changed") {
		t.Fatalf("log %q", r.log)
	}

	// 3. Nothing changed but the server's data is older than the patch: the whole map again.
	setServerMapsAge(t, server, dataDir, -time.Hour)
	if r = publish(spec); r.err != nil || !r.ran(rebuild...) || strings.Contains(r.mapArgs, "-t") {
		t.Fatalf("a publish over stale server data ran %v (%q), %v; want the whole map", r.steps, r.mapArgs, r.err)
	}

	// 4. One tile edited inside (its neighbour's border is unchanged) over current server data: only
	// that tile is extracted.
	setServerMapsAge(t, server, dataDir, time.Hour)
	edited := tile(10)
	edited.Outer[64*LatticeSize+64] = 3
	spec.Tiles = []TileSpec{edited, tile(11)}
	if r = publish(spec); r.err != nil || !r.ran(rebuild...) || !strings.Contains(r.mapArgs, "-m 1902 -t 10_10") || strings.Contains(r.mapArgs, "11_10") {
		t.Fatalf("an edited tile ran %v (%q), %v; want tile 10_10 alone", r.steps, r.mapArgs, r.err)
	}

	// 5. A tile added: the WDT changes, so the whole map, though the server's data was current.
	setServerMapsAge(t, server, dataDir, time.Hour)
	spec.Tiles = append(spec.Tiles, tile(12))
	if r = publish(spec); r.err != nil || !r.ran(rebuild...) || strings.Contains(r.mapArgs, "-t") {
		t.Fatalf("a new tile ran %v (%q), %v; want the whole map", r.steps, r.mapArgs, r.err)
	}
}

// TestPublishChainLockedPatch publishes while the game holds the patch (a read-only file stands in,
// as in TestLockedPatchIsRefusedUntouched): the publish fails before the server is touched, the
// patch is unchanged, and the file waiting for the game still waits, to go in with the next write.
func TestPublishChainLockedPatch(t *testing.T) {
	if runtime.GOOS != "windows" && os.Geteuid() == 0 {
		t.Skip("root ignores file permissions, so a 0444 file does not refuse writes here")
	}
	cache, oldRoot := t.TempDir(), pendingRoot
	pendingRoot = func() string { return cache }
	defer func() { pendingRoot = oldRoot }()

	root := chainClient(t)
	dataDir := filepath.Join(root, "Data")
	server := serverFolder(t)
	spec := MapSpec{Dir: chainMap, MapID: chainID, Tiles: []TileSpec{{X: 10, Y: 10, Outer: flatTile(0)}}}
	f := &fakeRunner{}
	p := PublishPlan{ClientRoot: root, ServerRoot: server, Mariadb: "mariadb", Run: f}
	if err := Publish(p, spec, func(string) {}); err != nil {
		t.Fatal(err)
	}

	if err := AddPending(dataDir, []mpq.File{{Name: SpellPath, Data: []byte("spell two")}}); err != nil {
		t.Fatal(err)
	}
	spec.Tiles[0].Outer[64*LatticeSize+64] = 3
	patch := filepath.Join(dataDir, PatchName)
	before, err := os.ReadFile(patch)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(patch, 0o444); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(patch, 0o644)
	f.calls = nil
	err = Publish(p, spec, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "in use") {
		t.Fatalf("publish over a held patch: %v, want it refused as in use", err)
	}
	if len(f.calls) != 0 {
		t.Fatalf("the server was touched after the patch write failed: %q", f.calls)
	}
	if after, _ := os.ReadFile(patch); !bytes.Equal(after, before) {
		t.Fatal("the held patch changed")
	}
	if left, _ := PendingFiles(dataDir); len(left) != 1 || string(left[0].Data) != "spell two" {
		t.Fatalf("the waiting Spell.dbc did not survive the failed write: %v", left)
	}

	// The game closed: the next publish takes the waiting file along and rebuilds the server.
	if err := os.Chmod(patch, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Publish(p, spec, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if b := patchFile(t, dataDir, SpellPath); string(b) != "spell two" {
		t.Fatalf("Spell.dbc in the patch = %q after the game closed", b)
	}
	if left, _ := PendingFiles(dataDir); len(left) != 0 {
		t.Fatalf("%d files still wait", len(left))
	}
	if callOf(f.calls, "mariadb") == "" {
		t.Fatalf("calls %q, want the server rebuilt", f.calls)
	}
}

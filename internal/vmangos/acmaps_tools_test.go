package vmangos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// acOwnServer is this machine's runner, but with no world server running: the test rebuilds a server
// folder of its own, which no world server reads, so a running one is not waited for.
type acOwnServer struct{ OSRunner }

func (acOwnServer) Running(string) bool { return false }

// AzerothCore's own tools (AZEROTHCORE_DIR, an install with bin, where they are built for this
// machine) rebuild map 571 (Northrend) from the 3.3.5a client (testclient.WotLKDir) into a server
// folder of the test's own (#1094): the client handed to them with its Map.dbc limited to the map makes
// both extractors take that map alone, and the movement maps of tile 30_21 are built. Nothing is
// written to the server's own data or to the client. Slow (minutes), so not with -short.
func TestAzerothCoreToolsRebuildOneMap(t *testing.T) {
	tools := os.Getenv("AZEROTHCORE_DIR")
	if tools == "" {
		t.Skip("AZEROTHCORE_DIR is not set (the AzerothCore install, the folder with bin)")
	}
	if testing.Short() {
		t.Skip("runs AzerothCore's extractors for minutes")
	}
	dataDir, err := wow.ResolveDataDir(testclient.WotLKDir(t))
	if err != nil {
		t.Fatal(err)
	}
	client := filepath.Dir(dataDir)

	// A server of the test's own: AzerothCore's bin, and a DataDir in the test's folder.
	root := t.TempDir()
	data := filepath.Join(root, "data")
	for _, d := range []string{"etc", "data/maps", "data/vmaps", "data/mmaps", "data/dbc"} {
		if err := os.MkdirAll(filepath.Join(root, filepath.FromSlash(d)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "etc", "worldserver.conf"), []byte("DataDir = \""+filepath.ToSlash(data)+"\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	bin, err := filepath.Abs(filepath.Join(tools, "bin"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(bin, filepath.Join(root, "bin")); err != nil {
		t.Fatal(err)
	}
	s, err := CheckAzerothCore(root)
	if err != nil {
		t.Fatal(err)
	}
	var log []string
	if err := UpdateAzerothCoreMaps(s, client, 571, []string{"30_21"}, false, acOwnServer{}, func(l string) {
		log = append(log, l)
		t.Log(l)
	}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(log, "\n"), "Every map of the client is extracted") {
		t.Error("the extraction was not limited to the map")
	}

	count := func(dir string, match func(string) bool) (n, other int) {
		entries, err := os.ReadDir(filepath.Join(data, dir))
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range entries {
			if match(e.Name()) {
				n++
			} else {
				other++
			}
		}
		return n, other
	}
	// Northrend has several hundred tiles, and nothing of another map is taken.
	if n, other := count("maps", func(n string) bool { return isMapTile(n, 571) }); n < 200 || other != 0 {
		t.Errorf("maps: %d of map 571's tiles, %d other files", n, other)
	}
	if !fileExists(filepath.Join(data, "maps", "5712130.map")) {
		t.Error("no map file for tile 30_21")
	}
	trees, _ := count("vmaps", func(n string) bool { return strings.HasSuffix(n, ".vmtree") })
	if trees != 1 || !fileExists(filepath.Join(data, "vmaps", "571.vmtree")) {
		t.Errorf("vmaps: %d trees, want 571.vmtree alone", trees)
	}
	if tiles, _ := count("vmaps", func(n string) bool { return strings.HasPrefix(n, "571_") && strings.HasSuffix(n, ".vmtile") }); tiles < 100 {
		t.Errorf("vmaps: %d tiles of map 571", tiles)
	}
	if models, _ := count("vmaps", func(n string) bool { return strings.HasSuffix(n, ".vmo") }); models < 100 {
		t.Errorf("vmaps: %d models", models)
	}
	if !fileExists(filepath.Join(data, "mmaps", "571.mmap")) || !fileExists(filepath.Join(data, "mmaps", "5712130.mmtile")) {
		t.Error("no movement maps for tile 30_21")
	}
	// The server had none of these files, so nothing was backed up, and no staging is left.
	for _, d := range []string{acBackupDir + "/maps", acBackupDir + "/vmaps", acBackupDir + "/mmaps", stagingDir} {
		if fileExists(filepath.Join(data, filepath.FromSlash(d))) {
			t.Errorf("%s is there", d)
		}
	}
}

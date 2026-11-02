package vmangos

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// A CMaNGOS classic server's map data, rebuilt from the client by that server's own extractors (#894,
// the owner's choice B): Meld runs them as Compile to Server runs VMaNGOS's, but CMaNGOS's tools take
// no map or tile filter, so every map is extracted and their output replaces the server's dbc, maps and
// vmaps whole. Its map extractor (ad) reads only model, dbc, terrain, patch and patch-2.MPQ unless
// patch-3.MPQ to patch-9.MPQ are added to CONF_mpq_list in contrib/extractor/System.cpp (the change
// Meld's VMaNGOS extractor carries), so a stock one is refused: it would never see Meld's tiles.

// CMaNGOSServer is a CMaNGOS classic server folder, as CheckCMaNGOS finds it.
type CMaNGOSServer struct {
	// Root is the folder picked: the one with mangosd.exe in a Windows build.
	Root string
	// Conf is its mangosd.conf.
	Conf string
	// Data is the server's DataDir (mangosd.conf), with dbc, maps, vmaps and mmaps in it.
	Data string
}

// cmangosToolDirs are where a CMaNGOS build puts its extractors, under the server folder: a Visual
// Studio build's output (bin/x64_Release/Extractors), an install (tools; bin/tools on Linux).
var cmangosToolDirs = []string{"Extractors", "tools", filepath.Join("bin", "tools")}

// cmangosMapExtractor and the rest are the tools' names (CMakeLists' EXECUTABLE_NAME), with .exe.
const (
	cmangosMapExtractor  = "ad.exe"
	cmangosVmapExtractor = "vmap_extractor.exe"
	cmangosVmapAssembler = "vmap_assembler.exe"
	cmangosMoveMapGen    = "MoveMapGen.exe"
)

// CheckCMaNGOS finds a CMaNGOS server's mangosd.conf (in the folder, or its etc) and its DataDir,
// which a relative path in the conf resolves against the folder (where mangosd runs from).
func CheckCMaNGOS(dir string) (CMaNGOSServer, error) {
	s := CMaNGOSServer{Root: dir}
	for _, c := range []string{"mangosd.conf", filepath.Join("etc", "mangosd.conf")} {
		if fileExists(filepath.Join(dir, c)) {
			s.Conf = filepath.Join(dir, c)
			break
		}
	}
	if s.Conf == "" {
		return s, fmt.Errorf("%s has no mangosd.conf (nor etc/mangosd.conf): not a CMaNGOS server folder (pick the folder with mangosd.exe)", dir)
	}
	data, err := readConfValue(s.Conf, "DataDir")
	if err != nil {
		return s, err
	}
	if data == "" {
		data = "."
	}
	if !filepath.IsAbs(data) {
		data = filepath.Join(dir, data)
	}
	s.Data = filepath.Clean(data)
	if info, err := os.Stat(s.Data); err != nil || !info.IsDir() {
		return s, fmt.Errorf("the DataDir of %s (%s) is not a folder", s.Conf, s.Data)
	}
	return s, nil
}

// readConfValue reads key's value from a mangosd.conf: the text after `key =`, unquoted, or "".
func readConfValue(conf, key string) (string, error) {
	b, err := os.ReadFile(conf)
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(k) == key {
			return strings.Trim(strings.TrimSpace(v), `"`), nil
		}
	}
	return "", nil
}

// Tools is the folder holding the server's extractors, or an error naming where they were looked for.
func (s CMaNGOSServer) Tools() (string, error) {
	for _, d := range cmangosToolDirs {
		if dir := filepath.Join(s.Root, d); fileExists(filepath.Join(dir, cmangosMapExtractor)) {
			return dir, nil
		}
	}
	return "", fmt.Errorf("no %s in %s's Extractors or tools folder: build CMaNGOS with -DBUILD_EXTRACTORS=ON", cmangosMapExtractor, s.Root)
}

// ErrStockExtractor is what a CMaNGOS map extractor that never opens patch-3.MPQ gets.
var ErrStockExtractor = errors.New("CMaNGOS's map extractor (ad.exe) reads only patch.MPQ and patch-2.MPQ, so it would never see Meld's tiles in patch-3.MPQ: add patch-3.MPQ to patch-9.MPQ to CONF_mpq_list in contrib/extractor/System.cpp and rebuild it (see the guide, Saving, compiling and playing › CMaNGOS classic)")

// readsCustomPatches reports whether the map extractor at path names patch-3.MPQ, which a build with
// the CONF_mpq_list change holds as a string literal and a stock one doesn't.
func readsCustomPatches(path string) (bool, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	return bytes.Contains(b, []byte(PatchName)), nil
}

// UpdateCMaNGOSMaps rebuilds a CMaNGOS server's map data from the client (its root, with Data in it),
// for mapID, the map Meld compiled: the dbc and map files, then the collision data, staged and moved
// over the server's once all have passed, then that map's movement maps unless skipMoveMaps. The world
// server holds its files open, so a running one is waited for until the author stops it, as for
// VMaNGOS (#661). Runs on Windows only (Supported).
func UpdateCMaNGOSMaps(s CMaNGOSServer, clientRoot string, mapID uint32, skipMoveMaps bool, run Runner, log func(string)) error {
	if run == nil {
		run = OSRunner{}
	}
	fail := func(err error) error {
		log(fmt.Sprintf("%v: the CMaNGOS server keeps its old map data.", err))
		return err
	}
	if err := Supported(run); err != nil {
		return fail(err)
	}
	tools, err := s.Tools()
	if err != nil {
		return fail(err)
	}
	if ok, err := readsCustomPatches(filepath.Join(tools, cmangosMapExtractor)); err != nil {
		return fail(err)
	} else if !ok {
		return fail(ErrStockExtractor)
	}
	for _, t := range []string{cmangosVmapExtractor, cmangosVmapAssembler} {
		if !fileExists(filepath.Join(tools, t)) {
			return fail(fmt.Errorf("no %s beside %s in %s", t, cmangosMapExtractor, tools))
		}
	}
	if run.Running("mangosd.exe") {
		log("Stop the world server: its map data is rebuilt as soon as it has stopped.")
		if !waitFor(func() bool { return !run.Running("mangosd.exe") }, serverStopWait) {
			return fail(errors.New("the world server kept running, so its map data was not rebuilt: stop it, then compile again"))
		}
	}
	if err := extractCMaNGOSMaps(s, tools, clientRoot, mapID, run, log); err != nil {
		return fail(err)
	}
	if !skipMoveMaps {
		buildCMaNGOSMoveMaps(s, tools, mapID, run, log)
	}
	return nil
}

// extractCMaNGOSMaps runs ad, vmap_extractor and vmap_assembler into stagingDir under the server's
// DataDir and, when all have passed and ad's Map.dbc has the map, moves their files over the server's.
func extractCMaNGOSMaps(s CMaNGOSServer, tools, clientRoot string, mapID uint32, run Runner, log func(string)) error {
	stage := filepath.Join(s.Data, stagingDir)
	if err := os.RemoveAll(stage); err != nil {
		return fmt.Errorf("clearing %s: %w", stage, err)
	}
	defer os.RemoveAll(stage)
	if err := os.MkdirAll(filepath.Join(stage, "vmaps"), 0o755); err != nil {
		return err
	}

	// Relative to the DataDir, where the tools run: ad keeps its paths in 128 bytes, and copies a longer
	// one past them. -e 3 is the map and dbc files, without the cinematic cameras, which no map changes.
	if len(clientRoot) >= 128 {
		return fmt.Errorf("CMaNGOS's map extractor takes a client path of at most 127 characters, and %s has %d", clientRoot, len(clientRoot))
	}
	log("Extracting the client's DBC and map files with CMaNGOS's extractor (every map: it has no map filter)…")
	if err := run.Run(s.Data, filepath.Join(tools, cmangosMapExtractor), []string{"-i", clientRoot, "-o", stagingDir, "-e", "3"}, log); err != nil {
		return fmt.Errorf("map extraction: %w", err)
	}
	dbc, err := os.ReadFile(filepath.Join(stage, "dbc", "Map.dbc"))
	if err != nil {
		return fmt.Errorf("the map extractor wrote no Map.dbc: %w", err)
	}
	found := false
	for _, id := range MapRowIDs(dbc) {
		found = found || id == mapID
	}
	if !found {
		return fmt.Errorf("the Map.dbc the map extractor read has no map %d: %w", mapID, ErrStockExtractor)
	}

	log("Extracting collision data…")
	if err := run.Run(s.Data, filepath.Join(tools, cmangosVmapExtractor), []string{"-d", filepath.Join(clientRoot, "Data"), "-o", stagingDir}, log); err != nil {
		return fmt.Errorf("collision extraction: %w", err)
	}
	if err := run.Run(s.Data, filepath.Join(tools, cmangosVmapAssembler),
		[]string{filepath.Join(stagingDir, "Buildings"), filepath.Join(stagingDir, "vmaps")}, log); err != nil {
		return fmt.Errorf("collision assembly: %w", err)
	}

	log("Replacing the server's map data…")
	maps, vmaps := filepath.Join(s.Data, "maps"), filepath.Join(s.Data, "vmaps")
	// The map may have lost tiles since, and the assembler writes a file only for a tile with buildings.
	tree := fmt.Sprintf("%03d", mapID)
	removeFiles(maps, func(name string) bool { return isMapTile(name, mapID) })
	removeFiles(vmaps, func(name string) bool {
		return name == tree+".vmtree" || strings.HasPrefix(name, tree+"_") && strings.HasSuffix(name, ".vmtile")
	})
	for _, d := range []string{"dbc", "maps", "vmaps"} {
		if err := moveFiles(filepath.Join(stage, d), filepath.Join(s.Data, d)); err != nil {
			return fmt.Errorf("replacing the server's %s: %w", d, err)
		}
	}
	return nil
}

// buildCMaNGOSMoveMaps rebuilds the map's movement maps with MoveMapGen, its old files removed first
// (it skips a tile that has one). A failure is only logged, as for VMaNGOS: the map data is in place.
func buildCMaNGOSMoveMaps(s CMaNGOSServer, tools string, mapID uint32, run Runner, log func(string)) {
	gen := filepath.Join(tools, cmangosMoveMapGen)
	if !fileExists(gen) {
		log("No MoveMapGen.exe beside the extractors, so the server's movement maps were left as they were.")
		return
	}
	mmaps := filepath.Join(s.Data, "mmaps")
	// The generator stops when its mmaps folder is missing.
	if err := os.MkdirAll(mmaps, 0o755); err != nil {
		log(fmt.Sprintf("Movement maps not built: %v", err))
		return
	}
	prefix := fmt.Sprintf("%03d", mapID)
	removeFiles(mmaps, func(name string) bool {
		return name == prefix+".mmap" || len(name) == len(prefix)+4+len(".mmtile") && strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".mmtile")
	})
	args := []string{strconv.FormatUint(uint64(mapID), 10), "--silent", "--threads", strconv.Itoa(max(1, min(runtime.NumCPU(), 8))), "--workdir", s.Data}
	for _, f := range []struct{ flag, name string }{{"--configInputPath", "config.json"}, {"--offMeshInput", "offmesh.txt"}} {
		if path := filepath.Join(tools, f.name); fileExists(path) {
			args = append(args, f.flag, path)
		}
	}
	log("Building the map's movement maps…")
	complaints := func(line string) {
		if l := strings.ToLower(line); strings.Contains(l, "error") || strings.Contains(l, "fail") || strings.Contains(l, "not found") {
			log(line)
		}
	}
	if err := run.Run(tools, gen, args, complaints); err != nil {
		log(fmt.Sprintf("MoveMapGen failed (%v): the map's movement maps are missing until it runs again. The map data itself was rebuilt.", err))
	}
}

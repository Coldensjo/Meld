package vmangos

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/clientbuild"
	"Meld/internal/mpq"
)

// An AzerothCore server's map data, rebuilt from a 3.3.5a client by that server's own extractors (#1094,
// the map half of #1073), as File › Compile to CMaNGOS Server does for CMaNGOS (#894). What its tools do
// was read in azerothcore-wotlk's src/tools (GPL, 2026-11); none of their code is copied:
//   - map_extractor (-i client, -o output, -e 1 the map files) and vmap4_extractor (-d the client's Data
//     folder, writing Buildings in the folder it runs in) take no map filter: each extracts every map
//     the client's Map.dbc lists. So the client is handed to them as a folder of links to its archives
//     plus one archive above them all holding a Map.dbc of the compiled map alone (acFilterArchives),
//     and they extract that map only. Both open patch-4.MPQ, Meld's patch in a 3.3.5a client:
//     map_extractor lists it in CONF_mpq_list, and vmap4_extractor takes every patch-N.MPQ.
//   - vmap4_assembler (Buildings, the vmaps folder) writes the map's tree, a file a tile with models and
//     the models those use.
//   - mmaps_generator (the map, --tile x,y, --threads, --silent, --config) reads maps and vmaps from its
//     YAML config's dataDir and writes mmaps there, skipping a tile whose file is current, so a tile's
//     old file is moved away first. A compile builds the region's tiles only: a whole continent takes
//     hours.
//   - The server takes its tables (DataDir/dbc) only from what map_extractor's -e 2 copies out of the
//     locale archives, which never hold Meld's patch, so the tables Meld's patch holds are copied into
//     DataDir/dbc by Meld itself (acInstallTables), as the client reads them: patch-4.MPQ above every
//     locale archive (clientbuild.PatchName).
//
// The server's own files are never lost: the first time Meld replaces one, it moves it into
// DataDir/meld-backup (the same folder under it: dbc, maps, vmaps, mmaps), so the server's data from
// before Meld can be put back by moving those files back.

// AzerothCoreServer is an AzerothCore server's install, as CheckAzerothCore finds it.
type AzerothCoreServer struct {
	// Root is the folder picked: the install (CMAKE_INSTALL_PREFIX, with bin and etc) or its bin folder.
	Root string
	// Conf is its worldserver.conf.
	Conf string
	// Data is the server's DataDir (worldserver.conf), with dbc, maps, vmaps and mmaps in it.
	Data string
	// Bin is the folder holding worldserver and the extractors, or "" when none was found.
	Bin string
}

// AzerothCore's program names (CMakeLists' executables), with .exe on Windows (acProgram).
const (
	acWorldServer = "worldserver"
	// acWorldImage is the world server's image name as Runner.Running takes it (off Windows it matches
	// the name without .exe).
	acWorldImage    = "worldserver.exe"
	acMapExtractor  = "map_extractor"
	acVmapExtractor = "vmap4_extractor"
	acVmapAssembler = "vmap4_assembler"
	acMoveMapGen    = "mmaps_generator"
	// acMoveMapConfig is mmaps_generator's configuration, which an install puts beside it.
	acMoveMapConfig = "mmaps-config.yaml"
	// acBackupDir is where the server's own files go the first time Meld replaces them, under DataDir.
	acBackupDir = "meld-backup"
	// acTablesList names, in acBackupDir, the tables Meld last copied into the server's dbc folder.
	acTablesList = "meld-tables.txt"
)

// acProgram is a program's file name on this machine.
func acProgram(name string) string {
	if hostOS == "windows" {
		return name + ".exe"
	}
	return name
}

// acConfDirs are where an install keeps worldserver.conf (etc; beside the programs in a Windows build)
// and acBinDirs where it keeps its programs, under the folder picked.
var (
	acConfDirs = []string{"etc", ".", "bin", filepath.Join("bin", "RelWithDebInfo"), filepath.Join("bin", "Release")}
	acBinDirs  = []string{"bin", ".", filepath.Join("bin", "RelWithDebInfo"), filepath.Join("bin", "Release")}
)

// CheckAzerothCore finds an AzerothCore install's worldserver.conf and DataDir. A relative DataDir is
// the worldserver's working folder's, which is where its program is (its default is "."), else the
// folder picked.
func CheckAzerothCore(dir string) (AzerothCoreServer, error) {
	s := AzerothCoreServer{Root: dir}
	for _, c := range acConfDirs {
		if p := filepath.Join(dir, c, "worldserver.conf"); fileExists(p) {
			s.Conf = p
			break
		}
	}
	if s.Conf == "" {
		return s, fmt.Errorf("%s has no worldserver.conf (nor etc/worldserver.conf): not an AzerothCore server folder (pick the folder with bin and etc)", dir)
	}
	for _, b := range acBinDirs {
		if p := filepath.Join(dir, b); fileExists(filepath.Join(p, acProgram(acWorldServer))) || fileExists(filepath.Join(p, acProgram(acMapExtractor))) {
			s.Bin = p
			break
		}
	}
	data, err := readConfValue(s.Conf, "DataDir")
	if err != nil {
		return s, err
	}
	if data == "" {
		data = "."
	}
	if !filepath.IsAbs(data) {
		base := s.Bin
		if base == "" {
			base = dir
		}
		data = filepath.Join(base, data)
	}
	s.Data = filepath.Clean(data)
	if info, err := os.Stat(s.Data); err != nil || !info.IsDir() {
		return s, fmt.Errorf("the DataDir of %s (%s) is not a folder", s.Conf, s.Data)
	}
	return s, nil
}

// ErrStockACExtractor is what a map extractor that never opens Meld's patch gets.
var ErrStockACExtractor = errors.New("AzerothCore's map extractor does not list Meld's patch (patch-4.MPQ) in CONF_mpq_list (src/tools/map_extractor/System.cpp), so it would never see Meld's tiles: build it from a newer AzerothCore, or add patch-4.MPQ there")

// acTools checks that the server's extractors can rebuild its map data from the 3.3.5a client at
// clientRoot, before anything is written.
func acTools(s AzerothCoreServer, clientRoot string) error {
	if s.Bin == "" || !fileExists(filepath.Join(s.Bin, acProgram(acMapExtractor))) {
		return fmt.Errorf("no %s in %s's bin folder: build AzerothCore with its tools (-DTOOLS_BUILD=all) and install them", acProgram(acMapExtractor), s.Root)
	}
	for _, t := range []string{acVmapExtractor, acVmapAssembler} {
		if !fileExists(filepath.Join(s.Bin, acProgram(t))) {
			return fmt.Errorf("no %s beside %s in %s", acProgram(t), acProgram(acMapExtractor), s.Bin)
		}
	}
	data := filepath.Join(clientRoot, "Data")
	if b := clientbuild.Detect(data).Build; b != clientbuild.WotLK {
		return fmt.Errorf("AzerothCore's extractors read a 3.3.5a client, and %s is %s", clientRoot, b)
	}
	b, err := os.ReadFile(filepath.Join(s.Bin, acProgram(acMapExtractor)))
	if err != nil {
		return err
	}
	if !bytes.Contains(b, []byte(clientbuild.WotLK.PatchName())) {
		return ErrStockACExtractor
	}
	return nil
}

// UpdateAzerothCoreMaps rebuilds an AzerothCore server's map data from the 3.3.5a client at clientRoot
// for mapID, the map Meld compiled: its map and collision files, extracted into stagingDir under the
// DataDir and moved over the server's once every step has passed, the tables Meld's patch holds, and
// then, unless skipMoveMaps, its movement maps for tiles ("x_y", the ADT's x and y), or for the whole
// map when there are none. The world server holds its files open, so a running one is waited for until
// the author stops it (#661): Meld never stops or starts it. Runs wherever AzerothCore's tools do.
func UpdateAzerothCoreMaps(s AzerothCoreServer, clientRoot string, mapID uint32, tiles []string, skipMoveMaps bool, run Runner, log func(string)) error {
	if run == nil {
		run = OSRunner{}
	}
	fail := func(err error) error {
		log(fmt.Sprintf("%v: the AzerothCore server keeps its old map data.", err))
		return err
	}
	if err := acTools(s, clientRoot); err != nil {
		return fail(err)
	}
	for _, t := range tiles {
		if _, _, ok := acTile(t); !ok {
			return fail(fmt.Errorf("%q is not a tile (x_y)", t))
		}
	}
	if run.Running(acWorldImage) {
		log("Stop the world server: its map data is rebuilt as soon as it has stopped.")
		if !waitFor(func() bool { return !run.Running(acWorldImage) }, serverStopWait) {
			return fail(errors.New("the world server kept running, so its map data was not rebuilt: stop it, then compile again"))
		}
	}
	if err := extractACMaps(s, clientRoot, mapID, run, log); err != nil {
		return fail(err)
	}
	if !skipMoveMaps {
		buildACMoveMaps(s, mapID, tiles, run, log)
	}
	return nil
}

// acTile reads a tile's "x_y" name.
func acTile(t string) (x, y int, ok bool) {
	a, b, found := strings.Cut(t, "_")
	x, errX := strconv.Atoi(a)
	y, errY := strconv.Atoi(b)
	return x, y, found && errX == nil && errY == nil && x >= 0 && x < 64 && y >= 0 && y < 64
}

// acComplaints passes on only the lines of a tool's output that say something went wrong: the tools
// print a line a file or a progress bar.
func acComplaints(log func(string)) func(string) {
	return func(line string) {
		if l := strings.ToLower(line); strings.Contains(l, "error") || strings.Contains(l, "fail") || strings.Contains(l, "not found") ||
			strings.Contains(l, "can't") || strings.Contains(l, "cannot") || strings.Contains(l, "could not") {
			log(line)
		}
	}
}

// extractACMaps runs map_extractor, vmap4_extractor and vmap4_assembler in stagingDir under the server's
// DataDir and, when all have passed, puts the map's files and Meld's tables in place of the server's.
func extractACMaps(s AzerothCoreServer, clientRoot string, mapID uint32, run Runner, log func(string)) error {
	stage := filepath.Join(s.Data, stagingDir)
	if err := os.RemoveAll(stage); err != nil {
		return fmt.Errorf("clearing %s: %w", stage, err)
	}
	defer os.RemoveAll(stage)
	if err := os.MkdirAll(stage, 0o755); err != nil {
		return err
	}
	clientData := filepath.Join(clientRoot, "Data")
	set, err := mpq.OpenDataDir(clientData)
	if err != nil {
		return fmt.Errorf("opening the client's archives: %w", err)
	}
	mapDBC, err := set.ReadFile(`DBFilesClient\Map.dbc`)
	set.Close()
	if err != nil {
		return fmt.Errorf("reading the client's Map.dbc: %w", err)
	}
	only, ok := mapDBCRows(mapDBC, mapID)
	if !ok {
		return fmt.Errorf("the client's Map.dbc has no map %d", mapID)
	}
	tables, err := patchTables(PatchPath(clientData))
	if err != nil {
		return err
	}

	// Relative to the staging folder, where the tools run, as map_extractor's paths are short.
	input := "client"
	if err := acFilteredClient(filepath.Join(stage, input), clientData, only); err != nil {
		// map_extractor keeps its input path in 128 bytes.
		if len(clientRoot) >= 128 {
			return fmt.Errorf("the extraction could not be limited to map %d (%v), and AzerothCore's map extractor takes a client path of at most 127 characters, which %s is not", mapID, err, clientRoot)
		}
		log(fmt.Sprintf("Every map of the client is extracted (slow), as it could not be limited to map %d: %v", mapID, err))
		input = clientRoot
	}
	log(fmt.Sprintf("Extracting map %d's ground with AzerothCore's map extractor…", mapID))
	if err := run.Run(stage, filepath.Join(s.Bin, acProgram(acMapExtractor)), []string{"-i", input, "-o", ".", "-e", "1"}, acComplaints(log)); err != nil {
		return fmt.Errorf("map extraction: %w", err)
	}
	log("Extracting its collision data…")
	if err := run.Run(stage, filepath.Join(s.Bin, acProgram(acVmapExtractor)), []string{"-d", filepath.Join(input, "Data")}, acComplaints(log)); err != nil {
		return fmt.Errorf("collision extraction: %w", err)
	}
	if err := run.Run(stage, filepath.Join(s.Bin, acProgram(acVmapAssembler)), []string{"Buildings", "vmaps"}, acComplaints(log)); err != nil {
		return fmt.Errorf("collision assembly: %w", err)
	}
	log("Replacing the server's map data…")
	isTree := func(name string) bool { return name == fmt.Sprintf("%03d.vmtree", mapID) }
	isVmTile := func(name string) bool {
		return strings.HasPrefix(name, fmt.Sprintf("%03d_", mapID)) && strings.HasSuffix(name, ".vmtile")
	}
	ofMap := func(name string) bool { return isTree(name) || isVmTile(name) }
	// The map may have lost tiles, and the assembler writes a file only for a tile with models, so the
	// map's old files all go first.
	if err := backUp(s.Data, "maps", func(name string) bool { return isMapTile(name, mapID) }); err != nil {
		return err
	}
	if err := backUp(s.Data, "vmaps", ofMap); err != nil {
		return err
	}
	if err := moveMatching(filepath.Join(stage, "maps"), filepath.Join(s.Data, "maps"), func(name string) bool { return isMapTile(name, mapID) }); err != nil {
		return fmt.Errorf("replacing the map files: %w", err)
	}
	// The map's tree and tiles, and the models of it the server lacks; a model the server has is the
	// same model file, which other maps' trees name too. Only the map's own files are taken from a
	// whole extraction.
	vmaps := filepath.Join(s.Data, "vmaps")
	if err := moveMatching(filepath.Join(stage, "vmaps"), vmaps, func(name string) bool {
		return ofMap(name) || !strings.HasSuffix(name, ".vmtree") && !strings.HasSuffix(name, ".vmtile") && !fileExists(filepath.Join(vmaps, name))
	}); err != nil {
		return fmt.Errorf("replacing the collision files: %w", err)
	}
	return acInstallTables(s, clientData, tables, log)
}

// mapDBCRows is a Map.dbc holding only the row of mapID, and whether dbc has one. The string block is
// kept whole, so the row's strings keep their offsets.
func mapDBCRows(dbc []byte, mapID uint32) ([]byte, bool) {
	if len(dbc) < 20 || string(dbc[:4]) != "WDBC" {
		return nil, false
	}
	records := int(binary.LittleEndian.Uint32(dbc[4:]))
	size := int(binary.LittleEndian.Uint32(dbc[12:]))
	strs := int(binary.LittleEndian.Uint32(dbc[16:]))
	if size < 4 || 20+records*size+strs > len(dbc) {
		return nil, false
	}
	for r := 0; r < records; r++ {
		row := dbc[20+r*size : 20+(r+1)*size]
		if binary.LittleEndian.Uint32(row) != mapID {
			continue
		}
		out := append([]byte(nil), dbc[:20]...)
		binary.LittleEndian.PutUint32(out[4:], 1)
		out = append(out, row...)
		return append(out, dbc[20+records*size:20+records*size+strs]...), true
	}
	return nil, false
}

// acFilteredClient lays out dir as a 3.3.5a client whose Map.dbc holds the one row only: a Data folder of
// links to the client's archives (its own and each locale folder's), and an archive holding that Map.dbc
// above all of them for both extractors (acFilterArchives). It fails when the client already has one of
// those archives, or links cannot be made here; the caller then extracts from the client itself.
func acFilteredClient(dir, clientData string, mapDBC []byte) error {
	data := filepath.Join(dir, "Data")
	locales, err := linkArchives(clientData, data)
	if err != nil {
		return err
	}
	if len(locales) == 0 {
		return errors.New("the client has no locale folder")
	}
	archive := mpq.Write([]mpq.File{{Name: `DBFilesClient\Map.dbc`, Data: mapDBC}})
	for _, rel := range acFilterArchives(locales) {
		path := filepath.Join(data, rel)
		if fileExists(path) {
			return fmt.Errorf("the client already has its own %s", rel)
		}
		if err := os.WriteFile(path, archive, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// acFilterArchives are the archives (under Data) that both extractors read above every other: patch-5.MPQ
// is the last of map_extractor's CONF_mpq_list, opened after the locale archives; vmap4_extractor opens
// the locale folders' patches last, so a locale's patch-<locale>-9.MPQ tops it.
func acFilterArchives(locales []string) []string {
	out := []string{"patch-5.MPQ"}
	for _, l := range locales {
		out = append(out, filepath.Join(l, "patch-"+l+"-9.MPQ"))
	}
	return out
}

// linkArchives links every archive (.MPQ) of the client's Data folder, and of each locale folder in it,
// into dst under the same names, and returns those locale folders' names.
func linkArchives(clientData, dst string) ([]string, error) {
	entries, err := os.ReadDir(clientData)
	if err != nil {
		return nil, err
	}
	var locales []string
	for _, e := range entries {
		if e.IsDir() && fileExists(filepath.Join(clientData, e.Name(), "locale-"+e.Name()+".MPQ")) {
			if err := linkFolderArchives(filepath.Join(clientData, e.Name()), filepath.Join(dst, e.Name())); err != nil {
				return nil, err
			}
			locales = append(locales, e.Name())
		}
	}
	if err := linkFolderArchives(clientData, dst); err != nil {
		return nil, err
	}
	return locales, nil
}

// linkFolderArchives links each .MPQ file of src into dst: a symbolic link, else a hard link (Windows
// without the right to make symbolic links, with both on one drive).
func linkFolderArchives(src, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".mpq") {
			continue
		}
		from, to := filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())
		abs, err := filepath.Abs(from)
		if err != nil {
			return err
		}
		if err := os.Symlink(abs, to); err != nil {
			if err2 := os.Link(abs, to); err2 != nil {
				return fmt.Errorf("linking %s: %w", e.Name(), err)
			}
		}
	}
	return nil
}

// moveMatching moves the files of src whose names match into dst, over any of the same name. A missing
// src moves nothing.
func moveMatching(src, dst string, match func(name string) bool) error {
	entries, err := os.ReadDir(src)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !match(e.Name()) {
			continue
		}
		if err := os.Rename(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

// backUp takes the files of data/sub whose names match out of the server's data: the first time, into
// data/meld-backup/sub, where the server's own file stays; after that (the backup holds the server's
// own), the file Meld wrote before is removed.
func backUp(data, sub string, match func(name string) bool) error {
	dir, backup := filepath.Join(data, sub), filepath.Join(data, acBackupDir, sub)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !match(e.Name()) {
			continue
		}
		from, to := filepath.Join(dir, e.Name()), filepath.Join(backup, e.Name())
		if fileExists(to) {
			if err := os.Remove(from); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(backup, 0o755); err != nil {
			return err
		}
		if err := os.Rename(from, to); err != nil {
			return fmt.Errorf("backing up %s: %w", from, err)
		}
	}
	return nil
}

// patchTables are the tables (DBFilesClient\*.dbc) Meld's patch at path holds, by file name, with their
// bytes: none when there is no patch.
func patchTables(path string) (map[string][]byte, error) {
	out := map[string][]byte{}
	if !fileExists(path) {
		return out, nil
	}
	a, err := mpq.Open(path)
	if err != nil {
		return nil, fmt.Errorf("opening Meld's patch: %w", err)
	}
	defer a.Close()
	names, err := a.ListFile()
	if err != nil {
		return nil, fmt.Errorf("listing Meld's patch: %w", err)
	}
	for _, n := range names {
		dir, file, ok := strings.Cut(strings.ReplaceAll(n, "/", `\`), `\`)
		if !ok || !strings.EqualFold(dir, "DBFilesClient") || strings.Contains(file, `\`) || !strings.EqualFold(filepath.Ext(file), ".dbc") {
			continue
		}
		b, err := a.ReadFile(n)
		if err != nil {
			return nil, fmt.Errorf("reading %s from Meld's patch: %w", n, err)
		}
		out[file] = b
	}
	return out, nil
}

// acInstallTables writes the tables Meld's patch holds into the server's dbc folder, the server's own
// copy of each backed up first, and puts back the server's own copy of a table Meld copied there before
// that the patch no longer holds (acTablesList says which), so the server reads the tables the client
// does.
func acInstallTables(s AzerothCoreServer, clientData string, tables map[string][]byte, log func(string)) error {
	dbc := filepath.Join(s.Data, "dbc")
	backup := filepath.Join(s.Data, acBackupDir)
	list := filepath.Join(backup, acTablesList)
	before := map[string]bool{}
	if b, err := os.ReadFile(list); err == nil {
		for _, n := range strings.Fields(string(b)) {
			before[n] = true
		}
	}
	var names []string
	for n := range tables {
		names = append(names, n)
	}
	sort.Strings(names)
	for n := range before {
		if _, ok := tables[n]; ok {
			continue
		}
		// The server's own copy back, or none when it had none.
		own := filepath.Join(backup, "dbc", n)
		if fileExists(own) {
			if err := os.Rename(own, filepath.Join(dbc, n)); err != nil {
				return fmt.Errorf("putting back the server's %s: %w", n, err)
			}
		} else {
			_ = os.Remove(filepath.Join(dbc, n))
		}
		log(fmt.Sprintf("Put back the server's own %s, which Meld's patch no longer holds.", n))
	}
	if len(names) > 0 {
		in := map[string]bool{}
		for _, n := range names {
			in[n] = true
		}
		if err := backUp(s.Data, "dbc", func(name string) bool { return in[name] }); err != nil {
			return err
		}
		if err := os.MkdirAll(dbc, 0o755); err != nil {
			return err
		}
		for _, n := range names {
			if err := os.WriteFile(filepath.Join(dbc, n), tables[n], 0o644); err != nil {
				return fmt.Errorf("writing the server's %s: %w", n, err)
			}
		}
		log(fmt.Sprintf("Copied the %d tables of Meld's patch into the server's dbc folder: %s.", len(names), strings.Join(names, ", ")))
	}
	if len(names) == 0 && len(before) == 0 {
		return nil
	}
	if err := os.MkdirAll(backup, 0o755); err != nil {
		return err
	}
	return os.WriteFile(list, []byte(strings.Join(names, "\n")+"\n"), 0o644)
}

// acDataDirLine is mmaps-config.yaml's dataDir setting.
var acDataDirLine = regexp.MustCompile(`(?m)^([ \t]*)dataDir:.*$`)

// acMoveMapConfigFor is the generator's configuration with its dataDir set to the server's DataDir.
func acMoveMapConfigFor(config []byte, data string) []byte {
	set := []byte("${1}dataDir: " + strconv.Quote(filepath.ToSlash(data)))
	if acDataDirLine.Match(config) {
		return acDataDirLine.ReplaceAll(config, set)
	}
	// Without one the generator reads the folder it runs in, which is the DataDir.
	return config
}

// buildACMoveMaps rebuilds the map's movement maps with mmaps_generator, from the server's new map and
// collision data: a run a tile when tiles are given, else the whole map, the old files moved away first
// (backUp), as the generator skips a tile whose file is current. A failure is only logged, as for
// VMaNGOS: the map data is in place.
func buildACMoveMaps(s AzerothCoreServer, mapID uint32, tiles []string, run Runner, log func(string)) {
	gen := filepath.Join(s.Bin, acProgram(acMoveMapGen))
	config, err := os.ReadFile(filepath.Join(s.Bin, acMoveMapConfig))
	if !fileExists(gen) || err != nil {
		log(fmt.Sprintf("No %s with its %s in %s, so the server's movement maps were left as they were.", acProgram(acMoveMapGen), acMoveMapConfig, s.Bin))
		return
	}
	cfg := filepath.Join(s.Data, "meld-"+acMoveMapConfig)
	if err := os.WriteFile(cfg, acMoveMapConfigFor(config, s.Data), 0o644); err != nil {
		log(fmt.Sprintf("Movement maps not built: %v", err))
		return
	}
	defer os.Remove(cfg)
	if err := os.MkdirAll(filepath.Join(s.Data, "mmaps"), 0o755); err != nil {
		log(fmt.Sprintf("Movement maps not built: %v", err))
		return
	}
	id := strconv.FormatUint(uint64(mapID), 10)
	base := []string{id, "--silent", "--threads", strconv.Itoa(max(1, min(runtime.NumCPU(), 8))), "--config", cfg}
	prefix := fmt.Sprintf("%03d", mapID)
	failed := 0
	if len(tiles) == 0 {
		log("Building the whole map's movement maps (a continent takes hours)…")
		if err := backUp(s.Data, "mmaps", func(name string) bool {
			return name == prefix+".mmap" || len(name) == len(prefix)+4+len(".mmtile") && strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".mmtile")
		}); err != nil {
			log(fmt.Sprintf("Movement maps not built: %v", err))
			return
		}
		if err := run.Run(s.Data, gen, base, acComplaints(log)); err != nil {
			failed++
		}
	} else {
		for i, t := range tiles {
			x, y, _ := acTile(t)
			// Its files are named by the map, then y, then x. Each run writes the map's .mmap again.
			name := fmt.Sprintf("%s%02d%02d.mmtile", prefix, y, x)
			log(fmt.Sprintf("Building movement maps: tile %s (%d of %d)…", t, i+1, len(tiles)))
			if err := backUp(s.Data, "mmaps", func(n string) bool { return n == name || n == prefix+".mmap" }); err != nil {
				log(fmt.Sprintf("Movement maps of tile %s not built: %v", t, err))
				failed++
				continue
			}
			if err := run.Run(s.Data, gen, append(append([]string(nil), base...), "--tile", fmt.Sprintf("%d,%d", x, y)), acComplaints(log)); err != nil {
				failed++
			}
		}
	}
	if failed > 0 {
		log(fmt.Sprintf("mmaps_generator failed %d time(s): those movement maps are missing until it runs again (creatures there stand still). The map data itself was rebuilt.", failed))
	}
}

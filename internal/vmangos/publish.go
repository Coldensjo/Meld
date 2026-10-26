package vmangos

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Runner runs the programs a publish needs: the server's extractors and mariadb, and the world
// server itself. Run waits for a program and passes its output lines to log; RunEnv does the same with
// env (KEY=value) added to its environment; Start leaves it running.
type Runner interface {
	Run(dir, name string, args []string, log func(string)) error
	RunEnv(dir, name string, env, args []string, log func(string)) error
	Start(dir, name string, args ...string) error
	// Running reports whether a program with this image name (say "mangosd.exe") is running.
	Running(image string) bool
}

// OSRunner runs programs on this machine.
type OSRunner struct{}

// ErrNeedsWindows is what the server tooling returns off Windows (#483): it finds and stops the
// server's programs with tasklist and taskkill and runs its Windows extractors, so elsewhere every
// program would look stopped and every step would fail with a misleading error.
var ErrNeedsWindows = errors.New("managing the VMaNGOS server needs Windows: Meld finds and stops its programs with tasklist and taskkill")

// hostOS is runtime.GOOS; tests change it to check the guard on any machine.
var hostOS = runtime.GOOS

// Supported returns ErrNeedsWindows when r is this machine's runner (or nil, which means it) and this
// machine isn't Windows, and nil otherwise; a test's fake runner is always supported.
func Supported(r Runner) error {
	if _, isOS := r.(OSRunner); (isOS || r == nil) && hostOS != "windows" {
		return ErrNeedsWindows
	}
	return nil
}

// Running asks Windows' task list for the image name. Off Windows it reads the process table, matching
// the name without ".exe" (a native build such as Benilla's) or with it (under Wine), so a patch write
// still waits for a running game there (#730); the servers stay Windows-only (Supported).
func (OSRunner) Running(image string) bool {
	if hostOS != "windows" {
		return runningOffWindows(image)
	}
	cmd := exec.Command("tasklist", "/FI", "IMAGENAME eq "+image, "/NH")
	hideConsole(cmd)
	out, err := cmd.Output()
	return err == nil && strings.Contains(strings.ToLower(string(out)), strings.ToLower(image))
}

func (r OSRunner) Run(dir, name string, args []string, log func(string)) error {
	return r.RunEnv(dir, name, nil, args, log)
}

func (OSRunner) RunEnv(dir, name string, env, args []string, log func(string)) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}
	hideConsole(cmd)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return err
	}
	sc := bufio.NewScanner(out)
	for sc.Scan() {
		if line := strings.TrimSpace(sc.Text()); line != "" && log != nil {
			log(line)
		}
	}
	return cmd.Wait()
}

// Start runs a program that stays up after this returns. See startProgram.
func (OSRunner) Start(dir, name string, args ...string) error {
	return startProgram(dir, name, args)
}

// StartEnv is Start with `env` (KEY=value) added to the program's environment (Benilla takes its data
// folder and login from it).
func (OSRunner) StartEnv(dir, name string, env []string, args ...string) error {
	return startProgramEnv(dir, name, args, env)
}

// StartLogged starts a program directly, not through cmd's start, so it gets no console of its own,
// with `env` added to its environment and its output written to a new file at logPath. It's for a
// windowed program (Meld's Benilla launcher), which needs no console, unlike the servers.
func (OSRunner) StartLogged(dir, name, logPath string, env []string, args ...string) error {
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return err
	}
	log, err := os.Create(logPath)
	if err != nil {
		return err
	}
	// The program gets its own copy of the handle, so this one closes once it's started.
	defer log.Close()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	cmd.Stdout, cmd.Stderr = log, log
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", name, err)
	}
	allowForeground(cmd.Process.Pid)
	// It runs on after the editor exits; nothing waits for it.
	return cmd.Process.Release()
}

// PublishPlan says where a map's files go: the client's Data folder (where the patch is written and the
// extractors read the client from), the VMaNGOS server folder, and the mariadb client program.
type PublishPlan struct {
	// ClientRoot is the client's folder (the one with Data in it).
	ClientRoot string
	// ServerRoot is the VMaNGOS server folder.
	ServerRoot string
	// Mariadb is the mariadb client program (or mysql). Empty means look it up on PATH.
	Mariadb string
	// Run runs programs; OSRunner in the app, a fake in tests.
	Run Runner
	// SkipMoveMaps leaves the server's movement maps (mmaps) alone after the map data is rebuilt
	// (Preferences › Build movement maps on compile, off).
	SkipMoveMaps bool
}

// Publish writes a map for the client and rebuilds what the server needs from it: the map is written
// into the client's patch, added to the server's map table and world database, and the server's map
// and collision data are extracted again once the world server is stopped. The server is never
// stopped or started here (#661): the author does that. log gets a line per step.
func Publish(p PublishPlan, spec MapSpec, log func(string)) error {
	if p.Run == nil {
		p.Run = OSRunner{}
	}
	clientData := filepath.Join(p.ClientRoot, "Data")
	if info, err := os.Stat(clientData); err != nil || !info.IsDir() {
		return fmt.Errorf("%s has no Data folder: set the WoW client folder first", p.ClientRoot)
	}
	if err := CheckServer(p.ServerRoot); err != nil {
		return err
	}

	log("Writing the map into the client's patch…")
	// Whether the server had the patch's last state, before this export writes a newer one: only then
	// are the tiles this export leaves alone current on the server.
	current := serverMapsCurrent(p.ServerRoot, spec.MapID, filepath.Join(clientData, PatchName))
	res, err := ExportMap(clientData, clientData, p.ServerRoot, spec)
	if err != nil {
		return err
	}
	if res.Patch == "" && current {
		log("Nothing changed since the last publish, and the server's map data is newer than the patch: the server was left alone.")
		return nil
	}
	if res.Patch != "" {
		log(fmt.Sprintf("Wrote %d of %d tiles to %s (the rest were unchanged)", res.Changed, res.Tiles, filepath.Base(res.Patch)))
	}

	var tiles []string
	if current && !res.Layout {
		tiles = res.ChangedTiles
	}
	return publishServer(p, clientData, spec, tiles, log)
}

// isMapTile reports whether a data/maps file name is one of the map's tiles: the map ID in three
// digits, the tile's y and x in two each, then ".map".
func isMapTile(name string, mapID uint32) bool {
	prefix := fmt.Sprintf("%03d", mapID)
	return len(name) == len(prefix)+8 && strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".map")
}

// removeFiles deletes the files of dir whose names match.
func removeFiles(dir string, match func(name string) bool) {
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if !e.IsDir() && match(e.Name()) {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

// serverMapsCurrent reports whether the server has extracted map data for the map since the patch was
// last written: one of its data/maps files (named by the map ID in three digits and the tile) is newer.
func serverMapsCurrent(serverRoot string, mapID uint32, patch string) bool {
	info, err := os.Stat(patch)
	if err != nil {
		return false
	}
	entries, err := os.ReadDir(filepath.Join(serverRoot, "data", "maps"))
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !isMapTile(e.Name(), mapID) {
			continue
		}
		if fi, err := e.Info(); err == nil && fi.ModTime().After(info.ModTime()) {
			return true
		}
	}
	return false
}

// ServerMapsCurrent is serverMapsCurrent for the patch in the client's Data folder.
func ServerMapsCurrent(serverRoot string, mapID uint32, clientData string) bool {
	return serverMapsCurrent(serverRoot, mapID, filepath.Join(clientData, PatchName))
}

// publishServer does the server's share of a publish, once the map is in the client's patch: the world
// database, and the map data extracted again once the world server is stopped. Only the map's own data is
// extracted (#174): its ground (just tiles, named "x_y", when given; else all of it, with the old tile
// files removed first, as the map may have lost some) and its buildings. A server whose vmaps were never
// built whole (no game object model list) gets every map extracted instead, as update-maps.bat does.
func publishServer(p PublishPlan, clientData string, spec MapSpec, tiles []string, log func(string)) error {
	db, err := worldDatabase(p.ServerRoot)
	if err != nil {
		return err
	}
	mariadb := p.Mariadb
	if mariadb == "" {
		mariadb = "mariadb"
	}
	log("Adding the map to the world database…")
	if err := p.Run.RunEnv(p.ServerRoot, mariadb, db.env(), db.args(templateSQL(spec)), nil); err != nil {
		return fmt.Errorf("world database: %w", err)
	}

	return UpdateServerMaps(p, clientData, spec.MapID, tiles, log)
}

var (
	// serverStopWait is how long UpdateServerMaps waits for the author to stop a running world server,
	// which Meld never stops itself (#661); tests shorten it.
	serverStopWait = 15 * time.Minute
	serverPoll     = 250 * time.Millisecond
)

// waitFor polls done until it is true or the timeout passes, and reports which.
func waitFor(done func() bool, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for !done() {
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(serverPoll)
	}
	return true
}

// stagingDir is the folder under the server's data folder that the extractors write into, so the
// server's own maps and vmaps stay as they were until every step has passed (#466). It sits beside
// them, so its files move over theirs by a rename.
const stagingDir = "meld-staging"

// UpdateServerMaps rebuilds the server's map data for one map from the client's patch, the share of a
// publish that follows the database (and all a compiled region of a continent needs, #211). Tiles are
// as publishServer's: "x_y" names, or none for the whole map. The world server holds its map files
// open, so a running one is waited for (up to serverStopWait) until the author stops it: Meld never
// stops or starts it (#661). The extractors write into stagingDir, whose files replace the server's
// only once all three steps have passed; when one fails the server keeps its old data.
func UpdateServerMaps(p PublishPlan, clientData string, mapID uint32, tiles []string, log func(string)) error {
	if p.Run == nil {
		p.Run = OSRunner{}
	}
	if err := Supported(p.Run); err != nil {
		log(fmt.Sprintf("%v: the server keeps its old map data.", err))
		return err
	}
	if p.Run.Running("mangosd.exe") {
		log("Stop the world server: its map data is rebuilt as soon as it has stopped.")
		if !waitFor(func() bool { return !p.Run.Running("mangosd.exe") }, serverStopWait) {
			return errors.New("the world server kept running, so its map data was not rebuilt: stop it, then compile to the server again")
		}
	}
	if err := extractServerMaps(p, clientData, mapID, tiles, log); err != nil {
		log(fmt.Sprintf("%v: the server keeps its old map data.", err))
		return err
	}
	return nil
}

// extractServerMaps runs the three extraction steps into stagingDir and, when all have passed, moves
// their files over the server's data/maps and data/vmaps. The server must be down.
func extractServerMaps(p PublishPlan, clientData string, mapID uint32, tiles []string, log func(string)) error {
	extractors := filepath.Join(p.ServerRoot, "run", "Extractors")
	data := filepath.Join(p.ServerRoot, "data")
	vmaps := filepath.Join(data, "vmaps")
	stage := filepath.Join(data, stagingDir)
	stageMaps, stageVmaps := filepath.Join(stage, "maps"), filepath.Join(stage, "vmaps")
	id := strconv.FormatUint(uint64(mapID), 10)
	_, err := os.Stat(filepath.Join(vmaps, "temp_gameobject_models"))
	whole := err != nil

	// A folder left by an earlier run that stopped half way holds nothing worth keeping.
	if err := os.RemoveAll(stage); err != nil {
		return fmt.Errorf("clearing %s: %w", stage, err)
	}
	defer os.RemoveAll(stage)
	// The extractors make their folders one level deep only.
	if err := os.MkdirAll(stageVmaps, 0o755); err != nil {
		return err
	}

	// Relative to data, where the extractors run: MapExtractor keeps its output path in 128 bytes.
	mapArgs := []string{"-i", p.ClientRoot, "-o", stagingDir, "-e", "1", "--silent"}
	switch {
	case whole:
		log("Extracting every map from the client, as the server's collision data was never built whole…")
	case len(tiles) > 0:
		log(fmt.Sprintf("Extracting %d of the map's tiles from the client…", len(tiles)))
		mapArgs = append(mapArgs, "-m", id, "-t", strings.Join(tiles, ","))
	default:
		log("Extracting the map from the client…")
		mapArgs = append(mapArgs, "-m", id)
	}
	if err := p.Run.Run(data, filepath.Join(extractors, "MapExtractor.exe"), mapArgs, log); err != nil {
		return fmt.Errorf("map extraction: %w", err)
	}
	log("Extracting collision data…")
	// Buildings is the extractor's scratch output, which the server never reads.
	_ = os.RemoveAll(filepath.Join(data, "Buildings"))
	vmapArgs := []string{"-l", "-d", clientData, "--silent"}
	if !whole {
		vmapArgs = append(vmapArgs, "-m", id)
	}
	if err := p.Run.Run(data, filepath.Join(extractors, "VMapExtractor.exe"), vmapArgs, log); err != nil {
		return fmt.Errorf("collision extraction: %w", err)
	}
	if err := p.Run.Run(data, filepath.Join(extractors, "VMapAssembler.exe"),
		[]string{"Buildings", filepath.Join(stagingDir, "vmaps")}, log); err != nil {
		return fmt.Errorf("collision assembly: %w", err)
	}

	log("Replacing the server's map data…")
	maps := filepath.Join(data, "maps")
	if !whole && len(tiles) == 0 {
		// The whole map was extracted, and it may have lost tiles since.
		removeFiles(maps, func(name string) bool { return isMapTile(name, mapID) })
	}
	if !whole {
		// The assembler writes the map's tree and a file per tile with buildings, so the old ones go
		// first: a tile whose buildings were all removed would keep its old file.
		tree := fmt.Sprintf("%03d", mapID)
		removeFiles(vmaps, func(name string) bool {
			return name == tree+".vmtree" || strings.HasPrefix(name, tree+"_") && strings.HasSuffix(name, ".vmtile")
		})
	}
	if err := moveFiles(stageMaps, maps); err != nil {
		return fmt.Errorf("replacing the map files: %w", err)
	}
	if err := moveFiles(stageVmaps, vmaps); err != nil {
		return fmt.Errorf("replacing the collision files: %w", err)
	}
	if !p.SkipMoveMaps {
		buildMoveMaps(p, mapID, tiles, log)
	}
	return nil
}

// buildMoveMaps rebuilds the server's movement maps (mmaps, the navmeshes creatures path on, #173)
// from its new map and collision data: one MoveMapGenerator run a tile when tiles are given, else
// the whole map, with its old mmap files removed first, as the generator skips a tile that has one.
// It runs in data (it reads maps and vmaps there and writes mmaps), after the map data was replaced.
// A failure is only logged: the map data is in place, and the server keeps mmaps off by default
// (mmap.enabled in mangosd.conf, which Meld leaves alone: the owner's choice on #173).
func buildMoveMaps(p PublishPlan, mapID uint32, tiles []string, log func(string)) {
	extractors := filepath.Join(p.ServerRoot, "run", "Extractors")
	gen := filepath.Join(extractors, "MoveMapGenerator.exe")
	if _, err := os.Stat(gen); err != nil {
		log("No MoveMapGenerator.exe beside the extractors, so the server's movement maps were left as they were.")
		return
	}
	data := filepath.Join(p.ServerRoot, "data")
	id := strconv.FormatUint(uint64(mapID), 10)
	// Without --threads it asks for a thread count on the console.
	base := []string{id, "--silent", "--threads", strconv.Itoa(max(1, min(runtime.NumCPU(), 8)))}
	for _, f := range []struct{ flag, name string }{{"--configInputPath", "config.json"}, {"--offMeshInput", "offmesh.txt"}} {
		if path := filepath.Join(extractors, f.name); fileExists(path) {
			base = append(base, f.flag, path)
		}
	}
	// The generator prints a line a step; only its complaints reach the compile's log.
	complaints := func(line string) {
		if l := strings.ToLower(line); strings.Contains(l, "error") || strings.Contains(l, "fail") || strings.Contains(l, "not found") {
			log(line)
		}
	}
	failed := 0
	if len(tiles) == 0 {
		log("Building the map's movement maps…")
		prefix := fmt.Sprintf("%03d", mapID)
		removeFiles(filepath.Join(data, "mmaps"), func(name string) bool {
			return name == prefix+".mmap" || len(name) == len(prefix)+4+len(".mmtile") && strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".mmtile")
		})
		if err := p.Run.Run(data, gen, base, complaints); err != nil {
			failed++
		}
	} else {
		for i, t := range tiles {
			// Meld's "x_y" (the ADT's x and y) is the generator's --tile x,y; its files are named by the
			// map, then y, then x (0002337.mmtile is tile 37_23 of map 0).
			log(fmt.Sprintf("Building movement maps: tile %s (%d of %d)…", t, i+1, len(tiles)))
			if err := p.Run.Run(data, gen, append(base, "--tile", strings.Replace(t, "_", ",", 1)), complaints); err != nil {
				failed++
			}
		}
	}
	if failed > 0 {
		log(fmt.Sprintf("MoveMapGenerator failed %d time(s): those movement maps keep their old state. The map data itself was rebuilt.", failed))
	}
}

// fileExists reports whether path names an existing file or folder.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// moveFiles moves every file of src into dst, over any of the same name. A missing src moves nothing.
func moveFiles(src, dst string) error {
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
		if e.IsDir() {
			continue
		}
		if err := os.Rename(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

// templateSQL adds the map to the world database's map templates, which the world server looks
// maps up in. Without the map's info an existing row is left as it is; with it, the row takes the
// info's type, zone, player limit and ghost entrance.
func templateSQL(m MapSpec) string {
	if m.Info == nil {
		return fmt.Sprintf("INSERT IGNORE INTO map_template (entry, patch, parent, map_type, linked_zone, player_limit, reset_delay, "+
			"ghost_entrance_map, ghost_entrance_x, ghost_entrance_y, map_name, script_name) "+
			"VALUES (%d, 0, 0, 0, 0, 0, 0, -1, 0, 0, %s, '');", m.MapID, sqlQuote(m.Dir))
	}
	i := m.Info
	name := i.Name
	if name == "" {
		name = m.Dir
	}
	return fmt.Sprintf("INSERT INTO map_template (entry, patch, parent, map_type, linked_zone, player_limit, reset_delay, "+
		"ghost_entrance_map, ghost_entrance_x, ghost_entrance_y, map_name, script_name) "+
		"VALUES (%d, 0, 0, %d, %d, %d, 0, %d, %s, %s, %s, '') "+
		"ON DUPLICATE KEY UPDATE map_type = VALUES(map_type), linked_zone = VALUES(linked_zone), player_limit = VALUES(player_limit), "+
		"ghost_entrance_map = VALUES(ghost_entrance_map), ghost_entrance_x = VALUES(ghost_entrance_x), ghost_entrance_y = VALUES(ghost_entrance_y), map_name = VALUES(map_name);",
		m.MapID, i.Type, i.AreaID, i.MaxPlayers, i.GhostMap, num(float64(i.GhostX)), num(float64(i.GhostY)), sqlQuote(name))
}

// worldDB is the world database's connection, from the world server's configuration.
type worldDB struct {
	host, port, user, password, name string
}

// args are mariadb's arguments to run sql against the world database. The password is not among
// them, since any process can read another's command line (#482): it goes in env.
func (d worldDB) args(sql string) []string {
	return []string{"-h", d.host, "-P", d.port, "-u", d.user, d.name, "-e", sql}
}

// env is what mariadb's environment needs beside args: the password, in MYSQL_PWD.
func (d worldDB) env() []string {
	return []string{"MYSQL_PWD=" + d.password}
}

// worldDatabase reads WorldDatabase.Info from the server's mangosd.conf:
// "host;port;user;password;database".
func worldDatabase(serverRoot string) (worldDB, error) {
	return confDatabase(serverRoot, "WorldDatabase.Info")
}

// confDatabase reads a database's connection (key: WorldDatabase.Info, CharacterDatabase.Info or
// LoginDatabase.Info) from the server's mangosd.conf.
func confDatabase(serverRoot, key string) (worldDB, error) {
	b, err := os.ReadFile(filepath.Join(serverRoot, "run", "mangosd.conf"))
	if err != nil {
		return worldDB{}, err
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, key) || strings.HasPrefix(line, "#") {
			continue
		}
		q := strings.Index(line, `"`)
		if q < 0 {
			break
		}
		parts := strings.Split(strings.Trim(line[q:], `"`), ";")
		if len(parts) != 5 {
			break
		}
		if _, err := strconv.Atoi(parts[1]); err != nil {
			break
		}
		return worldDB{host: parts[0], port: parts[1], user: parts[2], password: parts[3], name: parts[4]}, nil
	}
	return worldDB{}, errors.New("mangosd.conf has no " + key)
}

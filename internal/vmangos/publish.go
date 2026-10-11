package vmangos

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Runner runs the programs a publish needs: the server's extractors and mariadb, and the world
// server itself. Run waits for a program and passes its output lines to log; Start leaves it running.
type Runner interface {
	Run(dir, name string, args []string, log func(string)) error
	Start(dir, name string, args ...string) error
}

// OSRunner runs programs on this machine.
type OSRunner struct{}

func (OSRunner) Run(dir, name string, args []string, log func(string)) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
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

func (OSRunner) Start(dir, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
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
}

// Publish writes a map for the client and rebuilds what the server needs from it: the map is written
// into the client's patch, added to the server's map table and world database, the server's map and
// collision data are extracted again, and the world server is restarted. log gets a line per step.
// Player connections are dropped when the world server stops.
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
	res, err := ExportMap(clientData, clientData, p.ServerRoot, spec)
	if err != nil {
		return err
	}
	log(fmt.Sprintf("Wrote %d tiles to %s", res.Tiles, filepath.Base(res.Patch)))

	return publishServer(p, clientData, spec, log)
}

// publishServer does the server's share of a publish, once the map is in the client's patch: the world
// database, the map data extracted again, and the world server restarted.
func publishServer(p PublishPlan, clientData string, spec MapSpec, log func(string)) error {
	db, err := worldDatabase(p.ServerRoot)
	if err != nil {
		return err
	}
	mariadb := p.Mariadb
	if mariadb == "" {
		mariadb = "mariadb"
	}
	log("Adding the map to the world database…")
	if err := p.Run.Run(p.ServerRoot, mariadb, db.args(templateSQL(spec)), nil); err != nil {
		return fmt.Errorf("world database: %w", err)
	}

	log("Stopping the world server…")
	_ = p.Run.Run(p.ServerRoot, "taskkill", []string{"/IM", "mangosd.exe"}, nil)
	time.Sleep(3 * time.Second)

	extractors := filepath.Join(p.ServerRoot, "run", "Extractors")
	data := filepath.Join(p.ServerRoot, "data")
	log("Extracting the map from the client (this takes several minutes)…")
	if err := p.Run.Run(data, filepath.Join(extractors, "MapExtractor.exe"),
		[]string{"-i", p.ClientRoot, "-o", data, "-e", "1", "--silent"}, log); err != nil {
		return fmt.Errorf("map extraction: %w", err)
	}
	log("Extracting collision data…")
	_ = os.RemoveAll(filepath.Join(data, "Buildings"))
	if err := p.Run.Run(data, filepath.Join(extractors, "VMapExtractor.exe"),
		[]string{"-l", "-d", clientData, "--silent"}, log); err != nil {
		return fmt.Errorf("collision extraction: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(data, "vmaps"), 0o755); err != nil {
		return err
	}
	if err := p.Run.Run(data, filepath.Join(extractors, "VMapAssembler.exe"),
		[]string{"Buildings", "vmaps"}, log); err != nil {
		return fmt.Errorf("collision assembly: %w", err)
	}

	log("Starting the world server…")
	if err := p.Run.Start(filepath.Join(p.ServerRoot, "run"), filepath.Join(p.ServerRoot, "run", "mangosd.exe"),
		"-c", filepath.Join(p.ServerRoot, "run", "mangosd.conf")); err != nil {
		return fmt.Errorf("starting the world server: %w", err)
	}
	return nil
}

// templateSQL adds the map to the world database's map templates, which the world server looks
// maps up in. An existing row is left as it is.
func templateSQL(m MapSpec) string {
	return fmt.Sprintf("INSERT IGNORE INTO map_template (entry, patch, parent, map_type, linked_zone, player_limit, reset_delay, "+
		"ghost_entrance_map, ghost_entrance_x, ghost_entrance_y, map_name, script_name) "+
		"VALUES (%d, 0, 0, 0, 0, 0, 0, -1, 0, 0, '%s', '');", m.MapID, m.Dir)
}

// worldDB is the world database's connection, from the world server's configuration.
type worldDB struct {
	host, port, user, password, name string
}

// args are mariadb's arguments to run sql against the world database.
func (d worldDB) args(sql string) []string {
	return []string{"-h", d.host, "-P", d.port, "-u", d.user, "-p" + d.password, d.name, "-e", sql}
}

// worldDatabase reads WorldDatabase.Info from the server's mangosd.conf:
// "host;port;user;password;database".
func worldDatabase(serverRoot string) (worldDB, error) {
	b, err := os.ReadFile(filepath.Join(serverRoot, "run", "mangosd.conf"))
	if err != nil {
		return worldDB{}, err
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "WorldDatabase.Info") || strings.HasPrefix(line, "#") {
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
	return worldDB{}, errors.New("mangosd.conf has no WorldDatabase.Info")
}

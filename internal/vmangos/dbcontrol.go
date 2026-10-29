package vmangos

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// The File menu's server controls (#857) start and stop the server folder's own database, the one
// start-server.bat starts (database/my.ini). A database on the conf's port that keeps its data
// elsewhere is someone else's: Meld never stops it.

// ErrForeignDatabase says the world database that answers keeps its data outside the server folder,
// so Stop leaves it running.
var ErrForeignDatabase = errors.New("the world database that answers is not the server folder's own (its data is elsewhere), so Meld leaves it running")

// DatabaseState reports whether the world database of the server's mangosd.conf answers, and whether
// it is the server folder's own: its data directory is the folder's database folder.
func DatabaseState(serverRoot string) (running, own bool) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return false, false
	}
	out, err := runSQL(db, "SELECT @@datadir")
	if err != nil {
		// A refused login or a bad query still means something answers.
		return !cantConnect(err), false
	}
	return true, sameDir(unescapeBatch(strings.TrimSpace(string(out))), filepath.Join(serverRoot, "database"))
}

// sameDir reports whether two folder paths name the same folder, ignoring a trailing separator, the
// slash style and, on Windows, the case.
func sameDir(a, b string) bool {
	clean := func(p string) string {
		p = filepath.Clean(filepath.FromSlash(strings.ReplaceAll(p, `\`, "/")))
		if hostOS == "windows" {
			p = strings.ToLower(p)
		}
		return p
	}
	return a != "" && clean(a) == clean(b)
}

// StartDatabase makes sure the server's world database answers, starting the server folder's own
// when it doesn't (ensureDatabase).
func StartDatabase(serverRoot string) error {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return err
	}
	return ensureDatabase(db, serverRoot)
}

// StopDatabase shuts the server folder's own database down, as stop-server.bat does, and waits until
// it no longer answers. A database that isn't running is left as it is; one that isn't the folder's
// own gives ErrForeignDatabase and is left running.
func StopDatabase(serverRoot string) error {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return err
	}
	running, own := DatabaseState(serverRoot)
	if !running {
		return nil
	}
	if !own {
		return ErrForeignDatabase
	}
	if err := shutdownDatabase(db); err != nil {
		return fmt.Errorf("stopping the world database: %w", err)
	}
	deadline := time.Now().Add(dbStartWait)
	for {
		if _, err := runSQL(db, "SELECT 1"); cantConnect(err) {
			return nil
		}
		if time.Now().After(deadline) {
			return errors.New("the world database was asked to stop but still answers")
		}
		time.Sleep(dbStopPoll)
	}
}

// dbStopPoll is how often StopDatabase checks whether the database has gone.
var dbStopPoll = 250 * time.Millisecond

// shutdownDatabase asks the database at db's host and port to shut down: mariadb-admin as root, which
// the server folder's own database has without a password (stop-server.bat logs in so; the world
// server's account may not shut it down). A variable, so tests can stand in for it.
var shutdownDatabase = func(db worldDB) error {
	admin, err := adminProgram()
	if err != nil {
		return err
	}
	cmd := exec.Command(admin, "-h", db.host, "-P", db.port, "-u", "root", "shutdown")
	hideConsole(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w: %s", filepath.Base(admin), err, mariadbError(string(out)))
	}
	return nil
}

// adminProgram finds mariadb-admin (or mysqladmin) next to the mariadb client on PATH.
func adminProgram() (string, error) {
	client, err := exec.LookPath("mariadb")
	if err != nil {
		if client, err = exec.LookPath("mysql"); err != nil {
			return "", errors.New("mariadb is not on PATH")
		}
	}
	exe := ""
	if runtime.GOOS == "windows" {
		exe = ".exe"
	}
	for _, name := range []string{"mariadb-admin", "mysqladmin"} {
		p := filepath.Join(filepath.Dir(client), name+exe)
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("no mariadb-admin next to %s", client)
}

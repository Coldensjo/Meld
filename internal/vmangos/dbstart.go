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

// dbStartWait is how long a started database gets to accept connections.
var dbStartWait = 30 * time.Second

// cantConnect reports whether a mariadb error means the server is not running (client error 2002 on
// a socket, 2003 on TCP), rather than a bad query or password.
func cantConnect(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "ERROR 2002") || strings.Contains(s, "ERROR 2003") || strings.Contains(s, "Can't connect")
}

// ensureDatabase makes sure the world database answers queries. When it doesn't, and the server
// folder has its own database (database/my.ini, as the start-server script uses), the database
// program is started the same way and this waits for it. Any other failure is returned as it is.
func ensureDatabase(db worldDB, serverRoot string) error {
	_, err := runSQL(db, "SELECT 1")
	if !cantConnect(err) {
		return err
	}
	if hostOS != "windows" {
		// The server folder's database is started as start-server.bat does, a Windows mariadbd with a
		// console (#483); elsewhere the database is the system's own service.
		return fmt.Errorf("the world database is not running: start it yourself (Meld starts it only on Windows): %w", err)
	}
	ini := filepath.Join(serverRoot, "database", "my.ini")
	if _, statErr := os.Stat(ini); statErr != nil {
		return fmt.Errorf("the world database is not running (%s has no database/my.ini to start it from): %w", serverRoot, err)
	}
	daemon, lookErr := databaseProgram()
	if lookErr != nil {
		return fmt.Errorf("the world database is not running, and it could not be started: %w", lookErr)
	}
	if startErr := startProgram(filepath.Dir(daemon), daemon, []string{"--defaults-file=" + ini, "--console"}); startErr != nil {
		return fmt.Errorf("starting the world database: %w", startErr)
	}
	deadline := time.Now().Add(dbStartWait)
	for {
		time.Sleep(time.Second)
		if _, err = runSQL(db, "SELECT 1"); !cantConnect(err) {
			return err
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the world database was started but is not answering yet: %w", err)
		}
	}
}

// databaseProgram finds the database server program (mariadbd or mysqld) next to the mariadb client
// on PATH.
func databaseProgram() (string, error) {
	client, err := exec.LookPath("mariadb")
	if err != nil {
		if client, err = exec.LookPath("mysql"); err != nil {
			return "", errors.New("mariadb is not on PATH")
		}
	}
	dir := filepath.Dir(client)
	exe := ""
	if runtime.GOOS == "windows" {
		exe = ".exe"
	}
	for _, name := range []string{"mariadbd", "mysqld"} {
		p := filepath.Join(dir, name+exe)
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("no mariadbd next to %s", client)
}

package vmangos

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
)

// clientLookPath finds a program on PATH; a variable so tests can stand in for it.
var clientLookPath = exec.LookPath

// clientDirs are the folders a mariadb (or mysql) client is looked for in off Windows when PATH
// doesn't have it: where Homebrew (Apple silicon, then Intel), its keg-only clients (mysql-client,
// versioned mariadb@ formulae) and the MySQL installer put it. An app started from the Finder or the
// Dock gets only /usr/bin:/bin:/usr/sbin:/sbin as its PATH, so it misses a client the terminal finds.
// A variable so tests can point it at a temporary folder.
var clientDirs = func() []string {
	dirs := []string{"/opt/homebrew/bin", "/usr/local/bin"}
	for _, prefix := range []string{"/opt/homebrew/opt", "/usr/local/opt"} {
		for _, pattern := range []string{"mariadb", "mariadb@*", "mysql-client", "mysql-client@*", "mysql", "mysql@*"} {
			found, _ := filepath.Glob(filepath.Join(prefix, pattern, "bin"))
			dirs = append(dirs, found...)
		}
	}
	return append(dirs, "/usr/local/mysql/bin", "/opt/local/bin")
}

// mariadbClient finds the client program Meld talks to the world database with: mariadb, else mysql,
// on PATH and then, off Windows, in clientDirs. mariadb comes first wherever it is, because a recent
// mysql client may no longer log in to a MariaDB server's accounts (mysql_native_password).
func mariadbClient() (string, error) {
	names := []string{"mariadb", "mysql"}
	for _, name := range names {
		if p, err := clientLookPath(name); err == nil {
			return p, nil
		}
		if hostOS == "windows" {
			continue
		}
		for _, dir := range clientDirs() {
			p := filepath.Join(dir, name)
			if fi, err := os.Stat(p); err == nil && !fi.IsDir() && fi.Mode()&0o111 != 0 {
				return p, nil
			}
		}
	}
	if hostOS == "darwin" {
		return "", errors.New("no mariadb client found: install one with `brew install mariadb` (the client is enough; the server need not run), or put mariadb on PATH")
	}
	return "", errors.New("mariadb is not on PATH")
}

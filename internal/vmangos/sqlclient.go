package vmangos

import (
	"os"
	"os/exec"
	"runtime"
	"sync"
)

// The world database is queried through a command-line client: MariaDB's mariadb where there is one
// (VMaNGOS's own database), else MySQL's mysql, which an AzerothCore server runs on (MySQL 8.4) and
// which takes the same batch options (-B -N -h -P -u -e) and MYSQL_PWD. Homebrew installs MySQL 8.4 as
// a keg (mysql@8.4) that is not linked onto PATH, and an app started from the Dock or Finder has
// launchd's PATH, without Homebrew's, so its usual places are tried too.

// sqlClientPlaces are where a client off PATH is looked for, in order, on macOS and Linux.
var sqlClientPlaces = []string{
	"/opt/homebrew/bin/mariadb",
	"/opt/homebrew/bin/mysql",
	"/opt/homebrew/opt/mysql@8.4/bin/mysql",
	"/opt/homebrew/opt/mysql/bin/mysql",
	"/opt/homebrew/opt/mariadb/bin/mariadb",
	"/usr/local/bin/mariadb",
	"/usr/local/bin/mysql",
	"/usr/local/opt/mysql@8.4/bin/mysql",
	"/usr/local/opt/mysql/bin/mysql",
	"/usr/local/mysql/bin/mysql",
}

var (
	sqlClientOnce sync.Once
	sqlClientPath string
)

// sqlClient is the program the database queries run: mariadb or mysql on PATH, else the first of
// sqlClientPlaces that exists, else "mariadb" (whose failure to start then names the program).
func sqlClient() string {
	sqlClientOnce.Do(func() { sqlClientPath = findSQLClient(exec.LookPath, runtime.GOOS) })
	return sqlClientPath
}

// findSQLClient is sqlClient's search, with PATH's lookup and the OS passed in for tests.
func findSQLClient(lookPath func(string) (string, error), goos string) string {
	for _, name := range []string{"mariadb", "mysql"} {
		if p, err := lookPath(name); err == nil {
			return p
		}
	}
	if goos != "windows" {
		for _, p := range sqlClientPlaces {
			if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
				return p
			}
		}
	}
	return "mariadb"
}

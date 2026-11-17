package vmangos

import (
	"errors"
	"testing"
)

// The database client is mariadb, else mysql (an AzerothCore server's MySQL 8.4), on PATH; off PATH
// on Windows the name is left for the error.
func TestFindSQLClient(t *testing.T) {
	onPath := func(names ...string) func(string) (string, error) {
		return func(n string) (string, error) {
			for _, m := range names {
				if m == n {
					return "/bin/" + n, nil
				}
			}
			return "", errors.New("not found")
		}
	}
	if got := findSQLClient(onPath("mysql", "mariadb"), "linux"); got != "/bin/mariadb" {
		t.Errorf("both on PATH: %q, want mariadb", got)
	}
	if got := findSQLClient(onPath("mysql"), "darwin"); got != "/bin/mysql" {
		t.Errorf("mysql on PATH: %q", got)
	}
	if got := findSQLClient(onPath(), "windows"); got != "mariadb" {
		t.Errorf("none on Windows: %q, want the bare name", got)
	}
}

// MySQL's client warnings are dropped from an error like MariaDB's.
func TestMySQLWarningsDropped(t *testing.T) {
	got := mariadbError("mysql: [Warning] Using a password on the command line interface can be insecure.\nERROR 1146 (42S02): Table 'acore_world.x' doesn't exist\n")
	if got != "ERROR 1146 (42S02): Table 'acore_world.x' doesn't exist" {
		t.Errorf("mariadbError = %q", got)
	}
}

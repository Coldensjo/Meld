// Package testclient finds the WoW client and the VMaNGOS server the client-dependent Go tests read,
// so they run in a plain `go test` on a machine where Meld is set up, instead of only when WOW_DIR
// and VMANGOS_DIR are set by hand (#400).
//
// Each locator takes the variable when it is set, else the folder in Meld's config.json (wowPath,
// vmangosPath), else it skips the test. The folders it returns are for reading only: a test that
// writes the client uses t.TempDir() or a hard-linked copy, and a test that writes the world
// database names the server through VMANGOS_DIR itself, never through this package. The root
// package's TestNoTestWritesRealClient (guard_test.go) enforces both (#402).
//
// It imports only the standard library and internal/config, so the tests of internal/wow and
// internal/vmangos can import it; the caller resolves the client's Data folder
// (wow.ResolveDataDir).
package testclient

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"Meld/internal/config"
)

var (
	cfgOnce sync.Once
	cfg     config.Config

	dbOnce sync.Once
	dbErr  error
)

func loadConfig() config.Config {
	cfgOnce.Do(func() { cfg = config.Load() })
	return cfg
}

// locate is the folder the variable names, else the config's folder when it exists, else "" with
// the reason. A variable that names a missing folder is returned as is, so the test fails on it.
func locate(env, configured, key string) (string, string) {
	if dir := os.Getenv(env); dir != "" {
		return dir, ""
	}
	if configured == "" {
		return "", env + " not set and config.json has no " + key
	}
	if st, err := os.Stat(configured); err != nil || !st.IsDir() {
		return "", env + " not set and config.json's " + key + " (" + configured + ") is not a folder"
	}
	return configured, ""
}

// DataDir is the WoW 1.12 client's folder (WOW_DIR, else config.json's wowPath), read-only. It
// skips the test when there is none.
func DataDir(t testing.TB) string {
	t.Helper()
	dir, why := locate("WOW_DIR", loadConfig().WowPath, "wowPath")
	if dir == "" {
		t.Skip(why)
	}
	return dir
}

// ServerFolder is the VMaNGOS server's folder (VMANGOS_DIR, else config.json's vmangosPath), for a
// test that reads its files only. It skips the test when there is none.
func ServerFolder(t testing.TB) string {
	t.Helper()
	dir, why := locate("VMANGOS_DIR", loadConfig().VmangosPath, "vmangosPath")
	if dir == "" {
		t.Skip(why)
	}
	return dir
}

// ServerDir is ServerFolder for a test that reads the world database: it also skips the test when
// the database named by the server's mangosd.conf does not answer, so a stopped mariadb skips the
// database tests instead of failing each of them (the editor's own reads would start it).
func ServerDir(t testing.TB) string {
	t.Helper()
	dir := ServerFolder(t)
	dbOnce.Do(func() { dbErr = reachDatabase(dir) })
	if dbErr != nil {
		t.Skip("world database not reachable: " + dbErr.Error())
	}
	return dir
}

// ServerDirIfAny is the server's folder for a test that uses it when there is one, or "" (no skip),
// with its database reachable.
func ServerDirIfAny() string {
	dir, _ := locate("VMANGOS_DIR", loadConfig().VmangosPath, "vmangosPath")
	if dir == "" {
		return ""
	}
	dbOnce.Do(func() { dbErr = reachDatabase(dir) })
	if dbErr != nil {
		return ""
	}
	return dir
}

// reachDatabase connects to the world database's host and port from the server's mangosd.conf
// (WorldDatabase.Info, "host;port;user;password;database"). A TCP connect is enough to tell a
// running mariadb from a stopped one, and needs no client binary on the PATH.
func reachDatabase(serverRoot string) error {
	b, err := os.ReadFile(filepath.Join(serverRoot, "run", "mangosd.conf"))
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "WorldDatabase.Info") {
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
		conn, err := net.DialTimeout("tcp", net.JoinHostPort(parts[0], parts[1]), 2*time.Second)
		if err != nil {
			return err
		}
		return conn.Close()
	}
	return errors.New("mangosd.conf has no WorldDatabase.Info")
}

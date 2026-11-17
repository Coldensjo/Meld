// Package testclient finds the WoW client and the VMaNGOS server the client-dependent Go tests read,
// so they run in a plain `go test` on a machine where Meld is set up, instead of only when WOW_DIR
// and VMANGOS_DIR are set by hand (#400).
//
// Each locator takes the variable when it is set, else the folder in Meld's config.json (wowPath,
// wow335Path, vmangosPath), else it skips the test. The two client locators also read the client's
// build (#1066): DataDir is the 1.12 client and skips on a later one, WotLKDir is the 3.3.5a client. The folders it returns are for reading only: a test that
// writes the client uses t.TempDir() or a hard-linked copy, and a test that writes the world
// database names the server through VMANGOS_DIR itself, never through this package. The root
// package's TestNoTestWritesRealClient (guard_test.go) enforces both (#402).
//
// It imports only the standard library, internal/clientbuild and internal/config, so the tests of
// internal/wow and internal/vmangos can import it; the caller resolves the client's Data folder
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

	"Meld/internal/clientbuild"
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

// buildOf is the build of the client in dir, which is the client's folder or its Data folder.
func buildOf(dir string) clientbuild.Build {
	info := clientbuild.Detect(dir)
	if info.From == "" {
		// Neither a Wow.exe nor a known archive in dir: it is the client's folder, without a Wow.exe.
		info = clientbuild.Detect(filepath.Join(dir, "Data"))
	}
	return info.Build
}

// DataDir is the WoW 1.12 client's folder (WOW_DIR, else config.json's wowPath), read-only. It
// skips the test when there is none, and when the folder holds a later client (2.4.3 or 3.3.5a),
// whose files the 1.12 tests cannot read: a machine set up for a 3.3.5a client only has wowPath
// name that one (#1066).
func DataDir(t testing.TB) string {
	t.Helper()
	dir, skip := dataDir(loadConfig())
	if dir == "" {
		t.Skip(skip)
	}
	return dir
}

// dataDir is DataDir's choice: the folder, or why the test skips.
func dataDir(cfg config.Config) (dir, skip string) {
	dir, why := locate("WOW_DIR", cfg.WowPath, "wowPath")
	if dir == "" {
		return "", why
	}
	if b := buildOf(dir); b != clientbuild.Vanilla {
		return "", dir + " is a " + b.Version() + " client; this test reads a 1.12.1 one"
	}
	return dir, ""
}

// WotLKDir is the WoW 3.3.5a client's folder, read-only (#1066): WOW335_DIR, else config.json's
// wow335Path, else its wowPath when that client is a 3.3.5a one. It skips the test when there is
// none, and fails it when WOW335_DIR names a folder that holds another client.
func WotLKDir(t testing.TB) string {
	t.Helper()
	dir, skip, fail := wotlkDir(loadConfig())
	if fail != "" {
		t.Fatal(fail)
	}
	if dir == "" {
		t.Skip(skip)
	}
	return dir
}

// wotlkDir is WotLKDir's choice: the folder, or why the test skips, or why it fails.
func wotlkDir(cfg config.Config) (dir, skip, fail string) {
	dir, why := locate("WOW335_DIR", cfg.Wow335Path, "wow335Path")
	if dir == "" {
		// The editor's own client, when it is the 3.3.5a one.
		if st, err := os.Stat(cfg.WowPath); cfg.WowPath != "" && err == nil && st.IsDir() && buildOf(cfg.WowPath) == clientbuild.WotLK {
			return cfg.WowPath, "", ""
		}
		return "", why + ", and its wowPath is not a 3.3.5a client", ""
	}
	if b := buildOf(dir); b != clientbuild.WotLK {
		if os.Getenv("WOW335_DIR") != "" {
			return "", "", "WOW335_DIR (" + dir + ") is not a 3.3.5a client: Meld reads it as " + b.String()
		}
		return "", "config.json's wow335Path (" + dir + ") is not a 3.3.5a client: Meld reads it as " + b.String(), ""
	}
	return dir, "", ""
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
	AllowDatabase(t)
	return dir
}

// ServerDirIfAny is the server's folder for a test that uses it when there is one, or "" (no skip),
// with its database reachable. A folder it returns lets the test reach the database (AllowDatabase).
func ServerDirIfAny(t testing.TB) string {
	dir, _ := locate("VMANGOS_DIR", loadConfig().VmangosPath, "vmangosPath")
	if dir == "" {
		return ""
	}
	dbOnce.Do(func() { dbErr = reachDatabase(dir) })
	if dbErr != nil {
		return ""
	}
	AllowDatabase(t)
	return dir
}

// DatabaseEnv is the variable that lets internal/vmangos's mariadb runners (runSQL, pipeMariadb,
// shutdownDatabase) make a real call from a test: without it they panic, so a test that forgets to
// stand one in fails instead of running its SQL on the machine's own databases (#884, #885). It must
// match vmangos's testDatabaseEnv.
const DatabaseEnv = "MELD_TEST_DATABASE"

// AllowDatabase lets the calling test reach a real database through the mariadb runners, until it
// ends (t.Setenv, so not in a parallel test). ServerDir and ServerDirIfAny call it; a live test that
// names the server through VMANGOS_DIR itself (the database writers, guard_test.go) calls it after its
// skip.
func AllowDatabase(t testing.TB) {
	t.Helper()
	t.Setenv(DatabaseEnv, "1")
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

package testclient

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/config"
)

func TestLocateTakesTheVariableFirst(t *testing.T) {
	cfgDir := t.TempDir()
	t.Setenv("MELD_TESTCLIENT_X", "")
	if dir, why := locate("MELD_TESTCLIENT_X", cfgDir, "wowPath"); dir != cfgDir || why != "" {
		t.Errorf("config fallback: %q %q", dir, why)
	}
	if dir, why := locate("MELD_TESTCLIENT_X", "", "wowPath"); dir != "" || !strings.Contains(why, "no wowPath") {
		t.Errorf("no config: %q %q", dir, why)
	}
	missing := filepath.Join(cfgDir, "gone")
	if dir, why := locate("MELD_TESTCLIENT_X", missing, "wowPath"); dir != "" || !strings.Contains(why, "not a folder") {
		t.Errorf("missing config folder: %q %q", dir, why)
	}
	// A variable wins, even over a config folder, and is returned unchecked so a wrong one fails.
	t.Setenv("MELD_TESTCLIENT_X", missing)
	if dir, _ := locate("MELD_TESTCLIENT_X", cfgDir, "wowPath"); dir != missing {
		t.Errorf("variable: %q", dir)
	}
}

func TestReachDatabase(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	host, port, _ := net.SplitHostPort(ln.Addr().String())
	root := t.TempDir()
	conf := func(port string) {
		if err := os.MkdirAll(filepath.Join(root, "run"), 0o755); err != nil {
			t.Fatal(err)
		}
		body := "# WorldDatabase.Info\nWorldDatabase.Info = \"" + host + ";" + port + ";mangos;mangos;mangos\"\n"
		if err := os.WriteFile(filepath.Join(root, "run", "mangosd.conf"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	conf(port)
	if err := reachDatabase(root); err != nil {
		t.Errorf("listening database: %v", err)
	}
	ln.Close()
	if err := reachDatabase(root); err == nil {
		t.Error("a stopped database answered")
	}
	if err := reachDatabase(t.TempDir()); err == nil {
		t.Error("a server folder without mangosd.conf answered")
	}
}

// client makes a folder that reads as a client of the build its archives name, as a Benilla folder or
// the probes' sandbox does without a Wow.exe: Data with one of that client's archives in it.
func client(t *testing.T, archive string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "Data"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Data", archive), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// The 1.12 locator skips a later client instead of handing it to tests that read 1.12 files (#1066).
func TestDataDirSkipsALaterClient(t *testing.T) {
	vanilla, wotlk := client(t, "dbc.MPQ"), client(t, "lichking.MPQ")
	t.Setenv("WOW_DIR", "")
	if dir, skip := dataDir(config.Config{WowPath: vanilla}); dir != vanilla || skip != "" {
		t.Errorf("1.12 client from the config: %q %q", dir, skip)
	}
	if dir, skip := dataDir(config.Config{WowPath: wotlk}); dir != "" || !strings.Contains(skip, "3.3.5a") {
		t.Errorf("3.3.5a client from the config: %q %q", dir, skip)
	}
	// Its Data folder is told the same way.
	t.Setenv("WOW_DIR", filepath.Join(wotlk, "Data"))
	if dir, skip := dataDir(config.Config{}); dir != "" || !strings.Contains(skip, "3.3.5a") {
		t.Errorf("3.3.5a Data folder from the variable: %q %q", dir, skip)
	}
	// A missing folder is still returned, so the test fails on it.
	missing := filepath.Join(vanilla, "gone")
	t.Setenv("WOW_DIR", missing)
	if dir, _ := dataDir(config.Config{}); dir != missing {
		t.Errorf("missing folder from the variable: %q", dir)
	}
}

// The 3.3.5a locator takes WOW335_DIR, then wow335Path, then a wowPath that is a 3.3.5a client (#1066).
func TestWotLKDir(t *testing.T) {
	vanilla, wotlk, other := client(t, "dbc.MPQ"), client(t, "lichking.MPQ"), client(t, "common-2.MPQ")
	t.Setenv("WOW335_DIR", "")
	if dir, skip, fail := wotlkDir(config.Config{}); dir != "" || skip == "" || fail != "" {
		t.Errorf("nothing set: %q %q %q", dir, skip, fail)
	}
	if dir, skip, fail := wotlkDir(config.Config{WowPath: vanilla}); dir != "" || skip == "" || fail != "" {
		t.Errorf("a 1.12 wowPath: %q %q %q", dir, skip, fail)
	}
	if dir, _, _ := wotlkDir(config.Config{WowPath: wotlk}); dir != wotlk {
		t.Errorf("a 3.3.5a wowPath: %q", dir)
	}
	if dir, _, _ := wotlkDir(config.Config{WowPath: wotlk, Wow335Path: other}); dir != other {
		t.Errorf("wow335Path before wowPath: %q", dir)
	}
	if dir, skip, fail := wotlkDir(config.Config{Wow335Path: vanilla}); dir != "" || !strings.Contains(skip, "not a 3.3.5a client") || fail != "" {
		t.Errorf("a 1.12 wow335Path: %q %q %q", dir, skip, fail)
	}
	t.Setenv("WOW335_DIR", wotlk)
	if dir, _, _ := wotlkDir(config.Config{Wow335Path: other}); dir != wotlk {
		t.Errorf("the variable first: %q", dir)
	}
	t.Setenv("WOW335_DIR", vanilla)
	if dir, skip, fail := wotlkDir(config.Config{WowPath: wotlk}); dir != "" || skip != "" || !strings.Contains(fail, "WOW335_DIR") {
		t.Errorf("the variable naming a 1.12 client: %q %q %q", dir, skip, fail)
	}
}

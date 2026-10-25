package testclient

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
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

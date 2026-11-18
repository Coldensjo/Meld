package vmangos

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withClients stands in for PATH (onPath: name → program) and clientDirs.
func withClients(t *testing.T, onPath map[string]string, dirs []string) {
	t.Helper()
	oldLook, oldDirs := clientLookPath, clientDirs
	clientLookPath = func(name string) (string, error) {
		if p, ok := onPath[name]; ok {
			return p, nil
		}
		return "", errors.New("not on PATH")
	}
	clientDirs = func() []string { return dirs }
	t.Cleanup(func() { clientLookPath, clientDirs = oldLook, oldDirs })
}

// program writes an executable (or, with mode 0o644, a plain file) named name into dir.
func program(t *testing.T, dir, name string, mode os.FileMode) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"), mode); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMariadbClientPrefersPath(t *testing.T) {
	withHostOS(t, "darwin")
	brew := t.TempDir()
	program(t, brew, "mariadb", 0o755)
	withClients(t, map[string]string{"mariadb": "/path/mariadb", "mysql": "/path/mysql"}, []string{brew})
	if got, err := mariadbClient(); err != nil || got != "/path/mariadb" {
		t.Errorf("mariadbClient() = %q, %v; want the one on PATH", got, err)
	}
}

func TestMariadbClientFindsHomebrewOffPath(t *testing.T) {
	withHostOS(t, "darwin")
	root := t.TempDir()
	empty, brew := filepath.Join(root, "empty"), filepath.Join(root, "brew")
	os.MkdirAll(empty, 0o755)
	want := program(t, brew, "mariadb", 0o755)
	withClients(t, nil, []string{empty, brew})
	if got, err := mariadbClient(); err != nil || got != want {
		t.Errorf("mariadbClient() = %q, %v; want %q", got, err, want)
	}
}

func TestMariadbClientTakesMariadbBeforeMysql(t *testing.T) {
	withHostOS(t, "darwin")
	brew := t.TempDir()
	want := program(t, brew, "mariadb", 0o755)
	withClients(t, map[string]string{"mysql": "/path/mysql"}, []string{brew})
	if got, err := mariadbClient(); err != nil || got != want {
		t.Errorf("mariadbClient() = %q, %v; want mariadb in Homebrew's folder over mysql on PATH", got, err)
	}
}

func TestMariadbClientFallsBackToMysql(t *testing.T) {
	withHostOS(t, "darwin")
	keg := t.TempDir()
	program(t, keg, "mariadb", 0o644) // not executable
	want := program(t, keg, "mysql", 0o755)
	withClients(t, nil, []string{keg})
	if got, err := mariadbClient(); err != nil || got != want {
		t.Errorf("mariadbClient() = %q, %v; want %q", got, err, want)
	}
}

func TestMariadbClientMissingSaysHowToInstallOnMac(t *testing.T) {
	withHostOS(t, "darwin")
	withClients(t, nil, []string{t.TempDir()})
	_, err := mariadbClient()
	if err == nil || !strings.Contains(err.Error(), "brew install mariadb") {
		t.Errorf("mariadbClient() error = %v, want one naming brew install mariadb", err)
	}
}

func TestMariadbClientOnWindowsLooksOnlyOnPath(t *testing.T) {
	withHostOS(t, "windows")
	brew := t.TempDir()
	program(t, brew, "mariadb", 0o755)
	withClients(t, nil, []string{brew})
	if got, err := mariadbClient(); err == nil {
		t.Errorf("mariadbClient() = %q on Windows with nothing on PATH, want an error", got)
	}
}

func TestPublishServerLooksTheClientUp(t *testing.T) {
	withHostOS(t, "darwin")
	brew := t.TempDir()
	want := program(t, brew, "mariadb", 0o755)
	withClients(t, nil, []string{brew})
	f := &fakeRunner{}
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: serverFolder(t), Run: f}
	if err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), MapSpec{Dir: "MyMap", MapID: 1900}, []string{"1_2"}, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if len(f.calls) == 0 || !strings.HasPrefix(f.calls[0], want) {
		t.Errorf("first call = %q, want the world database through %s", f.calls, want)
	}
}

func TestPublishServerWithoutAClientSaysSo(t *testing.T) {
	withHostOS(t, "darwin")
	withClients(t, nil, nil)
	p := PublishPlan{ClientRoot: t.TempDir(), ServerRoot: serverFolder(t), Run: &fakeRunner{}}
	err := publishServer(p, filepath.Join(p.ClientRoot, "Data"), MapSpec{Dir: "MyMap", MapID: 1900}, nil, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "brew install mariadb") {
		t.Errorf("publishServer error = %v, want the install hint", err)
	}
}

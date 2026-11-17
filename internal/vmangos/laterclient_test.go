package vmangos

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/mpq"
)

// laterClient makes a Data folder that reads as the client the archive is of (lichking.MPQ a 3.3.5a
// one, expansion.MPQ a 2.4.3 one, dbc.MPQ a 1.12 one), and keeps the waiting files in a folder of the
// test's own.
func laterClient(t *testing.T, archive string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, archive), mpq.WriteUnmarked(tileFiles), 0o644); err != nil {
		t.Fatal(err)
	}
	root, old := t.TempDir(), pendingRoot
	pendingRoot = func() string { return root }
	t.Cleanup(func() { pendingRoot = old })
	return dir
}

// A later client's tiles, map files, tables and models are refused, at the patch write and at the
// waiting files, and nothing is written; a file whose format the clients share goes in.
func TestLaterClientWritesRefused(t *testing.T) {
	t.Setenv(LaterWritesEnv, "")
	for archive, version := range map[string]string{"lichking.MPQ": "3.3.5a", "expansion.MPQ": "2.4.3"} {
		dir := laterClient(t, archive)
		patch := PatchPath(dir)
		for _, name := range []string{`World\Maps\Northrend\Northrend_30_20.adt`, `World\Maps\New\New.WDT`, `DBFilesClient\Map.dbc`, `World\Meld\crate.m2`} {
			files := []mpq.File{{Name: `Interface\Icons\Meld.blp`, Data: []byte("icon")}, {Name: name, Data: []byte("x")}}
			_, err := InstallPatch(dir, files)
			if !errors.Is(err, ErrLaterClient) || !strings.Contains(err.Error(), version) || !strings.Contains(err.Error(), name) {
				t.Errorf("%s, InstallPatch with %s: %v", version, name, err)
			}
			if _, err := InstallWithPending(dir, files); !errors.Is(err, ErrLaterClient) {
				t.Errorf("%s, InstallWithPending with %s: %v", version, name, err)
			}
			if _, err := InstallDropping(dir, files, nil); !errors.Is(err, ErrLaterClient) {
				t.Errorf("%s, InstallDropping with %s: %v", version, name, err)
			}
			if err := AddPending(dir, files); !errors.Is(err, ErrLaterClient) {
				t.Errorf("%s, AddPending with %s: %v", version, name, err)
			}
		}
		if _, err := os.Stat(patch); !os.IsNotExist(err) {
			t.Errorf("%s: a refused write left %s: %v", version, filepath.Base(patch), err)
		}
		if n, err := PendingCount(dir); err != nil || n != 0 {
			t.Errorf("%s: %d files wait after a refused write, %v", version, n, err)
		}

		// Several refused files are counted, the first named.
		_, err := InstallPatch(dir, []mpq.File{{Name: `a.adt`}, {Name: `b.ADT`}, {Name: `c.dbc`}})
		if err == nil || !strings.Contains(err.Error(), "a.adt and 2 more") {
			t.Errorf("%s, three refused files: %v", version, err)
		}

		// A texture is the same file in every client.
		icon := []mpq.File{{Name: `Interface\Icons\Meld.blp`, Data: []byte("icon")}}
		if err := AddPending(dir, icon); err != nil {
			t.Fatalf("%s, AddPending with a texture: %v", version, err)
		}
		if _, err := InstallWithPending(dir, nil); err != nil {
			t.Fatalf("%s, InstallWithPending with a texture waiting: %v", version, err)
		}
		a, err := mpq.Open(patch)
		if err != nil {
			t.Fatal(err)
		}
		b, err := a.ReadFile(icon[0].Name)
		a.Close()
		if err != nil || string(b) != "icon" {
			t.Errorf("%s: the texture in the patch reads %q, %v", version, b, err)
		}
	}
}

// The 1.12 client takes every file as before, and the variable lets a later client's be written for
// the work on its formats.
func TestLaterClientWritesAllowed(t *testing.T) {
	t.Setenv(LaterWritesEnv, "")
	tile := []mpq.File{{Name: tileFiles[0].Name, Data: []byte("meld")}, {Name: `DBFilesClient\Map.dbc`, Data: []byte("map")}}
	if _, err := InstallPatch(laterClient(t, "dbc.MPQ"), tile); err != nil {
		t.Errorf("a 1.12 client: %v", err)
	}
	// A folder Meld cannot tell the client of is read as 1.12, and written as one.
	if _, err := InstallPatch(laterClient(t, "other.MPQ"), tile); err != nil {
		t.Errorf("a client of no known build: %v", err)
	}
	dir := laterClient(t, "lichking.MPQ")
	if _, err := InstallPatch(dir, nil); err != nil {
		t.Errorf("a 3.3.5a client, a write of no files: %v", err)
	}
	t.Setenv(LaterWritesEnv, "1")
	if _, err := InstallPatch(dir, tile); err != nil {
		t.Errorf("a 3.3.5a client with %s set: %v", LaterWritesEnv, err)
	}
	if err := AddPending(dir, tile); err != nil {
		t.Errorf("a 3.3.5a client with %s set, AddPending: %v", LaterWritesEnv, err)
	}
}

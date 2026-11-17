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
// test's own. Its archive holds a tile and a Map.dbc as wide as the 3.3.5a client's.
func laterClient(t *testing.T, archive string) string {
	t.Helper()
	dir := t.TempDir()
	files := append([]mpq.File{{Name: `DBFilesClient\Map.dbc`, Data: emptyTable(66)}}, tileFiles...)
	if err := os.WriteFile(filepath.Join(dir, archive), mpq.WriteUnmarked(files), 0o644); err != nil {
		t.Fatal(err)
	}
	root, old := t.TempDir(), pendingRoot
	pendingRoot = func() string { return root }
	t.Cleanup(func() { pendingRoot = old })
	return dir
}

// emptyTable is a DBC table of one empty record of the given width.
func emptyTable(fields int) []byte {
	return dbcFile(fields, 1, make([]byte, fields*4), []byte{0})
}

// refused checks that every way into the patch refuses files, naming the client and the file, and
// leaves nothing written or waiting.
func refused(t *testing.T, dir, version, name string, data []byte) {
	t.Helper()
	files := []mpq.File{{Name: `Interface\Icons\Meld.blp`, Data: []byte("icon")}, {Name: name, Data: data}}
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
	if _, err := os.Stat(PatchPath(dir)); !os.IsNotExist(err) {
		t.Errorf("%s: a refused write of %s left %s: %v", version, name, filepath.Base(PatchPath(dir)), err)
	}
	if n, err := PendingCount(dir); err != nil || n != 0 {
		t.Errorf("%s: %d files wait after a refused write of %s, %v", version, n, name, err)
	}
}

// A 2.4.3 client's tiles, map files, tables and models are refused, at the patch write and at the
// waiting files, and nothing is written; a file whose format the clients share goes in.
func TestLaterClientWritesRefused(t *testing.T) {
	t.Setenv(LaterWritesEnv, "")
	dir := laterClient(t, "expansion.MPQ")
	for _, name := range []string{`World\Maps\Expansion01\Expansion01_30_20.adt`, `World\Maps\New\New.WDT`, `DBFilesClient\Map.dbc`, `World\Meld\crate.m2`} {
		refused(t, dir, "2.4.3", name, emptyTable(66))
	}
	// Several refused files are counted, the first named.
	_, err := InstallPatch(dir, []mpq.File{{Name: `a.adt`}, {Name: `b.ADT`}, {Name: `c.dbc`}})
	if err == nil || !strings.Contains(err.Error(), "a.adt and 2 more") {
		t.Errorf("three refused files: %v", err)
	}

	// A texture is the same file in every client.
	icon := []mpq.File{{Name: `Interface\Icons\Meld.blp`, Data: []byte("icon")}}
	if err := AddPending(dir, icon); err != nil {
		t.Fatalf("AddPending with a texture: %v", err)
	}
	if _, err := InstallWithPending(dir, nil); err != nil {
		t.Fatalf("InstallWithPending with a texture waiting: %v", err)
	}
	a, err := mpq.Open(PatchPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	b, err := a.ReadFile(icon[0].Name)
	a.Close()
	if err != nil || string(b) != "icon" {
		t.Errorf("the texture in the patch reads %q, %v", b, err)
	}
}

// The 3.3.5a client takes tiles, map files and the tables of a map in its own columns (#1067 to
// #1070), and still refuses a model, a table Meld writes in the 1.12 columns only, a table of
// another width than the client's own, and one the client has no copy of to tell the columns by.
func TestWotLKClientWrites(t *testing.T) {
	t.Setenv(LaterWritesEnv, "")
	dir := laterClient(t, "lichking.MPQ")
	for name, data := range map[string][]byte{
		`World\Meld\crate.m2`:            []byte("x"),
		`DBFilesClient\Spell.dbc`:        emptyTable(234),
		`DBFilesClient\Map.dbc`:          emptyTable(42), // the 1.12 client's width
		`DBFilesClient\WorldMapArea.dbc`: emptyTable(11), // the right width, but the client here has none
	} {
		refused(t, dir, "3.3.5a", name, data)
	}
	files := []mpq.File{
		{Name: `World\Maps\Northrend\Northrend_30_20.adt`, Data: []byte("tile")},
		{Name: `World\Maps\New\New.WDT`, Data: []byte("map")},
		{Name: `DBFilesClient\Map.dbc`, Data: emptyTable(66)},
	}
	if err := AddPending(dir, files[:1]); err != nil {
		t.Fatalf("AddPending with a tile: %v", err)
	}
	if _, err := InstallWithPending(dir, files[1:]); err != nil {
		t.Fatalf("InstallWithPending with a map file and Map.dbc: %v", err)
	}
	a, err := mpq.Open(PatchPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	for _, f := range files {
		if b, err := a.ReadFile(f.Name); err != nil || string(b) != string(f.Data) {
			t.Errorf("%s in the patch: %d bytes, %v", f.Name, len(b), err)
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
	dir := laterClient(t, "expansion.MPQ")
	if _, err := InstallPatch(dir, nil); err != nil {
		t.Errorf("a 2.4.3 client, a write of no files: %v", err)
	}
	t.Setenv(LaterWritesEnv, "1")
	if _, err := InstallPatch(dir, tile); err != nil {
		t.Errorf("a 2.4.3 client with %s set: %v", LaterWritesEnv, err)
	}
	if err := AddPending(dir, tile); err != nil {
		t.Errorf("a 2.4.3 client with %s set, AddPending: %v", LaterWritesEnv, err)
	}
}

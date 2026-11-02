package main

import (
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// TestDeleteIconWaitsForGame follows the Icons tool's Delete while the game holds Meld's patch
// (#925): it no longer refuses, the icon waits to leave the patch and reads as gone at once, and the
// write once the game has closed takes it out. The game's state is a test switch, the waiting files'
// folder a temp cache, and the watcher is left out so flushPending is what writes.
func TestDeleteIconWaitsForGame(t *testing.T) {
	cache := t.TempDir()
	// os.UserCacheDir, where the waiting files are kept: LocalAppData on Windows, XDG_CACHE_HOME on Linux.
	t.Setenv("LocalAppData", cache)
	t.Setenv("XDG_CACHE_HOME", cache)
	root := t.TempDir()
	dataDir := filepath.Join(root, "Data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Stand-ins for icons: Delete reads where a file is, never its pixels.
	own := vmangos.IconPath("INV_Misc_Bag_07")
	added := vmangos.IconPath("Meld_Added")
	if err := os.WriteFile(filepath.Join(dataDir, "base.MPQ"), mpq.Write([]mpq.File{{Name: own, Data: []byte("client's")}}), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := vmangos.InstallPatch(dataDir, []mpq.File{{Name: added, Data: []byte("meld's")}, {Name: own, Data: []byte("replaced")}}); err != nil {
		t.Fatal(err)
	}
	running := true
	a := &App{gameUp: func() bool { return running }}
	a.cfg.WowPath = root
	a.pendingWatch.Store(true)
	inPatch := func(name string) bool {
		t.Helper()
		arch, err := mpq.Open(filepath.Join(dataDir, vmangos.PatchName))
		if err != nil {
			t.Fatal(err)
		}
		defer arch.Close()
		return arch.Has(name)
	}

	// The game runs: both deletes wait, and the patch is left as it is.
	for name, restored := range map[string]bool{"Meld_Added": false, "INV_Misc_Bag_07": true} {
		res, err := a.DeleteIcon(name)
		if err != nil || res != (IconDeleted{Restored: restored, Waiting: true}) {
			t.Fatalf("delete %s while the game runs: %+v %v", name, res, err)
		}
	}
	if !inPatch(added) || !inPatch(own) {
		t.Fatal("the patch was written while the game held it")
	}
	if n := a.ClientFilesWaiting(); n != 2 {
		t.Fatalf("%d waiting, want the 2 removals", n)
	}
	if st, err := a.IconState("Meld_Added"); err != nil || st != (vmangos.IconState{Leaving: true}) {
		t.Fatalf("the deleted icon: %+v %v", st, err)
	}
	if _, ok, err := a.clientOverlay(added); !ok || err == nil {
		t.Errorf("the deleted icon still previews: ok %v, %v", ok, err)
	}
	if b, ok, err := a.clientOverlay(own); !ok || err != nil || string(b) != "client's" {
		t.Errorf("the replaced icon previews %q (ok %v, %v), want the client's own", b, ok, err)
	}
	// Deleting it again while it waits is no error.
	if res, err := a.DeleteIcon("Meld_Added"); err != nil || !res.Waiting {
		t.Fatalf("a second delete: %+v %v", res, err)
	}

	// The game closed: the waiting removals are written.
	running = false
	a.flushPending()
	if inPatch(added) || inPatch(own) {
		t.Fatal("the deleted icons are still in the patch after the game closed")
	}
	if n := a.ClientFilesWaiting(); n != 0 {
		t.Fatalf("%d still wait", n)
	}

	// With the game closed, a delete writes at once.
	if _, err := vmangos.InstallPatch(dataDir, []mpq.File{{Name: added, Data: []byte("meld's")}}); err != nil {
		t.Fatal(err)
	}
	if res, err := a.DeleteIcon("Meld_Added"); err != nil || res.Waiting || inPatch(added) {
		t.Fatalf("a delete with the game closed: %+v %v, in the patch %v", res, err, inPatch(added))
	}
}

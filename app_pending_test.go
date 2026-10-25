package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// chainSaveMap is the made-up one-tile map the client file chain test saves a region of.
const chainSaveMap = "ChainSave"

// chainSaveClient makes a client folder (the one holding Data) with a one-tile map, 0_0, flat.
func chainSaveClient(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	mphd := append([]byte("DHPM"), 32, 0, 0, 0)
	wdt, err := vmangos.BuildWDT(append(mphd, make([]byte, 32)...), func(x, y int) bool { return x == 0 && y == 0 })
	if err != nil {
		t.Fatal(err)
	}
	tile, err := adt.BuildTile(make([]float32, vmangos.LatticeSize*vmangos.LatticeSize), adt.Ring{}, adt.Changes{})
	if err != nil {
		t.Fatal(err)
	}
	files := []mpq.File{
		{Name: `World\Maps\` + chainSaveMap + `\` + chainSaveMap + `.wdt`, Data: wdt},
		{Name: adt.TilePath(chainSaveMap, 0, 0, ""), Data: tile},
	}
	if err := os.WriteFile(filepath.Join(data, "terrain.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// chainEdit is an edit of the map's one tile with one vertex in its middle raised to h.
func chainEdit(h float32) vmangos.RegionEdit {
	side := vmangos.LatticeSize
	heights := make([]float32, side*side)
	heights[64*side+64] = h
	return vmangos.RegionEdit{MapName: chainSaveMap, X: 0, Y: 0, Size: 1, Heights: vmangos.EncodeHeights(heights)}
}

// TestClientFileChain follows the files of a client write through the app (#405): a Spell.dbc the
// spell editor saves while the game runs waits (saveClientFiles), the next region save takes it into
// the patch (SaveRegion, installClient, InstallWithPending), a write the game's patch refuses keeps it
// waiting, and a region saved while the game runs reaches the patch through waitForGameClosed, the
// step Compile to Server and Publish run before the server's map data is rebuilt (#214, #661). The
// game's state is a test switch, the waiting files' folder a temp cache, and the watcher is left out
// so the saves are what write.
func TestClientFileChain(t *testing.T) {
	cache := t.TempDir()
	// os.UserCacheDir, where the waiting files are kept: LocalAppData on Windows, XDG_CACHE_HOME on Linux.
	t.Setenv("LocalAppData", cache)
	t.Setenv("XDG_CACHE_HOME", cache)
	root := chainSaveClient(t)
	dataDir := filepath.Join(root, "Data")
	patch := filepath.Join(dataDir, vmangos.PatchName)
	running := false
	a := &App{gameUp: func() bool { return running }}
	a.cfg.WowPath = root
	a.pendingWatch.Store(true)

	inPatch := func(name string) []byte {
		t.Helper()
		arch, err := mpq.Open(patch)
		if err != nil {
			t.Fatal(err)
		}
		defer arch.Close()
		b, err := arch.ReadFile(name)
		if err != nil {
			return nil
		}
		return b
	}
	waiting := func() []string {
		t.Helper()
		files, err := vmangos.PendingFiles(dataDir)
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for _, f := range files {
			names = append(names, f.Name)
		}
		return names
	}
	tilePath := adt.TilePath(chainSaveMap, 0, 0, "")

	// The game is closed: a client file goes into the patch at once.
	if err := a.saveClientFiles(dataDir, []mpq.File{{Name: vmangos.SpellIconPath, Data: []byte("icons")}}); err != nil {
		t.Fatal(err)
	}
	if string(inPatch(vmangos.SpellIconPath)) != "icons" || len(waiting()) != 0 {
		t.Fatalf("a save with the game closed: patch has %q, waiting %v", inPatch(vmangos.SpellIconPath), waiting())
	}

	// The game runs: the spell editor's Spell.dbc waits.
	running = true
	if err := a.saveClientFiles(dataDir, []mpq.File{{Name: vmangos.SpellPath, Data: []byte("spell")}}); err != nil {
		t.Fatal(err)
	}
	if inPatch(vmangos.SpellPath) != nil || strings.Join(waiting(), ",") != vmangos.SpellPath {
		t.Fatalf("a save while the game runs: waiting %v", waiting())
	}

	// The game closed but its patch is still held (a read-only file stands in): the region save fails,
	// the patch is untouched and the Spell.dbc still waits.
	running = false
	if runtime.GOOS == "windows" || os.Geteuid() != 0 {
		before, err := os.ReadFile(patch)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(patch, 0o444); err != nil {
			t.Fatal(err)
		}
		_, err = a.SaveRegion(chainEdit(3))
		os.Chmod(patch, 0o644)
		if err == nil || !strings.Contains(err.Error(), "in use") {
			t.Fatalf("a region save over a held patch: %v, want it refused as in use", err)
		}
		if after, _ := os.ReadFile(patch); !bytes.Equal(after, before) {
			t.Fatal("the held patch changed")
		}
		if strings.Join(waiting(), ",") != vmangos.SpellPath {
			t.Fatalf("after the failed write, waiting %v, want the Spell.dbc", waiting())
		}
	}

	// The next region save writes the tile and takes the Spell.dbc along; nothing waits after it.
	res, err := a.SaveRegion(chainEdit(3))
	if err != nil {
		t.Fatal(err)
	}
	if res.Waiting || res.Patch != patch || res.Changed != 1 {
		t.Fatalf("region save: %+v", res)
	}
	saved := inPatch(tilePath)
	if saved == nil || string(inPatch(vmangos.SpellPath)) != "spell" || string(inPatch(vmangos.SpellIconPath)) != "icons" {
		t.Fatalf("the patch lacks the tile, the queued Spell.dbc or the earlier SpellIcon.dbc")
	}
	if left := waiting(); len(left) != 0 {
		t.Fatalf("still waiting after the region save: %v", left)
	}

	// A region saved while the game runs waits too, and the step before a server rebuild writes it
	// once the game has closed.
	running = true
	if res, err = a.SaveRegion(chainEdit(6)); err != nil || !res.Waiting {
		t.Fatalf("region save while the game runs: %+v, %v", res, err)
	}
	if !bytes.Equal(inPatch(tilePath), saved) || strings.Join(waiting(), ",") != tilePath {
		t.Fatalf("a region saved while the game runs reached the patch, or doesn't wait: %v", waiting())
	}
	running = false
	if err := a.waitForGameClosed(dataDir, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if b := inPatch(tilePath); b == nil || bytes.Equal(b, saved) {
		t.Fatal("waitForGameClosed did not write the waiting tile")
	}
	if left := waiting(); len(left) != 0 {
		t.Fatalf("still waiting after waitForGameClosed: %v", left)
	}
}

// TestPendingWatchGivesUp checks the watcher stops when a write of the waiting files fails (#481):
// at once when the patch isn't Meld's, after pendingTries when it stays in use, keeping the files.
func TestPendingWatchGivesUp(t *testing.T) {
	cache := t.TempDir()
	t.Setenv("LocalAppData", cache)
	t.Setenv("XDG_CACHE_HOME", cache)
	root := chainSaveClient(t)
	dataDir := filepath.Join(root, "Data")
	patch := filepath.Join(dataDir, vmangos.PatchName)
	a := &App{gameUp: func() bool { return false }}
	a.cfg.WowPath = root
	if err := vmangos.AddPending(dataDir, []mpq.File{{Name: vmangos.SpellPath, Data: []byte("spell")}}); err != nil {
		t.Fatal(err)
	}
	stillWaiting := func(what string) {
		t.Helper()
		files, err := vmangos.PendingFiles(dataDir)
		if err != nil || len(files) != 1 {
			t.Fatalf("%s: waiting %d files (%v), want the Spell.dbc kept", what, len(files), err)
		}
	}

	// A patch Meld didn't write: no retry fixes that, so the watcher returns after one try.
	if err := os.WriteFile(patch, []byte("not an archive from us"), 0o644); err != nil {
		t.Fatal(err)
	}
	slept := pendingRetry
	pendingRetry = time.Hour
	defer func() { pendingRetry = slept }()
	done := make(chan struct{})
	go func() { a.runPendingWatch(); close(done) }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the watcher kept retrying a patch that isn't Meld's")
	}
	stillWaiting("after a foreign patch")

	// A patch held open (a read-only file stands in): retried pendingTries times, then given up.
	if runtime.GOOS != "windows" && os.Geteuid() == 0 {
		return
	}
	if err := os.Remove(patch); err != nil {
		t.Fatal(err)
	}
	if _, err := vmangos.InstallPatch(dataDir, []mpq.File{{Name: vmangos.SpellIconPath, Data: []byte("icons")}}); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(patch, 0o444); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(patch, 0o644)
	if _, err := vmangos.InstallWithPending(dataDir, nil); !vmangos.InUse(err) {
		t.Fatalf("a write over a read-only patch: %v, want it seen as in use (retried)", err)
	}
	pendingRetry = time.Millisecond
	done = make(chan struct{})
	go func() { a.runPendingWatch(); close(done) }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the watcher kept retrying a patch in use")
	}
	stillWaiting("after a patch in use")
}

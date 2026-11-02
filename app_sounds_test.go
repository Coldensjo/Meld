package main

import (
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// TestRestoreSoundWaitsForGame follows the Sound tool's Restore the client's while the game holds
// Meld's patch (#925): the replacement waits to leave the patch, the sound plays the client's own at
// once, and the write once the game has closed takes it out.
func TestRestoreSoundWaitsForGame(t *testing.T) {
	cache := t.TempDir()
	t.Setenv("LocalAppData", cache)
	t.Setenv("XDG_CACHE_HOME", cache)
	root := t.TempDir()
	dataDir := filepath.Join(root, "Data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	fire := `Sound\Doodad\Fire.wav`
	if err := os.WriteFile(filepath.Join(dataDir, "base.MPQ"), mpq.Write([]mpq.File{{Name: fire, Data: []byte("client's")}}), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := vmangos.InstallPatch(dataDir, []mpq.File{{Name: fire, Data: []byte("replaced")}}); err != nil {
		t.Fatal(err)
	}
	running := true
	a := &App{gameUp: func() bool { return running }}
	a.cfg.WowPath = root
	a.pendingWatch.Store(true)

	waiting, err := a.RestoreSound(fire)
	if err != nil || !waiting {
		t.Fatalf("a restore while the game runs: waiting %v, %v", waiting, err)
	}
	states, err := a.SoundFileStates([]string{fire})
	if err != nil || states[0] != (vmangos.PatchFileState{Path: fire, Leaving: true, InClient: true}) {
		t.Fatalf("the restored sound: %+v %v", states, err)
	}
	if b, ok, err := a.clientOverlay(fire); !ok || err != nil || string(b) != "client's" {
		t.Errorf("the restored sound plays %q (ok %v, %v), want the client's own", b, ok, err)
	}

	running = false
	a.flushPending()
	states, err = a.SoundFileStates([]string{fire})
	if err != nil || states[0] != (vmangos.PatchFileState{Path: fire, InClient: true}) {
		t.Fatalf("after the game closed: %+v %v", states, err)
	}
}

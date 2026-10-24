package recovery

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"Meld/internal/worldfile"
)

// small is a world of one chunk with one cube.
func small() *worldfile.World {
	cubes := make([]byte, worldfile.PlanesLen)
	cubes[5] = 2
	return &worldfile.World{ChunksX: 1, ChunksZ: 1, Chunks: []worldfile.Chunk{{CX: 0, CZ: 0, Layer: 10, Cubes: cubes}}}
}

func TestLeftBehindCopiesAreListed(t *testing.T) {
	dir := t.TempDir()
	old, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	old.Session = "old-session"
	if err := old.Touch(); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "elwynn.world")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	in, err := old.SaveWorld(3, Info{Name: "Elwynn", File: file}, small())
	if err != nil {
		t.Fatal(err)
	}
	if in.ID != "old-session_3" {
		t.Fatalf("id %q", in.ID)
	}
	// Written again: still one copy.
	if _, err := old.SaveWorld(3, Info{Name: "Elwynn", File: file}, small()); err != nil {
		t.Fatal(err)
	}

	cur, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cur.SaveWorld(1, Info{Name: "Mine"}, small()); err != nil {
		t.Fatal(err)
	}
	// The old session still runs: nothing to offer, and never this session's own.
	if l, _ := cur.List(); len(l) != 0 {
		t.Fatalf("listed a running session's copies: %+v", l)
	}

	// The old session stopped beating.
	past := time.Now().Add(-2 * Stale)
	if err := os.Chtimes(old.alivePath(old.Session), past, past); err != nil {
		t.Fatal(err)
	}
	l, err := cur.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(l) != 1 || l[0].ID != "old-session_3" || l[0].Name != "Elwynn" || l[0].FileTime == 0 {
		t.Fatalf("list: %+v", l)
	}
	w, err := cur.LoadWorld(l[0].ID)
	if err != nil || len(w.Chunks) != 1 {
		t.Fatalf("load: %v %+v", err, w)
	}
	if err := cur.Drop(l[0].ID); err != nil {
		t.Fatal(err)
	}
	if l, _ := cur.List(); len(l) != 0 {
		t.Fatalf("dropped copy still listed: %+v", l)
	}
}

func TestCleanQuitDropsTheSessionsCopies(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	s.Touch()
	if _, err := s.SaveWorld(1, Info{Name: "A"}, small()); err != nil {
		t.Fatal(err)
	}
	if err := s.DropSession(); err != nil {
		t.Fatal(err)
	}
	left, _ := filepath.Glob(filepath.Join(dir, "*"))
	if len(left) != 0 {
		t.Fatalf("left behind: %v", left)
	}
}

func TestIDsStayInTheFolder(t *testing.T) {
	s, _ := Open(t.TempDir())
	for _, id := range []string{`..\x_1`, "../x_1", "x", "a_b"} {
		if _, err := s.LoadWorld(id); err == nil {
			t.Errorf("loaded %q", id)
		}
		if err := s.Drop(id); err == nil {
			t.Errorf("dropped %q", id)
		}
	}
}

func TestEndedSessionStaysEnded(t *testing.T) {
	s, _ := Open(t.TempDir())
	s.Touch()
	s.End()
	// A heartbeat that fires after the quit must not mark the session running again.
	s.Touch()
	if _, err := os.Stat(s.alivePath(s.Session)); err == nil {
		t.Fatal("alive file written after End")
	}
}

func TestListDropsDeadSessionsWithoutCopies(t *testing.T) {
	dir := t.TempDir()
	dead, _ := Open(dir)
	dead.Session = "dead"
	dead.Touch()
	kept, _ := Open(dir)
	kept.Session = "kept"
	kept.Touch()
	if _, err := kept.SaveWorld(1, Info{Name: "A"}, small()); err != nil {
		t.Fatal(err)
	}
	live, _ := Open(dir)
	live.Session = "live"
	live.Touch()
	past := time.Now().Add(-2 * Stale)
	os.Chtimes(dead.alivePath("dead"), past, past)
	os.Chtimes(kept.alivePath("kept"), past, past)

	cur, _ := Open(dir)
	if l, _ := cur.List(); len(l) != 1 {
		t.Fatalf("list: %+v", l)
	}
	for session, want := range map[string]bool{"dead": false, "kept": true, "live": true} {
		if _, err := os.Stat(cur.alivePath(session)); (err == nil) != want {
			t.Errorf("%s alive file there: %v, want %v", session, err == nil, want)
		}
	}
}

func TestOldMapCopiesAreDropped(t *testing.T) {
	dir := t.TempDir()
	// An older editor's copy of a .wmap map: its info has no world flag.
	if err := os.WriteFile(filepath.Join(dir, "old-session_2.wmap"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "old-session_2.json"), []byte(`{"id":"old-session_2","session":"old-session","name":"Elwynn"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	cur, _ := Open(dir)
	if l, _ := cur.List(); len(l) != 0 {
		t.Fatalf("listed an old map's copy: %+v", l)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "old-session_2.*")); len(left) != 0 {
		t.Fatalf("left behind %v", left)
	}
}

func TestWorldCopy(t *testing.T) {
	dir := t.TempDir()
	old, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	old.Session = "old-session"
	cubes := make([]byte, worldfile.PlanesLen)
	cubes[5] = 2
	w := &worldfile.World{ChunksX: 2, ChunksZ: 1, Chunks: []worldfile.Chunk{{CX: 1, CZ: 0, Layer: 10, Cubes: cubes}}}
	in, err := old.SaveWorld(4, Info{Name: "Valley", File: filepath.Join(dir, "valley.world")}, w)
	if err != nil {
		t.Fatal(err)
	}
	if !in.World {
		t.Fatal("a world's copy is not marked as one")
	}
	if _, err := os.Stat(filepath.Join(dir, "old-session_4.world")); err != nil {
		t.Fatal(err)
	}
	if err := old.End(); err != nil {
		t.Fatal(err)
	}

	cur, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	list, err := cur.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || !list[0].World || list[0].ID != in.ID {
		t.Fatalf("listed %+v", list)
	}
	back, err := cur.LoadWorld(in.ID)
	if err != nil {
		t.Fatal(err)
	}
	if back.ChunksX != 2 || len(back.Chunks) != 1 || back.Chunks[0].CX != 1 || back.Chunks[0].Layer != 10 || back.Chunks[0].Cubes[5] != 2 {
		t.Fatalf("read back %+v", back)
	}
	if err := cur.Drop(in.ID); err != nil {
		t.Fatal(err)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "old-session_4.*")); len(left) != 0 {
		t.Fatalf("left behind %v", left)
	}
}

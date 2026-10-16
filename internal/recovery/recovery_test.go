package recovery

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"

	"Meld/internal/mapfile"
)

// small is the smallest map, 16 cells a side.
func small(name string) *mapfile.MapData {
	const size = 16
	res := size * mapfile.ChunkCells / 2
	chunks := (size / mapfile.ChunkCells) * (size / mapfile.ChunkCells)
	b := func(n int) string { return base64.StdEncoding.EncodeToString(make([]byte, n)) }
	return &mapfile.MapData{
		Header:     mapfile.Header{Name: name, Size: size, CellSize: 2, SplatRes: res},
		Heights:    b((size + 1) * (size + 1) * 4),
		Weights:    b(res * res * 4),
		ChunkSlots: b(chunks * mapfile.SlotsPerChunk),
		Holes:      b(size * size),
	}
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
	file := filepath.Join(dir, "elwynn.wmap")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	in, err := old.Save(3, Info{Name: "Elwynn", File: file}, small("Elwynn"))
	if err != nil {
		t.Fatal(err)
	}
	if in.ID != "old-session_3" {
		t.Fatalf("id %q", in.ID)
	}
	// Written again: still one copy.
	if _, err := old.Save(3, Info{Name: "Elwynn", File: file}, small("Elwynn")); err != nil {
		t.Fatal(err)
	}

	cur, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cur.Save(1, Info{Name: "Mine"}, small("Mine")); err != nil {
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
	m, err := cur.Load(l[0].ID)
	if err != nil || m.Name != "Elwynn" {
		t.Fatalf("load: %v %+v", err, m)
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
	if _, err := s.Save(1, Info{Name: "A"}, small("A")); err != nil {
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
		if _, err := s.Load(id); err == nil {
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
	if _, err := kept.Save(1, Info{Name: "A"}, small("A")); err != nil {
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

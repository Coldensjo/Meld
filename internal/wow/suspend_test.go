package wow

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

// TestSuspendResume releases the archives and loads them again: WOW_DIR=/path/to/client go test ./internal/wow/
func TestSuspendResume(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	if !c.Status().Loaded {
		t.Fatal("not loaded after open")
	}
	c.Suspend()
	if c.Status().Loaded {
		t.Fatal("still loaded after suspend")
	}
	if err := c.Resume(); err != nil {
		t.Fatal(err)
	}
	if !c.Status().Loaded {
		t.Fatal("not loaded after resume")
	}
}

// solidBLP is a 4x4 BLP of one colour.
func solidBLP(t *testing.T, r, g, b byte) []byte {
	px := make([]byte, 4*4*4)
	for i := 0; i < len(px); i += 4 {
		px[i], px[i+1], px[i+2], px[i+3] = r, g, b, 255
	}
	out, err := EncodeMinimapBLP(px, 4, 4)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// TestResumeKeepsCache checks that a Resume keeps what was decoded and the file list (#471): only the
// files Forget names are read again, and the list is read again only when an archive changed.
func TestResumeKeepsCache(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	patch := filepath.Join(data, "patch-3.MPQ")
	const a, b = `tileset\Meld\A.blp`, `tileset\Meld\B.blp`
	write := func(files ...mpq.File) {
		t.Helper()
		if err := os.WriteFile(patch, mpq.Write(files), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(mpq.File{Name: a, Data: solidBLP(t, 255, 0, 0)}, mpq.File{Name: b, Data: solidBLP(t, 0, 255, 0)})

	c := NewClient()
	if err := c.Open(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Open("") })
	reads := 0
	c.SetOverlay(func(string) ([]byte, bool) { reads++; return nil, false })
	texture := func(path string) []byte {
		t.Helper()
		out, err := c.Texture(path)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	red := texture(a)
	texture(b)
	if reads != 2 {
		t.Fatalf("%d reads for two textures", reads)
	}

	// Suspends nest: the archives open again with the last Resume.
	c.Suspend()
	c.Suspend()
	if err := c.Resume(); err != nil {
		t.Fatal(err)
	}
	if c.Status().Loaded {
		t.Fatal("loaded again before the last Resume")
	}
	if err := c.Resume(); err != nil {
		t.Fatal(err)
	}
	if !c.Status().Loaded {
		t.Fatal("not loaded after the last Resume")
	}
	texture(a)
	texture(b)
	if reads != 2 {
		t.Fatalf("%d reads after a Resume: the cache was dropped", reads)
	}

	// A write that changes A and adds C: the list is read again, and only A is read again.
	c.Suspend()
	write(
		mpq.File{Name: a, Data: solidBLP(t, 0, 0, 255)},
		mpq.File{Name: b, Data: solidBLP(t, 0, 255, 0)},
		mpq.File{Name: `tileset\Meld\C.blp`, Data: solidBLP(t, 0, 0, 0)},
	)
	// The time a file system keeps may be coarse; the size differs anyway.
	_ = os.Chtimes(patch, time.Now().Add(time.Second), time.Now().Add(time.Second))
	if err := c.Resume(); err != nil {
		t.Fatal(err)
	}
	c.Forget(`TILESET/meld/a.BLP`)
	if blue := texture(a); bytes.Equal(blue, red) {
		t.Fatal("A was served from the cache after Forget")
	}
	texture(b)
	if reads != 3 {
		t.Fatalf("%d reads, want 3: only A is read again", reads)
	}
	if n := len(c.List("tileset")); n != 3 {
		t.Fatalf("%d tilesets listed after the patch changed, want 3", n)
	}

	// Open is a real client change: everything decoded goes.
	if err := c.Open(root); err != nil {
		t.Fatal(err)
	}
	texture(b)
	if reads != 4 {
		t.Fatalf("%d reads, want 4: Open keeps the cache", reads)
	}
}

// TestReadWaitsForResume checks that a read while the archives are suspended waits for the Resume
// instead of failing (#472), and that an unload or the time limit still ends the wait.
func TestReadWaitsForResume(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	const a = `tileset\Meld\A.blp`
	want := solidBLP(t, 255, 0, 0)
	if err := os.WriteFile(filepath.Join(data, "patch-3.MPQ"), mpq.Write([]mpq.File{{Name: a, Data: want}}), 0o644); err != nil {
		t.Fatal(err)
	}
	c := NewClient()
	if err := c.Open(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Open("") })

	type result struct {
		b   []byte
		err error
	}
	start := func() chan result {
		done := make(chan result, 1)
		go func() {
			b, err := c.read(a)
			done <- result{b, err}
		}()
		return done
	}

	c.Suspend()
	done := start()
	select {
	case r := <-done:
		t.Fatalf("read ended while suspended: %v", r.err)
	case <-time.After(100 * time.Millisecond):
	}
	if err := c.Resume(); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-done:
		if r.err != nil || !bytes.Equal(r.b, want) {
			t.Fatalf("read after Resume: %v", r.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("read still waiting after Resume")
	}

	// Unloading the client (the sandbox's end, a cleared folder) ends the wait with an error.
	c.Suspend()
	done = start()
	time.Sleep(50 * time.Millisecond)
	if err := c.Open(""); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-done:
		if r.err == nil {
			t.Fatal("read succeeded with no client")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("read still waiting after the client was unloaded")
	}

	// A Suspend that outlasts suspendWait fails the read rather than hanging it.
	if err := c.Open(root); err != nil {
		t.Fatal(err)
	}
	old := suspendWait
	suspendWait = 50 * time.Millisecond
	t.Cleanup(func() { suspendWait = old })
	c.Suspend()
	if _, err := c.read(a); err == nil {
		t.Fatal("read succeeded while suspended past the limit")
	}
	if err := c.Resume(); err != nil {
		t.Fatal(err)
	}
	if b, err := c.read(a); err != nil || !bytes.Equal(b, want) {
		t.Fatalf("read after the late Resume: %v", err)
	}
}

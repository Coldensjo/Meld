package mpq

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteRoundTrip(t *testing.T) {
	big := bytes.Repeat([]byte("terrain "), 5000)
	files := []File{
		{Name: `World\Maps\Test\Test_1_2.adt`, Data: big},
		{Name: `Interface/Icons/Small.blp`, Data: []byte{1, 2, 3}},
		{Name: `empty.txt`, Data: nil},
	}
	path := filepath.Join(t.TempDir(), "patch-3.MPQ")
	if err := os.WriteFile(path, Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	a, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	for _, f := range files {
		got, err := a.ReadFile(f.Name)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		if !bytes.Equal(got, f.Data) {
			t.Fatalf("%s: got %d bytes, want %d", f.Name, len(got), len(f.Data))
		}
	}
	marker, err := a.ReadFile(MarkerName)
	if err != nil || string(marker) != MarkerText {
		t.Fatalf("marker = %q, %v", marker, err)
	}
	if a.Has(`missing\file.adt`) {
		t.Error("Has reports a file that isn't there")
	}
}

// TestWriteToFromArchive copies files from one archive into another through Archive.Reader, as a
// patch write carries its old files over (#476), and checks that a short reader fails the write.
func TestWriteToFromArchive(t *testing.T) {
	dir := t.TempDir()
	big := bytes.Repeat([]byte("tile "), 3000)
	src := filepath.Join(dir, "a.MPQ")
	if err := os.WriteFile(src, Write([]File{{Name: `a\big.adt`, Data: big}, {Name: `b.txt`, Data: []byte("b")}}), 0o644); err != nil {
		t.Fatal(err)
	}
	a, err := Open(src)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if size, ok := a.Size(`A/BIG.adt`); !ok || size != int64(len(big)) {
		t.Fatalf("size %d, %v", size, ok)
	}
	var entries []Entry
	for _, name := range []string{`a\big.adt`, `b.txt`} {
		r, size, err := a.Reader(name)
		if err != nil {
			t.Fatal(err)
		}
		entries = append(entries, Entry{Name: name, Size: size, Data: r})
	}
	entries = append(entries, Entries([]File{{Name: `c.txt`, Data: []byte("new")}})...)
	var out bytes.Buffer
	if err := WriteTo(&out, entries); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "b.MPQ")
	if err := os.WriteFile(dst, out.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	b, err := Open(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	for name, want := range map[string][]byte{`a\big.adt`: big, `b.txt`: []byte("b"), `c.txt`: []byte("new")} {
		if got, err := b.ReadFile(name); err != nil || !bytes.Equal(got, want) {
			t.Fatalf("%s: %d bytes, %v", name, len(got), err)
		}
	}
	if _, _, err := a.Reader("missing"); err != ErrNotFound {
		t.Fatalf("missing file: %v", err)
	}
	short := []Entry{{Name: "x", Size: 10, Data: bytes.NewReader([]byte("abc"))}}
	if err := WriteTo(&bytes.Buffer{}, short); err == nil {
		t.Fatal("a short reader wrote an archive")
	}
}

func TestWriteReplacesOwnMarker(t *testing.T) {
	files := []File{{Name: MarkerName, Data: []byte("old")}, {Name: "a.txt", Data: []byte("x")}}
	path := filepath.Join(t.TempDir(), "p.MPQ")
	if err := os.WriteFile(path, Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	a, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if got, _ := a.ReadFile(MarkerName); string(got) != MarkerText {
		t.Errorf("marker = %q", got)
	}
}

// TestReadPrefix reads the start of a file only, as the unique ID scan reads tiles (#491): at least
// the bytes asked for, and the whole file when it is shorter or n is negative.
func TestReadPrefix(t *testing.T) {
	big := make([]byte, 50000)
	for i := range big {
		big[i] = byte(i * 7)
	}
	const name = `World\Maps\Test\Test_1_2.adt`
	path := filepath.Join(t.TempDir(), "patch-3.MPQ")
	if err := os.WriteFile(path, Write([]File{{Name: name, Data: big}}), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := OpenDataDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, n := range []int{0, 10, 4096, 4097, 20000, 50000, 1 << 20, -1} {
		got, err := s.ReadPrefix(name, n)
		if err != nil {
			t.Fatalf("n %d: %v", n, err)
		}
		want := n
		if n < 0 || n > len(big) {
			want = len(big)
		}
		if len(got) < want || !bytes.Equal(got, big[:len(got)]) {
			t.Fatalf("n %d: got %d bytes, want the first %d", n, len(got), want)
		}
	}
	if _, err := s.ReadPrefix(`missing.adt`, 10); err != ErrNotFound {
		t.Fatalf("missing file: %v", err)
	}
}

// A header whose sector shift overflows the sector size (#489) must fail to
// open, so OpenDataDir skips the archive instead of ReadFile dividing by zero.
func TestOpenRejectsBadSectorShift(t *testing.T) {
	dir := t.TempDir()
	good := Write([]File{{Name: `a.txt`, Data: []byte("good")}})
	bad := Write([]File{{Name: `a.txt`, Data: []byte("bad")}})
	bad[14], bad[15] = 0xFF, 0
	if err := os.WriteFile(filepath.Join(dir, "patch.MPQ"), good, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "patch-2.MPQ"), bad, 0o644); err != nil {
		t.Fatal(err)
	}
	if a, err := Open(filepath.Join(dir, "patch-2.MPQ")); err == nil {
		a.Close()
		t.Fatal("Open accepted a sector shift of 255")
	}
	s, err := OpenDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(s.Archives()); n != 1 {
		t.Fatalf("OpenDataDir opened %d archives, want 1", n)
	}
	got, err := s.ReadFile(`a.txt`)
	if err != nil || string(got) != "good" {
		t.Fatalf("ReadFile = %q, %v; want the good archive's copy", got, err)
	}
	for _, a := range s.Archives() {
		a.Close()
	}
}

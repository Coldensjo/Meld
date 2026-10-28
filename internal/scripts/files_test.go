package scripts

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInside(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "scripts")
	for _, c := range []struct {
		file string
		want bool
	}{
		{filepath.Join(dir, "a.txt"), true},
		{filepath.Join(dir, "sub", "b.txt"), true},
		{filepath.Join(dir, "sub", "..", "c.txt"), true},
		{filepath.Join(dir, "..a"), true},
		{dir, false},
		{filepath.Join(dir, ".."), false},
		{filepath.Join(dir, "..", "x.txt"), false},
		{filepath.Join(dir, "sub", "..", "..", "x.txt"), false},
		{dir + "2", false},
		{filepath.Join(dir+"2", "x.txt"), false},
	} {
		if got := Inside(dir, c.file); got != c.want {
			t.Errorf("Inside(%q) = %v, want %v", c.file, got, c.want)
		}
	}
}

func TestWritePath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "scripts")
	outside := filepath.Join(filepath.Dir(dir), "x.txt")
	ok := map[string]string{
		"a.txt":                     filepath.Join(dir, "a.txt"),
		"out/b.txt":                 filepath.Join(dir, "out", "b.txt"),
		"out/../c.txt":              filepath.Join(dir, "c.txt"),
		filepath.Join(dir, "d.txt"): filepath.Join(dir, "d.txt"),
	}
	for path, want := range ok {
		got, err := WritePath(dir, path, false)
		if err != nil || got != want {
			t.Errorf("WritePath(%q) = %q, %v; want %q", path, got, err, want)
		}
	}
	for _, bad := range []string{"", "..", "../x.txt", "out/../../x.txt", outside, ".", "out/.."} {
		if _, err := WritePath(dir, bad, false); err == nil {
			t.Errorf("WritePath(%q) let a script write outside the scripts folder", bad)
		}
	}
	// The preference lets a script write anywhere, whole paths and .. alike.
	if got, err := WritePath(dir, outside, true); err != nil || got != outside {
		t.Errorf("with any file allowed, WritePath(%q) = %q, %v", outside, got, err)
	}
	if got, err := WritePath(dir, "../x.txt", true); err != nil || got != outside {
		t.Errorf("with any file allowed, WritePath(../x.txt) = %q, %v", got, err)
	}
}

func TestReadWriteAppendExists(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "scripts")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if ok, err := Exists(dir, "out/log.txt"); ok || err != nil {
		t.Fatalf("Exists before writing = %v, %v", ok, err)
	}
	if err := WriteFile(dir, "out/log.txt", "one\n", false, false); err != nil {
		t.Fatal(err)
	}
	if err := WriteFile(dir, "out/log.txt", "two\n", true, false); err != nil {
		t.Fatal(err)
	}
	if text, err := ReadFile(dir, "out/log.txt"); err != nil || text != "one\ntwo\n" {
		t.Fatalf("ReadFile = %q, %v", text, err)
	}
	if err := WriteFile(dir, "out/log.txt", "three", false, false); err != nil {
		t.Fatal(err)
	}
	if text, _ := ReadFile(dir, filepath.Join(dir, "out", "log.txt")); text != "three" {
		t.Fatalf("after a write over it, ReadFile = %q", text)
	}
	for _, p := range []string{"out/log.txt", "out", filepath.Join(dir, "out")} {
		if ok, err := Exists(dir, p); !ok || err != nil {
			t.Errorf("Exists(%q) = %v, %v", p, ok, err)
		}
	}
	if _, err := ReadFile(dir, "missing.txt"); err == nil {
		t.Error("a missing file read")
	}
	if _, err := ReadFile(dir, "out"); err == nil {
		t.Error("a folder read as a file")
	}
	// Writing out of the folder is refused and writes nothing; reading out of it is allowed, as load_png's is.
	outside := filepath.Join(filepath.Dir(dir), "x.txt")
	if err := WriteFile(dir, "../x.txt", "no", false, false); err == nil {
		t.Error("a write reached out of the scripts folder")
	}
	if _, err := os.Stat(outside); !os.IsNotExist(err) {
		t.Fatalf("the refused write left %s: %v", outside, err)
	}
	if err := WriteFile(dir, "../x.txt", "yes", false, true); err != nil {
		t.Fatal(err)
	}
	if text, err := ReadFile(dir, "../x.txt"); err != nil || text != "yes" {
		t.Errorf("ReadFile(../x.txt) = %q, %v", text, err)
	}
}

func TestSavePNG(t *testing.T) {
	dir := t.TempDir()
	pix := []byte{255, 0, 0, 255, 0, 0, 255, 128}
	if err := SavePNG(dir, "img/dot.png", 2, 1, pix, false); err != nil {
		t.Fatal(err)
	}
	w, h, got, err := LoadPNG(filepath.Join(dir, "img", "dot.png"))
	if err != nil || w != 2 || h != 1 || string(got) != string(pix) {
		t.Fatalf("read back %d×%d %v, %v", w, h, got, err)
	}
	if err := SavePNG(dir, "bad.png", 2, 2, pix, false); err == nil {
		t.Error("too few bytes for the size saved")
	}
	if err := SavePNG(dir, "../dot.png", 2, 1, pix, false); err == nil {
		t.Error("image:save reached out of the scripts folder")
	}
}

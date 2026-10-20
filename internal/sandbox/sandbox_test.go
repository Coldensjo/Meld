package sandbox

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, path, data string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// The copy links the archives, copies the patch, and a write of the copy's patch (as InstallPatch
// does it, a new file renamed over it) leaves the real one alone; the next Prepare drops it.
func TestPrepare(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "client", "Data")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(real, "patch.MPQ"), "base")
	write(t, filepath.Join(real, Patch), "meld")
	write(t, filepath.Join(real, "readme.txt"), "not an archive")
	root := filepath.Join(dir, "sandbox")

	data, err := Prepare(real, root)
	if err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(data, "patch.MPQ")); got != "base" {
		t.Fatalf("patch.MPQ = %q", got)
	}
	if _, err := os.Stat(filepath.Join(data, "readme.txt")); !os.IsNotExist(err) {
		t.Fatalf("readme.txt was copied: %v", err)
	}
	ri, _ := os.Stat(filepath.Join(real, "patch.MPQ"))
	di, _ := os.Stat(filepath.Join(data, "patch.MPQ"))
	if !os.SameFile(ri, di) {
		t.Fatal("patch.MPQ is not linked")
	}

	// A probe writes the copy's patch and leaves a backup beside it.
	tmp := filepath.Join(data, Patch+".tmp")
	write(t, tmp, "probe")
	if err := os.Rename(tmp, filepath.Join(data, Patch)); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(data, Patch+".before-meld"), "old")
	if got := read(t, filepath.Join(real, Patch)); got != "meld" {
		t.Fatalf("the real patch changed: %q", got)
	}

	// The real client gains an archive and loses its patch.
	write(t, filepath.Join(real, "patch-2.MPQ"), "two")
	if err := os.Remove(filepath.Join(real, Patch)); err != nil {
		t.Fatal(err)
	}
	if _, err := Prepare(real, root); err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(data, "patch-2.MPQ")); got != "two" {
		t.Fatalf("patch-2.MPQ = %q", got)
	}
	for _, gone := range []string{Patch, Patch + ".before-meld"} {
		if _, err := os.Stat(filepath.Join(data, gone)); !os.IsNotExist(err) {
			t.Fatalf("%s is still in the copy: %v", gone, err)
		}
	}

	// The patch comes back, and a refresh copies it afresh over what the probe wrote.
	write(t, filepath.Join(real, Patch), "meld again")
	if _, err := Prepare(real, root); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(data, Patch+".tmp"), "probe again")
	if err := os.Rename(filepath.Join(data, Patch+".tmp"), filepath.Join(data, Patch)); err != nil {
		t.Fatal(err)
	}
	if _, err := Prepare(real, root); err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(data, Patch)); got != "meld again" {
		t.Fatalf("the copy's patch = %q after a refresh", got)
	}
}

func TestPrepareNoArchives(t *testing.T) {
	dir := t.TempDir()
	if _, err := Prepare(dir, filepath.Join(dir, "sandbox")); err == nil {
		t.Fatal("a folder without archives was taken")
	}
}

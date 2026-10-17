package mpq

import (
	"os"
	"path/filepath"
	"testing"
)

// ReadFileExcept skips only the archive named, so Blizzard's patches still override the base data
// while Meld's patch-3 is left out (#273).
func TestReadFileExceptSkipsOnlyTheNamedArchive(t *testing.T) {
	dir := t.TempDir()
	const tile = `World\Maps\Azeroth\Azeroth_31_29.adt`
	const patchOnly = `World\Maps\AhnQiraj\AhnQiraj_1_1.adt`
	const meldOnly = `World\Maps\New\New_0_0.adt`
	archives := map[string][]File{
		"terrain.MPQ": {{Name: tile, Data: []byte("terrain")}},
		"patch.MPQ":   {{Name: patchOnly, Data: []byte("patch")}},
		"patch-2.MPQ": {{Name: tile, Data: []byte("patch-2")}},
		"patch-3.MPQ": {{Name: tile, Data: []byte("meld")}, {Name: patchOnly, Data: []byte("meld")}, {Name: meldOnly, Data: []byte("meld")}},
	}
	for name, files := range archives {
		if err := os.WriteFile(filepath.Join(dir, name), Write(files), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s, err := OpenDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	for _, c := range []struct{ name, all, without string }{
		{tile, "meld", "patch-2"},
		{patchOnly, "meld", "patch"},
	} {
		if got, err := s.ReadFile(c.name); err != nil || string(got) != c.all {
			t.Errorf("ReadFile(%s) = %q, %v; want %q", c.name, got, err, c.all)
		}
		if got, err := s.ReadFileExcept(c.name, "PATCH-3.mpq"); err != nil || string(got) != c.without {
			t.Errorf("ReadFileExcept(%s) = %q, %v; want %q", c.name, got, err, c.without)
		}
	}
	if _, err := s.ReadFileExcept(meldOnly, "patch-3.MPQ"); err != ErrNotFound {
		t.Errorf("a file only in the skipped archive read with %v, want ErrNotFound", err)
	}
}

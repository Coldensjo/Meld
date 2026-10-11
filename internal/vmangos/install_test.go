package vmangos

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"WorldEditor/internal/mpq"
	"WorldEditor/internal/wow"
)

var tileFiles = []mpq.File{{Name: `World\Maps\Azeroth\Azeroth_32_48.adt`, Data: []byte("tile")}}

func TestInstallPatchFreshThenReplace(t *testing.T) {
	dir := t.TempDir()
	path, err := InstallPatch(dir, tileFiles)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != PatchName {
		t.Fatalf("wrote %s", path)
	}
	// A second export replaces our own patch, with no backup.
	tileFiles2 := []mpq.File{{Name: `World\Maps\Azeroth\Azeroth_32_48.adt`, Data: []byte("tile two")}}
	if _, err := InstallPatch(dir, tileFiles2); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, PatchName+BackupSuffix)); err == nil {
		t.Error("a WorldEditor patch was backed up")
	}
	a, err := mpq.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	got, err := a.ReadFile(`World\Maps\Azeroth\Azeroth_32_48.adt`)
	if err != nil || string(got) != "tile two" {
		t.Fatalf("tile = %q, %v", got, err)
	}
}

func TestInstallPatchLeavesUnknownArchive(t *testing.T) {
	dir := t.TempDir()
	orig := []byte("not an archive from us")
	if err := os.WriteFile(filepath.Join(dir, PatchName), orig, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallPatch(dir, tileFiles); err == nil {
		t.Fatal("replaced a patch it doesn't own")
	}
	if b, _ := os.ReadFile(filepath.Join(dir, PatchName)); !bytes.Equal(b, orig) {
		t.Error("the existing patch changed")
	}
}

func TestCheckServer(t *testing.T) {
	dir := t.TempDir()
	if CheckServer(dir) == nil {
		t.Fatal("empty folder accepted")
	}
	os.MkdirAll(filepath.Join(dir, "run"), 0o755)
	os.MkdirAll(filepath.Join(dir, "data"), 0o755)
	os.WriteFile(filepath.Join(dir, "run", "mangosd.conf"), []byte("x"), 0o644)
	if err := CheckServer(dir); err != nil {
		t.Fatal(err)
	}
}

// TestIronforgePatchIsBackedUp replaces the Ironforge patch in a client copy:
// WOW_DIR=/path/to/client go test ./internal/vmangos/
func TestIronforgePatchIsBackedUp(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.12 client to run")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(dataDir, PatchName)
	owner, err := archiveOwner(src)
	if err != nil {
		t.Fatal(err)
	}
	if owner != IronforgeMarker {
		t.Skip("the client's patch-3 is not Ironforge's, so there is no Ironforge backup to check")
	}
	tmp := t.TempDir()
	orig, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(tmp, PatchName), orig, 0o644)
	if _, err := InstallPatch(tmp, tileFiles); err != nil {
		t.Fatal(err)
	}
	backupBytes, err := os.ReadFile(filepath.Join(tmp, PatchName+BackupSuffix))
	if err != nil {
		t.Fatal("no backup written: ", err)
	}
	if !bytes.Equal(backupBytes, orig) {
		t.Fatal("backup differs from the original")
	}
}

func TestInstallPatchKeepsOtherTiles(t *testing.T) {
	dir := t.TempDir()
	a := []mpq.File{{Name: `World\Maps\Azeroth\Azeroth_1_1.adt`, Data: []byte("one")}}
	b := []mpq.File{{Name: `World\Maps\Azeroth\Azeroth_2_2.adt`, Data: []byte("two")}}
	if _, err := InstallPatch(dir, a); err != nil {
		t.Fatal(err)
	}
	path, err := InstallPatch(dir, b)
	if err != nil {
		t.Fatal(err)
	}
	arch, err := mpq.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer arch.Close()
	for name, want := range map[string]string{`World\Maps\Azeroth\Azeroth_1_1.adt`: "one", `World\Maps\Azeroth\Azeroth_2_2.adt`: "two"} {
		got, err := arch.ReadFile(name)
		if err != nil || string(got) != want {
			t.Errorf("%s = %q, %v", name, got, err)
		}
	}
}

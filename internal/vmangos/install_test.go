package vmangos

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/wow"
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
		t.Error("a Meld patch was backed up")
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

// TestChangedFiles keeps only what differs from the patch: a changed tile and a new one, not an
// unchanged tile. Without a patch, or with one Meld didn't write, everything counts.
func TestChangedFiles(t *testing.T) {
	dir := t.TempDir()
	same := mpq.File{Name: `World\Maps\Azeroth\Azeroth_32_48.adt`, Data: []byte("same")}
	edited := mpq.File{Name: `World\Maps\Azeroth\Azeroth_33_48.adt`, Data: []byte("before")}
	files := []mpq.File{same, {Name: edited.Name, Data: []byte("after")}, {Name: `World\Maps\Azeroth\Azeroth_34_48.adt`, Data: []byte("new")}}
	if got, err := ChangedFiles(dir, files); err != nil || len(got) != 3 {
		t.Fatalf("with no patch %d files changed, %v; want all 3", len(got), err)
	}
	if _, err := InstallPatch(dir, []mpq.File{same, edited}); err != nil {
		t.Fatal(err)
	}
	got, err := ChangedFiles(dir, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Name != edited.Name || string(got[1].Data) != "new" {
		t.Fatalf("changed = %v, want the edited and the new tile", got)
	}
	if countTiles(got) != 2 || countTiles([]mpq.File{{Name: `World\Maps\X\X.wdl`}}) != 0 {
		t.Fatal("countTiles counts something other than the tiles")
	}
	other := t.TempDir()
	if err := os.WriteFile(filepath.Join(other, PatchName), []byte("not ours"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, err := ChangedFiles(other, files); err != nil || len(got) != 3 {
		t.Fatalf("with a foreign patch %d files changed, %v; want all 3", len(got), err)
	}
}

func TestDropUnusedMinimaps(t *testing.T) {
	index := []byte("dir: Azeroth\r\nAzeroth\\map32_48.blp\tnew.blp\r\n")
	keep := []mpq.File{
		{Name: `textures\Minimap\old.blp`},
		{Name: `textures\Minimap\new.blp`},
		{Name: `World\Maps\Azeroth\Azeroth_32_48.adt`},
		{Name: `textures\Minimap\WMO\x.blp`}, // a folder below: not a tile of the index's form
	}
	got := dropUnusedMinimaps(append([]mpq.File(nil), keep...), []mpq.File{{Name: `textures\Minimap\md5translate.trs`, Data: index}})
	names := []string{}
	for _, f := range got {
		names = append(names, f.Name)
	}
	if len(got) != 3 || names[0] != `textures\Minimap\new.blp` {
		t.Fatalf("kept %v", names)
	}
	// No index anywhere: everything stays.
	if n := len(dropUnusedMinimaps(append([]mpq.File(nil), keep...), nil)); n != 4 {
		t.Fatalf("kept %d without an index", n)
	}
}

package vmangos

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
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
	// The patch it replaced is kept as .prev (#475), and the next write replaces that one.
	prevHas := func(name, want string) {
		t.Helper()
		p, err := mpq.Open(filepath.Join(dir, PatchName+PrevSuffix))
		if err != nil {
			t.Fatalf("no previous patch: %v", err)
		}
		defer p.Close()
		if got, err := p.ReadFile(name); err != nil || string(got) != want {
			t.Fatalf("previous patch's %s = %q, %v; want %q", name, got, err, want)
		}
	}
	prevHas(`World\Maps\Azeroth\Azeroth_32_48.adt`, string(tileFiles[0].Data))
	tileFiles3 := []mpq.File{{Name: `World\Maps\Azeroth\Azeroth_32_48.adt`, Data: []byte("tile three")}}
	if _, err := InstallPatch(dir, tileFiles3); err != nil {
		t.Fatal(err)
	}
	prevHas(`World\Maps\Azeroth\Azeroth_32_48.adt`, "tile two")
	if err := os.WriteFile(filepath.Join(dir, PatchName+PrevSuffix), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallPatch(dir, tileFiles2); err != nil {
		t.Fatal(err)
	}
	// A .prev already there (here not even an archive) is overwritten.
	prevHas(`World\Maps\Azeroth\Azeroth_32_48.adt`, "tile three")
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
	dir := testclient.DataDir(t)
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
	keep := []mpq.Entry{
		{Name: `textures\Minimap\old.blp`},
		{Name: `textures\Minimap\new.blp`},
		{Name: `World\Maps\Azeroth\Azeroth_32_48.adt`},
		{Name: `textures\Minimap\WMO\x.blp`}, // a folder below: not a tile of the index's form
	}
	got := dropUnusedMinimaps(append([]mpq.Entry(nil), keep...), index)
	names := []string{}
	for _, f := range got {
		names = append(names, f.Name)
	}
	if len(got) != 3 || names[0] != `textures\Minimap\new.blp` {
		t.Fatalf("kept %v", names)
	}
	// No index anywhere: everything stays.
	if n := len(dropUnusedMinimaps(append([]mpq.Entry(nil), keep...), nil)); n != 4 {
		t.Fatalf("kept %d without an index", n)
	}
}

// fakeReader records what InstallPatch and AddPending tell Meld's reader of the archives.
type fakeReader struct {
	log    []string
	forgot []string
}

func (r *fakeReader) Suspend()      { r.log = append(r.log, "suspend") }
func (r *fakeReader) Resume() error { r.log = append(r.log, "resume"); return nil }
func (r *fakeReader) Forget(paths ...string) {
	r.log = append(r.log, "forget")
	r.forgot = append(r.forgot, paths...)
}

// TestInstallPatchHoldsReader checks that a patch write closes Meld's reader for the rename only and
// has it forget just the files it wrote and the minimap tiles it dropped, not the ones it carried (#471).
func TestInstallPatchHoldsReader(t *testing.T) {
	dir := t.TempDir()
	if _, err := InstallPatch(dir, []mpq.File{
		{Name: `World\Maps\Azeroth\Azeroth_32_48.adt`, Data: []byte("tile")},
		{Name: `textures\Minimap\old.blp`, Data: []byte("old")},
	}); err != nil {
		t.Fatal(err)
	}
	r := &fakeReader{}
	SetClientReader(r)
	t.Cleanup(func() { SetClientReader(nil) })
	index := []byte("dir: Azeroth\r\nAzeroth\\map32_48.blp\tnew.blp\r\n")
	if _, err := InstallPatch(dir, []mpq.File{
		{Name: `textures\Minimap\md5translate.trs`, Data: index},
		{Name: `textures\Minimap\new.blp`, Data: []byte("new")},
	}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(r.log, ","); got != "suspend,resume,forget" {
		t.Fatalf("reader calls %s", got)
	}
	want := `textures\Minimap\md5translate.trs,textures\Minimap\new.blp,textures\Minimap\old.blp`
	if got := strings.Join(r.forgot, ","); got != want {
		t.Fatalf("forgot %s, want %s", got, want)
	}

	// A file waiting for the game to close is forgotten too: the reader's overlay serves it now.
	root := t.TempDir()
	old := pendingRoot
	pendingRoot = func() string { return root }
	defer func() { pendingRoot = old }()
	r.log, r.forgot = nil, nil
	if err := AddPending(dir, []mpq.File{{Name: `Interface\Icons\Meld_Test.blp`, Data: []byte("icon")}}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(r.forgot, ","); got != `Interface\Icons\Meld_Test.blp` || len(r.log) != 1 {
		t.Fatalf("pending: calls %v, forgot %s", r.log, got)
	}
}

// TestInstallPatchWithClientOpen writes the patch while Meld's reader has it open, as the app does:
// Windows renames over it only because the reader lets go for the write.
func TestInstallPatchWithClientOpen(t *testing.T) {
	dir := t.TempDir()
	if _, err := InstallPatch(dir, tileFiles); err != nil {
		t.Fatal(err)
	}
	c := wow.NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Open("") })
	SetClientReader(c)
	t.Cleanup(func() { SetClientReader(nil) })
	two := []mpq.File{{Name: tileFiles[0].Name, Data: []byte("tile two")}}
	if _, err := InstallPatch(dir, two); err != nil {
		t.Fatal(err)
	}
	if !c.Status().Loaded {
		t.Fatal("the reader didn't open the archives again")
	}
}

// TestPatchWritesOneAtATime runs patch writes at once, as Publish and the waiting files' watcher can
// (#657): each rebuilds the patch from the old one and renames over it, so without patchMu the last
// rename drops the files the others wrote.
func TestPatchWritesOneAtATime(t *testing.T) {
	dir := t.TempDir()
	cache, old := t.TempDir(), pendingRoot
	pendingRoot = func() string { return cache }
	defer func() { pendingRoot = old }()
	if err := AddPending(dir, []mpq.File{{Name: SpellPath, Data: []byte("spell")}}); err != nil {
		t.Fatal(err)
	}
	const writers = 8
	errs := make(chan error, writers)
	for i := 0; i < writers; i++ {
		go func(i int) {
			f := []mpq.File{{Name: fmt.Sprintf(`World\Maps\Azeroth\Azeroth_32_%d.adt`, 40+i), Data: []byte{byte(i)}}}
			var err error
			if i%2 == 0 {
				_, err = InstallPatch(dir, f)
			} else {
				_, err = InstallWithPending(dir, f)
			}
			errs <- err
		}(i)
	}
	for i := 0; i < writers; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	a, err := mpq.Open(filepath.Join(dir, PatchName))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	for i := 0; i < writers; i++ {
		if name := fmt.Sprintf(`World\Maps\Azeroth\Azeroth_32_%d.adt`, 40+i); !a.Has(name) {
			t.Errorf("%s was dropped", name)
		}
	}
	if b, err := a.ReadFile(SpellPath); err != nil || string(b) != "spell" {
		t.Errorf("the waiting Spell.dbc: %q %v", b, err)
	}
	if left, _ := PendingFiles(dir); len(left) != 0 {
		t.Errorf("still waiting: %d", len(left))
	}
}

// TestInstallWithPending takes the waiting files along, a given file replacing a waiting one of its
// name, and writes nothing when nothing is given or waits.
func TestInstallWithPending(t *testing.T) {
	dir := t.TempDir()
	cache, old := t.TempDir(), pendingRoot
	pendingRoot = func() string { return cache }
	defer func() { pendingRoot = old }()
	if patch, err := InstallWithPending(dir, nil); err != nil || patch != "" {
		t.Fatalf("nothing to write: %q %v", patch, err)
	}
	if _, err := os.Stat(filepath.Join(dir, PatchName)); err == nil {
		t.Fatal("a patch was written with nothing in it")
	}
	if err := AddPending(dir, []mpq.File{{Name: SpellPath, Data: []byte("old")}, {Name: SpellIconPath, Data: []byte("icons")}}); err != nil {
		t.Fatal(err)
	}
	patch, err := InstallWithPending(dir, []mpq.File{{Name: SpellPath, Data: []byte("new")}})
	if err != nil {
		t.Fatal(err)
	}
	a, err := mpq.Open(patch)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if b, _ := a.ReadFile(SpellPath); string(b) != "new" {
		t.Errorf("Spell.dbc = %q", b)
	}
	if b, _ := a.ReadFile(SpellIconPath); string(b) != "icons" {
		t.Errorf("SpellIcon.dbc = %q", b)
	}
	if left, _ := PendingFiles(dir); len(left) != 0 {
		t.Errorf("still waiting: %d", len(left))
	}
}

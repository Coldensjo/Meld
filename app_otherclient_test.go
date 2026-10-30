package main

import (
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
	"Meld/internal/wow"
)

// testClientDir writes files into a client folder's archive and returns the folder.
func testClientDir(t *testing.T, files ...mpq.File) string {
	t.Helper()
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(data, "base.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// TestImportOtherAssets copies a tileset with its sheen twin from another client into the current
// client's patch (#858), and refuses to open the current client as the other one.
func TestImportOtherAssets(t *testing.T) {
	src := testClientDir(t,
		mpq.File{Name: `Tileset\Other\Moss.blp`, Data: []byte("moss")},
		mpq.File{Name: `Tileset\Other\Moss_s.blp`, Data: []byte("moss sheen")},
		mpq.File{Name: `Tileset\Ours\Sand.blp`, Data: []byte("their sand")},
	)
	dst := testClientDir(t, mpq.File{Name: `Tileset\Ours\Sand.blp`, Data: []byte("sand")})
	a := &App{wow: wow.NewClient(), other: wow.NewClient(), gameUp: func() bool { return false }}
	a.cfg.WowPath = dst
	if err := a.wow.Open(dst); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.wow.Open(""); _ = a.other.Open("") })
	// As the app does, so a patch write lets go of the archives the current client holds open.
	vmangos.SetClientReader(a.wow)
	t.Cleanup(func() { vmangos.SetClientReader(nil) })

	if _, err := a.ImportOtherAssets([]string{`Tileset\Other\Moss.blp`}, wow.ImportOptions{}); err == nil {
		t.Error("imported with no other client open")
	}
	if _, err := a.OpenOtherClient(dst); err == nil {
		t.Error("opened the current client as the other one")
	}
	if st, err := a.OpenOtherClient(src); err != nil || !st.Loaded {
		t.Fatalf("open other: %v %+v", err, st)
	}
	res, err := a.ImportOtherAssets([]string{`Tileset\Other\Moss.blp`}, wow.ImportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 2 || len(res.Imported) != 1 || res.Waiting || res.Present == nil {
		t.Fatalf("result %+v", res)
	}
	patch, err := mpq.Open(filepath.Join(dst, "Data", "patch-3.MPQ"))
	if err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{`Tileset\Other\Moss.blp`: "moss", `Tileset\Other\Moss_s.blp`: "moss sheen"} {
		if b, err := patch.ReadFile(name); err != nil || string(b) != want {
			t.Errorf("%s in the patch: %q, %v", name, b, err)
		}
	}
	_ = patch.Close()
	// Again, the current client has it now.
	_ = a.wow.Open(dst)
	if res, err := a.ImportOtherAssets([]string{`Tileset\Other\Moss.blp`}, wow.ImportOptions{}); err != nil || res.Files != 0 || len(res.Present) != 1 {
		t.Errorf("second import: %+v, %v", res, err)
	}

	// A texture the current client has a different copy of is refused, and replaced when asked (#878).
	if res, err := a.ImportOtherAssets([]string{`Tileset\Ours\Sand.blp`}, wow.ImportOptions{}); err != nil || res.Files != 0 || len(res.Differs) != 1 || len(res.Refused) != 1 {
		t.Errorf("import over a different copy: %+v, %v", res, err)
	}
	res, err = a.ImportOtherAssets([]string{`Tileset\Ours\Sand.blp`}, wow.ImportOptions{ReplaceAssets: true})
	if err != nil || res.Files != 1 || len(res.Imported) != 1 || len(res.Replaced) != 1 {
		t.Fatalf("replace: %+v, %v", res, err)
	}
	// The open client reads the other client's copy at once: the write let go of its archives and
	// opened them again.
	if b, err := a.wow.ReadFile(`Tileset\Ours\Sand.blp`); err != nil || string(b) != "their sand" {
		t.Errorf("the current client reads %q, %v after the replace", b, err)
	}
}

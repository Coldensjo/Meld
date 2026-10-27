package scripts

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileName(t *testing.T) {
	for name, want := range map[string]string{"trees": "trees.lua", "Trees.LUA": "Trees.LUA", " noise ": "noise.lua"} {
		got, err := FileName(name)
		if err != nil || got != want {
			t.Errorf("FileName(%q) = %q, %v; want %q", name, got, err, want)
		}
	}
	for _, bad := range []string{"", "  ", "..", "a/b", `a\b`, "c:x", "../x", "a..b"} {
		if _, err := FileName(bad); err == nil {
			t.Errorf("FileName(%q) took a name that reaches out of the folder", bad)
		}
	}
}

func TestSaveListDelete(t *testing.T) {
	dir := t.TempDir()
	if _, err := Save(dir, "b", "print(2)"); err != nil {
		t.Fatal(err)
	}
	if _, err := Save(dir, "A.lua", "print(1)"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	list, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Name != "A.lua" || list[0].Text != "print(1)" || list[1].Name != "b.lua" {
		t.Fatalf("List = %+v; want A.lua then b.lua, without notes.txt", list)
	}
	if err := Delete(dir, "b"); err != nil {
		t.Fatal(err)
	}
	if list, _ = List(dir); len(list) != 1 {
		t.Fatalf("after Delete, List = %+v", list)
	}
}

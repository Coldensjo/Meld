package scripts

import (
	"image"
	"image/color"
	"image/png"
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

func TestLoadPNG(t *testing.T) {
	dir := t.TempDir()
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	img.Set(2, 1, color.RGBA{R: 200, G: 100, B: 50, A: 255})
	img.Set(0, 0, color.RGBA{R: 0, G: 0, B: 0, A: 0})
	f, err := os.Create(filepath.Join(dir, "dot.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	f.Close()
	file, err := ImagePath(dir, "dot.png")
	if err != nil || file != filepath.Join(dir, "dot.png") {
		t.Fatalf("ImagePath = %q, %v", file, err)
	}
	if abs, _ := ImagePath(dir, file); abs != file {
		t.Errorf("a whole path became %q", abs)
	}
	w, h, pix, err := LoadPNG(file)
	if err != nil {
		t.Fatal(err)
	}
	if w != 3 || h != 2 || len(pix) != 24 {
		t.Fatalf("read %d×%d, %d bytes", w, h, len(pix))
	}
	if got := pix[(1*3+2)*4 : (1*3+2)*4+4]; got[0] != 200 || got[1] != 100 || got[2] != 50 || got[3] != 255 {
		t.Errorf("pixel (2, 1) is %v", got)
	}
	if pix[3] != 0 {
		t.Errorf("pixel (0, 0) has alpha %d", pix[3])
	}
	if _, _, _, err := LoadPNG(filepath.Join(dir, "missing.png")); err == nil {
		t.Error("a missing file loaded")
	}
	os.WriteFile(filepath.Join(dir, "x.png"), []byte("not a png"), 0o644)
	if _, _, _, err := LoadPNG(filepath.Join(dir, "x.png")); err == nil {
		t.Error("a file that is no PNG loaded")
	}
}

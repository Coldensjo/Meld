package blender

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestWorkFor(t *testing.T) {
	a := WorkFor("root", "Tree 01", `m2:World\Tree 01.m2`)
	b := WorkFor("root", "Tree 01", `m2:World\Other\Tree 01.m2`)
	if a.Dir == b.Dir {
		t.Fatalf("two models of one name share %s", a.Dir)
	}
	if !strings.HasPrefix(filepath.Base(a.Dir), "Tree_01-") || filepath.Base(a.GLB) != "Tree_01.glb" || filepath.Base(a.Blend) != "Tree_01.blend" {
		t.Errorf("work %+v", a)
	}
	if c := WorkFor("root", "Tree 01", `M2:WORLD\TREE 01.M2`); c.Dir != a.Dir {
		t.Errorf("the type's case moved the folder: %s, %s", c.Dir, a.Dir)
	}
	if w := WorkFor("root", "..", "x"); filepath.Base(w.GLB) != "model.glb" {
		t.Errorf("a name of dots gave %s", w.GLB)
	}
}

func TestArgsKeepASavedBlend(t *testing.T) {
	w := WorkFor(t.TempDir(), "Crate", "m2:Crate.m2")
	args, fresh := Args(w)
	if !fresh || args[0] != "--python" || args[len(args)-1] != w.Blend {
		t.Fatalf("fresh args %v, %v", args, fresh)
	}
	if err := os.MkdirAll(w.Dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(w.Blend, []byte("BLENDER"), 0o644); err != nil {
		t.Fatal(err)
	}
	args, fresh = Args(w)
	if fresh || len(args) != 1 || args[0] != w.Blend {
		t.Fatalf("args with a saved .blend %v, %v", args, fresh)
	}
}

func TestFind(t *testing.T) {
	dir := t.TempDir()
	if _, err := Find(dir, ""); err == nil {
		t.Fatal("an empty folder gave a Blender")
	}
	exe := filepath.Join(dir, programs()[len(programs())-1])
	if err := os.WriteFile(exe, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	if p, err := Find(dir, ""); err != nil || p != exe {
		t.Fatalf("Find(%s) = %s, %v", dir, p, err)
	}
	if p, err := Find(exe, ""); err != nil || p != exe {
		t.Fatalf("Find(the program) = %s, %v", p, err)
	}
	// The tool chain's layout: a blender folder beside the client's.
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "blender"), 0o755); err != nil {
		t.Fatal(err)
	}
	beside := filepath.Join(root, "blender", programs()[len(programs())-1])
	if err := os.WriteFile(beside, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	if p, err := Find("", filepath.Join(root, "client")); err != nil || p != beside {
		t.Fatalf("Find beside the client = %s, %v", p, err)
	}
}

// TestOpenScript runs open.py in the Blender of BLENDER_DIR, or beside the client or on the PATH as the
// editor finds it (skipped without one, or without a client when BLENDER_DIR is unset), in the
// background, on a small export: it imports the model and saves the .blend.
func TestOpenScript(t *testing.T) {
	dir, client := os.Getenv("BLENDER_DIR"), ""
	if dir == "" {
		client = testclient.DataDir(t)
	}
	exe, err := Find(dir, client)
	if err != nil {
		t.Skip("no Blender:", err)
	}
	// The launcher detaches; the background run needs the program itself.
	exe = Console(exe)
	m := &wow.Mesh{
		Pos:    []float32{0, 0, 0, 1, 0, 0, 0, 1, 0},
		Normal: []float32{0, 0, 1, 0, 0, 1, 0, 0, 1},
		UV:     []float32{0, 0, 1, 0, 0, 1},
		Index:  []uint32{0, 1, 2},
		Groups: []wow.Group{{Count: 3}},
	}
	glb, err := wow.EncodeGLB(m, "Tri", func(string) *wow.Image { return nil })
	if err != nil {
		t.Fatal(err)
	}
	w := WorkFor(t.TempDir(), "Tri", "m2:Tri.m2")
	if err := os.MkdirAll(w.Dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(w.GLB, glb, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(w.Dir, "open.py"), openScript, 0o644); err != nil {
		t.Fatal(err)
	}
	args, _ := Args(w)
	out, err := exec.Command(exe, append([]string{"-b", "--factory-startup"}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	if _, err := os.Stat(w.Blend); err != nil {
		t.Fatalf("no .blend saved: %v\n%s", err, out)
	}
}

func TestWorkForType(t *testing.T) {
	root := t.TempDir()
	// A client model keeps the folder WorkFor gives it.
	const barrel = `m2:World\Azeroth\Barrel01.m2`
	if w, want := WorkForType(root, barrel), WorkFor(root, "Barrel01", barrel); w != want {
		t.Errorf("client model: %+v, want %+v", w, want)
	}
	if w, want := WorkForType(root, `wmo:World\Barn.wmo?set=1`), WorkFor(root, "Barn", `wmo:World\Barn.wmo?set=1`); w != want {
		t.Errorf("building with a set: %+v, want %+v", w, want)
	}
	// A model that came back from Blender finds its work folder again, whatever its case.
	w := WorkFor(root, "Barrel01", barrel)
	if got := w.Client(); got != `World\Meld\`+filepath.Base(w.Dir)+`\Barrel01.m2` {
		t.Fatalf("client path %s", got)
	}
	if back := WorkForType(root, "m2:"+strings.ToLower(w.Client())); !strings.EqualFold(back.Dir, w.Dir) || !strings.EqualFold(back.Blend, w.Blend) {
		t.Errorf("the model's work folder %+v, want %+v", back, w)
	}
	// A path outside a work folder's shape is a client model like any other.
	odd := `m2:World\Meld\a\b\c.m2`
	if got, want := WorkForType(root, odd), WorkFor(root, "c", odd); got != want {
		t.Errorf("nested path: %+v, want %+v", got, want)
	}
}

func TestWorkSourceAndModel(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(t.TempDir(), "My Tower.blend")
	if err := os.WriteFile(file, []byte("BLENDER"), 0o644); err != nil {
		t.Fatal(err)
	}
	w := WorkForFile(root, file)
	if w.Name() != "My_Tower" || w.Model() != "" {
		t.Fatalf("work %+v, model %q", w, w.Model())
	}
	if err := w.SetSource(file); err != nil {
		t.Fatal(err)
	}
	if w.Model() != file {
		t.Errorf("model %q, want the imported file", w.Model())
	}
	// Open in Blender opens the imported .blend itself.
	if args, fresh := Args(w); fresh || len(args) != 1 || args[0] != file {
		t.Errorf("args %v, %v", args, fresh)
	}
	// A .blend saved in the work folder wins.
	if err := os.WriteFile(w.Blend, []byte("BLENDER"), 0o644); err != nil {
		t.Fatal(err)
	}
	if w.Model() != w.Blend {
		t.Errorf("model %q, want the work folder's .blend", w.Model())
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(w.Blend); err != nil {
		t.Fatal(err)
	}
	if w.Model() != "" {
		t.Errorf("a removed source still gives %q", w.Model())
	}
}

// TestExportScript makes a .blend of a two-material cube with open.py, as Open in Blender does, then
// exports it with export.py in a background Blender (ExportGLB) and writes the result as an M2: the
// way a model comes back from Blender (#290). Skipped without a Blender, as TestOpenScript is.
func TestExportScript(t *testing.T) {
	dir, client := os.Getenv("BLENDER_DIR"), ""
	if dir == "" {
		client = testclient.DataDir(t)
	}
	exe, err := Find(dir, client)
	if err != nil {
		t.Skip("no Blender:", err)
	}
	m := &wow.Mesh{}
	// A cube: six faces, two materials (the first textured).
	for f := 0; f < 6; f++ {
		axis, sign := f/2, float32(1-2*(f%2))
		u, v := (axis+1)%3, (axis+2)%3
		base := uint32(len(m.Pos) / 3)
		for _, c := range [4][2]float32{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}} {
			var p, n [3]float32
			p[axis], n[axis] = sign, sign
			p[u], p[v] = c[0]*sign, c[1]
			m.Pos = append(m.Pos, p[:]...)
			m.Normal = append(m.Normal, n[:]...)
			m.UV = append(m.UV, (c[0]+1)/2, (c[1]+1)/2)
		}
		m.Index = append(m.Index, base, base+1, base+2, base, base+2, base+3)
	}
	m.Groups = []wow.Group{{Start: 0, Count: 18, Texture: "red"}, {Start: 18, Count: 18}}
	glb, err := wow.EncodeGLB(m, "Cube", func(p string) *wow.Image {
		if p != "red" {
			return nil
		}
		return &wow.Image{W: 4, H: 4, Pix: []byte(strings.Repeat("\xff\x00\x00\xff", 16))}
	})
	if err != nil {
		t.Fatal(err)
	}
	w := WorkFor(t.TempDir(), "Cube", "m2:Cube.m2")
	if err := os.MkdirAll(w.Dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(w.GLB, glb, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(w.Dir, "open.py"), openScript, 0o644); err != nil {
		t.Fatal(err)
	}
	args, _ := Args(w)
	if out, err := exec.Command(Console(exe), append([]string{"-b", "--factory-startup"}, args...)...).CombinedOutput(); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	back, err := ExportGLB(context.Background(), exe, w.Blend)
	if err != nil {
		t.Fatal(err)
	}
	built, err := wow.BuildM2FromGLB(back, `World\Meld\Cube-x`, "Cube")
	if err != nil {
		t.Fatal(err)
	}
	if built.Triangles != 12 || built.Textures != 2 {
		t.Errorf("%d triangles, %d textures back from Blender", built.Triangles, built.Textures)
	}
	parsed, err := wow.ParseM2(built.Files[0].Data, built.Path)
	if err != nil {
		t.Fatal(err)
	}
	for i, v := range parsed.Pos {
		if v < -1.0001 || v > 1.0001 || (v > -0.9999 && v < 0.9999) {
			t.Fatalf("coordinate %d is %v: the cube moved", i, v)
		}
	}
	// The textured face kept its red texture through Blender.
	var red *wow.Image
	for _, f := range built.Files[1:] {
		img, err := wow.DecodeBLP(f.Data)
		if err != nil {
			t.Fatal(err)
		}
		if img.Pix[0] > 240 && img.Pix[1] < 16 {
			red = img
		}
	}
	if red == nil {
		t.Error("no red texture came back")
	}
	// A broken .blend fails with Blender's words.
	bad := filepath.Join(t.TempDir(), "bad.blend")
	if err := os.WriteFile(bad, []byte("not a blend"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ExportGLB(context.Background(), exe, bad); err == nil {
		t.Error("a broken .blend exported")
	}
}

package blender

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
	if runtime.GOOS == "windows" && strings.EqualFold(filepath.Base(exe), "blender-launcher.exe") {
		exe = filepath.Join(filepath.Dir(exe), "blender.exe")
	}
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

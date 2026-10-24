package play

import (
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestArgs(t *testing.T) {
	got, err := Args("w.world", Spot{X: 1.5, Y: 2, Z: -3.25, Yaw: 0.5, Pitch: -0.1})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"w.world", "--at", "1.500,2.000,-3.250", "--look", "0.500,-0.100"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Args = %v, want %v", got, want)
	}
	if _, err := Args("w.world", Spot{X: math.NaN()}); err == nil {
		t.Error("a NaN position was accepted")
	}
}

func TestFindClient(t *testing.T) {
	root := t.TempDir()
	exe := filepath.Join(root, "target", "debug", exeName())
	os.MkdirAll(filepath.Dir(exe), 0o755)
	os.WriteFile(exe, nil, 0o755)
	editor := filepath.Join(root, "editor", "build", "bin", "Meld.exe")
	got, err := FindClient("", editor)
	if err != nil || got != exe {
		t.Errorf("found %q, %v; want %q", got, err, exe)
	}
	if got, err := FindClient(filepath.Dir(exe), ""); err != nil || got != exe {
		t.Errorf("a configured folder gave %q, %v", got, err)
	}
	if _, err := FindClient(filepath.Join(root, "none"), editor); err == nil {
		t.Error("a missing configured client was accepted")
	}
}

type fake struct {
	name string
	args []string
}

func (f *fake) StartLogged(dir, name, logPath string, env []string, args ...string) error {
	f.name, f.args = name, args
	return nil
}

func TestLaunchNeedsTheWorldFile(t *testing.T) {
	f := &fake{}
	if err := Launch(f, "client", filepath.Join(t.TempDir(), "gone.world"), t.TempDir(), Spot{}); err == nil {
		t.Error("launched on a missing world")
	}
	w := filepath.Join(t.TempDir(), "a.world")
	os.WriteFile(w, nil, 0o644)
	if err := Launch(f, "client", w, t.TempDir(), Spot{}); err != nil || f.args[0] != w {
		t.Errorf("launch: %v, %v", err, f.args)
	}
}

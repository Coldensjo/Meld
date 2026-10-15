package game

import (
	"os"
	"path/filepath"
	"testing"
)

var windowed = Window{Mode: "windowed", Resolution: "1280x720"}

func TestSetConfigWTF(t *testing.T) {
	in := "SET gxWindow \"0\"\r\nSET gxResolution \"1440x1080\"\r\nSET realmList \"127.0.0.1\"\r\n"
	got := setConfigWTF(in, windowed.cvars())
	want := "SET gxWindow \"1\"\r\nSET gxResolution \"1280x720\"\r\nSET realmList \"127.0.0.1\"\r\nSET gxMaximize \"0\"\r\n"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if got := setConfigWTF("", windowed.cvars()); got != "SET gxWindow \"1\"\r\nSET gxMaximize \"0\"\r\nSET gxResolution \"1280x720\"\r\n" {
		t.Fatalf("a new file: %q", got)
	}
}

func TestSetBenillaConfig(t *testing.T) {
	// Benilla's own file: a comment header, then the [cvars] table.
	in := "# benilla local config\n[cvars]\nAmbienceVolume = \"0.6\"\nGXWINDOW = \"0\"\n\n[other]\nx = 1\n"
	got := setBenillaConfig(in, windowed.cvars())
	want := "# benilla local config\n[cvars]\nAmbienceVolume = \"0.6\"\ngxWindow = \"1\"\ngxMaximize = \"0\"\ngxResolution = \"1280x720\"\n\n[other]\nx = 1\n"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if got := setBenillaConfig("", Window{Mode: "fullscreen", Resolution: "1920x1080"}.cvars()); got != "[cvars]\ngxWindow = \"0\"\ngxResolution = \"1920x1080\"\n" {
		t.Fatalf("a new file: %q", got)
	}
	if got := setBenillaConfig("# header\n", windowed.cvars()); got != "# header\n\n[cvars]\ngxWindow = \"1\"\ngxMaximize = \"0\"\ngxResolution = \"1280x720\"\n" {
		t.Fatalf("no table: %q", got)
	}
}

func TestWindowCheck(t *testing.T) {
	for _, w := range []Window{{}, windowed, {Mode: "fullscreen", Resolution: "1920x1080"}} {
		if err := w.Check(); err != nil {
			t.Fatalf("%+v: %v", w, err)
		}
	}
	for _, w := range []Window{{Mode: "maximised", Resolution: "1280x720"}, {Mode: "windowed", Resolution: "big"}, {Mode: "windowed", Resolution: "0x720"}} {
		if w.Check() == nil {
			t.Fatalf("%+v passed", w)
		}
	}
}

// The setting lands in the file of the game the session starts, and the game's own setting writes nothing.
func TestApplyWindow(t *testing.T) {
	dir := t.TempDir()
	s := Session{ClientRoot: filepath.Join(dir, "wow"), Benilla: filepath.Join(dir, "benilla"), Window: windowed}
	if err := s.applyWindow(); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "benilla", "benilla-config", "config.toml"))
	if err != nil || string(b) != "[cvars]\ngxWindow = \"1\"\ngxMaximize = \"0\"\ngxResolution = \"1280x720\"\n" {
		t.Fatalf("benilla config %q %v", b, err)
	}
	s.Benilla = ""
	if err := s.applyWindow(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "wow", "WTF", "Config.wtf")); err != nil {
		t.Fatal("Config.wtf not written:", err)
	}
	s.Window = Window{}
	s.ClientRoot = filepath.Join(dir, "untouched")
	if err := s.applyWindow(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.ClientRoot); !os.IsNotExist(err) {
		t.Fatal("the game's own setting wrote a file")
	}
}

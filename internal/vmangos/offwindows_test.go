package vmangos

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// withHostOS runs the test as if this machine ran goos.
func withHostOS(t *testing.T, goos string) {
	t.Helper()
	old := hostOS
	hostOS = goos
	t.Cleanup(func() { hostOS = old })
}

func TestSupportedOnlyRefusesThisMachinesRunnerOffWindows(t *testing.T) {
	withHostOS(t, "linux")
	if err := Supported(OSRunner{}); !errors.Is(err, ErrNeedsWindows) {
		t.Errorf("OSRunner off Windows: %v, want ErrNeedsWindows", err)
	}
	if err := Supported(nil); !errors.Is(err, ErrNeedsWindows) {
		t.Errorf("nil runner off Windows: %v, want ErrNeedsWindows", err)
	}
	if err := Supported(&fakeRunner{}); err != nil {
		t.Errorf("a fake runner off Windows: %v, want nil", err)
	}
	withHostOS(t, "windows")
	if err := Supported(OSRunner{}); err != nil {
		t.Errorf("OSRunner on Windows: %v, want nil", err)
	}
}

// withProcs points the process table at a folder with one process for each name in comms.
func withProcs(t *testing.T, comms ...string) {
	t.Helper()
	root := t.TempDir()
	for i, c := range comms {
		dir := filepath.Join(root, strconv.Itoa(100+i))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "comm"), []byte(c+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// Not a process: a name that isn't a pid.
	if err := os.MkdirAll(filepath.Join(root, "self"), 0o755); err != nil {
		t.Fatal(err)
	}
	old := procRoot
	procRoot = root
	t.Cleanup(func() { procRoot = old })
}

func TestOSRunnerReadsTheProcessTableOffWindows(t *testing.T) {
	withHostOS(t, "linux")
	withProcs(t, "bash", "benilla", "Wow.exe", "meld-benilla")
	r := OSRunner{}
	for image, want := range map[string]bool{
		"benilla.exe":      true, // a native build: the name without .exe
		"meld-benilla.exe": true,
		"Wow.exe":          true, // under Wine: the whole name
		"mangosd.exe":      false,
		"bash.exe":         true,
		"benill.exe":       false,
	} {
		if got := r.Running(image); got != want {
			t.Errorf("Running(%q) = %v, want %v", image, got, want)
		}
	}
	// comm keeps 15 characters of a longer name.
	withProcs(t, "a-very-long-pro")
	if !r.Running("a-very-long-program.exe") {
		t.Error("a name longer than comm keeps was not found")
	}
	// No process table (macOS): nothing runs.
	procRoot = filepath.Join(t.TempDir(), "missing")
	if r.Running("benilla.exe") {
		t.Error("Running answered yes without a process table")
	}
}

func TestStopCommand(t *testing.T) {
	withHostOS(t, "linux")
	if name, args := StopCommand(OSRunner{}, "benilla.exe", false); name != "pkill" || strings.Join(args, " ") != `^(benilla\.exe|benilla)$` {
		t.Errorf("off Windows: %s %q", name, args)
	}
	if _, args := StopCommand(OSRunner{}, "Wow.exe", true); args[0] != "-KILL" {
		t.Errorf("forced off Windows: %q", args)
	}
	if name, args := StopCommand(&fakeRunner{}, "Wow.exe", true); name != "taskkill" || strings.Join(args, " ") != "/F /IM Wow.exe" {
		t.Errorf("a fake runner: %s %q", name, args)
	}
	withHostOS(t, "windows")
	if name, args := StopCommand(OSRunner{}, "Wow.exe", false); name != "taskkill" || strings.Join(args, " ") != "/IM Wow.exe" {
		t.Errorf("on Windows: %s %q", name, args)
	}
}

func TestUpdateServerMapsSaysItNeedsWindows(t *testing.T) {
	withHostOS(t, "linux")
	var lines []string
	err := UpdateServerMaps(PublishPlan{ServerRoot: t.TempDir()}, t.TempDir(), 0, nil, func(s string) { lines = append(lines, s) })
	if !errors.Is(err, ErrNeedsWindows) {
		t.Fatalf("UpdateServerMaps off Windows: %v, want ErrNeedsWindows", err)
	}
	if len(lines) != 1 {
		t.Errorf("logged %q, want one line", lines)
	}
}

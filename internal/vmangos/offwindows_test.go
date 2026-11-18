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
}

// Without a /proc (macOS) the process list ps prints is read: a program's path, whole.
func TestOSRunnerReadsThePsListWithoutAProcessTable(t *testing.T) {
	withHostOS(t, "darwin")
	old, oldList := procRoot, processList
	procRoot = filepath.Join(t.TempDir(), "missing")
	t.Cleanup(func() { procRoot, processList = old, oldList })
	processList = func() []string {
		return []string{"/sbin/launchd", "  /Volumes/T7/WoWServer/server/bin/worldserver", "/usr/bin/a-very-long-program-name", "Wow.exe", ""}
	}
	r := OSRunner{}
	for image, want := range map[string]bool{
		"worldserver.exe":              true, // a native build: the name without .exe
		"worldserver":                  true,
		"Wow.exe":                      true, // under Wine: the whole name
		"authserver.exe":               false,
		"launch.exe":                   false,
		"a-very-long-program-name.exe": true, // ps keeps the whole name
		"a-very-long-pro.exe":          false,
	} {
		if got := r.Running(image); got != want {
			t.Errorf("Running(%q) = %v, want %v", image, got, want)
		}
	}
	// ps failed: nothing runs.
	processList = func() []string { return nil }
	if r.Running("worldserver.exe") {
		t.Error("Running answered yes without a process list")
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

func TestUpdateServerMapsNeedsNativeExtractorsOffWindows(t *testing.T) {
	withHostOS(t, "linux")
	var lines []string
	err := UpdateServerMaps(PublishPlan{ServerRoot: t.TempDir()}, t.TempDir(), 0, nil, func(s string) { lines = append(lines, s) })
	if !errors.Is(err, ErrNoNativeExtractors) {
		t.Fatalf("UpdateServerMaps off Windows without native extractors: %v, want ErrNoNativeExtractors", err)
	}
	if len(lines) != 1 {
		t.Errorf("logged %q, want one line", lines)
	}

	// With the extractors built for this machine, the guard lets the rebuild through, and this machine's
	// runner gets their native paths (a test's fake runner, and Windows, the .exe ones).
	server := t.TempDir()
	dir := filepath.Join(server, "run", "Extractors")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, n := range append([]string{"MoveMapGenerator"}, nativeExtractors...) {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("tool"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	p := PublishPlan{ServerRoot: server, Run: OSRunner{}}
	if err := mapsSupported(p); err != nil {
		t.Fatalf("with native extractors: %v, want nil", err)
	}
	if got := serverTool(OSRunner{}, dir, "MapExtractor"); got != filepath.Join(dir, "MapExtractor") {
		t.Errorf("this machine's runner off Windows gets %s", got)
	}
	if got := serverTool(&fakeRunner{}, dir, "MapExtractor"); got != filepath.Join(dir, "MapExtractor.exe") {
		t.Errorf("a fake runner gets %s", got)
	}
	withHostOS(t, "windows")
	if got := serverTool(OSRunner{}, dir, "MapExtractor"); got != filepath.Join(dir, "MapExtractor.exe") {
		t.Errorf("on Windows: %s", got)
	}
}

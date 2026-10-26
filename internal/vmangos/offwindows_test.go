package vmangos

import (
	"errors"
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

func TestOSRunnerRunsNothingOffWindows(t *testing.T) {
	withHostOS(t, "linux")
	if (OSRunner{}).Running("mangosd.exe") {
		t.Error("Running answered yes off Windows")
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

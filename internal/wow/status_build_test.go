package wow

import (
	"os"
	"path/filepath"
	"testing"
)

// A client folder that did not open still names its build by its archives, so the start dialog knows a
// 3.3.5a client before (or without) opening it.
func TestStatusBuildOfAClientNotOpen(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{"common.MPQ", "common-2.MPQ", "lichking.MPQ"} {
		if err := os.WriteFile(filepath.Join(data, n), []byte("not an archive"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	c := &Client{}
	_ = c.Open(root) // the archives are not real, so it fails
	s := c.Status()
	if s.Loaded || s.Error == "" {
		t.Fatalf("status = %+v, want a failed open", s)
	}
	if s.Build != 12340 {
		t.Errorf("build = %d, want 12340 from the archive names", s.Build)
	}
	if (&Client{}).Status().Build != 0 {
		t.Error("no client has no build")
	}
}

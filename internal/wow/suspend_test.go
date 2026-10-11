package wow

import (
	"os"
	"testing"
)

// TestSuspendResume releases the archives and loads them again: WOW_DIR=/path/to/client go test ./internal/wow/
func TestSuspendResume(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.x client to run")
	}
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	if !c.Status().Loaded {
		t.Fatal("not loaded after open")
	}
	c.Suspend()
	if c.Status().Loaded {
		t.Fatal("still loaded after suspend")
	}
	if err := c.Resume(); err != nil {
		t.Fatal(err)
	}
	if !c.Status().Loaded {
		t.Fatal("not loaded after resume")
	}
}

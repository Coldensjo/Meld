package vmangos

import (
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestRealRegionHoles checks that Elwynn's mines come through as holes:
// WOW_DIR=/path/to/client go test ./internal/vmangos/ -run RealRegionHoles
func TestRealRegionHoles(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 31, 48, 3)
	if err != nil {
		t.Fatal(err)
	}
	holes := 0
	for _, c := range view.Chunks {
		for _, row := range c.Holes {
			for b := 0; b < 8; b++ {
				if row&(1<<b) != 0 {
					holes++
				}
			}
		}
	}
	if holes == 0 {
		t.Fatal("no holes in Elwynn's tiles 31–33 × 48–50, but the mines there have cave mouths")
	}
	t.Logf("%d hole cells", holes)
}

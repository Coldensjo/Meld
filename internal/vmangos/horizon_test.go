package vmangos

import (
	"os"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/wow"
)

// TestClientRegionHorizon reads the horizon around Northshire's tile (Azeroth 32_48): the tiles around
// it within two tiles, none of them the block's own, each with its full grid of heights. It needs WOW_DIR.
func TestClientRegionHorizon(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	tiles, err := ReadRegionHorizon(dataDir, "Azeroth", 32, 48, 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(tiles) == 0 || len(tiles) > 24 {
		t.Fatalf("%d horizon tiles around one tile within two", len(tiles))
	}
	for _, h := range tiles {
		if h.DX == 0 && h.DY == 0 {
			t.Fatal("the block's own tile is in its horizon")
		}
		if h.DX < -2 || h.DX > 2 || h.DY < -2 || h.DY > 2 || len(h.Heights) != WDLHeights {
			t.Fatalf("tile %+d,%+d with %d heights", h.DX, h.DY, len(h.Heights))
		}
	}
	// The tile east of the block starts where the block ends: its west column of corner heights is the
	// block's east edge at the chunk corners (the WDL keeps them truncated to whole yards), and the tile
	// south of it likewise along the block's south edge.
	region, err := ReadRegion(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	side := tileCells + 1
	for _, h := range tiles {
		for k := 0; k < WDLOuter; k++ {
			var want float32
			var got int
			switch {
			case h.DX == 1 && h.DY == 0:
				want, got = region.Heights[(k*adt.CellsPerChunk)*side+tileCells], h.Heights[k*WDLOuter]
			case h.DX == 0 && h.DY == 1:
				want, got = region.Heights[tileCells*side+k*adt.CellsPerChunk], h.Heights[k]
			default:
				continue
			}
			if d := float32(got) - want; d > 1 || d < -1 {
				t.Fatalf("tile %+d,%+d corner %d: %d against the block's %.1f", h.DX, h.DY, k, got, want)
			}
		}
	}
	t.Logf("%d horizon tiles", len(tiles))
}

package vmangos

import (
	"testing"

	"Meld/internal/adt"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestClientRegionHorizon reads the horizon around Northshire's tile (Azeroth 32_48): the tiles around
// it within two tiles, none of them the block's own, each with its full grid of heights. It needs WOW_DIR.
func TestClientRegionHorizon(t *testing.T) {
	dir := testclient.DataDir(t)
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

// TestClientWorldHorizon reads Azeroth's whole horizon for the world view: every tile once, at its own
// coordinates, Northshire's (32_48) among them with the same heights the region's horizon has for it.
func TestClientWorldHorizon(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	all, err := ReadWorldHorizon(dataDir, "Azeroth")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[int]bool{}
	var north *HorizonTile
	for i, h := range all {
		k := h.DX + MapTiles*h.DY
		if seen[k] || h.DX < 0 || h.DY < 0 || h.DX >= MapTiles || h.DY >= MapTiles || len(h.Heights) != WDLHeights {
			t.Fatalf("tile %d,%d twice, off the map or with %d heights", h.DX, h.DY, len(h.Heights))
		}
		seen[k] = true
		if h.DX == 32 && h.DY == 48 {
			north = &all[i]
		}
	}
	if len(all) < 100 || north == nil {
		t.Fatalf("%d tiles, Northshire's found: %v", len(all), north != nil)
	}
	around, err := ReadRegionHorizon(dataDir, "Azeroth", 31, 48, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range around {
		if h.DX == 1 && h.DY == 0 {
			for i := range h.Heights {
				if h.Heights[i] != north.Heights[i] {
					t.Fatalf("height %d: %d in the world's horizon, %d in the region's", i, north.Heights[i], h.Heights[i])
				}
			}
			return
		}
	}
	t.Fatal("Northshire's tile not in the horizon of the tile west of it")
}

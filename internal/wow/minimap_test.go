package wow

import (
	"bytes"
	"image/png"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

// TestRealMinimap stitches Azeroth's overview from the client and checks Goldshire's tile is drawn:
// WOW_DIR=/path/to/client go test ./internal/wow/ -run RealMinimap
func TestRealMinimap(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	tiles, err := c.MinimapTiles("Azeroth")
	if err != nil {
		t.Fatal(err)
	}
	has := false
	for _, tile := range tiles {
		if tile.X == 32 && tile.Y == 48 {
			has = true
		}
	}
	if !has {
		t.Fatalf("tile 32,48 missing from %d Azeroth tiles", len(tiles))
	}
	b, err := c.MapOverview("Azeroth")
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != MapTilesPerSide*OverviewTilePx {
		t.Fatalf("overview is %v", img.Bounds())
	}
	_, _, _, a := img.At(32*OverviewTilePx+16, 48*OverviewTilePx+16).RGBA()
	if a == 0 {
		t.Fatal("Goldshire's tile is transparent")
	}
	_, _, _, a = img.At(0, 0).RGBA()
	if a != 0 {
		t.Fatal("tile 0,0 should be empty")
	}
	t.Logf("%d tiles, %d bytes of PNG", len(tiles), len(b))
}

func TestOverviewPathChangesWithTheArchives(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LocalAppData", t.TempDir())
	c := &Client{dir: "client", set: &mpq.Set{}, stamps: "patch-3.mpq|100|1\n"}
	before, err := c.overviewPath("Azeroth")
	if err != nil {
		t.Fatal(err)
	}
	again, _ := c.overviewPath("Azeroth")
	if before != again {
		t.Fatal("same archives, different path")
	}
	c.stamps = "patch-3.mpq|200|2\n"
	after, _ := c.overviewPath("Azeroth")
	if before == after {
		t.Fatal("a rewritten patch kept the cached overview")
	}
}

package wow

import (
	"encoding/binary"
	"testing"

	"Meld/internal/testclient"
)

// wdtChunk is a chunk as the client stores it: the id reversed, then its size.
func wdtChunk(id string, body []byte) []byte {
	out := []byte{id[3], id[2], id[1], id[0], 0, 0, 0, 0}
	binary.LittleEndian.PutUint32(out[4:], uint32(len(body)))
	return append(out, body...)
}

func TestWDTTiles(t *testing.T) {
	main := make([]byte, MapTilesPerSide*MapTilesPerSide*8)
	main[(30+64*31)*8] = 1
	main[(2+64*0)*8] = 1
	main[(5+64*5)*8] = 2 // another flag, not "has an ADT"
	wdt := append(wdtChunk("MVER", []byte{18, 0, 0, 0}), wdtChunk("MPHD", make([]byte, 32))...)
	wdt = append(wdt, wdtChunk("MAIN", main)...)
	got := WDTTiles(wdt)
	if len(got) != 2 || got[0] != [2]int{2, 0} || got[1] != [2]int{30, 31} {
		t.Fatalf("tiles %v", got)
	}
	if got := WDTTiles(wdt[:20]); len(got) != 0 {
		t.Fatalf("a truncated WDT gave %v", got)
	}
}

// TestRealInstanceTiles lists an instance's tiles from its WDT, and a WMO-only one's as none:
// WOW_DIR=/path/to/client go test ./internal/wow/ -run RealInstanceTiles
func TestRealInstanceTiles(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	if tiles, err := c.MapTiles("DeadminesInstance"); err != nil || len(tiles) == 0 {
		t.Fatalf("Deadmines: %d tiles, %v", len(tiles), err)
	}
	if tiles, err := c.MapTiles("MoltenCore"); err != nil || len(tiles) != 0 {
		t.Fatalf("Molten Core, one building: %d tiles, %v", len(tiles), err)
	}
	// Ahn'Qiraj has tiles without a minimap image, which the overview draws from their heights.
	tiles, _ := c.MapTiles("AhnQiraj")
	bare := 0
	for _, tile := range tiles {
		if tile.File == "" {
			bare++
		}
	}
	if bare == 0 {
		t.Fatal("expected Ahn'Qiraj tiles without a minimap image")
	}
	if _, err := c.MapOverview("AhnQiraj"); err != nil {
		t.Fatal(err)
	}
}

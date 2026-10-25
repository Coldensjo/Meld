package vmangos

import (
	"bytes"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestWDLRoundTrip builds a WDL from two tiles' heights and reads it back.
func TestWDLRoundTrip(t *testing.T) {
	slope := make([]float32, LatticeSize*LatticeSize)
	for i := range slope {
		slope[i] = float32(i%LatticeSize)*0.5 - 3.7
	}
	tiles := map[int]*WDLTile{6*MapTiles + 5: WDLTileOf(slope, LatticeSize), 63*MapTiles + 63: WDLTileOf(flatTile(-40000), LatticeSize)}
	got, err := ParseWDL(BuildWDL(tiles))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || *got[6*MapTiles+5] != *tiles[6*MapTiles+5] {
		t.Fatalf("tiles read back = %d, want the two written", len(got))
	}
	s := got[6*MapTiles+5]
	// The corners truncate toward zero: column 8 is 0.3 yards up, column 16 is 4.3.
	if s[0] != -3 || s[1] != 0 || s[2] != 4 || s[WDLOuter] != -3 {
		t.Fatalf("outer heights %v", s[:3])
	}
	// The inner height is the chunk's mean: columns 0 to 8 average to 4 cells up, 2 yards, so -1.7.
	if s[WDLOuter*WDLOuter] != -1 {
		t.Fatalf("inner height %d, want -1", s[WDLOuter*WDLOuter])
	}
	if got[63*MapTiles+63][0] != -32768 {
		t.Fatalf("a height below the int16 range is %d, want clamped", got[63*MapTiles+63][0])
	}
}

// TestClientWDL checks the WDL against the client's Azeroth.wdl: written back unchanged it is the
// same file, and the outer heights sampled from a tile are the client's own. It needs WOW_DIR.
func TestClientWDL(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := set.ReadFile(wdlPath("Azeroth"))
	set.Close()
	if err != nil {
		t.Fatal(err)
	}
	tiles, err := ParseWDL(b)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(BuildWDL(tiles), b) {
		t.Fatal("Azeroth.wdl written back differs from the client's")
	}
	// Westfall, Elwynn's mines and Ironforge's mountains.
	for _, xy := range [][2]int{{31, 49}, {35, 30}, {40, 40}} {
		tile, _, err := ReadTile(dataDir, "Azeroth", xy[0], xy[1])
		if err != nil {
			t.Fatal(err)
		}
		got, want := WDLTileOf(tile.Heights, LatticeSize), tiles[xy[1]*MapTiles+xy[0]]
		if want == nil {
			t.Fatalf("tile %v has no horizon in the client", xy)
		}
		for i := 0; i < WDLOuter*WDLOuter; i++ {
			if got[i] != want[i] {
				t.Fatalf("tile %v outer height %d is %d, the client's %d", xy, i, got[i], want[i])
			}
		}
		off := 0
		for i := WDLOuter * WDLOuter; i < WDLHeights; i++ {
			off += max(int(got[i]-want[i]), int(want[i]-got[i]))
		}
		if mean := float64(off) / (WDLInner * WDLInner); mean > 3 {
			t.Fatalf("tile %v inner heights are %.1f yards off the client's on average", xy, mean)
		}
	}
}

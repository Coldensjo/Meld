package vmangos

import (
	"encoding/base64"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestClientRegionShadows reads Northshire's tile (Azeroth 32_48): its chunks carry baked shadows, the
// map is 1024 texels a side, and some but not all of it is in shadow. It needs WOW_DIR.
func TestClientRegionShadows(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	s, err := ReadRegionShadows(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	if s.Side != 1024 || s.Bits == "" {
		t.Fatalf("side %d, %d bits", s.Side, len(s.Bits))
	}
	bits, err := base64.StdEncoding.DecodeString(s.Bits)
	if err != nil || len(bits) != 1024*1024/8 {
		t.Fatalf("%d bytes: %v", len(bits), err)
	}
	set := 0
	for _, b := range bits {
		for ; b != 0; b &= b - 1 {
			set++
		}
	}
	if set == 0 || set > len(bits)*8*3/4 {
		t.Fatalf("%d of %d texels in shadow", set, len(bits)*8)
	}
	t.Logf("%d of %d texels in shadow", set, len(bits)*8)
}

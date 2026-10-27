package vmangos

import (
	"math"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// A chunk of two layers whose top layer is half on: each shows half; three layers split what the
// top one leaves.
func TestChunkCover(t *testing.T) {
	half := make([]byte, adt.AlphaSize*adt.AlphaSize)
	full := make([]byte, adt.AlphaSize*adt.AlphaSize)
	for i := range half {
		if i%adt.AlphaSize < adt.AlphaSize/2 {
			half[i] = 255
		}
		full[i] = 128
	}
	cover := map[string]float64{}
	addChunkCover(cover, adt.TexChunk{Layers: []adt.TexLayer{{Texture: "a"}, {Texture: "b"}}, Alpha: [][]byte{half}}, nil)
	addChunkCover(cover, adt.TexChunk{Layers: []adt.TexLayer{{Texture: "a"}, {Texture: "c"}, {Texture: "b"}}, Alpha: [][]byte{full, full}}, nil)
	// A third chunk all under water adds nothing.
	wet := [cellCount]bool{}
	for i := range wet {
		wet[i] = true
	}
	addChunkCover(cover, adt.TexChunk{Layers: []adt.TexLayer{{Texture: "d"}}}, &wet)
	got := sharesOf(cover)
	if len(got) != 3 || got[0].Path != "b" {
		t.Fatalf("shares = %+v", got)
	}
	// Chunk 1: a 0.5, b 0.5. Chunk 2: b ~0.502, c ~0.502*0.498, a the rest. Out of 2 chunks.
	want := map[string]float64{"a": (0.5 + 0.498*0.498) / 2, "b": (0.5 + 0.502) / 2, "c": 0.502 * 0.498 / 2}
	for _, u := range got {
		if math.Abs(u.Share-want[u.Path]) > 0.002 {
			t.Errorf("%s = %.4f, want %.4f", u.Path, u.Share, want[u.Path])
		}
	}
}

func TestZoneAreas(t *testing.T) {
	areas := []Area{{ID: 10}, {ID: 11, Parent: 10}, {ID: 12, Parent: 11}, {ID: 20}, {ID: 21, Parent: 20}}
	in := zoneAreas(areas, 10)
	if !in[10] || !in[11] || !in[12] || in[20] || in[21] || in[0] {
		t.Fatalf("zoneAreas(10) = %v", in)
	}
}

// TestRealZoneTextures reads Tanaris's and Duskwood's ground textures: each is mostly its own
// tileset folder's (with the seabed left out: Tanaris's coast is Wetlands dirt), and Tanaris's
// largest is a sand.
// WOW_DIR=/path/to/client go test ./internal/vmangos/ -run RealZoneTextures -v
func TestRealZoneTextures(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	zones, err := LoadZones(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	dirs := map[uint32]string{0: "Azeroth", 1: "Kalimdor"}
	for _, name := range []string{"Tanaris", "Duskwood"} {
		var z *Zone
		for i := range zones {
			if zones[i].Name == name {
				z = &zones[i]
			}
		}
		if z == nil {
			t.Fatalf("%s not among the zones", name)
		}
		uses, err := ReadZoneTextures(dataDir, dirs[z.MapID], *z)
		if err != nil {
			t.Fatal(err)
		}
		if len(uses) < 4 {
			t.Fatalf("%s uses %d textures: %+v", name, len(uses), uses)
		}
		own, sum := 0.0, 0.0
		for i, u := range uses {
			sum += u.Share
			if strings.Contains(strings.ToLower(u.Path), strings.ToLower(name)) {
				own += u.Share
			}
			if i < 12 {
				t.Logf("%s %5.1f%% %s", name, u.Share*100, u.Path)
			}
		}
		if math.Abs(sum-1) > 1e-6 || own < 0.6 {
			t.Fatalf("%s: shares sum to %.3f, its own folder's %.2f", name, sum, own)
		}
		if name == "Tanaris" && !strings.Contains(strings.ToLower(uses[0].Path), "sand") {
			t.Fatalf("Tanaris's largest texture is %s, want a sand", uses[0].Path)
		}
	}
}

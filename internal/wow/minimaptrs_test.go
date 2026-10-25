package wow

import (
	"bytes"
	"testing"

	"Meld/internal/testclient"
)

// Benilla's minimap_translate.rs case: headers skipped, rows found in any case.
func TestParseMinimapIndex(t *testing.T) {
	raw := []byte("dir: AhnQiraj\r\nAhnQiraj\\map27_46.blp\t1fcd95d6d410e7557d6b62081c5e87b5.blp\r\n" +
		"dir: Azeroth\r\nAzeroth\\map32_48.blp\tea283abc0bf9637c3fad5e840a65b38b.blp\r\n")
	x := ParseMinimapIndex(raw)
	if x.Len() != 2 {
		t.Fatalf("%d rows", x.Len())
	}
	for _, dir := range []string{"Azeroth", "azeroth"} {
		if f, ok := x.Tile(dir, 32, 48); !ok || f != "ea283abc0bf9637c3fad5e840a65b38b.blp" {
			t.Fatalf("%s 32_48: %q %v", dir, f, ok)
		}
	}
	if _, ok := x.Tile("Azeroth", 99, 99); ok {
		t.Fatal("a tile that isn't there")
	}
	if !bytes.Equal(x.Bytes(), raw) {
		t.Fatalf("written back:\n%q", x.Bytes())
	}
	// LF lines read too.
	if y := ParseMinimapIndex(bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))); y.Len() != 2 {
		t.Fatalf("LF: %d rows", y.Len())
	}
}

// A new tile goes under its folder's header (a new folder gets one, and so do the folders above it)
// where the client's order puts it: names compare upper-cased, so "_" sorts after letters.
func TestMinimapIndexSetKeepsTheClientsOrder(t *testing.T) {
	x := ParseMinimapIndex([]byte("dir: Azeroth\r\nAzeroth\\map32_48.blp\ta.blp\r\n"))
	x.Set(`Azeroth\map32_47.blp`, "b.blp")
	x.Set(`MyMap\map1_1.blp`, "c.blp")
	x.Set(`WMO\Hut\Hut_000_00_00.blp`, "d.blp")
	x.Set(`WMO\Hut\HutTwo_000_00_00.blp`, "e.blp")
	x.Set(`azeroth\MAP32_48.blp`, "f.blp") // replaces, keeping one row
	want := "dir: Azeroth\r\nAzeroth\\map32_47.blp\tb.blp\r\nazeroth\\MAP32_48.blp\tf.blp\r\n" +
		"dir: MyMap\r\nMyMap\\map1_1.blp\tc.blp\r\n" +
		"dir: WMO\r\ndir: WMO\\Hut\r\nWMO\\Hut\\HutTwo_000_00_00.blp\te.blp\r\nWMO\\Hut\\Hut_000_00_00.blp\td.blp\r\n"
	if got := string(x.Bytes()); got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

// TestClientMinimapIndex reads the client's md5translate.trs as Benilla's test does (8401 rows,
// Azeroth 32_48, the Ironforge interior), writes it back byte for byte, and checks that a stored
// tile's name is the md5 of its bytes. It needs WOW_DIR.
func TestClientMinimapIndex(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	raw, err := c.read(MinimapIndexPath)
	if err != nil {
		t.Fatal(err)
	}
	x := ParseMinimapIndex(raw)
	if x.Len() != 8401 {
		t.Fatalf("%d rows, want 8401", x.Len())
	}
	f, ok := x.Tile("Azeroth", 32, 48)
	if !ok || f != "ea283abc0bf9637c3fad5e840a65b38b.blp" {
		t.Fatalf("Azeroth 32_48: %q", f)
	}
	if _, ok := x.Lookup(`wmo\KhazModan\Cities\Ironforge\ironforge_001_00_00.blp`); !ok {
		t.Fatal("the Ironforge interior tile")
	}
	if out := x.Bytes(); !bytes.Equal(out, raw) {
		i := 0
		for i < len(out) && i < len(raw) && out[i] == raw[i] {
			i++
		}
		lo := max(0, i-80)
		t.Fatalf("the index doesn't write back as the client's (%d vs %d bytes), from byte %d:\n%q\nwant\n%q", len(out), len(raw), i, out[lo:min(len(out), i+80)], raw[lo:min(len(raw), i+80)])
	}
	blp, err := c.read(`textures\Minimap\` + f)
	if err != nil {
		t.Fatal(err)
	}
	if MinimapFileName(blp) != f {
		t.Fatalf("md5 of the tile: %s, stored as %s", MinimapFileName(blp), f)
	}
}

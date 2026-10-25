package vmangos

import (
	"encoding/binary"
	"fmt"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// worldOverlayDBC is a WorldMapOverlay.dbc of the given rows (by their WorldMapArea row) as the client
// lays it out.
func worldOverlayDBC(rows map[uint32][]WorldMapOverlay) []byte {
	strs := []byte{0}
	var recs []byte
	n := 0
	for _, area := range []uint32{30, 41} {
		for _, o := range rows[area] {
			f := make([]uint32, worldOverlayFields)
			f[0], f[ovMapArea] = o.ID, area
			copy(f[ovArea0:ovArea0+worldOverlayAreas], o.Areas)
			f[ovName] = uint32(len(strs))
			strs = append(append(strs, o.Name...), 0)
			f[ovWidth], f[ovHeight], f[ovOffsetX], f[ovOffsetY] = o.Width, o.Height, o.OffsetX, o.OffsetY
			f[ovHitTop], f[ovHitLeft], f[ovHitBottom], f[ovHitRight] = o.HitTop, o.HitLeft, o.HitBottom, o.HitRight
			for _, v := range f {
				recs = binary.LittleEndian.AppendUint32(recs, v)
			}
			n++
		}
	}
	out := []byte("WDBC")
	for _, v := range []uint32{uint32(n), worldOverlayFields, worldOverlayFields * 4, uint32(len(strs))} {
		out = binary.LittleEndian.AppendUint32(out, v)
	}
	return append(append(out, recs...), strs...)
}

// keepOverlays is the overlays without their pictures: written so, the client's art is kept.
func keepOverlays(list []WorldMapOverlay) []WorldMapOverlay {
	out := make([]WorldMapOverlay, len(list))
	for i, o := range list {
		o.Pixels = nil
		out[i] = o
	}
	return out
}

func TestSetWorldMapOverlaysReplacesTheZones(t *testing.T) {
	dbc := worldOverlayDBC(map[uint32][]WorldMapOverlay{
		30: {
			{ID: 122, Areas: []uint32{87}, Name: "GOLDSHIRE", Width: 240, Height: 220, OffsetX: 250, OffsetY: 270, HitTop: 400, HitLeft: 370, HitBottom: 465, HitRight: 455},
			{ID: 125, Areas: []uint32{9}, Name: "NORTHSHIREVALLEY", Width: 256, Height: 256, OffsetX: 381, OffsetY: 147},
		},
		41: {{ID: 140, Areas: []uint32{186}, Name: "DOLANAAR", Width: 190, Height: 128, OffsetX: 462, OffsetY: 323}},
	})
	got, err := WorldMapOverlays(dbc, 30)
	if err != nil || len(got) != 2 || got[0].Name != "GOLDSHIRE" || got[0].HitTop != 400 || got[0].HitRight != 455 || len(got[0].Areas) != 1 {
		t.Fatalf("read %+v, %v", got, err)
	}
	// Northshire is redrawn wider, Goldshire dropped, and a new piece added.
	ns := got[1]
	ns.Width, ns.Pixels = 300, make([]byte, 300*256*4)
	out, written, err := SetWorldMapOverlays(dbc, 30, []WorldMapOverlay{ns, {Areas: []uint32{5000, 5001}, Name: "MYVALE", Width: 20, Height: 30, OffsetX: 980, OffsetY: 600, Pixels: make([]byte, 20*30*4)}})
	if err != nil {
		t.Fatal(err)
	}
	if written[0].ID != 125 || written[1].ID != 141 || written[0].Pixels != nil {
		t.Fatalf("written %+v", written)
	}
	back, _ := WorldMapOverlays(out, 30)
	if len(back) != 2 || back[0].ID != 125 || back[0].Width != 300 || back[1].Name != "MYVALE" || len(back[1].Areas) != 2 || back[1].Areas[1] != 5001 {
		t.Fatalf("read back %+v", back)
	}
	if other, _ := WorldMapOverlays(out, 41); len(other) != 1 || other[0].Name != "DOLANAAR" || other[0].OffsetY != 323 {
		t.Fatalf("another zone's rows changed: %+v", other)
	}
	if tb, _ := worldOverlayTable(out); tb.records != 3 {
		t.Fatalf("%d records, want 3", tb.records)
	}

	for name, o := range map[string]WorldMapOverlay{
		"no areas":            {Name: "A", Width: 1, Height: 1, Pixels: []byte{0, 0, 0, 0}},
		"five areas":          {Areas: []uint32{1, 2, 3, 4, 5}, Name: "A", Width: 1, Height: 1, Pixels: []byte{0, 0, 0, 0}},
		"a path in the name":  {Areas: []uint32{1}, Name: `A\B`, Width: 1, Height: 1, Pixels: []byte{0, 0, 0, 0}},
		"past the picture":    {Areas: []uint32{1}, Name: "A", Width: 30, Height: 1, OffsetX: 990, Pixels: make([]byte, 30*4)},
		"no picture, not own": {ID: 140, Areas: []uint32{1}, Name: "A", Width: 1, Height: 1},
	} {
		if _, _, err := SetWorldMapOverlays(dbc, 30, []WorldMapOverlay{o}); err == nil {
			t.Errorf("%s was taken", name)
		}
	}
	if _, _, err := SetWorldMapOverlays(dbc, 30, []WorldMapOverlay{ns, ns}); err == nil {
		t.Error("two overlays of one name were taken")
	}
}

// TestWorldOverlayFilesCutAsTheClient cuts a 306x233 piece as RidgepointTower is: two tiles, 256x256
// and 64x256, numbered 1 and 2; a 256x341 one as ForestsEdge: 256x256 above 256x128; and a small one
// into a single 16x16.
func TestWorldOverlayFilesCutAsTheClient(t *testing.T) {
	for _, c := range []struct {
		w, h  int
		sizes [][2]int
	}{{306, 233, [][2]int{{256, 256}, {64, 256}}}, {256, 341, [][2]int{{256, 256}, {256, 128}}}, {10, 10, [][2]int{{16, 16}}}} {
		pix := make([]byte, c.w*c.h*4)
		for i := range pix {
			pix[i] = byte(i / 4 % 251)
		}
		files, err := worldOverlayFiles("Elwynn", WorldMapOverlay{Name: "PIECE", Width: uint32(c.w), Height: uint32(c.h), Pixels: pix})
		if err != nil {
			t.Fatal(err)
		}
		if len(files) != len(c.sizes) {
			t.Fatalf("%dx%d: %d tiles", c.w, c.h, len(files))
		}
		for i, f := range files {
			if want := fmt.Sprintf("Interface\\WorldMap\\Elwynn\\PIECE%d.blp", i+1); f.Name != want {
				t.Fatalf("tile %d is %s, want %s", i, f.Name, want)
			}
			img, err := wow.DecodeBLP(f.Data)
			if err != nil || img.W != c.sizes[i][0] || img.H != c.sizes[i][1] {
				t.Fatalf("%dx%d tile %d: %v, %dx%d", c.w, c.h, i, err, img.W, img.H)
			}
		}
	}
}

// TestWorldMapOverlaysFromClient reads Elwynn's twelve overlays from the client (WOW_DIR): Goldshire
// as the table has it, its picture whole with soft alpha, and writes it back through WorldMapFiles: its
// tiles, the rest kept, the table's rows as they were.
func TestWorldMapOverlaysFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadWorldMap(dataDir, 0, 12)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Overlays) != 12 {
		t.Fatalf("Elwynn has %d overlays, want 12", len(view.Overlays))
	}
	var gold *WorldMapOverlay
	for i, o := range view.Overlays {
		if o.Pixels == nil {
			t.Fatalf("overlay %s has no picture", o.Name)
		}
		if o.Name == "GOLDSHIRE" {
			gold = &view.Overlays[i]
		}
	}
	if gold == nil || gold.ID != 122 || gold.Width != 240 || gold.Height != 220 || gold.OffsetX != 250 || gold.OffsetY != 270 || gold.HitTop != 400 || gold.HitRight != 455 || len(gold.Areas) != 1 || gold.Areas[0] != 87 {
		t.Fatalf("Goldshire reads %+v", gold)
	}
	opaque := 0
	for i := 3; i < len(gold.Pixels); i += 4 {
		if gold.Pixels[i] > 200 {
			opaque++
		}
	}
	if opaque < 1000 || opaque > 240*220-1000 {
		t.Fatalf("Goldshire has %d opaque pixels of %d: its alpha is not soft-edged", opaque, 240*220)
	}
	specs := keepOverlays(view.Overlays)
	for i := range specs {
		if specs[i].ID == gold.ID {
			specs[i].Pixels = gold.Pixels
		}
	}
	files, _, written, err := WorldMapFiles(dataDir, WorldMapSpec{Row: *view.Row, Pixels: view.Pixels, Overlays: specs})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 15 || !strings.HasSuffix(files[0].Name, `Elwynn\GOLDSHIRE1.blp`) {
		t.Fatalf("%d files, the first %s", len(files), files[0].Name)
	}
	back, _ := WorldMapOverlays(files[14].Data, 30)
	if len(back) != 12 || len(written) != 12 {
		t.Fatalf("%d rows back, %d written", len(back), len(written))
	}
	for i := range back {
		w := view.Overlays[i]
		if back[i].ID != w.ID || back[i].Name != w.Name || back[i].OffsetX != w.OffsetX || back[i].HitBottom != w.HitBottom || len(back[i].Areas) != len(w.Areas) {
			t.Fatalf("row %d reads back %+v, was %+v", i, back[i], w)
		}
	}
	img, err := wow.DecodeBLP(files[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	var diff, n float64
	for y := 0; y < 220; y++ {
		for x := 0; x < 240; x++ {
			for c := 0; c < 4; c++ {
				if c < 3 && gold.Pixels[(y*240+x)*4+3] < 16 {
					continue // a hidden pixel's colour doesn't matter
				}
				d := float64(img.Pix[(y*256+x)*4+c]) - float64(gold.Pixels[(y*240+x)*4+c])
				diff += max(d, -d)
				n++
			}
		}
	}
	if diff/n > 6 {
		t.Fatalf("Goldshire written back differs by %.1f a channel", diff/n)
	}
	t.Logf("Goldshire written back differs by %.2f a channel", diff/n)
}

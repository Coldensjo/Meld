package vmangos

import (
	"encoding/binary"
	"math"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// worldMapDBC is a WorldMapArea.dbc of the given rows, as the client lays it out.
func worldMapDBC(rows ...WorldMapRow) []byte {
	strs := []byte{0}
	var recs []byte
	for _, r := range rows {
		off := uint32(len(strs))
		strs = append(append(strs, r.Name...), 0)
		for _, v := range []uint32{r.ID, r.MapID, r.AreaID, off, math.Float32bits(r.Left), math.Float32bits(r.Right), math.Float32bits(r.Top), math.Float32bits(r.Bottom)} {
			recs = binary.LittleEndian.AppendUint32(recs, v)
		}
	}
	out := []byte("WDBC")
	for _, v := range []uint32{uint32(len(rows)), 8, 32, uint32(len(strs))} {
		out = binary.LittleEndian.AppendUint32(out, v)
	}
	return append(append(out, recs...), strs...)
}

func TestSetWorldMapRowAddsAndReplaces(t *testing.T) {
	dbc := worldMapDBC(
		WorldMapRow{ID: 14, MapID: 0, AreaID: 0, Name: "Azeroth", Left: 16000, Right: -19200, Top: 7466, Bottom: -16000},
		WorldMapRow{ID: 30, MapID: 0, AreaID: 12, Name: "Elwynn", Left: 1535.4, Right: -1935.4, Top: -7939.6, Bottom: -10254.2},
	)
	out, row, err := SetWorldMapRow(dbc, WorldMapRow{MapID: 1900, AreaID: 5000, Name: "MyZone", Left: 300, Right: -300, Top: 200, Bottom: -200})
	if err != nil {
		t.Fatal(err)
	}
	if row.ID != 31 {
		t.Fatalf("a new row got ID %d, want the next free 31", row.ID)
	}
	got, err := FindWorldMapRow(out, 1900, 5000)
	if err != nil || got == nil || *got != row {
		t.Fatalf("read back %+v, %v; wrote %+v", got, err, row)
	}
	if e, _ := FindWorldMapRow(out, 0, 12); e == nil || e.Name != "Elwynn" || e.ID != 30 {
		t.Fatalf("the other rows changed: %+v", e)
	}

	// The same map and area again replaces the row and keeps its ID.
	out, row, err = SetWorldMapRow(out, WorldMapRow{MapID: 1900, AreaID: 5000, Name: "MyZone2", Left: 600, Right: -600, Top: 400, Bottom: -400})
	if err != nil || row.ID != 31 {
		t.Fatalf("replaced row %+v, %v", row, err)
	}
	tb, _ := worldMapTable(out)
	if tb.records != 3 {
		t.Fatalf("%d records after a replace, want 3", tb.records)
	}
	if got, _ := FindWorldMapRow(out, 1900, 5000); got.Name != "MyZone2" || got.Left != 600 {
		t.Fatalf("replaced row reads %+v", got)
	}
}

func TestSetWorldMapRowRefusesBadRows(t *testing.T) {
	dbc := worldMapDBC(WorldMapRow{ID: 1, Name: "A", Left: 1, Top: 1})
	for name, r := range map[string]WorldMapRow{
		"a path in the name": {Name: `My\Zone`, Left: 1, Right: 0, Top: 1, Bottom: 0},
		"no name":            {Left: 1, Right: 0, Top: 1, Bottom: 0},
		"an empty extent":    {Name: "Z", Left: 0, Right: 1, Top: 1, Bottom: 0},
	} {
		if _, _, err := SetWorldMapRow(dbc, r); err == nil {
			t.Errorf("%s was taken", name)
		}
	}
}

// TestWorldMapFromClient reads Elwynn's world map from the client and writes it again: the row is the
// client's (WorldMapArea row 30, area 12), the picture is whole, the twelve tiles come out as BLPs of
// the client's kind (DXT1, 256x256) whose pixels are close to the picture, and the table keeps the row
// and its ID. It needs WOW_DIR set.
func TestWorldMapFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadWorldMap(dataDir, 0, 12)
	if err != nil {
		t.Fatal(err)
	}
	if view.Row == nil || view.Row.ID != 30 || view.Row.Name != "Elwynn" || math.Abs(float64(view.Row.Left)-1535.4) > 0.1 {
		t.Fatalf("Elwynn's row: %+v", view.Row)
	}
	if len(view.Pixels) != WorldMapWidth*WorldMapHeight*4 {
		t.Fatalf("Elwynn's picture is %d bytes", len(view.Pixels))
	}
	files, row, _, err := WorldMapFiles(dataDir, WorldMapSpec{Row: *view.Row, Pixels: view.Pixels, Overlays: keepOverlays(view.Overlays)})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 14 || row.ID != 30 {
		t.Fatalf("%d files, row %+v", len(files), row)
	}
	if files[0].Name != `Interface\WorldMap\Elwynn\Elwynn1.blp` || !strings.HasSuffix(files[11].Name, `Elwynn12.blp`) {
		t.Fatalf("tile names %s .. %s", files[0].Name, files[11].Name)
	}
	blp := files[5].Data // the second row's second tile: x 256..511, y 256..511
	if blp[8] != 2 || binary.LittleEndian.Uint32(blp[12:]) != 256 {
		t.Fatalf("tile 6 is compression %d, %d wide", blp[8], binary.LittleEndian.Uint32(blp[12:]))
	}
	img, err := wow.DecodeBLP(blp)
	if err != nil {
		t.Fatal(err)
	}
	var diff, n float64
	for y := 0; y < 256; y++ {
		for x := 0; x < 256; x++ {
			for c := 0; c < 3; c++ {
				diff += math.Abs(float64(img.Pix[(y*256+x)*4+c]) - float64(view.Pixels[((256+y)*WorldMapWidth+256+x)*4+c]))
				n++
			}
		}
	}
	if diff/n > 6 {
		t.Fatalf("tile 6 differs from the picture by %.1f a channel", diff/n)
	}
	got, err := FindWorldMapRow(files[12].Data, 0, 12)
	if err != nil || got == nil || *got != *view.Row {
		t.Fatalf("the table's Elwynn row is %+v (%v), want %+v", got, err, view.Row)
	}
	t.Logf("tile 6 differs by %.2f a channel", diff/n)
}

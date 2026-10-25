package vmangos

import (
	"encoding/binary"
	"math"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// loadingScreenDBC is a LoadingScreens.dbc of the given rows, as the client lays it out.
func loadingScreenDBC(rows ...LoadingScreen) []byte {
	strs := []byte{0}
	var recs []byte
	for _, r := range rows {
		name := uint32(len(strs))
		strs = append(append(strs, r.Name...), 0)
		path := uint32(len(strs))
		strs = append(append(strs, r.Path...), 0)
		for _, v := range []uint32{r.ID, name, path} {
			recs = binary.LittleEndian.AppendUint32(recs, v)
		}
	}
	out := []byte("WDBC")
	for _, v := range []uint32{uint32(len(rows)), 3, 12, uint32(len(strs))} {
		out = binary.LittleEndian.AppendUint32(out, v)
	}
	return append(append(out, recs...), strs...)
}

func TestSetLoadingScreenRowAddsAndReplaces(t *testing.T) {
	kalimdor := LoadingScreen{ID: 3, Name: "Kalimdor", Path: `Interface\Glues\LoadingScreens\LoadScreenKalimdor.blp`}
	cave := LoadingScreen{ID: 21, Name: "InstanceCave", Path: `Interface\Glues\LoadingScreens\LoadScreenCave.blp`}
	dbc := loadingScreenDBC(kalimdor, cave)
	path := LoadingScreenPicture("MyMap")
	out, row, err := SetLoadingScreenRow(dbc, "MyMap", path)
	if err != nil {
		t.Fatal(err)
	}
	if row.ID != 22 || row.Path != path {
		t.Fatalf("a new row is %+v, want ID 22, the next free", row)
	}
	got, err := ReadLoadingScreens(out)
	if err != nil || len(got) != 3 || got[0] != kalimdor || got[1] != cave || got[2] != row {
		t.Fatalf("read back %+v, %v", got, err)
	}

	// The same picture again keeps its row and ID, under the new name.
	out, again, err := SetLoadingScreenRow(out, "MyMap2", path)
	if err != nil || again.ID != 22 {
		t.Fatalf("again: %+v, %v", again, err)
	}
	if got, _ = ReadLoadingScreens(out); len(got) != 3 || got[2].Name != "MyMap2" || got[2].Path != path || got[1] != cave {
		t.Fatalf("after a replace: %+v", got)
	}
	if _, _, err := SetLoadingScreenRow(dbc, "", path); err == nil {
		t.Error("a row with no name was taken")
	}
}

func TestLoadingScreenNameKeepsToTheFolder(t *testing.T) {
	for dir, want := range map[string]string{"MyMap": "MyMap", "Stratholme Raid": "StratholmeRaid", "Zul'gurub": "Zulgurub", "'' ": "Map1901"} {
		if got := LoadingScreenName(1901, dir); got != want {
			t.Errorf("%q names %q, want %q", dir, got, want)
		}
	}
	if got := LoadingScreenPicture("Cave"); got != `Interface\Glues\LoadingScreens\LoadScreenMeldCave.blp` {
		t.Errorf("Cave's picture is %s", got)
	}
}

func TestSetMapLoadingScreen(t *testing.T) {
	dbc := testMapDBC(t)
	out, ok, err := SetMapLoadingScreen(dbc, 0, 250)
	if err != nil || !ok {
		t.Fatalf("%v, %v", ok, err)
	}
	tb, _ := parseDBC(out)
	r, _ := tb.row(0)
	if tb.u32(r, 38) != 250 {
		t.Fatalf("field 38 is %d", tb.u32(r, 38))
	}
	if _, ok, err := SetMapLoadingScreen(dbc, 4242, 250); ok || err != nil {
		t.Fatalf("a map with no row: %v, %v", ok, err)
	}
}

// testMapDBC is a 42-field Map.dbc with one row, map 0, whose loading screen is 4.
func testMapDBC(t *testing.T) []byte {
	t.Helper()
	rec := make([]byte, 42*4)
	binary.LittleEndian.PutUint32(rec[38*4:], 4)
	out := []byte("WDBC")
	for _, v := range []uint32{1, 42, 42 * 4, 1} {
		out = binary.LittleEndian.AppendUint32(out, v)
	}
	return append(append(out, rec...), 0)
}

// TestLoadingScreenFromClient reads the Deadmines' loading screen from the client and writes it again
// as the Deadmines map's own: the BLP is of the client's kind (DXT1 512x512, no mips, the size of the
// client's own without mips) and close to the picture, LoadingScreens.dbc keeps the client's rows and
// adds one, and Map.dbc's Deadmines row points at it. It needs WOW_DIR set.
func TestLoadingScreenFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	before, err := LoadLoadingScreens(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	var src string
	for _, s := range before {
		if s.ID == 142 {
			src = s.Path
		}
	}
	if src != `Interface\Glues\LoadingScreens\LoadScreenDeadmines.blp` {
		t.Fatalf("row 142 shows %q", src)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := set.ReadFile(src)
	set.Close()
	if err != nil {
		t.Fatal(err)
	}
	img, err := wow.DecodeBLP(raw)
	if err != nil || img.W != LoadingScreenSize || img.H != LoadingScreenSize {
		t.Fatalf("the Deadmines' picture: %v", err)
	}
	files, row, err := LoadingScreenFiles(dataDir, LoadingScreenSpec{MapID: 36, Dir: "DeadminesInstance", Pixels: img.Pix})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 3 || files[0].Name != `Interface\Glues\LoadingScreens\LoadScreenMeldDeadminesInstance.blp` {
		t.Fatalf("%d files, the first %s", len(files), files[0].Name)
	}
	blp := files[0].Data
	if blp[8] != 2 || blp[9] != 0 || blp[11] != 0 || len(blp) != 132244 {
		t.Fatalf("the BLP is compression %d, alpha %d, mips %d, %d bytes", blp[8], blp[9], blp[11], len(blp))
	}
	out, err := wow.DecodeBLP(blp)
	if err != nil {
		t.Fatal(err)
	}
	var diff float64
	for i := range out.Pix {
		if i%4 != 3 {
			diff += math.Abs(float64(out.Pix[i]) - float64(img.Pix[i]))
		}
	}
	if diff /= float64(len(out.Pix)) * 3 / 4; diff > 6 {
		t.Fatalf("the BLP differs from the picture by %.1f a channel", diff)
	}
	after, err := ReadLoadingScreens(files[1].Data)
	if err != nil || len(after) != len(before)+1 || after[len(after)-1] != row {
		t.Fatalf("%d rows after (%v), %d before; row %+v", len(after), err, len(before), row)
	}
	for i := range before {
		if after[i] != before[i] {
			t.Fatalf("row %d changed: %+v, was %+v", i, after[i], before[i])
		}
	}
	mt, err := parseDBC(files[2].Data)
	if err != nil {
		t.Fatal(err)
	}
	r, _ := mt.row(36)
	if mt.u32(r, 38) != row.ID {
		t.Fatalf("Map.dbc's Deadmines row shows screen %d, want %d", mt.u32(r, 38), row.ID)
	}
	t.Logf("row %+v, the BLP within %.2f a channel", row, diff)
}

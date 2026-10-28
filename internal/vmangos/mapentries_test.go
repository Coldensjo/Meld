package vmangos

import (
	"encoding/binary"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestReadMapEntriesSynthetic reads two rows of five fields (ID, folder, type, flags, name) out of
// a string block that both point into.
func TestReadMapEntriesSynthetic(t *testing.T) {
	// Offset 0 is the empty string, so the folder and name start at 1 and 6.
	strs := "\x00Mine\x00Mine name\x00"
	var dbc []byte
	dbc = append(dbc, "WDBC"...)
	dbc = binary.LittleEndian.AppendUint32(dbc, 2)
	dbc = binary.LittleEndian.AppendUint32(dbc, 5)
	dbc = binary.LittleEndian.AppendUint32(dbc, 20)
	dbc = binary.LittleEndian.AppendUint32(dbc, uint32(len(strs)))
	for _, row := range [][5]uint32{{900, 1, MapDungeon, 0, 6}, {1, 0, MapContinent, 0, 0}} {
		for _, f := range row {
			dbc = binary.LittleEndian.AppendUint32(dbc, f)
		}
	}
	dbc = append(dbc, strs...)
	entries, err := ReadMapEntries(dbc)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].ID != 1 || entries[1].ID != 900 {
		t.Fatalf("entries = %+v, want IDs 1 and 900 in order", entries)
	}
	if e := entries[1]; e.Dir != "Mine" || e.Type != MapDungeon || e.Name != "Mine name" {
		t.Fatalf("row 900 = %+v", e)
	}
}

// TestClientMapRowInfo reads the client's Map.dbc once: a few maps of each type read as the client
// names them, a row added at a free ID reads back, a map added with a raid's info shows the client's
// reader the type and the name, with the zone and loading screen where Molten Core's sit, and
// Azeroth's WDT builds a tile table. It needs WOW_DIR.
func TestClientMapRowInfo(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	dbc, err := set.ReadFile(`DBFilesClient\Map.dbc`)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := ReadMapEntries(dbc)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[uint32]MapEntry{}
	for _, e := range entries {
		byID[e.ID] = e
	}
	for _, want := range []MapEntry{
		{ID: 0, Dir: "Azeroth", Type: MapContinent, Name: "Eastern Kingdoms"},
		{ID: 1, Dir: "Kalimdor", Type: MapContinent, Name: "Kalimdor"},
		{ID: 389, Dir: "OrgrimmarInstance", Type: MapDungeon, Name: "Ragefire Chasm"},
		{ID: 409, Dir: "MoltenCore", Type: MapRaid, Name: "Molten Core"},
		{ID: 30, Dir: "PVPZone01", Type: MapBattleground, Name: "Alterac Valley"},
	} {
		if got := byID[want.ID]; got != want {
			t.Errorf("map %d = %+v, want %+v", want.ID, got, want)
		}
	}

	// A free ID: the client may already list the maps the editor has exported.
	free := uint32(0)
	for _, id := range MapRowIDs(dbc) {
		if id >= free {
			free = id + 1
		}
	}
	withFree, err := AddMapRow(dbc, free, "MeldTest")
	if err != nil {
		t.Fatal(err)
	}
	if MapRowDir(withFree, free) != "MeldTest" || len(MapRowIDs(withFree)) != len(MapRowIDs(dbc))+1 {
		t.Fatal("the new row did not read back")
	}
	wdt, err := set.ReadFile(`World\Maps\Azeroth\Azeroth.wdt`)
	if err != nil {
		t.Fatal(err)
	}
	built, err := BuildWDT(wdt, func(x, y int) bool { return x == 32 && y == 48 })
	if err != nil {
		t.Fatal(err)
	}
	if len(built) == 0 {
		t.Fatal("empty WDT")
	}

	added, err := AddMapRow(dbc, 1901, "MeldRaid")
	if err != nil {
		t.Fatal(err)
	}
	out, err := SetMapRowInfo(added, 1901, MapInfo{Type: 2, Name: "Meld's Raid", AreaID: 2717, LoadingScreen: 192})
	if err != nil {
		t.Fatal(err)
	}
	raid, err := ReadMapEntries(out)
	if err != nil {
		t.Fatal(err)
	}
	var got *MapEntry
	for i := range raid {
		if raid[i].ID == 1901 {
			got = &raid[i]
		}
	}
	if got == nil || got.Dir != "MeldRaid" || got.Type != 2 || got.Name != "Meld's Raid" {
		t.Fatalf("the new map reads back as %+v", got)
	}
	tb, _ := parseDBC(out)
	r, _ := tb.row(1901)
	if tb.u32(r, 19) != 2717 || tb.u32(r, 38) != 192 || tb.u32(r, 3) != 0 {
		t.Fatalf("zone %d, loading screen %d, pvp %d", tb.u32(r, 19), tb.u32(r, 38), tb.u32(r, 3))
	}
	if _, err := SetMapRowInfo(out, 1901, MapInfo{Type: 7}); err == nil {
		t.Fatal("map type 7 was accepted")
	}
}

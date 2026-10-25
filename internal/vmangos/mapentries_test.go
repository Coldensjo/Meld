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

// TestRealMapEntries reads the client's Map.dbc and checks a few maps of each type:
// WOW_DIR=/path/to/client go test ./internal/vmangos/ -run RealMapEntries
func TestRealMapEntries(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := LoadMapEntries(dataDir)
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
}

// TestClientMapRowInfo adds a map to the client's Map.dbc and gives it a raid's info: the client's
// reader sees the type and the name, and the zone and loading screen sit where Molten Core's do. It
// needs WOW_DIR.
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
	dbc, err := set.ReadFile(`DBFilesClient\Map.dbc`)
	set.Close()
	if err != nil {
		t.Fatal(err)
	}
	added, err := AddMapRow(dbc, 1901, "MeldRaid")
	if err != nil {
		t.Fatal(err)
	}
	out, err := SetMapRowInfo(added, 1901, MapInfo{Type: 2, Name: "Meld's Raid", AreaID: 2717, LoadingScreen: 192})
	if err != nil {
		t.Fatal(err)
	}
	entries, err := ReadMapEntries(out)
	if err != nil {
		t.Fatal(err)
	}
	var got *MapEntry
	for i := range entries {
		if entries[i].ID == 1901 {
			got = &entries[i]
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

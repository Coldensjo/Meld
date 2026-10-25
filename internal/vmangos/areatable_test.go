package vmangos

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// areaDBC builds a 1.12 AreaTable with the given rows (ID, map, parent, bit, name).
func areaDBC(rows ...[4]uint32) []byte {
	strs := []byte{0}
	recs := make([]byte, 0, len(rows)*areaFields*4)
	for _, r := range rows {
		rec := make([]byte, areaFields*4)
		binary.LittleEndian.PutUint32(rec[areaID*4:], r[0])
		binary.LittleEndian.PutUint32(rec[areaMap*4:], r[1])
		binary.LittleEndian.PutUint32(rec[areaParent*4:], r[2])
		binary.LittleEndian.PutUint32(rec[areaBit*4:], r[3])
		binary.LittleEndian.PutUint32(rec[areaFlags*4:], 64)
		binary.LittleEndian.PutUint32(rec[areaNameMask*4:], 0xff)
		binary.LittleEndian.PutUint32(rec[areaName*4:], uint32(len(strs)))
		strs = append(strs, []byte("Area"+string(rune('A'+len(recs)/(areaFields*4))))...)
		strs = append(strs, 0)
		recs = append(recs, rec...)
	}
	out := []byte("WDBC")
	for _, v := range []int{len(rows), areaFields, areaFields * 4, len(strs)} {
		out = binary.LittleEndian.AppendUint32(out, uint32(v))
	}
	return append(append(out, recs...), strs...)
}

func TestAreaRowsEditAndAdd(t *testing.T) {
	dbc := areaDBC([4]uint32{12, 0, 0, 5}, [4]uint32{87, 0, 12, 6}, [4]uint32{14, 1, 0, 7})
	rows, err := ReadAreaRows(dbc, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].ID != 12 || rows[1].Parent != 12 {
		t.Fatalf("map 0's rows = %+v, want the zone then its subzone", rows)
	}
	// Written back unchanged, the table is the same bytes.
	if same, err := SetAreaRows(dbc, rows); err != nil || !bytes.Equal(same, dbc) {
		t.Fatalf("an unchanged write differs (%v)", err)
	}
	sub, err := NewAreaRow(dbc, 0, 12)
	if err != nil {
		t.Fatal(err)
	}
	if sub.ID != 88 || sub.AreaBit != 8 || sub.Parent != 12 {
		t.Fatalf("new subzone = %+v, want ID 88 and bit 8", sub)
	}
	sub.Name = "Meld's Hollow"
	sub.Level = 12
	rows[0].Name = "Elwynn"
	out, err := SetAreaRows(dbc, []AreaRow{rows[0], sub})
	if err != nil {
		t.Fatal(err)
	}
	got, err := ReadAreaRows(out, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Name != "Elwynn" {
		t.Fatalf("rows after the write = %+v", got)
	}
	var added AreaRow
	for _, r := range got {
		if r.ID == 88 {
			added = r
		}
	}
	if added.Name != "Meld's Hollow" || added.Level != 12 || added.AreaBit != 8 {
		t.Fatalf("the added subzone reads back as %+v", added)
	}
	// The other map's row, and every area's list entry, still read.
	if all, err := ReadAreas(out); err != nil || len(all) != 4 {
		t.Fatalf("ReadAreas after the write: %d areas, %v", len(all), err)
	}
	if kal, _ := ReadAreaRows(out, 1); len(kal) != 1 || kal[0].Name != "AreaC" {
		t.Fatalf("map 1's row = %+v", kal)
	}
	// An exploration bit another area has is refused, and so is an empty name.
	clash := sub
	clash.ID = 99
	if _, err := SetAreaRows(out, []AreaRow{clash}); err == nil {
		t.Fatal("a second area with bit 8 was accepted")
	}
	clash.AreaBit, clash.Name = 50, " "
	if _, err := SetAreaRows(out, []AreaRow{clash}); err == nil {
		t.Fatal("an area with no name was accepted")
	}
	sql := AreaSQL([]AreaRow{added})
	if !strings.Contains(sql, `REPLACE INTO area_template`) || !strings.Contains(sql, `'Meld\'s Hollow'`) {
		t.Fatalf("SQL = %s", sql)
	}
}

// TestClientAreaTable writes the client's own Azeroth areas back unchanged (the same file), then
// renames Goldshire and adds a subzone, and checks only those rows changed. It needs WOW_DIR.
func TestClientAreaTable(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	dbc, err := set.ReadFile(`DBFilesClient\AreaTable.dbc`)
	set.Close()
	if err != nil {
		t.Fatal(err)
	}
	rows, err := ReadAreaRows(dbc, 0)
	if err != nil {
		t.Fatal(err)
	}
	same, err := SetAreaRows(dbc, rows)
	if err != nil || !bytes.Equal(same, dbc) {
		t.Fatalf("the client's Azeroth areas written back differ (%v)", err)
	}
	var gold AreaRow
	for _, r := range rows {
		if r.ID == 87 {
			gold = r
		}
	}
	if gold.Name != "Goldshire" || gold.Parent != 12 {
		t.Fatalf("area 87 = %+v, want Goldshire in Elwynn", gold)
	}
	gold.Name = "Goldshire Village"
	sub, err := NewAreaRow(dbc, 0, 12)
	if err != nil {
		t.Fatal(err)
	}
	out, err := SetAreaRows(dbc, []AreaRow{gold, sub})
	if err != nil {
		t.Fatal(err)
	}
	before, _ := parseDBC(dbc)
	after, err := parseDBC(out)
	if err != nil {
		t.Fatal(err)
	}
	if after.records != before.records+1 {
		t.Fatalf("%d rows after adding one to %d", after.records, before.records)
	}
	for r := 0; r < before.records; r++ {
		if before.u32(r, 0) == 87 {
			continue
		}
		a := dbc[20+r*before.recSize : 20+(r+1)*before.recSize]
		b := out[20+r*after.recSize : 20+(r+1)*after.recSize]
		if !bytes.Equal(a, b) {
			t.Fatalf("row %d (area %d) changed", r, before.u32(r, 0))
		}
	}
	areas, err := ReadAreas(out)
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, a := range areas {
		if (a.ID == 87 && a.Name == "Goldshire Village") || (a.ID == sub.ID && a.Parent == 12) {
			found++
		}
	}
	if found != 2 {
		t.Fatal("the renamed and the added area don't read back through ReadAreas")
	}
}

package vmangos

import (
	"encoding/binary"
	"strings"
	"testing"
)

func TestAddMapRowSynthetic(t *testing.T) {
	// Two records of two fields (ID, directory), with the string "Old".
	var dbc []byte
	dbc = append(dbc, "WDBC"...)
	dbc = binary.LittleEndian.AppendUint32(dbc, 2)
	dbc = binary.LittleEndian.AppendUint32(dbc, 2)
	dbc = binary.LittleEndian.AppendUint32(dbc, 8)
	dbc = binary.LittleEndian.AppendUint32(dbc, 4)
	dbc = binary.LittleEndian.AppendUint32(dbc, 0)
	dbc = binary.LittleEndian.AppendUint32(dbc, 0)
	dbc = binary.LittleEndian.AppendUint32(dbc, 1)
	dbc = binary.LittleEndian.AppendUint32(dbc, 0)
	dbc = append(dbc, "Old\x00"...)
	out, err := AddMapRow(dbc, 900, "Mine")
	if err != nil {
		t.Fatal(err)
	}
	ids := MapRowIDs(out)
	if len(ids) != 3 || ids[2] != 900 {
		t.Fatalf("ids = %v", ids)
	}
	if got := MapRowDir(out, 900); got != "Mine" {
		t.Fatalf("dir = %q", got)
	}
	if got := MapRowDir(out, 0); got != "Old" {
		t.Fatalf("existing row dir = %q", got)
	}
	if _, err := AddMapRow(out, 900, "Again"); err == nil {
		t.Fatal("a second row with the same ID was added")
	}
}

// TestBuildWDTLayout checks the chunk order the map extractor reads: MVER, MPHD, MAIN, MWMO.
func TestBuildWDTLayout(t *testing.T) {
	template := []byte{}
	template = append(template, "REVM"...)
	template = binary.LittleEndian.AppendUint32(template, 4)
	template = binary.LittleEndian.AppendUint32(template, 18)
	template = append(template, "DHPM"...)
	template = binary.LittleEndian.AppendUint32(template, 32)
	template = append(template, make([]byte, 32)...)
	out, err := BuildWDT(template, func(x, y int) bool { return x == 1 && y == 2 })
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for o := 0; o+8 <= len(out); {
		ids = append(ids, string([]byte{out[o+3], out[o+2], out[o+1], out[o]}))
		o += 8 + int(binary.LittleEndian.Uint32(out[o+4:]))
	}
	if strings.Join(ids, ",") != "MVER,MPHD,MAIN,MWMO" {
		t.Fatalf("chunks = %v", ids)
	}
	main := out[len(out)-8-64*64*8 : len(out)-8]
	if binary.LittleEndian.Uint32(main[(2*64+1)*8:]) != 1 || binary.LittleEndian.Uint32(main[0:]) != 0 {
		t.Fatal("the tile table does not mark tile 1,2 alone")
	}
}

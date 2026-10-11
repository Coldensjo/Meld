package vmangos

import (
	"encoding/binary"
	"os"
	"testing"

	"WorldEditor/internal/mpq"
	"WorldEditor/internal/wow"
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

// TestRealMapTables adds a row to the client's Map.dbc and builds a tile table:
// WOW_DIR=/path/to/client go test ./internal/vmangos/
func TestRealMapTables(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.12 client to run")
	}
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
	out, err := AddMapRow(dbc, 1900, "WorldEditorTest")
	if err != nil {
		t.Fatal(err)
	}
	if MapRowDir(out, 1900) != "WorldEditorTest" || len(MapRowIDs(out)) != len(MapRowIDs(dbc))+1 {
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
}

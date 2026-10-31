package main

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// TestImportAreasWritesAsSave checks the Zones dialog's Import (#942) end to end on a made-up client:
// the script's zone goes into the client's AreaTable.dbc in Meld's patch and, with a server folder,
// its area_template row and weather into the world database (a stand-in, App.runSQL), as Save writes
// them; a script the plan refuses writes nothing.
func TestImportAreasWritesAsSave(t *testing.T) {
	cache := t.TempDir()
	t.Setenv("LocalAppData", cache)
	t.Setenv("XDG_CACHE_HOME", cache)
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	// A 1.12 AreaTable.dbc of one zone: 12 "Elwynn" on map 0, exploration bit 5.
	rec := make([]byte, 25*4)
	for f, v := range map[int]uint32{0: 12, 3: 5, 4: 64, 11: 1} {
		binary.LittleEndian.PutUint32(rec[f*4:], v)
	}
	strs := append([]byte{0}, "Elwynn\x00"...)
	dbc := []byte("WDBC")
	for _, v := range []int{1, 25, 100, len(strs)} {
		dbc = binary.LittleEndian.AppendUint32(dbc, uint32(v))
	}
	dbc = append(append(dbc, rec...), strs...)
	if err := os.WriteFile(filepath.Join(data, "dbc.MPQ"), mpq.Write([]mpq.File{{Name: vmangos.AreaTablePath, Data: dbc}}), 0o644); err != nil {
		t.Fatal(err)
	}
	var scripts []string
	a := &App{gameUp: func() bool { return false }, runSQL: func(_, script string) error {
		scripts = append(scripts, script)
		return nil
	}}
	a.cfg.WowPath = root
	a.cfg.VmangosPath = t.TempDir()
	a.pendingWatch.Store(true)

	zone := vmangos.AreaRow{ID: 600, MapID: 451, AreaBit: 5, Flags: 64, Level: 20, Name: "Meld Vale", Music: 3}
	script, err := vmangos.AreaScript([]vmangos.AreaRow{zone}, []vmangos.ZoneWeather{{Zone: 600, Rain: [4]int{30, 0, 0, 0}}}, true, "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "zones.sql")
	if err := os.WriteFile(path, []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}
	plan, err := a.PlanAreaImport(path)
	if err != nil {
		t.Fatal(err)
	}
	// Bit 5 is Elwynn's, so the zone takes the next free one.
	if len(plan.Areas) != 1 || plan.Areas[0].FromBit != 5 || plan.Areas[0].Bit != 6 || !plan.Server || plan.Weather != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	if len(scripts) != 0 {
		t.Fatalf("the plan ran SQL: %q", scripts)
	}
	res, err := a.ImportAreas(path)
	if err != nil {
		t.Fatal(err)
	}
	if res.Areas != 1 || res.Weather != 1 || !res.Server || res.Patch == "" || len(res.Maps) != 1 || res.Maps[0] != 451 {
		t.Fatalf("result = %+v", res)
	}
	if len(scripts) != 1 || !strings.Contains(scripts[0], "VALUES (600, 451, 0, 6, 64, 20, 'Meld Vale'") || !strings.Contains(scripts[0], "REPLACE INTO game_weather (zone,") {
		t.Fatalf("SQL = %q, want the zone's area_template row with bit 6 and its weather", scripts)
	}
	written, err := vmangos.LoadAreaTable(data)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := vmangos.ReadAreaRows(written, 451)
	if err != nil || len(rows) != 1 || rows[0].Name != "Meld Vale" || rows[0].AreaBit != 6 || rows[0].Music != 3 {
		t.Fatalf("the client's map 451 = %+v (%v)", rows, err)
	}

	// A nameless area is refused by the plan, and nothing is written.
	bad := filepath.Join(t.TempDir(), "bad.sql")
	if err := os.WriteFile(bad, []byte(strings.Replace(script, `"Meld Vale"`, `" "`, 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ImportAreas(bad); err == nil || !strings.Contains(err.Error(), "not imported") || len(scripts) != 1 {
		t.Fatalf("a refused script: %v (%d scripts)", err, len(scripts))
	}
}

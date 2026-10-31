package main

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"
)

// TestImportAreaTriggersWritesAsSave checks the Portals dialog's Import (#943) end to end on a made-up
// client without a server folder: the script's triggers go into the client's AreaTrigger.dbc in
// Meld's patch as Save writes them, no SQL runs, and a script the plan refuses writes nothing. (With a
// server folder the plan reads the server's names and teleports through vmangos.TriggerExtras, which
// the vmangos tests cover.)
func TestImportAreaTriggersWritesAsSave(t *testing.T) {
	cache := t.TempDir()
	t.Setenv("LocalAppData", cache)
	t.Setenv("XDG_CACHE_HOME", cache)
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	// A 1.12 AreaTrigger.dbc of one trigger: 45 on map 0, a 5 yd sphere.
	dbc := []byte("WDBC")
	for _, v := range []uint32{1, 10, 40, 1} {
		dbc = binary.LittleEndian.AppendUint32(dbc, v)
	}
	for _, v := range []uint32{45, 0, 0, 0, 0, math.Float32bits(5), 0, 0, 0, 0} {
		dbc = binary.LittleEndian.AppendUint32(dbc, v)
	}
	dbc = append(dbc, 0)
	if err := os.WriteFile(filepath.Join(data, "dbc.MPQ"), mpq.Write([]mpq.File{{Name: vmangos.AreaTriggerPath, Data: dbc}}), 0o644); err != nil {
		t.Fatal(err)
	}
	var scripts []string
	a := &App{gameUp: func() bool { return false }, runSQL: func(_, script string) error {
		scripts = append(scripts, script)
		return nil
	}}
	a.cfg.WowPath = root
	a.pendingWatch.Store(true)

	rows := []vmangos.AreaTrigger{
		{ID: 45, MapID: 0, X: 1, Y: 2, Z: 3, Radius: 8, Name: "Bigger"},
		{ID: 4300, MapID: 451, X: -10, Y: 20, Z: 5, BoxX: 4, BoxY: 2, BoxZ: 3, BoxYaw: 0.5, Name: "Meld gate", Teleport: &vmangos.TriggerTeleport{Map: 0, X: 1, Y: 1, Z: 1}},
	}
	script, err := vmangos.TriggerScript(rows, true, "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "portals.sql")
	if err := os.WriteFile(path, []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}
	plan, err := a.PlanAreaTriggerImport(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Triggers) != 2 || !plan.Triggers[0].Exists || plan.Triggers[1].Exists || plan.Server || plan.Teleports != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	res, err := a.ImportAreaTriggers(path)
	if err != nil {
		t.Fatal(err)
	}
	if res.Triggers != 2 || res.Server || res.Patch == "" || len(res.Maps) != 2 {
		t.Fatalf("result = %+v", res)
	}
	if len(scripts) != 0 {
		t.Fatalf("SQL ran without a server folder: %q", scripts)
	}
	written, err := vmangos.LoadAreaTriggerTable(data)
	if err != nil {
		t.Fatal(err)
	}
	on0, err := vmangos.ReadAreaTriggers(written, 0)
	if err != nil || len(on0) != 1 || on0[0].Radius != 8 {
		t.Fatalf("the client's map 0 = %+v (%v)", on0, err)
	}
	on451, err := vmangos.ReadAreaTriggers(written, 451)
	if err != nil || len(on451) != 1 || on451[0].BoxYaw != 0.5 || on451[0].X != -10 {
		t.Fatalf("the client's map 451 = %+v (%v)", on451, err)
	}

	// A trigger without a size is refused by the plan, and nothing is written.
	bad := filepath.Join(t.TempDir(), "bad.sql")
	if err := os.WriteFile(bad, []byte(strings.Replace(script, "-- meld trigger 45 0 1 2 3 8 ", "-- meld trigger 46 0 1 2 3 0 ", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	before, _ := vmangos.LoadAreaTriggerTable(data)
	if _, err := a.ImportAreaTriggers(bad); err == nil || !strings.Contains(err.Error(), "not imported") {
		t.Fatalf("a refused script: %v", err)
	}
	if after, _ := vmangos.LoadAreaTriggerTable(data); string(after) != string(before) {
		t.Fatal("a refused script changed AreaTrigger.dbc")
	}
}

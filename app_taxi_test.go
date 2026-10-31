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

// taxiDBC is a 1.12 DBC table of fields 32-bit fields with the records recs and the string block strs.
func taxiDBC(fields int, recs [][]uint32, strs []byte) []byte {
	b := []byte("WDBC")
	for _, v := range []uint32{uint32(len(recs)), uint32(fields), uint32(fields * 4), uint32(len(strs))} {
		b = binary.LittleEndian.AppendUint32(b, v)
	}
	for _, r := range recs {
		for _, v := range r {
			b = binary.LittleEndian.AppendUint32(b, v)
		}
	}
	return append(b, strs...)
}

// TestImportTaxiWritesAsSave checks the Flight Paths window's Import (#944) end to end on a made-up
// client without a server folder: the script's stops and routes go into the client's three taxi
// tables in Meld's patch as Save writes them, no SQL runs, and a script the plan refuses writes
// nothing.
func TestImportTaxiWritesAsSave(t *testing.T) {
	cache := t.TempDir()
	t.Setenv("LocalAppData", cache)
	t.Setenv("XDG_CACHE_HOME", cache)
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	// One stop, 1 "Old" on map 0, and no routes.
	stop := make([]uint32, 16)
	stop[0], stop[5], stop[15] = 1, 1, 541
	files := []mpq.File{
		{Name: vmangos.TaxiNodesPath, Data: taxiDBC(16, [][]uint32{stop}, []byte("\x00Old\x00"))},
		{Name: vmangos.TaxiPathPath, Data: taxiDBC(4, nil, []byte{0})},
		{Name: vmangos.TaxiPathNodePath, Data: taxiDBC(9, nil, []byte{0})},
	}
	if err := os.WriteFile(filepath.Join(data, "dbc.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	var scripts []string
	a := &App{gameUp: func() bool { return false }, runSQL: func(_, script string) error {
		scripts = append(scripts, script)
		return nil
	}}
	a.cfg.WowPath = root
	a.pendingWatch.Store(true)

	nodes := []vmangos.TaxiNode{{ID: 1, Name: "Goldshire", X: 1, AllianceMount: 541}, {ID: 2, Name: "Lakeshire", X: 100, HordeMount: 2224, AllianceMount: 541}}
	routes := []vmangos.TaxiRoute{{ID: 7, From: 1, To: 2, Cost: 90, Points: []vmangos.TaxiPoint{{X: 1, Z: 50}, {X: 50, Z: 80}, {X: 100, Z: 50, Flags: 2}}}}
	script, err := vmangos.TaxiScript(nodes, routes, "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "flights.sql")
	if err := os.WriteFile(path, []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}
	plan, err := a.PlanTaxiImport(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Stops) != 2 || !plan.Stops[0].Exists || plan.Stops[0].Was != "Old" || plan.Stops[1].Exists || len(plan.Routes) != 1 || plan.Server || len(plan.Refused) > 0 {
		t.Fatalf("plan = %+v", plan)
	}
	res, err := a.ImportTaxi(path)
	if err != nil {
		t.Fatal(err)
	}
	if res.Stops != 2 || res.Routes != 1 || res.Server || res.Patch == "" {
		t.Fatalf("result = %+v", res)
	}
	if len(scripts) != 0 {
		t.Fatalf("SQL ran without a server folder: %q", scripts)
	}
	tt, err := vmangos.LoadTaxiTables(data)
	if err != nil {
		t.Fatal(err)
	}
	net, err := vmangos.ReadTaxiNetwork(tt, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(net.Nodes) != 2 || net.Nodes[0].Name != "Goldshire" || len(net.Routes) != 1 || len(net.Routes[0].Points) != 3 || net.Routes[0].Points[2].Flags != 2 {
		t.Fatalf("the client's map 0 = %+v", net)
	}

	// A route to a stop neither holds is refused, and nothing is written.
	bad := filepath.Join(t.TempDir(), "bad.sql")
	if err := os.WriteFile(bad, []byte(strings.Replace(script, "-- meld route 7 1 2 90", "-- meld route 8 1 9 90", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	// The points still name route 7, so the script is refused as unreadable before the plan.
	if _, err := a.ImportTaxi(bad); err == nil {
		t.Fatal("a script with points of no route was imported")
	}
	bad2 := strings.NewReplacer("-- meld route 7 1 2 90", "-- meld route 8 1 9 90", "-- meld point 7 ", "-- meld point 8 ").Replace(script)
	if err := os.WriteFile(bad, []byte(bad2), 0o644); err != nil {
		t.Fatal(err)
	}
	before, _ := vmangos.LoadTaxiTables(data)
	if _, err := a.ImportTaxi(bad); err == nil || !strings.Contains(err.Error(), "not imported") {
		t.Fatalf("a refused script: %v", err)
	}
	if after, _ := vmangos.LoadTaxiTables(data); string(after.Paths) != string(before.Paths) || string(after.Nodes) != string(before.Nodes) {
		t.Fatal("a refused script changed the taxi tables")
	}
}

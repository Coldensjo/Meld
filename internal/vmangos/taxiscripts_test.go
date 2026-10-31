package vmangos

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
	"time"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestTaxiScriptRoundTrip writes the fixture's map 0 stops and routes as a script and reads them back:
// the stops from their taxi_nodes rows, the routes and their points from the meld lines, a name with
// a quote and a backslash kept.
func TestTaxiScriptRoundTrip(t *testing.T) {
	net, err := ReadTaxiNetwork(taxiFixture(), 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	net.Nodes[0].Name = `Gold's \ shire`
	net.Routes[0].Points[1].X = 150.125
	script, err := TaxiScript(net.Nodes, net.Routes, "Eastern Kingdoms", time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"-- Flight paths exported by Meld on 2026-10-31 12:00: 2 stops and 2 routes (5 points) of map 0 (Eastern Kingdoms).",
		"-- meld route 10 1 2 110\n-- meld point 10 0 100 0 60 0 0\n-- meld point 10 0 150.125 0 80 0 0\n",
		"-- meld point 10 0 200 0 60 2 30\n",
		"REPLACE INTO `taxi_nodes`",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("the script lacks %q:\n%s", want, script)
		}
	}
	s, err := readTaxiScript(script)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s.nodes, net.Nodes) {
		t.Fatalf("stops %+v, want %+v", s.nodes, net.Nodes)
	}
	if !reflect.DeepEqual(s.routes, net.Routes) {
		t.Fatalf("routes %+v, want %+v", s.routes, net.Routes)
	}
	if s.skipped != 0 || len(s.unknown) != 0 {
		t.Fatalf("skipped %d, unknown %v", s.skipped, s.unknown)
	}

	// A stop alone: its routes fly to a stop the script doesn't hold, which the header names.
	one, err := TaxiScript(net.Nodes[:1], net.Routes, "", time.Now())
	if err != nil || !strings.Contains(one, "from or to stop 2, which this script doesn't hold") {
		t.Fatalf("a stop's script (%v):\n%s", err, one)
	}
	if _, err := TaxiScript(nil, nil, "", time.Now()); err == nil {
		t.Fatal("an empty export was written")
	}
}

// TestTaxiImportPlan plans scripts into the fixture: unchanged stops and routes, a renamed stop, a
// new route between stops the client has, one that replaces the client's route the same way, a route
// ID the client uses between other stops, and a route to a stop neither holds, which is refused.
func TestTaxiImportPlan(t *testing.T) {
	tt := taxiFixture()
	net, _ := ReadTaxiNetwork(tt, 0, 0)
	script, _ := TaxiScript(net.Nodes, net.Routes, "", time.Now())
	plan, edit, err := PlanTaxiImport(tt, script, map[uint32]bool{0: true}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Refused) > 0 || len(plan.Stops) != 2 || len(plan.Routes) != 2 || len(plan.MissingMaps) > 0 {
		t.Fatalf("plan %+v", plan)
	}
	for _, s := range plan.Stops {
		if !s.Exists || !s.Same || s.Was != "" {
			t.Fatalf("stop %+v, want it unchanged", s)
		}
	}
	for _, r := range plan.Routes {
		if !r.Exists || !r.Same || r.Replaces != 0 || r.FromName == "" {
			t.Fatalf("route %+v, want it unchanged", r)
		}
	}
	if len(edit.Nodes) != 2 || len(edit.Routes) != 0 || len(edit.RemoveRoutes) != 0 {
		t.Fatalf("an unchanged import's edit %+v", edit)
	}
	if out, err := SetTaxi(tt, edit.Nodes, nil, nil, nil); err != nil || !bytes.Equal(out.Nodes, tt.Nodes) || !bytes.Equal(out.Points, tt.Points) {
		t.Fatalf("an unchanged import changed the tables (%v)", err)
	}

	// Stop 1 renamed and moved to map 1; route 20 (1 to 2, as the client's 10 flies) and route 11 now
	// flying from 3 to 2.
	nodes := []TaxiNode{{ID: 1, MapID: 1, X: 5, Y: 6, Z: 7, Name: "Newshire", AllianceMount: 541}, net.Nodes[1]}
	pts := []TaxiPoint{{MapID: 0, X: 1}, {MapID: 0, X: 2}, {MapID: 0, X: 3}}
	routes := []TaxiRoute{{ID: 20, From: 1, To: 2, Cost: 50, Points: pts}, {ID: 11, From: 3, To: 2, Cost: 60, Points: pts[:2]}}
	script, _ = TaxiScript(nodes, routes, "", time.Now())
	plan, edit, err = PlanTaxiImport(tt, script, map[uint32]bool{0: true}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Refused) > 0 || !plan.Server {
		t.Fatalf("refused %v", plan.Refused)
	}
	if s := plan.Stops[0]; !s.Exists || s.Same || s.Was != "Goldshire" || s.WasMap != 0 {
		t.Fatalf("stop 1 %+v", s)
	}
	if r := plan.Routes[0]; r.Exists || r.Replaces != 10 || r.FromName != "Newshire" || r.ToName != "Lakeshire" {
		t.Fatalf("route 20 %+v", r)
	}
	if r := plan.Routes[1]; !r.Exists || r.Same || !r.OtherWay || r.WasFrom != 2 || r.WasTo != 1 || r.FromName != "Ratchet" {
		t.Fatalf("route 11 %+v", r)
	}
	if !reflect.DeepEqual(plan.MissingMaps, []uint32{1}) || !reflect.DeepEqual(plan.Maps, []uint32{1, 0}) {
		t.Fatalf("maps %v, missing %v", plan.Maps, plan.MissingMaps)
	}
	if len(edit.Routes) != 2 || !reflect.DeepEqual(edit.RemoveRoutes, []uint32{10}) {
		t.Fatalf("edit %+v", edit)
	}
	out, err := SetTaxi(tt, edit.Nodes, edit.RemoveNodes, edit.Routes, edit.RemoveRoutes)
	if err != nil {
		t.Fatal(err)
	}
	back, _ := ReadTaxiNetwork(out, 1, 0)
	if len(back.Nodes) != 2 || back.Nodes[0].Name != "Newshire" || len(back.Routes) != 2 {
		t.Fatalf("map 1 after the import: %+v", back)
	}

	// A route to stop 9, which neither the script nor the client has, is refused.
	script, _ = TaxiScript(nil, []TaxiRoute{{ID: 30, From: 1, To: 9, Cost: 1, Points: pts}}, "", time.Now())
	if plan, _, err = PlanTaxiImport(tt, script, nil, false); err != nil || len(plan.Refused) != 1 || !strings.Contains(plan.Refused[0], "stop 9") {
		t.Fatalf("a route to a missing stop: %+v (%v)", plan.Refused, err)
	}
}

// TestTaxiScriptReadsRows reads what a script by hand or a dump has: an INSERT without a column list,
// rows of several builds (the highest up to 5875 taken), another table's statement and a column Meld
// doesn't write; and refuses what it can't read.
func TestTaxiScriptReadsRows(t *testing.T) {
	script := strings.Join([]string{
		"INSERT INTO `taxi_nodes` VALUES (5, 4222, 0, 1, 2, 3, 'Old', 1, 2), (5, 5875, 0, 4, 5, 6, 'Lakeshire', 2224, 541), (5, 9999, 0, 7, 8, 9, 'Later', 0, 0);",
		"INSERT INTO `taxi_nodes` (`id`, `build`, `map_id`, `name`, `extra`) VALUES (6, 5875, 1, 'Ratchet', 1);",
		"UPDATE creature_template SET npc_flags = 8 WHERE entry = 1;",
		"",
	}, "\n")
	s, err := readTaxiScript(script)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.nodes) != 2 || s.nodes[0] != (TaxiNode{ID: 5, X: 4, Y: 5, Z: 6, Name: "Lakeshire", HordeMount: 2224, AllianceMount: 541}) || s.nodes[1].Name != "Ratchet" || s.nodes[1].MapID != 1 {
		t.Fatalf("stops %+v", s.nodes)
	}
	if s.skipped != 1 || !reflect.DeepEqual(s.unknown, []string{"taxi_nodes.extra"}) {
		t.Fatalf("skipped %d, unknown %v", s.skipped, s.unknown)
	}
	for _, bad := range []string{
		"SELECT 1;",
		"-- meld route 1 2 3\n",
		"-- meld route 1 2 3 4\n-- meld route 1 2 3 4\n",
		"-- meld point 7 0 1 2 3 0 0\n",
		"-- meld route 1 2 3 4\n-- meld point 1 0 x 2 3 0 0\n",
	} {
		if _, err := readTaxiScript(bad); err == nil {
			t.Errorf("read %q", bad)
		}
	}
}

// TestClientTaxiScriptRoundTrip exports Eastern Kingdoms' flight paths from the client and plans the
// script back: every stop and route is the client's already, so the import leaves the tables as
// they are.
func TestClientTaxiScriptRoundTrip(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	tt, err := LoadTaxiTables(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	net, err := ReadTaxiNetwork(tt, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	script, err := TaxiScript(net.Nodes, net.Routes, "Eastern Kingdoms", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Eastern Kingdoms: %d stops, %d routes, a script of %d KB", len(net.Nodes), len(net.Routes), len(script)/1024)
	maps := map[uint32]bool{}
	if entries, err := LoadMapEntries(dataDir); err == nil {
		for _, m := range entries {
			maps[m.ID] = true
		}
	}
	plan, edit, err := PlanTaxiImport(tt, script, maps, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Refused) > 0 || len(plan.MissingMaps) > 0 || plan.Skipped > 0 || len(plan.Unknown) > 0 {
		t.Fatalf("plan: refused %v, missing maps %v, skipped %d, unknown %v", plan.Refused, plan.MissingMaps, plan.Skipped, plan.Unknown)
	}
	for _, s := range plan.Stops {
		if !s.Same {
			t.Fatalf("stop %+v, want it unchanged", s)
		}
	}
	for _, r := range plan.Routes {
		if !r.Same || r.Replaces != 0 {
			t.Fatalf("route %+v, want it unchanged", r)
		}
	}
	out, err := SetTaxi(tt, edit.Nodes, edit.RemoveNodes, edit.Routes, edit.RemoveRoutes)
	if err != nil || !bytes.Equal(out.Nodes, tt.Nodes) || !bytes.Equal(out.Paths, tt.Paths) || !bytes.Equal(out.Points, tt.Points) {
		t.Fatalf("the import wrote the client's tables differently (%v)", err)
	}
}

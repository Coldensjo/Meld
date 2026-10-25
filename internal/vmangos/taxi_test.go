package vmangos

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// taxiFixture builds 1.12 taxi tables: stops 1 and 2 on map 0 and 3 on map 1, route 10 from 1 to 2
// with three points and route 11 from 2 to 1 with two.
func taxiFixture() TaxiTables {
	f := math.Float32bits
	strs := []byte{0}
	name := func(s string) uint32 {
		at := uint32(len(strs))
		strs = append(append(strs, s...), 0)
		return at
	}
	var nodes []byte
	for _, n := range []struct {
		id, mapID uint32
		x         float32
		name      string
		h, a      uint32
	}{{1, 0, 100, "Goldshire", 0, 541}, {2, 0, 200, "Lakeshire", 2224, 541}, {3, 1, 300, "Ratchet", 2224, 0}} {
		rec := make([]uint32, taxiNodeFields)
		rec[0], rec[1], rec[2], rec[3], rec[4] = n.id, n.mapID, f(n.x), f(-n.x), f(50)
		rec[taxiNodeName] = name(n.name)
		rec[taxiNodeMask] = 0x7f007e
		rec[taxiNodeHorde], rec[taxiNodeAlly] = n.h, n.a
		nodes = appendFields(nodes, rec...)
	}
	paths := appendFields(nil, 10, 1, 2, 110, 11, 2, 1, 120)
	var points []byte
	// Out of index order, as the client's table can be.
	for _, p := range [][]uint32{{35, 10, 1, 0, f(150), 0, f(80), 0, 0}, {34, 10, 0, 0, f(100), 0, f(60), 0, 0}, {36, 10, 2, 0, f(200), 0, f(60), 2, 30}, {40, 11, 0, 0, f(200), 0, f(60), 0, 0}, {41, 11, 1, 0, f(100), 0, f(60), 0, 0}} {
		points = appendFields(points, p...)
	}
	return TaxiTables{
		Nodes:  dbcFile(taxiNodeFields, 3, nodes, strs),
		Paths:  dbcFile(taxiPathFields, 2, paths, []byte{0}),
		Points: dbcFile(taxiPointFields, 5, points, []byte{0}),
	}
}

func TestReadTaxiNetwork(t *testing.T) {
	net, err := ReadTaxiNetwork(taxiFixture(), 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(net.Nodes) != 2 || net.Nodes[0].Name != "Goldshire" || net.Nodes[1].HordeMount != 2224 || net.Nodes[1].AllianceMount != 541 {
		t.Fatalf("stops %+v", net.Nodes)
	}
	if len(net.Routes) != 2 || net.Routes[0].ID != 10 || net.Routes[0].Cost != 110 {
		t.Fatalf("routes %+v", net.Routes)
	}
	pts := net.Routes[0].Points
	if len(pts) != 3 || pts[0].X != 100 || pts[1].X != 150 || pts[2].Flags != 2 || pts[2].Delay != 30 {
		t.Fatalf("route 10's points not in index order: %+v", pts)
	}
	if net.NextNode != 4 || net.NextRoute != 12 {
		t.Fatalf("next IDs %d, %d", net.NextNode, net.NextRoute)
	}
	if up, _ := ReadTaxiNetwork(taxiFixture(), 0, 90); up.NextNode != 91 {
		t.Fatalf("next stop %d, want 91 (above the server's)", up.NextNode)
	}
	if other, _ := ReadTaxiNetwork(taxiFixture(), 1, 0); len(other.Nodes) != 1 || len(other.Routes) != 0 {
		t.Fatalf("map 1: %+v", other)
	}
}

func TestSetTaxiUnchanged(t *testing.T) {
	tt := taxiFixture()
	out, err := SetTaxi(tt, nil, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out.Nodes, tt.Nodes) || !bytes.Equal(out.Paths, tt.Paths) || !bytes.Equal(out.Points, tt.Points) {
		t.Fatal("an empty write changed the tables")
	}
}

func TestSetTaxiEditsAddsAndRemoves(t *testing.T) {
	tt := taxiFixture()
	net, _ := ReadTaxiNetwork(tt, 0, 0)
	gold := net.Nodes[0]
	gold.Name = "Goldshire, Elwynn"
	gold.X = 105
	newStop := TaxiNode{ID: 4, MapID: 0, X: 400, Y: -400, Z: 70, Name: "Sentinel Hill", AllianceMount: 541}
	r10 := net.Routes[0]
	r10.Cost = 150
	r10.Points = []TaxiPoint{{X: 100, Z: 60}, {X: 120, Z: 90}, {X: 160, Z: 95}, {X: 200, Z: 60, Flags: 2}}
	r12 := TaxiRoute{ID: 12, From: 1, To: 4, Cost: 300, Points: []TaxiPoint{{X: 100, Z: 60}, {X: 400, Z: 70}}}
	out, err := SetTaxi(tt, []TaxiNode{gold, newStop}, nil, []TaxiRoute{r10, r12}, []uint32{11})
	if err != nil {
		t.Fatal(err)
	}
	back, err := ReadTaxiNetwork(out, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.Nodes) != 3 || back.Nodes[0].Name != "Goldshire, Elwynn" || back.Nodes[0].X != 105 || back.Nodes[2].Name != "Sentinel Hill" || back.Nodes[1].Name != "Lakeshire" {
		t.Fatalf("stops %+v", back.Nodes)
	}
	nt, _ := parseDBC(out.Nodes)
	if r, _ := nt.row(4); nt.u32(r, taxiNodeMask) != 0x7f007e {
		t.Fatal("a new stop didn't take the client's locale mask")
	}
	if len(back.Routes) != 2 || back.Routes[0].ID != 10 || back.Routes[0].Cost != 150 || back.Routes[1].ID != 12 {
		t.Fatalf("routes %+v", back.Routes)
	}
	if got := back.Routes[0].Points; len(got) != 4 || got[1].Z != 90 || got[3].Flags != 2 {
		t.Fatalf("route 10's points %+v", got)
	}
	pt, _ := parseDBC(out.Points)
	if pt.records != 6 {
		t.Fatalf("%d points, want 6 (route 11's gone)", pt.records)
	}
	// Route 10 reuses its IDs 34 to 36 and takes 42 past the highest; route 12 takes 43 and 44.
	ids := map[uint32]bool{}
	for r := 0; r < pt.records; r++ {
		ids[pt.u32(r, 0)] = true
		if pt.u32(r, 1) == 11 {
			t.Fatal("a removed route's point was kept")
		}
	}
	for _, id := range []uint32{34, 35, 36, 42, 43, 44} {
		if !ids[id] {
			t.Fatalf("point IDs %v, want 34-36 and 42-44", ids)
		}
	}
}

func TestSetTaxiRefuses(t *testing.T) {
	tt := taxiFixture()
	two := []TaxiPoint{{X: 1}, {X: 2}}
	cases := map[string]struct {
		nodes        []TaxiNode
		removeNodes  []uint32
		routes       []TaxiRoute
		removeRoutes []uint32
		want         string
	}{
		"stop past the mask":      {nodes: []TaxiNode{{ID: MaxTaxiNode + 1, Name: "x"}}, want: "1 to 256"},
		"stop without a name":     {nodes: []TaxiNode{{ID: 5, Name: " "}}, want: "needs a name"},
		"route to itself":         {routes: []TaxiRoute{{ID: 12, From: 1, To: 1, Points: two}}, want: "starts and ends"},
		"route of one point":      {routes: []TaxiRoute{{ID: 12, From: 1, To: 3, Points: two[:1]}}, want: "two points"},
		"route to a lost stop":    {routes: []TaxiRoute{{ID: 12, From: 1, To: 9, Points: two}}, want: "stop 9"},
		"stop a route still uses": {removeNodes: []uint32{2}, removeRoutes: []uint32{11}, want: "route 10 uses stop 2"},
		"second route one way":    {routes: []TaxiRoute{{ID: 12, From: 1, To: 2, Points: two}}, want: "both fly"},
		"saved and removed":       {routes: []TaxiRoute{{ID: 11, From: 2, To: 1, Points: two}}, removeRoutes: []uint32{11}, want: "both saved and removed"},
		"unknown route removed":   {removeRoutes: []uint32{99}, want: "not in the table"},
	}
	for name, c := range cases {
		_, err := SetTaxi(tt, c.nodes, c.removeNodes, c.routes, c.removeRoutes)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: got %v, want an error with %q", name, err, c.want)
		}
	}
	// A stop removed with its routes goes.
	out, err := SetTaxi(tt, nil, []uint32{2}, nil, []uint32{10, 11})
	if err != nil {
		t.Fatal(err)
	}
	if net, _ := ReadTaxiNetwork(out, 0, 0); len(net.Nodes) != 1 || len(net.Routes) != 0 {
		t.Fatalf("after removing stop 2: %+v", net)
	}
}

func TestTaxiSQL(t *testing.T) {
	sql := TaxiSQL([]TaxiNode{{ID: 88, MapID: 0, X: 1.5, Y: -2, Z: 3, Name: "Meld's Rest", AllianceMount: 541}}, []uint32{87, 86}, []uint32{500})
	for _, want := range []string{
		"DELETE FROM `taxi_nodes` WHERE `id` IN (87, 86);",
		"DELETE FROM `locales_taxi_node` WHERE `entry` IN (87, 86);",
		"DELETE FROM `taxi_path_transitions` WHERE `in_path` IN (500) OR `out_path` IN (500);",
		"VALUES (88, 5875, 0, 1.5, -2, 3, 'Meld\\'s Rest', 0, 541);",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("SQL lacks %q:\n%s", want, sql)
		}
	}
}

// TestClientTaxi reads the client's own taxi tables (WOW_DIR=C:/WoW/client): written back unchanged
// they are the same bytes, Azeroth has Stormwind's stop, and a route edited and read back keeps its points.
func TestClientTaxi(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	tt, err := LoadTaxiTables(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	same, err := SetTaxi(tt, nil, nil, nil, nil)
	if err != nil || !bytes.Equal(same.Nodes, tt.Nodes) || !bytes.Equal(same.Paths, tt.Paths) || !bytes.Equal(same.Points, tt.Points) {
		t.Fatalf("the client's tables written back differ (%v)", err)
	}
	net, err := ReadTaxiNetwork(tt, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	var sw *TaxiNode
	for i := range net.Nodes {
		if net.Nodes[i].ID == 2 {
			sw = &net.Nodes[i]
		}
	}
	if sw == nil || !strings.Contains(sw.Name, "Stormwind") || sw.AllianceMount != 541 {
		t.Fatalf("stop 2 is %+v, want Stormwind with the gryphon", sw)
	}
	t.Logf("Eastern Kingdoms: %d stops, %d routes, next stop %d, next route %d", len(net.Nodes), len(net.Routes), net.NextNode, net.NextRoute)
	r := net.Routes[0]
	out, err := SetTaxi(tt, nil, nil, []TaxiRoute{r}, nil)
	if err != nil {
		t.Fatal(err)
	}
	back, _ := ReadTaxiNetwork(out, 0, 0)
	if len(back.Routes) != len(net.Routes) || len(back.Routes[0].Points) != len(r.Points) || back.Routes[0].Points[1] != r.Points[1] {
		t.Fatal("a route saved as it was came back different")
	}
}

func TestInstallServerTaxi(t *testing.T) {
	dir := t.TempDir()
	dbcDir := filepath.Join(dir, "data", "5875", "dbc")
	for _, d := range []string{filepath.Join(dir, "run"), dbcDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "run", "mangosd.conf"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	old := []byte("the extractor's table")
	if err := os.WriteFile(filepath.Join(dbcDir, "TaxiPath.dbc"), old, 0o644); err != nil {
		t.Fatal(err)
	}
	tt := taxiFixture()
	if _, err := InstallServerTaxi(dir, tt); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string][]byte{"TaxiNodes.dbc": tt.Nodes, "TaxiPath.dbc": tt.Paths, "TaxiPathNode.dbc": tt.Points, "TaxiPath.dbc" + BackupSuffix: old} {
		got, err := os.ReadFile(filepath.Join(dbcDir, name))
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("%s: %v, differs %v", name, err, !bytes.Equal(got, want))
		}
	}
	// A second save keeps the first backup: the extractor's table.
	if _, err := InstallServerTaxi(dir, tt); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(dbcDir, "TaxiPath.dbc"+BackupSuffix)); !bytes.Equal(got, old) {
		t.Error("the backup was replaced")
	}
}

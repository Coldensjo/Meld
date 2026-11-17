package vmangos

import (
	"bytes"
	"encoding/binary"
	"reflect"
	"testing"

	"Meld/internal/clientbuild"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// The tables a map is made of, written into the 3.3.5a client's own copies (#1067): the client's
// rows written back through the editors' writers leave each table byte for byte as it is, and a
// new row comes out in the client's columns, as wide as its own and read back as written. These are
// the tables laterTables lets into that client.
func TestWotLKTableWrites(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.WotLKDir(t))
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	if set.Build() != clientbuild.WotLK {
		t.Fatalf("the client reads as %v", set.Build())
	}
	read := func(name string) []byte {
		t.Helper()
		b, err := set.ReadFile(`DBFilesClient\` + name + `.dbc`)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	same := func(what string, before, after []byte, err error) {
		t.Helper()
		if err != nil {
			t.Errorf("%s: %v", what, err)
		} else if !bytes.Equal(before, after) {
			t.Errorf("%s: writing the client's own rows back changed the table", what)
		}
	}
	// grown checks a table with rows added: the client's width, its rows first and as they were.
	grown := func(what string, before, after []byte, rows int) {
		t.Helper()
		if len(after) < 20 || string(after[:4]) != "WDBC" {
			t.Fatalf("%s: not a table", what)
		}
		h := func(b []byte, at int) uint32 { return binary.LittleEndian.Uint32(b[at:]) }
		if h(after, 8) != h(before, 8) || h(after, 12) != h(before, 12) {
			t.Errorf("%s: %d fields of %d bytes, the client's are %d of %d", what, h(after, 8), h(after, 12), h(before, 8), h(before, 12))
		}
		if h(after, 4) != h(before, 4)+uint32(rows) {
			t.Errorf("%s: %d rows, want %d", what, h(after, 4), h(before, 4)+uint32(rows))
		}
		n := int(h(before, 4) * h(before, 12))
		if !bytes.Equal(before[20:20+n], after[20:20+n]) {
			t.Errorf("%s: the client's own rows changed", what)
		}
	}
	const northrend, fjord = 571, 495

	// Map.dbc: a map's own info written back, and a new map's row.
	maps := read("Map")
	mt, err := mapTable(maps)
	if err != nil {
		t.Fatal(err)
	}
	r, ok := mt.row(northrend)
	if !ok {
		t.Fatal("Map.dbc has no Northrend")
	}
	info := MapInfo{
		Type: mt.u32(r, mt.col("InstanceType")), Name: mt.str(r, mt.col("Name")),
		AreaID: mt.u32(r, mt.col("AreaID")), LoadingScreen: mt.u32(r, mt.col("LoadingScreen")),
	}
	out, err := SetMapRowInfo(maps, northrend, info)
	same("Map.dbc, Northrend's info", maps, out, err)
	out, changed, err := SetMapLoadingScreen(maps, northrend, info.LoadingScreen)
	same("Map.dbc, Northrend's loading screen", maps, out, err)
	if !changed {
		t.Error("SetMapLoadingScreen found no Northrend row")
	}
	added, err := AddMapRow(maps, 9001, "MeldTest")
	if err != nil {
		t.Fatal(err)
	}
	grown("Map.dbc", maps, added, 1)
	if dir := MapRowDir(added, 9001); dir != "MeldTest" {
		t.Errorf("the new map's folder reads %q", dir)
	}
	named, err := SetMapRowInfo(added, 9001, MapInfo{Type: 1, Name: "Meld's Dungeon", AreaID: fjord, LoadingScreen: info.LoadingScreen})
	if err != nil {
		t.Fatal(err)
	}
	nt, err := mapTable(named)
	if err != nil {
		t.Fatal(err)
	}
	if nt.l.build != clientbuild.WotLK {
		t.Errorf("Map.dbc read in the %v layout", nt.l.build)
	}
	if r, ok := nt.row(9001); !ok || nt.str(r, nt.col("Name")) != "Meld's Dungeon" || nt.u32(r, nt.col("InstanceType")) != 1 || nt.u32(r, nt.col("AreaID")) != fjord {
		t.Errorf("the new map's row reads otherwise than written")
	}

	// LoadingScreens.dbc: a new screen.
	screens := read("LoadingScreens")
	withScreen, row, err := SetLoadingScreenRow(screens, "MeldTest", LoadingScreenPicture("MeldTest"))
	if err != nil {
		t.Fatal(err)
	}
	grown("LoadingScreens.dbc", screens, withScreen, 1)
	if got, err := ReadLoadingScreens(withScreen); err != nil || got[len(got)-1] != row {
		t.Errorf("the new loading screen reads %v, %v; want %v", got[len(got)-1], err, row)
	}

	// AreaTable.dbc: Northrend's zones written back, and a new subzone of the Howling Fjord, whose
	// exploration bit lies past the 1.12 client's last.
	areas := read("AreaTable")
	own, err := ReadAreaRows(areas, northrend)
	if err != nil || len(own) == 0 {
		t.Fatalf("Northrend's zones: %d, %v", len(own), err)
	}
	out, err = SetAreaRows(areas, own)
	same("AreaTable.dbc", areas, out, err)
	sub, err := NewAreaRow(areas, northrend, fjord)
	if err != nil {
		t.Fatal(err)
	}
	if sub.AreaBit < MaxAreaBit {
		t.Logf("the new area's bit is %d", sub.AreaBit)
	}
	sub.Name = "Meld Hollow"
	out, err = SetAreaRows(areas, []AreaRow{sub})
	if err != nil {
		t.Fatal(err)
	}
	grown("AreaTable.dbc", areas, out, 1)
	back, err := ReadAreaRows(out, northrend)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, a := range back {
		if a.ID == sub.ID {
			found = a.Name == sub.Name && a.Parent == fjord && a.AreaBit == sub.AreaBit
		}
	}
	if !found {
		t.Error("the new subzone reads otherwise than written")
	}

	// WorldMapArea.dbc and WorldMapOverlay.dbc: the Howling Fjord's map and overlays written back, and
	// a new zone's map.
	wma := read("WorldMapArea")
	wrow, err := FindWorldMapRow(wma, northrend, fjord)
	if err != nil || wrow == nil {
		t.Fatalf("the Howling Fjord's world map: %v", err)
	}
	out, _, err = SetWorldMapRow(wma, *wrow)
	same("WorldMapArea.dbc", wma, out, err)
	fresh := *wrow
	fresh.ID, fresh.AreaID, fresh.Name = 0, sub.ID, "MeldHollow"
	out, fresh, err = SetWorldMapRow(wma, fresh)
	if err != nil {
		t.Fatal(err)
	}
	grown("WorldMapArea.dbc", wma, out, 1)
	if got, err := FindWorldMapRow(out, northrend, sub.ID); err != nil || got == nil || *got != fresh {
		t.Errorf("the new world map reads %v, %v; want %v", got, err, fresh)
	}
	wt, err := parseTable(out, dbcWorldMapArea)
	if err != nil {
		t.Fatal(err)
	}
	if f, ok := wt.l.byName["DisplayMap"]; ok {
		col := wt.l.fields[f].at
		if v := wt.u32(wt.records-1, col); v != usualValue(wt, col) {
			t.Errorf("the new world map's DisplayMap is %d, the client's rows mostly %d", int32(v), int32(usualValue(wt, col)))
		}
	} else {
		t.Error("WorldMapArea.dbc read without the 3.3.5a client's DisplayMap column")
	}
	overlays := read("WorldMapOverlay")
	ovs, err := WorldMapOverlays(overlays, wrow.ID)
	if err != nil || len(ovs) == 0 {
		t.Fatalf("the Howling Fjord's overlays: %d, %v", len(ovs), err)
	}
	// The writer puts the zone's rows after the others', so the table holds the same records, each
	// byte for byte, in another order.
	out, _, err = SetWorldMapOverlays(overlays, wrow.ID, ovs)
	if err != nil {
		t.Fatalf("WorldMapOverlay.dbc: %v", err)
	}
	if !bytes.Equal(out[4:20], overlays[4:20]) {
		t.Error("WorldMapOverlay.dbc: the header changed")
	}
	recSize := int(binary.LittleEndian.Uint32(overlays[12:]))
	records := func(b []byte) map[string]int {
		n := int(binary.LittleEndian.Uint32(b[4:]))
		m := map[string]int{}
		for r := 0; r < n; r++ {
			m[string(b[20+r*recSize:20+(r+1)*recSize])]++
		}
		return m
	}
	if !reflect.DeepEqual(records(overlays), records(out)) || !bytes.HasPrefix(out[len(out)-int(binary.LittleEndian.Uint32(out[16:])):], overlays[len(overlays)-int(binary.LittleEndian.Uint32(overlays[16:])):]) {
		t.Error("WorldMapOverlay.dbc: writing the Howling Fjord's own overlays back changed the table's records")
	}

	// AreaTrigger.dbc: Northrend's triggers.
	triggers := read("AreaTrigger")
	trs, err := ReadAreaTriggers(triggers, northrend)
	if err != nil || len(trs) == 0 {
		t.Fatalf("Northrend's triggers: %d, %v", len(trs), err)
	}
	out, err = SetAreaTriggers(triggers, trs, nil)
	same("AreaTrigger.dbc", triggers, out, err)

	// TaxiNodes, TaxiPath and TaxiPathNode.dbc: Northrend's flight network written back, and a new
	// stop with an ID past the 1.12 client's last.
	tt := TaxiTables{Nodes: read("TaxiNodes"), Paths: read("TaxiPath"), Points: read("TaxiPathNode")}
	net, err := ReadTaxiNetwork(tt, northrend, 0)
	if err != nil || len(net.Nodes) == 0 || len(net.Routes) == 0 {
		t.Fatalf("Northrend's flight paths: %d stops, %d routes, %v", len(net.Nodes), len(net.Routes), err)
	}
	if net.MaxNode != maxTaxiNodeWotLK {
		t.Errorf("the network's stops go to %d, want %d", net.MaxNode, maxTaxiNodeWotLK)
	}
	written, err := SetTaxi(tt, net.Nodes, nil, net.Routes, nil)
	same("TaxiNodes.dbc", tt.Nodes, written.Nodes, err)
	same("TaxiPath.dbc", tt.Paths, written.Paths, err)
	same("TaxiPathNode.dbc", tt.Points, written.Points, err)
	// A route edited (its price) keeps its points' records whole, the events of the 3.3.5a
	// client's columns among them, though they move to the table's end.
	priced := net.Routes[0]
	priced.Cost++
	written, err = SetTaxi(tt, nil, nil, []TaxiRoute{priced}, nil)
	if err != nil {
		t.Fatal(err)
	}
	pointSize := int(binary.LittleEndian.Uint32(tt.Points[12:]))
	pointSet := func(b []byte) map[string]int {
		m := map[string]int{}
		for r := 0; r < int(binary.LittleEndian.Uint32(b[4:])); r++ {
			m[string(b[20+r*pointSize:20+(r+1)*pointSize])]++
		}
		return m
	}
	if !reflect.DeepEqual(pointSet(tt.Points), pointSet(written.Points)) {
		t.Error("TaxiPathNode.dbc: a route's new price changed its points' records")
	}
	stop := net.Nodes[0]
	stop.ID, stop.Name = max(net.NextNode, MaxTaxiNode+1), "Meld Landing"
	if stop.ID > maxTaxiNodeWotLK {
		t.Fatalf("no stop ID is left: next is %d", stop.ID)
	}
	written, err = SetTaxi(tt, []TaxiNode{stop}, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	grown("TaxiNodes.dbc", tt.Nodes, written.Nodes, 1)
	after, err := ReadTaxiNetwork(written, northrend, 0)
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, n := range after.Nodes {
		if n.ID == stop.ID {
			found = n.Name == stop.Name && n.X == stop.X && n.Y == stop.Y && n.Z == stop.Z
		}
	}
	if !found {
		t.Error("the new stop reads otherwise than written")
	}
}

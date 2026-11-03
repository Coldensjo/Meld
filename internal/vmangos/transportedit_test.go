package vmangos

import (
	"math"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// line is points along x every step yards on map mapID, from x0.
func line(mapID uint32, x0, step float32, n int) []TaxiPoint {
	out := make([]TaxiPoint, n)
	for i := range out {
		out[i] = TaxiPoint{MapID: mapID, X: x0 + float32(i)*step}
	}
	return out
}

func TestTransportPeriod(t *testing.T) {
	near := func(got uint32, want float64) bool { return math.Abs(float64(got)-want) <= 1 }
	// Five points 100 yd apart: the leg sails from the second to the fourth, 200 yd, at 30 yd/s
	// all the way (no dock: the client takes it as cruising).
	pts := line(0, 0, 100, 5)
	if p, ok := TransportPeriod(pts, 30, 1); !ok || !near(p, 200.0/30*1000) {
		t.Errorf("no dock: %d %v, want %.0f", p, ok, 200.0/30*1000)
	}
	// A dock in the middle waited at 10 s: out of it and into it each too short to reach full speed
	// (450 yd to speed up at 1 yd/s²), so each 100 yd takes sqrt(2*100) s.
	pts[2].Flags, pts[2].Delay = 2, 10
	want := 10000 + 2*math.Sqrt(200)*1000
	if p, ok := TransportPeriod(pts, 30, 1); !ok || !near(p, want) {
		t.Errorf("one dock: %d %v, want %.0f", p, ok, want)
	}
	// A second map adds its leg's time.
	two := append(append([]TaxiPoint(nil), pts...), line(1, 0, 100, 5)...)
	if p, ok := TransportPeriod(two, 30, 1); !ok || !near(p, want+200.0/30*1000) {
		t.Errorf("two maps: %d %v, want %.0f", p, ok, want+200.0/30*1000)
	}
	if _, ok := TransportPeriod(pts, 30, 0); ok {
		t.Error("no acceleration gave a period")
	}
	if _, ok := TransportPeriod(nil, 30, 1); ok {
		t.Error("no points gave a period")
	}
}

// TestClientTransportPeriods checks TransportPeriod against the nine live transports' periods
// (VMaNGOS's `transports` rows of the highest build up to 5875, sniffs of the client's), on the
// client's own paths (WOW_DIR=C:/WoW/client).
func TestClientTransportPeriods(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	tt, err := LoadTaxiTables(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseTaxi(tt)
	if err != nil {
		t.Fatal(err)
	}
	points := p.routePoints()
	for _, g := range []struct {
		path, period uint32
		speed        float32
	}{{241, 350818, 30}, {302, 356284, 30}, {285, 303463, 30}, {292, 329313, 30}, {293, 316251, 30}, {295, 295579, 30}, {301, 333044, 30}, {303, 317040, 30}, {436, 1208014, 1}} {
		got, ok := TransportPeriod(points[g.path], g.speed, 1)
		if !ok || got != g.period {
			t.Errorf("path %d: %d (%v), want %d", g.path, got, ok, g.period)
		}
	}
}

// ferry is a valid edit: path 30 across a lake on map 0 and back, docks at both ends.
func ferry() TransportEdit {
	pts := line(0, 0, 100, 8)
	pts[1].Flags, pts[1].Delay = 2, 30
	pts[4].Flags, pts[4].Delay = 2, 30
	return TransportEdit{Entry: 900000, Name: "Lake ferry", Object: "The Lake Queen", DisplayID: 3015, Size: 1, Speed: 30, Accel: 1, PathID: 30, Points: pts}
}

func TestCheckTransport(t *testing.T) {
	never := func(uint32) bool { return false }
	e := ferry()
	period, err := CheckTransport(e, never)
	if want, _ := TransportPeriod(e.Points, 30, 1); err != nil || period != want {
		t.Fatalf("a ferry: %d %v, want %d", period, err, want)
	}
	for name, change := range map[string]func(*TransportEdit){
		"no entry":     func(e *TransportEdit) { e.Entry = 0 },
		"no path":      func(e *TransportEdit) { e.PathID = 0 },
		"no name":      func(e *TransportEdit) { e.Name = " " },
		"no model":     func(e *TransportEdit) { e.DisplayID = 0 },
		"no speed":     func(e *TransportEdit) { e.Speed = 0 },
		"no accel":     func(e *TransportEdit) { e.Accel = 0 },
		"three points": func(e *TransportEdit) { e.Points = e.Points[:3] },
		"unknown flag": func(e *TransportEdit) { e.Points[2].Flags = 4 },
		"not a number": func(e *TransportEdit) { e.Points[2].X = float32(math.NaN()) },
		"a one-point leg": func(e *TransportEdit) {
			// Map 0's stretch sails through point 1 alone: 0 and 2 are its ends.
			for i := 3; i < len(e.Points); i++ {
				e.Points[i].MapID = 1
			}
		},
		"slow forever": func(e *TransportEdit) { e.Points[1].Delay = 1 << 20 },
	} {
		e := ferry()
		change(&e)
		if _, err := CheckTransport(e, never); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// Two maps: fine between continents, refused into an instance.
	e = ferry()
	e.Points = append(e.Points, line(1, 0, 100, 5)...)
	if _, err := CheckTransport(e, never); err != nil {
		t.Errorf("two continents: %v", err)
	}
	if _, err := CheckTransport(e, func(m uint32) bool { return m == 1 }); err == nil {
		t.Error("a route into an instance was accepted")
	}
}

func TestSetTransportPath(t *testing.T) {
	tt := transportFixture()
	next, err := NextTaxiPath(tt)
	if err != nil || next != 22 {
		t.Fatalf("next path %d %v, want 22", next, err)
	}
	e := ferry()
	out, err := SetTransportPath(tt, next, e.Points)
	if err != nil {
		t.Fatal(err)
	}
	// A second new path from stop 0 to stop 0 is no duplicate flight.
	out, err = SetTransportPath(out, next+1, e.Points)
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseTaxi(out)
	if err != nil {
		t.Fatal(err)
	}
	row, ok := p.paths.row(next)
	if !ok || p.paths.u32(row, 1) != 0 || p.paths.u32(row, 2) != 0 {
		t.Fatalf("path %d: %v", next, ok)
	}
	got := p.routePoints()[next]
	if len(got) != len(e.Points) || got[4].Flags != 2 || got[4].Delay != 30 || got[7].X != 700 {
		t.Fatalf("path %d's points: %+v", next, got)
	}
	// An existing path keeps its stops; its points are replaced.
	out, err = SetTransportPath(out, 20, e.Points[:5])
	if err != nil {
		t.Fatal(err)
	}
	p, _ = parseTaxi(out)
	row, _ = p.paths.row(20)
	if p.paths.u32(row, 1) != 1 || p.paths.u32(row, 2) != 2 || len(p.routePoints()[20]) != 5 {
		t.Errorf("path 20: from %d to %d, %d points", p.paths.u32(row, 1), p.paths.u32(row, 2), len(p.routePoints()[20]))
	}
	// The Flight Paths window doesn't list a transport's path.
	net, err := ReadTaxiNetwork(out, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range net.Routes {
		if r.ID == next {
			t.Error("the new transport path is listed as a flight")
		}
	}
	// A flight still can't start and end at one stop.
	if _, err := SetTaxi(tt, nil, nil, []TaxiRoute{{ID: 40, From: 1, To: 1, Points: e.Points}}, nil); err == nil {
		t.Error("a flight from stop 1 to stop 1 was saved")
	}
}

func TestTransportSQL(t *testing.T) {
	sql, err := TransportSQL(ferry(), 123456)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"INSERT IGNORE INTO `gameobject_template` (`entry`, `patch`, `type`, `displayId`, `name`, `flags`, `size`, `data0`, `data1`, `data2`) VALUES (900000, 0, 15, 3015, 'The Lake Queen', 40, 1, 30, 30, 1);",
		"UPDATE `gameobject_template` SET `displayId` = 3015, `name` = 'The Lake Queen', `size` = 1, `data0` = 30, `data1` = 30, `data2` = 1 WHERE `entry` = 900000 AND `type` = 15;",
		"REPLACE INTO `transports` (`entry`, `build`, `name`, `period`) VALUES (900000, 5875, 'Lake ferry', 123456);",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("SQL lacks %q:\n%s", want, sql)
		}
	}
	e := ferry()
	e.Object = strings.Repeat("x", 101)
	if _, err := TransportSQL(e, 1); err == nil {
		t.Error("a 101-character name was written")
	}
}

func TestRemoveTransportPath(t *testing.T) {
	tt := transportFixture()
	withNew, err := SetTransportPath(tt, 22, ferry().Points)
	if err != nil {
		t.Fatal(err)
	}
	out, err := RemoveTransportPath(withNew, 22)
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseTaxi(out)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := p.paths.row(22); ok {
		t.Error("path 22 is still in TaxiPath.dbc")
	}
	points := p.routePoints()
	if len(points[22]) != 0 {
		t.Errorf("path 22 keeps %d points", len(points[22]))
	}
	if len(points[20]) != 10 || len(points[21]) != 4 {
		t.Errorf("the other paths: %d and %d points, want 10 and 4", len(points[20]), len(points[21]))
	}
	// Done again (a delete that failed after the tables were written), the tables stay as they are.
	again, err := RemoveTransportPath(out, 22)
	if err != nil || string(again.Paths) != string(out.Paths) || string(again.Points) != string(out.Points) {
		t.Errorf("removing a path the tables lack changed them (%v)", err)
	}
}

func TestDeleteTransportSQL(t *testing.T) {
	want := "DELETE FROM `gameobject_template` WHERE `entry` = 900000 AND `type` = 15;\nDELETE FROM `transports` WHERE `entry` = 900000;\n"
	if got := DeleteTransportSQL(900000); got != want {
		t.Errorf("got\n%s\nwant\n%s", got, want)
	}
}

// TestTransportPathOf reads the path of the Menethil-Theramore boat (entry 20808, path 241, which no
// other transport sails) from the world database, and finds no path for an entry that is no transport.
func TestTransportPathOf(t *testing.T) {
	server := testclient.ServerDir(t)
	path, shared, ok, err := TransportPathOf(server, 20808)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || path != 241 || shared {
		t.Errorf("entry 20808: path %d, shared %v, ok %v; want 241, false, true", path, shared, ok)
	}
	if _, _, ok, err := TransportPathOf(server, 1<<24-1); err != nil || ok {
		t.Errorf("an entry that is no transport: ok %v, %v", ok, err)
	}
}

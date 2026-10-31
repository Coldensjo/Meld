package vmangos

import (
	"math"
	"strings"
	"testing"
)

// transportFixture is taxi tables with path 20 a ferry: four points on map 0 (the second a dock
// waited at 60 s), a map change, four on map 1 (the third a dock), as the client's Menethil boats run;
// and path 21 a lift on map 0 alone.
func transportFixture() TaxiTables {
	f := math.Float32bits
	paths := appendFields(nil, 20, 1, 2, 0, 21, 1, 2, 0)
	var points []byte
	id := uint32(100)
	add := func(path, index, mapID uint32, x float32, flags, delay uint32) {
		points = appendFields(points, id, path, index, mapID, f(x), f(-x), 0, flags, delay)
		id++
	}
	// Path 20: 0 shapes the start, 1 to 3 on map 0 (1 a dock), 4 the jump's last point on map 0,
	// 5 the first on map 1 (left out), 6 to 8 on map 1 (7 a dock), 9 shapes the end.
	add(20, 0, 0, 0, 0, 0)
	add(20, 1, 0, 10, 2, 60)
	add(20, 2, 0, 20, 0, 0)
	add(20, 3, 0, 30, 0, 0)
	add(20, 4, 0, 40, 0, 0)
	add(20, 5, 1, 500, 0, 0)
	add(20, 6, 1, 510, 0, 0)
	add(20, 7, 1, 520, 2, 45)
	add(20, 8, 1, 530, 0, 0)
	add(20, 9, 1, 540, 0, 0)
	for i := uint32(0); i < 4; i++ {
		add(21, i, 0, float32(1000+i), 0, 0)
	}
	tt := taxiFixture()
	tt.Paths = dbcFile(taxiPathFields, 2, paths, []byte{0})
	tt.Points = dbcFile(taxiPointFields, int(id-100), points, []byte{0})
	return tt
}

func TestTransportLegs(t *testing.T) {
	p, err := parseTaxi(transportFixture())
	if err != nil {
		t.Fatal(err)
	}
	legs := TransportLegs(p.routePoints()[20])
	if len(legs) != 2 {
		t.Fatalf("%d legs, want 2: %+v", len(legs), legs)
	}
	xs := func(l TransportLeg) []float32 {
		var out []float32
		for _, pt := range l.Points {
			out = append(out, pt.X)
		}
		return out
	}
	if l := legs[0]; l.MapID != 0 || len(l.Points) != 3 || xs(l)[0] != 10 || xs(l)[2] != 30 || l.Points[0].Flags != 2 || l.Points[0].Delay != 60 {
		t.Errorf("leg on map 0: %+v (x %v)", l, xs(l))
	}
	if l := legs[1]; l.MapID != 1 || len(l.Points) != 3 || xs(l)[0] != 510 || xs(l)[2] != 530 || l.Points[1].Delay != 45 {
		t.Errorf("leg on map 1: %+v (x %v)", l, xs(l))
	}
	if TransportLegs(p.routePoints()[20][:2]) != nil {
		t.Error("two points made legs; the server needs three")
	}
	if one := TransportLegs(p.routePoints()[21]); len(one) != 1 || len(one[0].Points) != 2 {
		t.Errorf("one-map path: %+v", one)
	}
	// A point flagged 1 ends a leg as a map change does.
	flagged := append([]TaxiPoint(nil), p.routePoints()[21]...)
	flagged = append(flagged, TaxiPoint{X: 1004}, TaxiPoint{X: 1005}, TaxiPoint{X: 1006})
	flagged[2].Flags = 1
	if l := TransportLegs(flagged); len(l) != 2 || len(l[0].Points) != 1 || l[1].Points[0].X != 1004 {
		t.Errorf("flag 1: %+v", l)
	}
}

func TestReadTransports(t *testing.T) {
	// entry, name, period, template name, path, speed, accel, display, size.
	raw := []byte("176231\tMenethil Harbor and Theramore Isle\t329313\tProudmore's Treasure\t20\t30\t1\t3015\t1\n" +
		"181056\t\t0\tNaxxramas\t21\t1\t1\t6637\t1\n" +
		"20808\tNo path\t0\tTEST Ship\t99\t30\t1\t3015\t1\n")
	model := func(d uint32) string {
		if d == 3015 {
			return `World\wmo\transports\transport_ship\transportship.wmo`
		}
		return ""
	}
	got, err := readTransports(raw, transportFixture(), 0, model)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("%d transports on map 0, want 2 (the one without a path left out): %+v", len(got), got)
	}
	ship := got[0]
	if ship.Entry != 176231 || ship.Name != "Menethil Harbor and Theramore Isle" || ship.Object != "Proudmore's Treasure" || ship.Period != 329313 ||
		ship.PathID != 20 || ship.Speed != 30 || ship.Accel != 1 || !strings.HasSuffix(ship.Model, "transportship.wmo") || len(ship.Legs) != 2 {
		t.Errorf("ship %+v", ship)
	}
	if naxx := got[1]; naxx.Name != "Naxxramas" || naxx.Model != "" || len(naxx.Legs) != 1 {
		t.Errorf("a transport without a row's name takes the template's: %+v", naxx)
	}
	if on1, _ := readTransports(raw, transportFixture(), 1, model); len(on1) != 1 || on1[0].Entry != 176231 {
		t.Errorf("map 1: %+v", on1)
	}
	if none, _ := readTransports(raw, transportFixture(), 5, model); none == nil || len(none) != 0 {
		t.Errorf("map 5: %+v, want an empty list", none)
	}
}

func TestTransportsSQL(t *testing.T) {
	for _, want := range []string{"t.type = 15", "build <= 5875", "MAX(patch)", "LEFT JOIN"} {
		if !strings.Contains(transportsSQL, want) {
			t.Errorf("transportsSQL lacks %q: %s", want, transportsSQL)
		}
	}
}

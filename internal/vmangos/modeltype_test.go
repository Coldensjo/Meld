package vmangos

import (
	"testing"

	"Meld/internal/adt"
)

func TestModelTypeRoundTrip(t *testing.T) {
	for _, c := range []struct {
		kind adt.Kind
		name string
		set  uint16
		want string
	}{
		{adt.M2, `World\Azeroth\Elwynn\Tree.m2`, 0, `m2:World\Azeroth\Elwynn\Tree.m2`},
		{adt.WMO, `World\wmo\Inn.wmo`, 0, `wmo:World\wmo\Inn.wmo`},
		{adt.WMO, `World\wmo\Inn.wmo`, 2, `wmo:World\wmo\Inn.wmo?set=2`},
	} {
		got := adt.ModelType(c.kind, c.name, c.set)
		if got != c.want {
			t.Fatalf("modelType = %q, want %q", got, c.want)
		}
		kind, name, set, hasSet, err := parseModelType(got)
		if err != nil || kind != c.kind || name != c.name || set != c.set || hasSet != (c.set != 0) {
			t.Fatalf("parse %q: %v %q %d %v", got, kind, name, set, err)
		}
	}
	if _, _, set, hasSet, _ := parseModelType("wmo:a.wmo?set=0"); set != 0 || !hasSet {
		t.Fatal("an explicit set 0 was not read as one")
	}
	if _, _, _, _, err := parseModelType("wmo:a.wmo?set=x"); err == nil {
		t.Fatal("a bad set was read")
	}
	if _, _, _, _, err := parseModelType("tree"); err == nil {
		t.Fatal("not a model, but read")
	}
}

// A WMO named without a set keeps the placement's own (a map saved before sets were named); a set in
// the name, 0 included, is the editor's.
func TestPlacementDoodadSet(t *testing.T) {
	orig := &adt.Placement{Kind: adt.WMO, Name: `World\wmo\Inn.wmo`, DoodadSet: 2, NameSet: 1}
	e := RegionEdit{X: 32, Y: 48, Size: 1}
	for _, c := range []struct {
		typ  string
		orig *adt.Placement
		want uint16
	}{
		{`wmo:World\wmo\Inn.wmo`, orig, 2},
		{`wmo:World\wmo\Inn.wmo?set=0`, orig, 0},
		{`wmo:World\wmo\Inn.wmo?set=3`, orig, 3},
		{`wmo:World\wmo\Inn.wmo?set=3`, nil, 3},
		{`wmo:World\wmo\Inn.wmo`, nil, 0},
	} {
		out, err := placementFromView(ObjectView{Type: c.typ, Scale: 1}, e, c.orig)
		if err != nil {
			t.Fatal(err)
		}
		if out.DoodadSet != c.want || out.Name != `World\wmo\Inn.wmo` {
			t.Fatalf("%s: set %d, name %q", c.typ, out.DoodadSet, out.Name)
		}
		if c.orig != nil && out.NameSet != 1 {
			t.Fatalf("%s: name set %d", c.typ, out.NameSet)
		}
	}
}

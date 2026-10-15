package wow

import "testing"

func TestDoodadsOfAddsTheSetToTheGlobalOne(t *testing.T) {
	r := &WMORoot{
		Sets:       []WMODoodadSet{{Name: "Set_$DefaultGlobal", Start: 0, Count: 2}, {Name: "Set_Inn", Start: 2, Count: 2}, {Name: "Set_Xmas", Start: 4, Count: 1}},
		AllDoodads: []WMODoodad{{Model: "a.m2"}, {Model: ""}, {Model: "b.m2"}, {Model: "c.m2"}, {Model: "d.m2"}},
	}
	names := func(ds []WMODoodad) (out []string) {
		for _, d := range ds {
			out = append(out, d.Model)
		}
		return out
	}
	if got := names(r.DoodadsOf(0)); len(got) != 1 || got[0] != "a.m2" {
		t.Fatalf("set 0: %v", got)
	}
	if got := names(r.DoodadsOf(1)); len(got) != 3 || got[1] != "b.m2" || got[2] != "c.m2" {
		t.Fatalf("set 1: %v", got)
	}
	if got := names(r.DoodadsOf(9)); len(got) != 1 {
		t.Fatalf("a set past the end: %v", got)
	}
}

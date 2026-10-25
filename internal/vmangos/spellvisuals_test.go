package vmangos

import (
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// visualTables makes a SpellVisual.dbc with visual 10 (precast kit 5, a missile of effect 7 with
// path 2, attachment 3, sound 4) and a SpellVisualKit.dbc with kit 5 (effect 7 on the left hand).
func visualTables() ([]byte, []byte) {
	vis := make([]uint32, visualFields)
	vis[0], vis[1], vis[6], vis[7], vis[8], vis[9], vis[10] = 10, 5, 1, 7, 2, 3, 4
	kit := make([]uint32, kitFields)
	kit[0], kit[2] = 5, 52
	for i := 0; i < kitSlots; i++ {
		kit[kitEffectsBase+i] = none
	}
	kit[kitEffectsBase+3] = 7
	return dbcBytes(visualFields, [][]uint32{vis}, "\x00"), dbcBytes(kitFields, [][]uint32{kit}, "\x00")
}

func TestPlanVisual(t *testing.T) {
	vb, kb := visualTables()
	v, _ := parseDBC(vb)
	k, _ := parseDBC(kb)
	d := readVisualDesign(v, k, 10)
	if d.Stages[0].ID != 5 || d.Stages[0].Effects[3] != 7 || d.Stages[0].Effects[0] != 0 || d.Missile != 7 || d.MissileFrom != 10 || d.Area != 0 {
		t.Fatalf("read %+v", d)
	}
	// Unchanged: the same visual, nothing written.
	id, vis, kits, err := planVisual(vb, kb, d)
	if err != nil || id != 10 || vis != nil || kits != nil {
		t.Fatalf("unchanged: %d %v %v %v", id, vis != nil, kits != nil, err)
	}
	// An area effect added: a new visual, a copy with the missile kept, no new kit.
	d.Area = 9
	id, vis, kits, err = planVisual(vb, kb, d)
	if err != nil || id != 11 || vis == nil || kits != nil {
		t.Fatalf("area: %d %v %v %v", id, vis != nil, kits != nil, err)
	}
	nv, _ := parseDBC(vis)
	r, _ := nv.row(11)
	if nv.u32(r, 1) != 5 || nv.u32(r, 7) != 7 || nv.u32(r, 8) != 2 || nv.u32(r, 11) != 1 || nv.u32(r, 12) != 9 {
		t.Fatalf("the new visual: %v", nv.record(r))
	}
	if o, _ := nv.row(10); nv.u32(o, 12) != 0 {
		t.Fatal("the old visual changed")
	}
	// A stage's effect changed: a new kit, a copy of its own (animation kept), and a new visual.
	d.Stages[0].Effects[4] = 8
	id, vis, kits, err = planVisual(vb, kb, d)
	if err != nil || id != 11 || vis == nil || kits == nil {
		t.Fatalf("kit: %d %v", id, err)
	}
	nk, _ := parseDBC(kits)
	kr, ok := nk.row(6)
	if !ok || nk.u32(kr, 2) != 52 || nk.u32(kr, kitEffectsBase+3) != 7 || nk.u32(kr, kitEffectsBase+4) != 8 || nk.u32(kr, kitEffectsBase) != none {
		t.Fatalf("the new kit: %v", nk.record(kr))
	}
	nv, _ = parseDBC(vis)
	if r, _ := nv.row(11); nv.u32(r, 1) != 6 {
		t.Fatal("the new visual doesn't use the new kit")
	}
	// A cast stage from nothing: a new kit of the cast kind and animation.
	d.Stages[0].Effects[4] = 0
	d.Stages[1].Effects[1] = 8
	_, _, kits, _ = planVisual(vb, kb, d)
	nk, _ = parseDBC(kits)
	if kr, ok := nk.row(6); !ok || nk.u32(kr, 1) != 0 || nk.u32(kr, 2) != 54 || nk.u32(kr, kitEffectsBase+1) != 8 {
		t.Fatal("the new cast kit is wrong")
	}
	// Nothing at all: no visual.
	empty := readVisualDesign(v, k, 0)
	if id, vis, kits, err := planVisual(vb, kb, empty); id != 0 || vis != nil || kits != nil || err != nil {
		t.Fatalf("empty: %d %v", id, err)
	}
}

// TestSpellVisualsLive checks the visual tables' layout against the client's rows (the stages name
// kits, the missile and area effects name effect models, the kits' attachment points name effect
// models) and composes a lava blizzard: Blizzard's visual with Rain of Fire's falling fire for its
// area. Nothing is written. It needs WOW_DIR.
func TestSpellVisualsLive(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	vb, kb, err := readVisualTables(set, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	eb, _ := set.ReadFile(SpellVisualEffectPath)
	v, _ := parseDBC(vb)
	k, _ := parseDBC(kb)
	e, _ := parseDBC(eb)
	if err := checkVisualTables(v, k); err != nil {
		t.Fatal(err)
	}
	share := func(tb *dbcTable, fields []int, in *dbcTable, skip uint32) (int, int) {
		set, hit := 0, 0
		for r := 0; r < tb.records; r++ {
			for _, f := range fields {
				if x := tb.u32(r, f); x != 0 && x != skip {
					set++
					if _, ok := in.row(x); ok {
						hit++
					}
				}
			}
		}
		return hit, set
	}
	for _, c := range []struct {
		what   string
		tb     *dbcTable
		fields []int
		in     *dbcTable
	}{
		{"stage kits", v, []int{1, 2, 3, 4, 5}, k},
		{"missile and area models", v, []int{7, 12}, e},
		{"attachment points", k, []int{3, 4, 5, 6, 7, 8, 9, 10, 11, 12}, e},
	} {
		hit, n := share(c.tb, c.fields, c.in, none)
		t.Logf("%s: %d of %d name a row", c.what, hit, n)
		if hit < n*95/100 {
			t.Errorf("%s: only %d of %d name a row", c.what, hit, n)
		}
	}
	effects, err := ListVisualEffects(dataDir)
	if err != nil || len(effects) < 300 {
		t.Fatalf("%d effects, %v", len(effects), err)
	}

	// Blizzard is visual 259, Rain of Fire 329.
	d, err := ReadSpellVisual(dataDir, 259)
	if err != nil {
		t.Fatal(err)
	}
	fire, _ := ReadSpellVisual(dataDir, 329)
	t.Logf("Blizzard %+v\nRain of Fire %+v", d, fire)
	if d.Area == 0 || fire.Area == 0 || d.Stages[4].ID == 0 {
		t.Fatal("Blizzard or Rain of Fire has no area effect or channel")
	}
	d.Area, d.AreaFrom = fire.Area, fire.AreaFrom
	id, files, err := planSpellVisualFiles(set, dataDir, d)
	if err != nil || len(files) != 1 || files[0].Name != SpellVisualPath {
		t.Fatalf("lava blizzard: %d, %d files, %v", id, len(files), err)
	}
	nv, _ := parseDBC(files[0].Data)
	r, _ := nv.row(uint32(id))
	b, _ := v.row(259)
	fr, _ := v.row(329)
	for f := 1; f < visualFields; f++ {
		want := v.u32(b, f)
		if f >= visualArea && f < visualArea+3 {
			want = v.u32(fr, f)
		}
		if nv.u32(r, f) != want {
			t.Errorf("field %d is %d, want %d", f, nv.u32(r, f), want)
		}
	}
	if nv.records != v.records+1 {
		t.Fatalf("%d visuals, was %d", nv.records, v.records)
	}
}

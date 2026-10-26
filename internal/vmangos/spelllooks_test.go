package vmangos

import (
	"sort"
	"strings"
	"testing"
	"time"
)

// An exported script carries the spells' icon and visual as "-- meld" lines, and importing it on a
// client that lacks them (or holds other rows under their IDs) adds or finds them and rewrites the
// rows' IDs; on the client it came from nothing changes (#381).
func TestSpellScriptLooks(t *testing.T) {
	// The exporting client: icon 7 Interface\Icons\Meld_Bolt (Meld-added), visual 10 with kit 5.
	iconFrom := iconTable(map[uint32]string{1: `Interface\Icons\Temp`, 7: `Interface\Icons\Meld_Bolt`})
	visFrom, kitFrom := visualTables()
	it, _ := parseDBC(iconFrom)
	vt, _ := parseDBC(visFrom)
	kt, _ := parseDBC(kitFrom)
	cols := append(spellScript.keyColumns(),
		TemplateColumn{Name: "name", Kind: "text", MaxLen: 256},
		TemplateColumn{Name: "spellIconId", Kind: "uint", Max: 1<<32 - 1},
		TemplateColumn{Name: "spellVisual1", Kind: "uint", Max: 1<<32 - 1})
	rows := []batchRow{{"40000", "5875", "Bolt", "7", "10"}, {"40001", "5875", "Plain", "1", "0"}}
	extra := looksComment(cols, rows, it, vt, kt)
	if !strings.Contains(extra, "-- meld icon 7 Interface\\Icons\\Meld_Bolt\n") || !strings.Contains(extra, "-- meld icon 1 Interface\\Icons\\Temp\n") ||
		!strings.Contains(extra, "-- meld visual 10 5 0 0 0 0 1 7 2 3 4 0 0 0 0 0\n") || !strings.Contains(extra, "-- meld kit 5 ") {
		t.Fatalf("looks:\n%s", extra)
	}
	script := templateScript(spellScript, cols, rows, extra, time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC))
	plan, err := planScript(spellScript, script, []string{"entry", "build", "name", "spellIconId", "spellVisual1"})
	if err != nil || plan.skipped != 0 || len(plan.rows) != 2 {
		t.Fatalf("the meld lines are read as statements: %+v %v", plan, err)
	}
	l := readScriptLooks(script)
	if l.icons[7] != `Interface\Icons\Meld_Bolt` || len(l.visuals[10]) != visualFields || l.visuals[10][6] != 1 || len(l.kits[5]) != kitFields || l.kits[5][kitEffectsBase+3] != 7 {
		t.Fatalf("read back %+v", l)
	}
	used := func(ids ...int) map[int]bool {
		m := map[int]bool{}
		for _, id := range ids {
			m[id] = true
		}
		return m
	}

	// The same client: every row found under its own ID, nothing written.
	p, err := planLooks(l, used(1, 7), used(10), iconFrom, visFrom, kitFrom)
	if err != nil || len(p.icons) != 0 || len(p.visuals) != 0 || p.files != nil {
		t.Fatalf("same client: %+v %v", p, err)
	}

	// Another client: icon 7 is another texture, the bolt's is missing; visual 10 and kit 5 are
	// other rows; Temp is icon 1 there too.
	iconTo := iconTable(map[uint32]string{1: `Interface\Icons\Temp`, 7: `Interface\Icons\Other`, 9: `Interface\Icons\Third`})
	otherVis := make([]uint32, visualFields)
	otherVis[0], otherVis[1] = 10, 5
	otherKit := make([]uint32, kitFields)
	otherKit[0] = 5
	for i := 0; i < kitSlots; i++ {
		otherKit[kitEffectsBase+i] = none
	}
	visTo := dbcBytes(visualFields, [][]uint32{otherVis}, "\x00")
	kitTo := dbcBytes(kitFields, [][]uint32{otherKit}, "\x00")
	p, err = planLooks(l, used(1, 7), used(10), iconTo, visTo, kitTo)
	if err != nil {
		t.Fatal(err)
	}
	if p.icons[7] != 10 || len(p.icons) != 1 || p.visuals[10] != 11 || len(p.files) != 3 {
		t.Fatalf("other client: %+v", p)
	}
	byName := map[string][]byte{}
	for _, f := range p.files {
		byName[f.Name] = f.Data
	}
	ni, _ := parseDBC(byName[SpellIconPath])
	if r, ok := ni.row(10); !ok || ni.str(r, 1) != `Interface\Icons\Meld_Bolt` {
		t.Fatal("the bolt's icon wasn't added")
	}
	nk, _ := parseDBC(byName[SpellVisualKitPath])
	if r, ok := nk.row(6); !ok || nk.u32(r, kitEffectsBase+3) != 7 || nk.u32(r, 2) != 52 {
		t.Fatal("the kit wasn't added")
	}
	nv, _ := parseDBC(byName[SpellVisualPath])
	if r, ok := nv.row(11); !ok || nv.u32(r, 1) != 6 || nv.u32(r, 7) != 7 || nv.u32(r, 9) != 3 {
		t.Fatal("the visual wasn't added with the new kit")
	}
	if r, _ := nv.row(10); nv.u32(r, 6) != 0 {
		t.Fatal("the client's own visual 10 changed")
	}

	// The rows' IDs are rewritten to the client's, the plain spell's left alone.
	r0 := sqlRow{values: map[string]string{"spellIconId": "7", "spellVisual1": "10"}}
	r1 := sqlRow{values: map[string]string{"spellIconId": "1", "spellVisual1": "0"}}
	p.rewrite([]sqlRow{r0, r1})
	if r0.values["spellIconId"] != "10" || r0.values["spellVisual1"] != "11" || r1.values["spellIconId"] != "1" || r1.values["spellVisual1"] != "0" {
		t.Fatalf("rows %v %v", r0.values, r1.values)
	}

	// A client that has the bolt's visual under another ID: found, not added.
	moved := append([]uint32(nil), l.visuals[10]...)
	moved[0], moved[1] = 30, 8
	kit8 := append([]uint32(nil), l.kits[5]...)
	kit8[0] = 8
	p, err = planLooks(l, nil, used(10), iconTo, dbcBytes(visualFields, [][]uint32{otherVis, moved}, "\x00"), dbcBytes(kitFields, [][]uint32{otherKit, kit8}, "\x00"))
	if err != nil || p.visuals[10] != 30 || p.files != nil {
		t.Fatalf("found elsewhere: %+v %v", p, err)
	}

	// A script without the lines changes nothing.
	if l := readScriptLooks("REPLACE INTO spell_template (entry) VALUES (1);\n-- meld icon x y\n-- meld visual 3 1 2\n"); len(l.icons)+len(l.visuals)+len(l.kits) != 0 {
		t.Fatalf("bad lines read: %+v", l)
	}
}

// iconTable makes a SpellIcon.dbc of the icons (ID and texture path).
func iconTable(icons map[uint32]string) []byte {
	ids := make([]int, 0, len(icons))
	for id := range icons {
		ids = append(ids, int(id))
	}
	sort.Ints(ids)
	block := "\x00"
	var rows [][]uint32
	for _, id := range ids {
		rows = append(rows, []uint32{uint32(id), uint32(len(block))})
		block += icons[uint32(id)] + "\x00"
	}
	return dbcBytes(2, rows, block)
}

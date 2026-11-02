package vmangos

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fakeSource is a carriedSource over rows in memory: each table's columns and its rows in their order.
type fakeSource struct {
	cols map[string][]TemplateColumn
	data map[string][]batchRow
}

func (f *fakeSource) columns(table string) ([]TemplateColumn, error) {
	c, ok := f.cols[table]
	if !ok {
		return nil, fmt.Errorf("no table %s", table)
	}
	return c, nil
}

func (f *fakeSource) rows(t carriedTable, cols []TemplateColumn, ids []int) ([]batchRow, error) {
	ci := columnIndex(cols, t.id)
	want := map[int]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var out []batchRow
	for _, r := range f.data[t.name] {
		if n, _ := strconv.Atoi(r[ci]); want[n] {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { a, _ := strconv.Atoi(out[i][ci]); b, _ := strconv.Atoi(out[j][ci]); return a < b })
	return out, nil
}

func (f *fakeSource) maxID(t carriedTable) (int, error) {
	cols, err := f.columns(t.name)
	if err != nil {
		return 0, err
	}
	ci, top := columnIndex(cols, t.id), 0
	for _, r := range f.data[t.name] {
		n, _ := strconv.Atoi(r[ci])
		top = max(top, n)
	}
	return top, nil
}

func carriedTestCols() map[string][]TemplateColumn {
	u := func(name string, top int64) TemplateColumn { return TemplateColumn{Name: name, Kind: "uint", Max: top} }
	loot := []TemplateColumn{u("entry", 1<<24-1), u("item", 1<<24-1), {Name: "ChanceOrQuestChance", Kind: "float"}, u("groupid", 255),
		{Name: "mincountOrRef", Kind: "int", Min: -1 << 23, Max: 1<<23 - 1}, u("maxcount", 255)}
	return map[string][]TemplateColumn{
		"creature_loot_template":  loot,
		"reference_loot_template": loot,
		"creature_equip_template": {u("entry", 1<<24-1), u("item1", 1<<24-1), u("item2", 1<<24-1), u("item3", 1<<24-1)},
		"gossip_menu":             {u("entry", 65535), u("text_id", 1<<24-1)},
		"gossip_menu_option": {u("menu_id", 65535), u("id", 65535), {Name: "option_text", Kind: "text", Nullable: true}, u("option_broadcast_text", 1<<24-1),
			{Name: "action_menu_id", Kind: "int", Min: -1 << 23, Max: 1<<23 - 1}},
		"npc_text":       {u("ID", 1<<24-1), u("BroadcastTextID0", 1<<24-1), {Name: "Probability0", Kind: "float"}},
		"broadcast_text": {u("entry", 1<<24-1), {Name: "male_text", Kind: "text", Nullable: true}},
	}
}

// A creature's loot (with the reference loot it names), equipment and gossip menu (two menus whose
// options open each other, their text and its broadcast text) travel in its script by their IDs
// (#991): kept on the server they came from; on another, each set the server holds other rows of
// under its ID (or that names such a set) comes to a fresh ID, and the template and the sets naming it
// are rewritten, the menus' loop too.
func TestCarriedSets(t *testing.T) {
	cols := append(creatureScript.keyColumns(),
		TemplateColumn{Name: "name", Kind: "text", MaxLen: 100},
		TemplateColumn{Name: "loot_id", Kind: "uint", Max: 1<<24 - 1},
		TemplateColumn{Name: "gossip_menu_id", Kind: "uint", Max: 1<<24 - 1},
		TemplateColumn{Name: "equipment_id", Kind: "uint", Max: 1<<24 - 1},
		TemplateColumn{Name: "spell_list_id", Kind: "uint", Max: 1<<32 - 1})
	rows := []batchRow{{"90001", "0", "Probe Guard", "500", "70", "5", "0"}}
	src := &fakeSource{cols: carriedTestCols(), data: map[string][]batchRow{
		"creature_loot_template":  {{"500", "2589", "50", "0", "1", "3"}, {"500", "0", "100", "0", "-600", "1"}, {"501", "1", "1", "0", "1", "1"}},
		"reference_loot_template": {{"600", "12000", "100", "0", "1", "1"}},
		"creature_equip_template": {{"5", "1899", "0", "0"}},
		"gossip_menu":             {{"70", "80"}, {"71", "80"}},
		"gossip_menu_option":      {{"70", "0", "Tell me more.", "0", "71"}, {"70", "1", "NULL", "0", "-1"}, {"71", "0", "Back", "90", "70"}},
		"npc_text":                {{"80", "90", "1"}},
		"broadcast_text":          {{"90", "Well met, it's \"you\"."}},
	}}
	carried, err := exportCarried(src, creatureRoots, cols, rows)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"-- Loot list 500: creature_loot_template (2 rows)\nDELETE FROM `creature_loot_template` WHERE `entry` = 500;\n",
		"(600, 12000, 100, 0, 1, 1);\n",
		"-- Equipment 5: creature_equip_template (1 row)\n",
		"-- Gossip menu 70: gossip_menu_option (2 rows)\n",
		"(70, 1, NULL, 0, -1);\n",
		"-- Gossip menu 71: gossip_menu (1 row)\n",
		"-- Gossip text 80: npc_text (1 row)\n",
		"(90, 'Well met, it\\'s \"you\".');\n",
	} {
		if !strings.Contains(carried, want) {
			t.Fatalf("missing %q in\n%s", want, carried)
		}
	}
	if strings.Contains(carried, "501") || strings.Contains(carried, "creature_spells") {
		t.Fatalf("a set no template names:\n%s", carried)
	}
	script := templateScript(creatureScript, cols, rows, creatureHeader, time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)) + carried +
		// A loot list no template names: left out.
		"DELETE FROM `creature_loot_template` WHERE `entry` = 9;\nINSERT INTO `creature_loot_template` (`entry`, `item`) VALUES (9, 1), (9, 2);\n"
	order := []string{"entry", "patch", "name", "loot_id", "gossip_menu_id", "equipment_id", "spell_list_id"}

	tmpl, err := planScript(creatureScript, script, order)
	if err != nil {
		t.Fatal(err)
	}
	p, err := planCarried(src, script, creatureRoots, tmpl.rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.sets) != 7 || p.others != 3 || p.stmts != 20 {
		t.Fatalf("%d sets, %d others, %d statements: %+v", len(p.sets), p.others, p.stmts, p.imports())
	}
	if p.stmts != tmpl.skipped {
		t.Fatalf("the template plan skipped %d statements, the sets took %d", tmpl.skipped, p.stmts)
	}
	for _, s := range p.imports() {
		if !s.Same || s.To != s.ID {
			t.Errorf("on the server it came from: %+v", s)
		}
	}
	if sql, err := p.sql(src); sql != "" || err != nil {
		t.Fatalf("the server it came from gets %q, %v", sql, err)
	}

	// Another server: its broadcast text 90 says something else, its loot list 500 is the same but its
	// reference loot 600 isn't, it has no equipment 5, and the same menus and text.
	other := &fakeSource{cols: src.cols, data: map[string][]batchRow{
		"creature_loot_template":  {src.data["creature_loot_template"][0], src.data["creature_loot_template"][1], {"700", "1", "1", "0", "1", "1"}},
		"reference_loot_template": {{"600", "12001", "100", "0", "1", "1"}, {"650", "1", "1", "0", "1", "1"}},
		"creature_equip_template": {{"7", "1", "0", "0"}},
		"gossip_menu":             src.data["gossip_menu"],
		"gossip_menu_option":      src.data["gossip_menu_option"],
		"npc_text":                src.data["npc_text"],
		"broadcast_text":          {{"90", "Go away."}, {"95", "x"}},
	}}
	tmpl, _ = planScript(creatureScript, script, order)
	p, err = planCarried(other, script, creatureRoots, tmpl.rows)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for _, s := range p.imports() {
		got[fmt.Sprintf("%s %d", s.What, s.ID)] = s.To
		if s.Same {
			t.Errorf("kept %+v", s)
		}
	}
	want := map[string]int{"equipment 5": 8, "loot list 500": 701, "reference loot list 600": 651, "gossip menu 70": 72, "gossip menu 71": 73, "gossip text 80": 81, "broadcast text 90": 96}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s comes to %d, want %d (%v)", k, got[k], v, got)
		}
	}
	if r := tmpl.rows[0].values; r["loot_id"] != "701" || r["gossip_menu_id"] != "72" || r["equipment_id"] != "8" || r["spell_list_id"] != "0" {
		t.Fatalf("template %v", r)
	}
	sql, err := p.sql(other)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"REPLACE INTO `creature_loot_template` (`entry`, `item`, `ChanceOrQuestChance`, `groupid`, `mincountOrRef`, `maxcount`) VALUES (701, 0, 100, 0, -651, 1);\n",
		"REPLACE INTO `reference_loot_template` (`entry`, `item`, `ChanceOrQuestChance`, `groupid`, `mincountOrRef`, `maxcount`) VALUES (651, 12000, 100, 0, 1, 1);\n",
		"REPLACE INTO `gossip_menu` (`entry`, `text_id`) VALUES (72, 81);\n",
		"VALUES (72, 0, 'Tell me more.', 0, 73);\n",
		"VALUES (72, 1, NULL, 0, -1);\n",
		"VALUES (73, 0, 'Back', 96, 72);\n",
		"REPLACE INTO `npc_text` (`ID`, `BroadcastTextID0`, `Probability0`) VALUES (81, 96, 1);\n",
		"REPLACE INTO `broadcast_text` (`entry`, `male_text`) VALUES (96, 'Well met, it\\'s \"you\".');\n",
		"REPLACE INTO `creature_equip_template` (`entry`, `item1`, `item2`, `item3`) VALUES (8, 1899, 0, 0);\n",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("missing %q in\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "(500,") || strings.Contains(sql, "(600,") || strings.Contains(sql, "(90,") {
		t.Errorf("wrote over a set of the server:\n%s", sql)
	}

	// A server with no free ID left for a menu refuses the import.
	full := &fakeSource{cols: other.cols, data: map[string][]batchRow{}}
	for k, v := range other.data {
		full.data[k] = v
	}
	full.data["gossip_menu"] = append(append([]batchRow{}, other.data["gossip_menu"]...), batchRow{"65535", "1"})
	full.data["broadcast_text"] = other.data["broadcast_text"]
	tmpl, _ = planScript(creatureScript, script, order)
	if _, err := planCarried(full, script, creatureRoots, tmpl.rows); err == nil || !strings.Contains(err.Error(), "gossip menu 70") {
		t.Errorf("no free menu ID: %v", err)
	}
}

func TestRefID(t *testing.T) {
	for _, c := range []struct {
		v    string
		ref  bool
		want int
	}{{"5", false, 5}, {"-1", false, 0}, {"0", false, 0}, {"x", false, 0}, {"-600", true, 600}, {"3", true, 0}, {" 7 ", false, 7}} {
		if got := refID(c.v, c.ref); got != c.want {
			t.Errorf("refID(%q, %v) = %d, want %d", c.v, c.ref, got, c.want)
		}
	}
}

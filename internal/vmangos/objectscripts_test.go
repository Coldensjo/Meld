package vmangos

import (
	"strings"
	"testing"
	"time"

	"Meld/internal/testclient"
)

func TestObjectLoot(t *testing.T) {
	for _, c := range []struct {
		typ, data1 string
		want       int
	}{
		{"3", "2265", 2265}, {"25", "7", 7}, {"2", "2265", 0}, {"3", "0", 0}, {"3", "-4", 0}, {"3", "x", 0}, {"", "", 0},
	} {
		if got := objectLoot(c.typ, c.data1); got != c.want {
			t.Errorf("objectLoot(%q, %q) = %d, want %d", c.typ, c.data1, got, c.want)
		}
	}
}

// An exported chest, with its contents and quests, reads back as the same rows, its quest lists
// replaced and its contents, the loot list its data1 names, carried by that ID (#991): left as they
// are on a server holding the same, moved to a fresh ID with data1 on one holding other contents there.
func TestObjectScriptRoundTrip(t *testing.T) {
	cols := append(objectScript.keyColumns(),
		TemplateColumn{Name: "type", Kind: "uint", Max: 255},
		TemplateColumn{Name: "name", Kind: "text", MaxLen: 100},
		TemplateColumn{Name: "data1", Kind: "int", Min: -1 << 31, Max: 1<<31 - 1})
	rows := []batchRow{{"90001", "0", "3", "Probe's Chest", "4001"}, {"90001", "7", "3", "Probe's Chest", "4001"}, {"90002", "0", "2", "Probe's Sign", "4002"}}
	lcols := []TemplateColumn{{Name: "entry", Kind: "uint", Max: 1<<24 - 1}, {Name: "item", Kind: "uint", Max: 1<<24 - 1},
		{Name: "ChanceOrQuestChance", Kind: "float"}, {Name: "groupid", Kind: "uint", Max: 255}, {Name: "mincountOrRef", Kind: "int", Min: -1 << 23, Max: 1<<23 - 1}, {Name: "maxcount", Kind: "uint", Max: 255}}
	qcols := []TemplateColumn{{Name: "id", Kind: "uint", Max: 1<<24 - 1}, {Name: "quest", Kind: "uint", Max: 1<<24 - 1}}
	src := &fakeSource{cols: map[string][]TemplateColumn{lootTable: lcols, "reference_loot_template": lcols}, data: map[string][]batchRow{
		// 4002 is the sign's data1, which names no loot.
		lootTable:                 {{"4001", "2589", "50", "0", "1", "3"}, {"4001", "0", "100", "0", "-12000", "1"}, {"4002", "1", "1", "0", "1", "1"}},
		"reference_loot_template": {{"12000", "4306", "25.5", "1", "1", "2"}},
	}}
	starts := objectLists[0]
	carried, err := exportCarried(src, objectRoots, cols, rows)
	if err != nil {
		t.Fatal(err)
	}
	script := templateScript(objectScript, cols, rows, objectHeader, time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)) +
		listScript(starts, qcols, []batchRow{{"90001", "33"}}, []int{90001}) + carried +
		// The quests of an object the script has no template row of: left out.
		"INSERT INTO `gameobject_questrelation` (`id`, `quest`) VALUES (5, 7);\n"
	for _, want := range []string{
		"-- Loot list 4001: gameobject_loot_template (2 rows)\nDELETE FROM `gameobject_loot_template` WHERE `entry` = 4001;\nREPLACE INTO `gameobject_loot_template` (`entry`, `item`, `ChanceOrQuestChance`, `groupid`, `mincountOrRef`, `maxcount`) VALUES\n(4001, 2589, 50, 0, 1, 3),\n(4001, 0, 100, 0, -12000, 1);\n",
		"-- Reference loot list 12000: reference_loot_template (1 row)\n",
		"-- Object 90001: the quests it starts (1 row)\nDELETE FROM `gameobject_questrelation` WHERE `id` = 90001;\n",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("missing %q in\n%s", want, script)
		}
	}
	if strings.Contains(script, "4002;") {
		t.Fatalf("the sign's data1 was taken for loot:\n%s", script)
	}
	tmpl, err := planScript(objectScript, script, []string{"entry", "patch", "type", "name", "data1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(tmpl.rows) != 3 || tmpl.rows[1].values["data1"] != "4001" {
		t.Fatalf("template %+v", tmpl.rows)
	}
	// On the server it came from, the contents are the same: kept, data1 as it was.
	p, err := planCarried(src, script, objectRoots, tmpl.rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.sets) != 2 || !p.sets[0].same || !p.sets[1].same || p.sets[0].to != 4001 || tmpl.rows[0].values["data1"] != "4001" {
		t.Fatalf("same server: %+v", p.imports())
	}
	if sql, err := p.sql(src); err != nil || sql != "" {
		t.Fatalf("same server writes %q, %v", sql, err)
	}
	if got := p.items(); len(got) != 2 || got[0] != 2589 || got[1] != 4306 {
		t.Fatalf("items %v", got)
	}
	// On a server whose loot list 4001 holds other contents, the chest's come to a fresh ID, and
	// both of its patch rows' data1 with them.
	other := &fakeSource{cols: src.cols, data: map[string][]batchRow{
		lootTable:                 {{"4001", "1", "1", "0", "1", "1"}, {"4500", "1", "1", "0", "1", "1"}},
		"reference_loot_template": src.data["reference_loot_template"],
	}}
	tmpl, _ = planScript(objectScript, script, []string{"entry", "patch", "type", "name", "data1"})
	p, err = planCarried(other, script, objectRoots, tmpl.rows)
	if err != nil {
		t.Fatal(err)
	}
	if p.sets[0].same || p.sets[0].to != 4501 || !p.sets[1].same || tmpl.rows[0].values["data1"] != "4501" || tmpl.rows[1].values["data1"] != "4501" || tmpl.rows[2].values["data1"] != "4002" {
		t.Fatalf("other server: %+v, data1 %s", p.imports(), tmpl.rows[0].values["data1"])
	}
	sql, err := p.sql(other)
	want := "REPLACE INTO `gameobject_loot_template` (`entry`, `item`, `ChanceOrQuestChance`, `groupid`, `mincountOrRef`, `maxcount`) VALUES (4501, 2589, 50, 0, 1, 3);\n" +
		"REPLACE INTO `gameobject_loot_template` (`entry`, `item`, `ChanceOrQuestChance`, `groupid`, `mincountOrRef`, `maxcount`) VALUES (4501, 0, 100, 0, -12000, 1);\n"
	if err != nil || sql != want {
		t.Fatalf("sql\n%s\nwant\n%s (%v)", sql, want, err)
	}
	qp, err := planList(starts, script, tmpl.entries(), []string{"id", "quest", "patch_min", "patch_max"})
	if err != nil || len(qp.replaced) != 1 || qp.replaced[0] != 90001 || len(qp.rows) != 1 || qp.others != 1 {
		t.Fatalf("quest plan %+v %v", qp, err)
	}
	// A loot row out of range names its loot list.
	bad := "REPLACE INTO gameobject_template (entry, type, data1) VALUES (90001, 3, 4001);\nINSERT INTO gameobject_loot_template (entry, item, maxcount) VALUES (4001, 4, 900);"
	tmpl, _ = planScript(objectScript, bad, []string{"entry", "patch", "type", "data1"})
	p, err = planCarried(other, bad, objectRoots, tmpl.rows)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.sql(other); err == nil || !strings.Contains(err.Error(), "loot list 4001") {
		t.Errorf("an out of range count: %v", err)
	}
}

// A readable object's text, the page_text chain its data0 (a text object) or data7 (a goober) names,
// travels page by page (#992): left as it is on a server holding the same pages, and on one holding
// other text under a page, that page and the ones naming it come to fresh IDs, past the largest page
// in use, with next_page and the objects' columns rewritten.
func TestObjectPagesRoundTrip(t *testing.T) {
	cols := append(objectScript.keyColumns(),
		TemplateColumn{Name: "type", Kind: "uint", Max: 255},
		TemplateColumn{Name: "name", Kind: "text", MaxLen: 100},
		TemplateColumn{Name: "data0", Kind: "int", Min: -1 << 31, Max: 1<<31 - 1},
		TemplateColumn{Name: "data7", Kind: "int", Min: -1 << 31, Max: 1<<31 - 1})
	order := []string{"entry", "patch", "type", "name", "data0", "data7"}
	// A plaque (500, then 501), a goober reading 600 with lock 77 in data0, and a door whose data0 is
	// no page.
	rows := []batchRow{{"90003", "0", "9", "Probe's Plaque", "500", "0"}, {"90004", "0", "10", "Probe's Book", "77", "600"}, {"90005", "0", "0", "Probe's Door", "501", "0"}}
	pcols := []TemplateColumn{{Name: "entry", Kind: "uint", Max: 1<<24 - 1}, {Name: "text", Kind: "text"}, {Name: "next_page", Kind: "uint", Max: 1<<24 - 1}}
	src := &fakeSource{cols: map[string][]TemplateColumn{"page_text": pcols}, data: map[string][]batchRow{
		"page_text": {{"77", "Not a page of these", "0"}, {"500", "Here lies\nIt's Probe", "501"}, {"501", "The end", "0"}, {"600", "A book", "0"}},
	}}
	carried, err := exportCarried(src, objectRoots, cols, rows)
	if err != nil {
		t.Fatal(err)
	}
	script := templateScript(objectScript, cols, rows, objectHeader, time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)) + carried
	for _, want := range []string{
		"-- Page 500: page_text (1 row)\nDELETE FROM `page_text` WHERE `entry` = 500;\nREPLACE INTO `page_text` (`entry`, `text`, `next_page`) VALUES\n(500, 'Here lies\\nIt\\'s Probe', 501);\n",
		"-- Page 501: page_text (1 row)\n",
		"-- Page 600: page_text (1 row)\n",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("missing %q in\n%s", want, script)
		}
	}
	if strings.Contains(script, "Page 77") {
		t.Fatalf("the goober's lock was taken for a page:\n%s", script)
	}
	tmpl, err := planScript(objectScript, script, order)
	if err != nil {
		t.Fatal(err)
	}
	// On the server it came from, the pages are the same: kept, the columns as they were.
	p, err := planCarried(src, script, objectRoots, tmpl.rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.sets) != 3 || !p.sets[0].same || !p.sets[1].same || !p.sets[2].same {
		t.Fatalf("same server: %+v", p.imports())
	}
	if sql, err := p.sql(src); err != nil || sql != "" {
		t.Fatalf("same server writes %q, %v", sql, err)
	}
	// On a server whose page 501 says something else and which lacks 600, 501 moves, 500 with it as
	// it names 501, and 600 too; the door's data0 stays.
	other := &fakeSource{cols: src.cols, data: map[string][]batchRow{
		"page_text": {{"500", "Here lies\nIt's Probe", "501"}, {"501", "Other text", "0"}, {"700", "Last", "0"}},
	}}
	tmpl, _ = planScript(objectScript, script, order)
	p, err = planCarried(other, script, objectRoots, tmpl.rows)
	if err != nil {
		t.Fatal(err)
	}
	got := []int{p.sets[0].to, p.sets[1].to, p.sets[2].to}
	if p.sets[0].same || p.sets[1].same || p.sets[2].same || got[0] != 701 || got[1] != 702 || got[2] != 703 {
		t.Fatalf("other server: %+v", p.imports())
	}
	if v := tmpl.rows[0].values; v["data0"] != "701" {
		t.Errorf("plaque %v", v)
	}
	if v := tmpl.rows[1].values; v["data0"] != "77" || v["data7"] != "703" {
		t.Errorf("goober %v", v)
	}
	if v := tmpl.rows[2].values; v["data0"] != "501" {
		t.Errorf("door %v", v)
	}
	sql, err := p.sql(other)
	want := "REPLACE INTO `page_text` (`entry`, `text`, `next_page`) VALUES (701, 'Here lies\\nIt\\'s Probe', 702);\n" +
		"REPLACE INTO `page_text` (`entry`, `text`, `next_page`) VALUES (702, 'The end', 0);\n" +
		"REPLACE INTO `page_text` (`entry`, `text`, `next_page`) VALUES (703, 'A book', 0);\n"
	if err != nil || sql != want {
		t.Fatalf("sql\n%s\nwant\n%s (%v)", sql, want, err)
	}
}

// TestObjectsLive exports a chest whose contents other chests share and a quest giver, and plans the
// script back, from the server. It needs VMANGOS_DIR (database running) and writes nothing.
func TestObjectsLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	// Battered Chest (two patch rows, loot list 2265, which four other chests hold) and Old Lion
	// Statue (two quests it starts, one it ends), and two readable objects (#992): Missing: Corporal
	// Keeshan (page 245) and A Treatise on Military Ranks (pages from 2654 on, which item 18664 reads
	// too).
	script, err := ExportObjects(dir, []int{2843, 31, 1726, 179706})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanObjectImport(dir, script)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v", plan)
	if len(plan.Objects) != 5 || len(plan.Unknown) != 0 || plan.Skipped != 0 || plan.Others != 0 {
		t.Fatalf("plan %+v", plan)
	}
	for _, o := range plan.Objects {
		if !o.Exists {
			t.Errorf("%+v is not there", o)
		}
	}
	for _, l := range plan.Lists {
		if l.Rows != l.Had {
			t.Errorf("%s of %s %d: %d rows, has %d", l.Table, l.Of, l.Entry, l.Rows, l.Had)
		}
	}
	if len(plan.Lists) != 8 {
		t.Fatalf("lists %+v", plan.Lists)
	}
	// Planned on the server it came from, the contents are the same and keep their ID.
	loot, pages := false, map[int]bool{}
	for _, c := range plan.Carried {
		if c.Table == "page_text" {
			pages[c.ID] = true
		}
		if !c.Same || c.To != c.ID || c.Rows == 0 {
			t.Errorf("carried %+v", c)
		}
		if c.Table == lootTable && c.ID == 2265 {
			loot = true
		}
	}
	if !loot || !pages[245] || !pages[2654] || len(pages) < 3 {
		t.Fatalf("carried %+v", plan.Carried)
	}
}

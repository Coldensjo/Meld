package vmangos

import (
	"strconv"
	"strings"
	"testing"
	"time"
)

// An exported item carries what it names by ID (#1044): a letter's pages (the page_text chain its
// page_text names), a clam's contents (item_loot_template, a list keyed by the item, with the
// reference loot a row names) and its disenchant loot. On the server it came from they are all kept;
// on one holding other rows under a page or the reference loot, those (and the page naming the moved
// one) come to fresh IDs, the letter's page_text and the contents row's mincountOrRef rewritten, while
// the disenchant loot the server holds the same stays.
func TestItemScriptCarried(t *testing.T) {
	cols := append(itemScript.keyColumns(),
		TemplateColumn{Name: "name", Kind: "text", MaxLen: 255},
		TemplateColumn{Name: "page_text", Kind: "uint", Max: 1<<24 - 1},
		TemplateColumn{Name: "disenchant_id", Kind: "uint", Max: 1<<24 - 1})
	order := []string{"entry", "patch", "name", "page_text", "disenchant_id"}
	rows := []batchRow{{"90001", "0", "Probe's Letter", "500", "0"}, {"90002", "0", "Probe's Clam", "0", "40"}}
	tc := carriedTestCols()
	loot := tc["reference_loot_template"]
	pcols := []TemplateColumn{{Name: "entry", Kind: "uint", Max: 1<<24 - 1}, {Name: "text", Kind: "text"}, {Name: "next_page", Kind: "uint", Max: 1<<24 - 1}}
	src := &fakeSource{cols: map[string][]TemplateColumn{"page_text": pcols, "disenchant_loot_template": loot, "reference_loot_template": loot}, data: map[string][]batchRow{
		"page_text":                {{"500", "Dear Probe,", "501"}, {"501", "Yours", "0"}},
		"disenchant_loot_template": {{"40", "10940", "100", "0", "1", "2"}},
		"reference_loot_template":  {{"12000", "4306", "25", "1", "1", "2"}},
	}}
	contents := itemLists[0]
	lc := append([]TemplateColumn{}, loot...)
	lrows := []batchRow{{"90002", "5503", "50", "0", "1", "1"}, {"90002", "12000", "100", "1", "-12000", "1"}}
	carried, err := exportCarriedFrom(src, itemRoots, carriedRows{cols, rows}, carriedRows{lc, lrows})
	if err != nil {
		t.Fatal(err)
	}
	script := templateScript(itemScript, cols, rows, itemHeader, time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)) +
		listScript(contents, lc, lrows, []int{90001, 90002}) + carried +
		// The contents of an item the script has no template row of: left out.
		"INSERT INTO `item_loot_template` (`entry`, `item`) VALUES (90009, 7);\n"
	for _, want := range []string{
		"-- Item 90001: the contents (0 rows)\nDELETE FROM `item_loot_template` WHERE `entry` = 90001;\n",
		"-- Item 90002: the contents (2 rows)\nDELETE FROM `item_loot_template` WHERE `entry` = 90002;\n",
		"-- Disenchant loot list 40: disenchant_loot_template (1 row)\n",
		"-- Reference loot list 12000: reference_loot_template (1 row)\n",
		"-- Page 500: page_text (1 row)\nDELETE FROM `page_text` WHERE `entry` = 500;\nREPLACE INTO `page_text` (`entry`, `text`, `next_page`) VALUES\n(500, 'Dear Probe,', 501);\n",
		"-- Page 501: page_text (1 row)\n",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("missing %q in\n%s", want, script)
		}
	}
	plan := func(s carriedSource) (scriptPlan, listPlan, carriedPlan) {
		t.Helper()
		tmpl, err := planScript(itemScript, script, order)
		if err != nil {
			t.Fatal(err)
		}
		lp, err := planList(contents, script, tmpl.entries(), []string{"entry", "item", "ChanceOrQuestChance", "groupid", "mincountOrRef", "maxcount"})
		if err != nil {
			t.Fatal(err)
		}
		p, err := planCarried(s, script, itemRoots, append(append([]sqlRow{}, tmpl.rows...), lp.rows...))
		if err != nil {
			t.Fatal(err)
		}
		return tmpl, lp, p
	}
	// On the server it came from, everything is the same: kept, the columns as they were.
	tmpl, lp, p := plan(src)
	if len(p.sets) != 4 || len(lp.replaced) != 2 || len(lp.rows) != 2 || lp.others != 1 {
		t.Fatalf("same server: %+v, contents %+v", p.imports(), lp)
	}
	for _, s := range p.sets {
		if !s.same || s.to != s.id {
			t.Fatalf("same server: %+v", p.imports())
		}
	}
	if sql, err := p.sql(src); err != nil || sql != "" {
		t.Fatalf("same server writes %q, %v", sql, err)
	}
	if got := p.items(); len(got) != 2 || got[0] != 10940 || got[1] != 4306 {
		t.Fatalf("items %v", got)
	}
	// On a server whose page 501 says something else and whose reference loot 12000 holds other
	// items, both pages and the reference loot come to fresh IDs; the disenchant loot stays.
	other := &fakeSource{cols: src.cols, data: map[string][]batchRow{
		"page_text":                {{"500", "Dear Probe,", "501"}, {"501", "Other text", "0"}},
		"disenchant_loot_template": src.data["disenchant_loot_template"],
		"reference_loot_template":  {{"12000", "1", "1", "0", "1", "1"}, {"12500", "1", "1", "0", "1", "1"}},
	}}
	tmpl, lp, p = plan(other)
	to := map[string]int{}
	for _, s := range p.sets {
		to[s.kind.key+" "+strconv.Itoa(s.id)] = s.to
		if s.same != (s.kind.key == "disenchant") {
			t.Fatalf("other server: %+v", p.imports())
		}
	}
	if to["disenchant 40"] != 40 || to["reference 12000"] != 12501 || to["page 500"] != 502 || to["page 501"] != 503 {
		t.Fatalf("other server: %v", to)
	}
	if v := tmpl.rows[0].values; v["page_text"] != "502" {
		t.Errorf("letter %v", v)
	}
	if v := tmpl.rows[1].values; v["page_text"] != "0" || v["disenchant_id"] != "40" {
		t.Errorf("clam %v", v)
	}
	ls, err := listSQL(lp, lc)
	if err != nil || !strings.Contains(ls, "VALUES (90002, 12000, 100, 1, -12501, 1);") || !strings.Contains(ls, "VALUES (90002, 5503, 50, 0, 1, 1);") {
		t.Fatalf("contents sql\n%s (%v)", ls, err)
	}
	sql, err := p.sql(other)
	want := "REPLACE INTO `reference_loot_template` (`entry`, `item`, `ChanceOrQuestChance`, `groupid`, `mincountOrRef`, `maxcount`) VALUES (12501, 4306, 25, 1, 1, 2);\n" +
		"REPLACE INTO `page_text` (`entry`, `text`, `next_page`) VALUES (502, 'Dear Probe,', 503);\n" +
		"REPLACE INTO `page_text` (`entry`, `text`, `next_page`) VALUES (503, 'Yours', 0);\n"
	if err != nil || sql != want {
		t.Fatalf("sql\n%s\nwant\n%s (%v)", sql, want, err)
	}
}

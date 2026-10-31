package vmangos

import (
	"strings"
	"testing"
	"time"

	"Meld/internal/testclient"
)

func TestParseDeletes(t *testing.T) {
	script := "DELETE FROM `npc_vendor` WHERE `entry` = 25;\n-- a; comment\ndelete from mangos.npc_vendor where entry='26'\n;" +
		"DELETE FROM `npc_vendor` WHERE `entry` = 27 AND `item` = 3;\nDELETE FROM `npc_vendor` WHERE `item` = 4;\n" +
		"DELETE FROM `creature_questrelation` WHERE `id` = 28;\nINSERT INTO npc_vendor (entry, item) VALUES (29, 'x;y');"
	got, err := parseDeletes(script, "npc_vendor", "entry")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != 25 || got[1] != 26 {
		t.Fatalf("deletes %v", got)
	}
	if got, _ := parseDeletes(script, "creature_questrelation", "id"); len(got) != 1 || got[0] != 28 {
		t.Fatalf("relation deletes %v", got)
	}
}

// An exported creature, with its shop and quests, reads back as the same rows, its lists replaced.
func TestCreatureScriptRoundTrip(t *testing.T) {
	cols := append(creatureScript.keyColumns(),
		TemplateColumn{Name: "name", Kind: "text", MaxLen: 100},
		TemplateColumn{Name: "subname", Kind: "text", MaxLen: 100, Nullable: true},
		TemplateColumn{Name: "npc_flags", Kind: "uint", Max: 1<<32 - 1})
	rows := []batchRow{{"90001", "0", "Gil's \"Goods\"", "NULL", "6"}}
	vendor := creatureLists[0]
	vcols := []TemplateColumn{{Name: "entry", Kind: "uint", Max: 1<<24 - 1}, {Name: "slot", Kind: "uint", Max: 65535}, {Name: "item", Kind: "uint", Max: 1<<24 - 1}, {Name: "maxcount", Kind: "uint", Max: 255}}
	starts := creatureLists[1]
	qcols := []TemplateColumn{{Name: "id", Kind: "uint", Max: 1<<24 - 1}, {Name: "quest", Kind: "uint", Max: 1<<24 - 1}, {Name: "patch_min", Kind: "uint", Max: 255}, {Name: "patch_max", Kind: "uint", Max: 255}}
	script := templateScript(creatureScript, cols, rows, creatureHeader, time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)) +
		listScript(vendor, vcols, []batchRow{{"90001", "0", "25", "0"}, {"90001", "1", "2361", "3"}}, []int{90001}) +
		listScript(starts, qcols, nil, []int{90001}) +
		// A list of a creature the script has no template row of: left out.
		"DELETE FROM `npc_vendor` WHERE `entry` = 5;\nINSERT INTO `npc_vendor` (`entry`, `item`) VALUES (5, 7);\n"
	for _, want := range []string{
		"DELETE FROM `npc_vendor` WHERE `entry` = 90001;\nREPLACE INTO `npc_vendor` (`entry`, `slot`, `item`, `maxcount`) VALUES\n(90001, 0, 25, 0),\n(90001, 1, 2361, 3);\n",
		"-- Creature 90001: the quests it starts (0 rows)\nDELETE FROM `creature_questrelation` WHERE `id` = 90001;\n",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("missing %q in\n%s", want, script)
		}
	}
	tmpl, err := planScript(creatureScript, script, []string{"entry", "patch", "name", "subname", "npc_flags"})
	if err != nil {
		t.Fatal(err)
	}
	if len(tmpl.rows) != 1 || tmpl.rows[0].values["name"] != "Gil's \"Goods\"" || !tmpl.rows[0].null["subname"] {
		t.Fatalf("template %+v", tmpl.rows)
	}
	// Five statements are the lists': the two vendor DELETEs, the two vendor rows' statements and the quest DELETE.
	if tmpl.skipped != 5 {
		t.Fatalf("skipped %d", tmpl.skipped)
	}
	vp, err := planList(vendor, script, tmpl.entries(), []string{"entry", "slot", "item", "maxcount", "incrtime"})
	if err != nil {
		t.Fatal(err)
	}
	if len(vp.replaced) != 1 || vp.replaced[0] != 90001 || len(vp.rows) != 2 || vp.others != 2 || vp.stmts != 4 {
		t.Fatalf("vendor plan %+v", vp)
	}
	sql, err := listSQL(vp, vcols)
	if err != nil {
		t.Fatal(err)
	}
	want := "DELETE FROM `npc_vendor` WHERE `entry` = 90001;\n" +
		"REPLACE INTO `npc_vendor` (`entry`, `slot`, `item`, `maxcount`) VALUES (90001, 0, 25, 0);\n" +
		"REPLACE INTO `npc_vendor` (`entry`, `slot`, `item`, `maxcount`) VALUES (90001, 1, 2361, 3);\n"
	if sql != want {
		t.Fatalf("sql\n%s\nwant\n%s", sql, want)
	}
	// An emptied list clears the creature's rows.
	qp, err := planList(starts, script, tmpl.entries(), []string{"id", "quest", "patch_min", "patch_max"})
	if err != nil || len(qp.replaced) != 1 || len(qp.rows) != 0 {
		t.Fatalf("quest plan %+v %v", qp, err)
	}
	if sql, _ := listSQL(qp, qcols); sql != "DELETE FROM `creature_questrelation` WHERE `id` = 90001;\n" {
		t.Fatalf("quest sql %q", sql)
	}
	// A script with no lists replaces none.
	if p, _ := planList(vendor, "REPLACE INTO creature_template (entry, name) VALUES (90001, 'x');", []int{90001}, []string{"entry", "item"}); len(p.replaced) != 0 {
		t.Fatalf("no lists: %+v", p)
	}
	// A row without its key, or a value out of range, is refused.
	if _, err := planList(vendor, "INSERT INTO npc_vendor (entry, slot) VALUES (90001, 1);", []int{90001}, []string{"entry", "slot", "item"}); err == nil {
		t.Error("a vendor row without an item was taken")
	}
	p, _ := planList(vendor, "INSERT INTO npc_vendor (entry, item, maxcount) VALUES (90001, 4, 900);", []int{90001}, []string{"entry", "item", "maxcount"})
	if _, err := listSQL(p, vcols); err == nil || !strings.Contains(err.Error(), "creature 90001, item 4") {
		t.Errorf("an out of range stock: %v", err)
	}
}

// TestCreaturesLive exports a creature with a shop and quests and plans the script back, from the
// server. It needs VMANGOS_DIR (database running) and writes nothing.
func TestCreaturesLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	script, err := ExportCreatures(dir, []int{7852}) // Pratt McGrubben: a shop, quests he starts and ends
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanCreatureImport(dir, script)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v", plan)
	if len(plan.Creatures) < 1 || !plan.Creatures[0].Exists || plan.Creatures[0].Name != "Pratt McGrubben" || len(plan.Unknown) != 0 || plan.Skipped != 0 || plan.Others != 0 {
		t.Fatalf("plan %+v", plan)
	}
	if len(plan.Lists) != 3 {
		t.Fatalf("lists %+v", plan.Lists)
	}
	for _, l := range plan.Lists {
		if l.Rows == 0 || l.Rows != l.Had {
			t.Errorf("%s: %d rows, has %d", l.Table, l.Rows, l.Had)
		}
	}
}

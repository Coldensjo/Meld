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

// An exported chest, with its contents and quests, reads back as the same rows, its lists replaced:
// the contents keyed by the loot list its data1 names, not by its entry.
func TestObjectScriptRoundTrip(t *testing.T) {
	cols := append(objectScript.keyColumns(),
		TemplateColumn{Name: "type", Kind: "uint", Max: 255},
		TemplateColumn{Name: "name", Kind: "text", MaxLen: 100},
		TemplateColumn{Name: "data1", Kind: "int", Min: -1 << 31, Max: 1<<31 - 1})
	rows := []batchRow{{"90001", "0", "3", "Probe's Chest", "4001"}, {"90001", "7", "3", "Probe's Chest", "4001"}}
	lcols := []TemplateColumn{{Name: "entry", Kind: "uint", Max: 1<<24 - 1}, {Name: "item", Kind: "uint", Max: 1<<24 - 1},
		{Name: "ChanceOrQuestChance", Kind: "float"}, {Name: "mincountOrRef", Kind: "int", Min: -1 << 23, Max: 1<<23 - 1}, {Name: "maxcount", Kind: "uint", Max: 255}}
	qcols := []TemplateColumn{{Name: "id", Kind: "uint", Max: 1<<24 - 1}, {Name: "quest", Kind: "uint", Max: 1<<24 - 1}}
	starts := objectLists[0]
	script := templateScript(objectScript, cols, rows, objectHeader, time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)) +
		listScript(starts, qcols, []batchRow{{"90001", "33"}}, []int{90001}) +
		listScript(objectLootList, lcols, []batchRow{{"4001", "2589", "50", "1", "3"}, {"4001", "12000", "100", "-12000", "1"}}, []int{4001}) +
		// The contents of a loot list no template row of the script names, and the quests of an object it
		// has no template row of: left out.
		"DELETE FROM `gameobject_loot_template` WHERE `entry` = 90001;\nINSERT INTO `gameobject_questrelation` (`id`, `quest`) VALUES (5, 7);\n"
	for _, want := range []string{
		"-- Loot list 4001: the contents (2 rows)\nDELETE FROM `gameobject_loot_template` WHERE `entry` = 4001;\nREPLACE INTO `gameobject_loot_template` (`entry`, `item`, `ChanceOrQuestChance`, `mincountOrRef`, `maxcount`) VALUES\n(4001, 2589, 50, 1, 3),\n(4001, 12000, 100, -12000, 1);\n",
		"-- Object 90001: the quests it starts (1 row)\nDELETE FROM `gameobject_questrelation` WHERE `id` = 90001;\n",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("missing %q in\n%s", want, script)
		}
	}
	tmpl, err := planScript(objectScript, script, []string{"entry", "patch", "type", "name", "data1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(tmpl.rows) != 2 || tmpl.rows[1].values["data1"] != "4001" {
		t.Fatalf("template %+v", tmpl.rows)
	}
	var loots []int
	for _, r := range tmpl.rows {
		loots = addOnce(loots, objectLoot(r.values["type"], r.values["data1"]))
	}
	if len(loots) != 1 || loots[0] != 4001 {
		t.Fatalf("loots %v", loots)
	}
	ids := objectListIDs(tmpl.entries(), loots)
	lp, err := planList(objectLootList, script, ids(objectLootList), []string{"entry", "item", "ChanceOrQuestChance", "groupid", "mincountOrRef", "maxcount"})
	if err != nil {
		t.Fatal(err)
	}
	if len(lp.replaced) != 1 || lp.replaced[0] != 4001 || len(lp.rows) != 2 || lp.others != 1 {
		t.Fatalf("loot plan %+v", lp)
	}
	sql, err := listSQL(lp, lcols)
	if err != nil {
		t.Fatal(err)
	}
	want := "DELETE FROM `gameobject_loot_template` WHERE `entry` = 4001;\n" +
		"REPLACE INTO `gameobject_loot_template` (`entry`, `item`, `ChanceOrQuestChance`, `mincountOrRef`, `maxcount`) VALUES (4001, 2589, 50, 1, 3);\n" +
		"REPLACE INTO `gameobject_loot_template` (`entry`, `item`, `ChanceOrQuestChance`, `mincountOrRef`, `maxcount`) VALUES (4001, 12000, 100, -12000, 1);\n"
	if sql != want {
		t.Fatalf("sql\n%s\nwant\n%s", sql, want)
	}
	qp, err := planList(starts, script, ids(starts), []string{"id", "quest", "patch_min", "patch_max"})
	if err != nil || len(qp.replaced) != 1 || qp.replaced[0] != 90001 || len(qp.rows) != 1 || qp.others != 1 {
		t.Fatalf("quest plan %+v %v", qp, err)
	}
	// A loot row out of range names its loot list.
	p, _ := planList(objectLootList, "INSERT INTO gameobject_loot_template (entry, item, maxcount) VALUES (4001, 4, 900);", []int{4001}, []string{"entry", "item", "maxcount"})
	if _, err := listSQL(p, lcols); err == nil || !strings.Contains(err.Error(), "loot list 4001, item 4") {
		t.Errorf("an out of range count: %v", err)
	}
}

// TestObjectsLive exports a chest whose contents other chests share and a quest giver, and plans the
// script back, from the server. It needs VMANGOS_DIR (database running) and writes nothing.
func TestObjectsLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	// Battered Chest (two patch rows, loot list 2265, which four other chests hold) and Old Lion
	// Statue (two quests it starts, one it ends).
	script, err := ExportObjects(dir, []int{2843, 31})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanObjectImport(dir, script)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v", plan)
	if len(plan.Objects) != 3 || len(plan.Unknown) != 0 || plan.Skipped != 0 || plan.Others != 0 {
		t.Fatalf("plan %+v", plan)
	}
	for _, o := range plan.Objects {
		if !o.Exists {
			t.Errorf("%+v is not there", o)
		}
	}
	loot := false
	for _, l := range plan.Lists {
		if l.Rows != l.Had {
			t.Errorf("%s of %s %d: %d rows, has %d", l.Table, l.Of, l.Entry, l.Rows, l.Had)
		}
		if l.Table == lootTable {
			loot = l.Entry == 2265 && l.Rows > 0 && l.Of == "loot list"
		}
	}
	if !loot || len(plan.Lists) != 5 {
		t.Fatalf("lists %+v", plan.Lists)
	}
	if len(plan.Shared) == 0 {
		t.Fatal("no other chest shares loot list 2265")
	}
	for _, s := range plan.Shared {
		if s.Loot != 2265 || s.Entry == 2843 {
			t.Errorf("shared %+v", s)
		}
	}
}

package vmangos

import (
	"strings"
	"testing"
	"time"

	"Meld/internal/testclient"
)

// An exported quest chain, with its givers, reads back as the same rows, its givers replaced and keyed
// by the quest; a row is held to the quest editor's rules, the script's own quests counting as there.
func TestQuestScriptRoundTrip(t *testing.T) {
	cols := append(questScript.keyColumns(),
		TemplateColumn{Name: "Title", Kind: "text", Nullable: true},
		TemplateColumn{Name: "PrevQuestId", Kind: "int", Min: -1 << 23, Max: 1<<23 - 1},
		TemplateColumn{Name: "RewItemId1", Kind: "uint", Max: 1<<24 - 1},
		TemplateColumn{Name: "RewItemCount1", Kind: "uint", Max: 255})
	rows := []batchRow{{"90001", "0", "Probe's Errand", "0", "0", "0"}, {"90002", "0", "Probe's Return", "90001", "4000", "1"}}
	rcols := []TemplateColumn{{Name: "quest", Kind: "uint", Max: 1<<24 - 1}, {Name: "id", Kind: "uint", Max: 1<<24 - 1},
		{Name: "patch_min", Kind: "uint", Max: 255}, {Name: "patch_max", Kind: "uint", Max: 255}}
	starts, objEnds := questLists[0], questLists[3]
	script := templateScript(questScript, cols, rows, questHeader, time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)) +
		listScript(starts, rcols, []batchRow{{"90001", "197", "0", "10"}, {"90002", "197", "0", "10"}}, []int{90001, 90002}) +
		listScript(objEnds, rcols, nil, []int{90001}) +
		// The givers of a quest the script has no template row of: left out.
		"DELETE FROM `creature_questrelation` WHERE `quest` = 5;\nINSERT INTO `gameobject_involvedrelation` (`id`, `quest`) VALUES (31, 7);\n"
	for _, want := range []string{
		"-- Probe's Return (entry 90002, patch 0)\n",
		"-- Quest 90001: the creatures that start it (1 row)\nDELETE FROM `creature_questrelation` WHERE `quest` = 90001;\nREPLACE INTO `creature_questrelation` (`quest`, `id`, `patch_min`, `patch_max`) VALUES\n(90001, 197, 0, 10);\n",
		"-- Quest 90001: the game objects that end it (0 rows)\nDELETE FROM `gameobject_involvedrelation` WHERE `quest` = 90001;\n",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("missing %q in\n%s", want, script)
		}
	}
	tmpl, err := planScript(questScript, script, []string{"entry", "patch", "Title", "PrevQuestId", "RewItemId1", "RewItemCount1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(tmpl.rows) != 2 || tmpl.keys[1].name != "Probe's Return" || tmpl.rows[1].values["PrevQuestId"] != "90001" {
		t.Fatalf("template %+v %+v", tmpl.keys, tmpl.rows)
	}
	order := []string{"id", "quest", "patch_min", "patch_max"}
	sp, err := planList(starts, script, tmpl.entries(), order)
	if err != nil || len(sp.replaced) != 2 || len(sp.rows) != 2 || sp.others != 1 {
		t.Fatalf("starters plan %+v %v", sp, err)
	}
	sql, err := listSQL(sp, rcols)
	if err != nil {
		t.Fatal(err)
	}
	want := "DELETE FROM `creature_questrelation` WHERE `quest` = 90001;\nDELETE FROM `creature_questrelation` WHERE `quest` = 90002;\n" +
		"REPLACE INTO `creature_questrelation` (`quest`, `id`, `patch_min`, `patch_max`) VALUES (90001, 197, 0, 10);\n" +
		"REPLACE INTO `creature_questrelation` (`quest`, `id`, `patch_min`, `patch_max`) VALUES (90002, 197, 0, 10);\n"
	if sql != want {
		t.Fatalf("sql\n%s\nwant\n%s", sql, want)
	}
	ep, err := planList(objEnds, script, tmpl.entries(), order)
	if err != nil || len(ep.replaced) != 1 || ep.replaced[0] != 90001 || len(ep.rows) != 0 || ep.others != 1 {
		t.Fatalf("enders plan %+v %v", ep, err)
	}

	// The rules: PrevQuestId names a quest of the script, which counts as there; the reward item is
	// looked for on the server, once.
	asked := 0
	known := func(items map[int]bool) questKnown {
		return func(kind string, ids []int) (map[int]bool, error) {
			asked++
			if kind == "item" {
				return items, nil
			}
			return map[int]bool{}, nil
		}
	}
	refused, err := questRefusals(tmpl, known(map[int]bool{4000: true}))
	if err != nil || len(refused) != 0 {
		t.Fatalf("refused %v %v", refused, err)
	}
	if asked != 2 {
		t.Errorf("asked the server %d times, want once a kind (item, quest)", asked)
	}
	refused, err = questRefusals(tmpl, known(map[int]bool{}))
	if err != nil || len(refused) != 1 || refused[0] != "quest 90002 (patch 0): RewItemId1 names item 4000, which the world database doesn't have" {
		t.Fatalf("refused %q %v", refused, err)
	}
	// A rule broken: a reward with no count, and the title gone.
	bad, err := planScript(questScript, "INSERT INTO quest_template (entry, Title, RewItemId1, RewItemCount1) VALUES (90003, '', 4000, 0);", []string{"entry", "patch", "Title", "RewItemId1", "RewItemCount1"})
	if err != nil {
		t.Fatal(err)
	}
	refused, err = questRefusals(bad, known(map[int]bool{4000: true}))
	if err != nil || len(refused) != 2 || !strings.HasPrefix(refused[0], "quest 90003 (patch 0): the quest needs a title") || !strings.Contains(refused[1], "RewItemId1 names item 4000 but RewItemCount1 is 0") {
		t.Fatalf("refused %q %v", refused, err)
	}
}

// TestQuestScriptsLive exports a quest chain with its givers and plans the script back, from the server.
// It needs VMANGOS_DIR (database running) and the client (for the rules' client tables), and writes
// nothing.
func TestQuestScriptsLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	data := testclient.DataDir(t) + "/Data"
	// Northshire's chain: A Threat Within, Kobold Camp Cleanup, Investigate Echo Ridge, Skirmish at
	// Echo Ridge, each with a creature that starts it and one that ends it.
	chain := []int{783, 7, 15, 21}
	script, err := ExportQuests(dir, chain)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(script, "-- Kobold Camp Cleanup (entry 7, patch 0)") {
		t.Fatalf("no titled row in\n%.2000s", script)
	}
	plan, err := PlanQuestImport(dir, data, script)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v", plan)
	if len(plan.Quests) < len(chain) || len(plan.Unknown) != 0 || plan.Skipped != 0 || plan.Others != 0 || len(plan.Refused) != 0 {
		t.Fatalf("plan %+v", plan)
	}
	if len(plan.MissingCreatures) != 0 || len(plan.MissingObjects) != 0 || len(plan.Unready) != 0 {
		t.Fatalf("givers %+v", plan)
	}
	for _, q := range plan.Quests {
		if !q.Exists || q.Title == "" {
			t.Errorf("%+v is not there", q)
		}
	}
	rows := 0
	for _, l := range plan.Lists {
		if l.Rows != l.Had {
			t.Errorf("%s of quest %d: %d rows, has %d", l.Table, l.Entry, l.Rows, l.Had)
		}
		rows += l.Rows
	}
	if len(plan.Lists) != 4*len(chain) || rows < 2*len(chain) {
		t.Fatalf("lists %+v", plan.Lists)
	}
}

package vmangos

import (
	"fmt"
	"slices"
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
	if len(plan.Lists) != len(questLists)*len(chain) || rows < 2*len(chain) {
		t.Fatalf("lists %+v", plan.Lists)
	}
	if len(plan.Carried) != 0 {
		t.Fatalf("the chain names no scripts, but carries %+v", plan.Carried)
	}

	// Wait for Sirra to Finish (401) has a start script whose talk commands say broadcast texts, and an
	// end script; Children's Week's 172 is offered in a game event (#993).
	script, err = ExportQuests(dir, []int{401, 172})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"-- Start script 401: quest_start_scripts", "-- End script 401: quest_end_scripts", "-- Broadcast text ",
		"-- Quest 172: the game events it is offered in (1 row)", "-- Quest 401: the translations (1 row)"} {
		if !strings.Contains(script, want) {
			t.Fatalf("missing %q in\n%.4000s", want, script)
		}
	}
	plan, err = PlanQuestImport(dir, data, script)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v", plan.Carried)
	if plan.Skipped != 0 || plan.Others != 0 || len(plan.Unknown) != 0 || len(plan.Refused) != 0 || len(plan.MissingEvents) != 0 {
		t.Fatalf("plan %+v", plan)
	}
	kinds := map[string]int{}
	for _, c := range plan.Carried {
		kinds[c.What]++
		if !c.Same || c.To != c.ID || c.Rows == 0 {
			t.Errorf("not kept as it is on the server it came from: %+v", c)
		}
	}
	if kinds["start script"] != 1 || kinds["end script"] != 1 || kinds["broadcast text"] == 0 {
		t.Fatalf("carried %+v", plan.Carried)
	}
	foundElsewhere(t, dir, questScript, script, questRoots)
	for _, l := range plan.Lists {
		if l.Rows != l.Had {
			t.Errorf("%s of quest %d: %d rows, has %d", l.Table, l.Entry, l.Rows, l.Had)
		}
	}

	// Brought from the server they came from, the scripts' commands name nothing it lacks: The
	// Thandol Span (632) summons creature 4062 under condition 390 (#1045).
	script, err = ExportQuests(dir, []int{632})
	if err != nil {
		t.Fatal(err)
	}
	if plan, err = PlanQuestImport(dir, data, script); err != nil {
		t.Fatal(err)
	}
	if len(plan.Carried) == 0 || len(plan.ScriptLacks) != 0 {
		t.Fatalf("quest 632: carried %+v, lacks %+v", plan.Carried, plan.ScriptLacks)
	}
	// What the server lacks of what a script names: the IDs past the largest, not those it has.
	db, err := openWorld(dir)
	if err != nil {
		t.Fatal(err)
	}
	row := func(command, datalong, condition string) sqlRow {
		return sqlRow{values: map[string]string{"command": command, "datalong": datalong, "condition_id": condition}}
	}
	none := "16777214"
	p := carriedPlan{sets: []*importSet{{kind: &carriedKinds[slices.IndexFunc(carriedKinds, func(k carriedKind) bool { return k.key == "startscript" })], id: 1,
		rows: [][]sqlRow{{row("10", "4062", "390"), row("10", none, "0"), row("15", "4984", none), row("74", none, "0"), row("76", none, "0"), row("76", none, "0")}}}}}
	lacks, err := scriptLacks(db, &p)
	if err != nil {
		t.Fatal(err)
	}
	got := fmt.Sprintf("%+v", lacks)
	if want := "[{What:creature IDs:[16777214]} {What:game object IDs:[16777214]} {What:spell IDs:[16777214]} {What:condition IDs:[16777214]}]"; got != want {
		t.Fatalf("lacks %s, want %s", got, want)
	}
}

// A quest's start and end scripts travel in its script by their IDs, with the broadcast texts their
// talk commands say (#993), and its event links and translations as lists keyed by the quest: kept on
// the server they came from; on another, a script the server holds other rows of under its ID comes
// to a fresh ID past any a quest names, StartScript or CompleteScript rewritten, and a talk command's
// texts with it, while another command's dataint stays as it is.
func TestQuestScriptCarried(t *testing.T) {
	cols := append(questScript.keyColumns(),
		TemplateColumn{Name: "Title", Kind: "text", Nullable: true},
		TemplateColumn{Name: "StartScript", Kind: "uint", Max: 1<<24 - 1},
		TemplateColumn{Name: "CompleteScript", Kind: "uint", Max: 1<<24 - 1})
	rows := []batchRow{{"90001", "0", "Probe's Errand", "401", "402"}}
	u := func(name string, top int64) TemplateColumn { return TemplateColumn{Name: name, Kind: "uint", Max: top} }
	i32 := func(name string) TemplateColumn {
		return TemplateColumn{Name: name, Kind: "int", Min: -1 << 31, Max: 1<<31 - 1}
	}
	scriptCols := []TemplateColumn{u("id", 1<<32-1), u("delay", 1<<32-1), u("command", 255), u("datalong", 1<<32-1),
		i32("dataint"), i32("dataint2"), {Name: "x", Kind: "float"}, {Name: "comments", Kind: "text", MaxLen: 255}}
	src := &fakeSource{cols: map[string][]TemplateColumn{
		"quest_start_scripts": scriptCols,
		"quest_end_scripts":   scriptCols,
		"broadcast_text":      {u("entry", 1<<24-1), {Name: "male_text", Kind: "text", Nullable: true}},
	}, data: map[string][]batchRow{
		// Script 401 says text 500 or 501, then casts spell 7 with dataint 5 (not a text).
		"quest_start_scripts": {{"401", "0", "0", "0", "500", "501", "0", "Sirra says"}, {"401", "2", "15", "7", "5", "0", "-1.5", "cast"}},
		"quest_end_scripts":   {{"402", "0", "0", "0", "502", "0", "0", "done"}},
		"broadcast_text":      {{"500", "Wait."}, {"501", "Hold on."}, {"502", "Thank you."}},
	}}
	carried, err := exportCarried(src, questRoots, cols, rows)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"-- Start script 401: quest_start_scripts (2 rows)\nDELETE FROM `quest_start_scripts` WHERE `id` = 401;\n",
		"(401, 2, 15, 7, 5, 0, -1.5, 'cast');\n",
		"-- End script 402: quest_end_scripts (1 row)\n",
		"-- Broadcast text 501: broadcast_text (1 row)\n",
		"(502, 'Thank you.');\n",
	} {
		if !strings.Contains(carried, want) {
			t.Fatalf("missing %q in\n%s", want, carried)
		}
	}
	if strings.Contains(carried, "Broadcast text 5:") {
		t.Fatalf("a cast's dataint taken for a text:\n%s", carried)
	}
	lcols := []TemplateColumn{{Name: "entry", Kind: "uint", Max: 1<<24 - 1}, {Name: "Title_loc3", Kind: "text", Nullable: true}, {Name: "Title_loc6", Kind: "text", Nullable: true}}
	ecols := []TemplateColumn{{Name: "quest", Kind: "uint", Max: 1<<24 - 1}, {Name: "event", Kind: "uint", Max: 65535}, {Name: "patch_min", Kind: "uint", Max: 255}}
	events, locales := questLists[4], questLists[5]
	script := templateScript(questScript, cols, rows, questHeader, time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)) +
		listScript(events, ecols, []batchRow{{"90001", "12", "0"}}, []int{90001}) +
		listScript(locales, lcols, []batchRow{{"90001", "Botengang", "NULL"}}, []int{90001}) + carried
	for _, want := range []string{
		"-- Quest 90001: the game events it is offered in (1 row)\nDELETE FROM `game_event_quest` WHERE `quest` = 90001;\n",
		"-- Quest 90001: the translations (1 row)\nDELETE FROM `locales_quest` WHERE `entry` = 90001;\nREPLACE INTO `locales_quest` (`entry`, `Title_loc3`, `Title_loc6`) VALUES\n(90001, 'Botengang', NULL);\n",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("missing %q in\n%s", want, script)
		}
	}
	order := []string{"entry", "patch", "Title", "StartScript", "CompleteScript"}
	tmpl, err := planScript(questScript, script, order)
	if err != nil {
		t.Fatal(err)
	}
	lp, err := planList(locales, script, tmpl.entries(), []string{"entry", "Title_loc3", "Title_loc6"})
	if err != nil || len(lp.replaced) != 1 || len(lp.rows) != 1 || lp.rows[0].values["Title_loc3"] != "Botengang" || !lp.rows[0].null["Title_loc6"] {
		t.Fatalf("translations plan %+v %v", lp, err)
	}
	ep, err := planList(events, script, tmpl.entries(), []string{"quest", "event", "patch_min"})
	if err != nil || len(ep.rows) != 1 || ep.rows[0].values["event"] != "12" {
		t.Fatalf("events plan %+v %v", ep, err)
	}
	p, err := planCarried(src, script, questRoots, tmpl.rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.sets) != 5 || p.others != 0 || p.stmts+lp.stmts+ep.stmts != tmpl.skipped {
		t.Fatalf("%d sets, %d others, %d+%d+%d statements of %d skipped: %+v", len(p.sets), p.others, p.stmts, lp.stmts, ep.stmts, tmpl.skipped, p.imports())
	}
	for _, s := range p.imports() {
		if !s.Same || s.To != s.ID {
			t.Errorf("on the server it came from: %+v", s)
		}
	}
	if n := p.scriptNames(); len(n) != 1 || !slices.Equal(n["spell"], []int{7}) {
		t.Fatalf("the scripts' commands name %v, want spell 7", n)
	}

	// Another server: its script 401 is another quest's, its end script 402 the same, its text 500
	// says something else, and a quest there names start script 900 without rows.
	other := &fakeSource{cols: src.cols, data: map[string][]batchRow{
		"quest_start_scripts": {{"401", "0", "15", "8", "0", "0", "0", "other"}, {"450", "0", "0", "0", "0", "0", "0", ""}},
		"quest_end_scripts":   src.data["quest_end_scripts"],
		"broadcast_text":      {{"500", "Go away."}, {"501", "Hold on."}, {"502", "Thank you."}, {"520", "x"}},
	}}
	tmpl, _ = planScript(questScript, script, order)
	p, err = planCarried(lastIs{other, map[string]int{"quest_start_scripts": 900}}, script, questRoots, tmpl.rows)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, s := range p.imports() {
		got[fmt.Sprintf("%s %d", s.What, s.ID)] = fmt.Sprintf("%d %v", s.To, s.Same)
	}
	want := map[string]string{"start script 401": "901 false", "end script 402": "402 true", "broadcast text 500": "521 false", "broadcast text 501": "501 true", "broadcast text 502": "502 true"}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s comes to %q, want %q (%v)", k, got[k], v, got)
		}
	}
	if r := tmpl.rows[0].values; r["StartScript"] != "901" || r["CompleteScript"] != "402" {
		t.Fatalf("template %v", r)
	}
	sql, err := p.sql(other)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"REPLACE INTO `quest_start_scripts` (`id`, `delay`, `command`, `datalong`, `dataint`, `dataint2`, `x`, `comments`) VALUES (901, 0, 0, 0, 521, 501, 0, 'Sirra says');\n",
		"VALUES (901, 2, 15, 7, 5, 0, -1.5, 'cast');\n",
		"REPLACE INTO `broadcast_text` (`entry`, `male_text`) VALUES (521, 'Wait.');\n",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("missing %q in\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "quest_end_scripts") || strings.Contains(sql, "(401,") || strings.Contains(sql, "(501,") {
		t.Errorf("wrote over a set of the server:\n%s", sql)
	}
}

// lastIs is a carriedSource whose largest ID in use is, for the tables named, the one given, as a
// table's last expression finds an ID something names without the table having it.
type lastIs struct {
	*fakeSource
	last map[string]int
}

func (l lastIs) maxID(t carriedTable) (int, error) {
	n, err := l.fakeSource.maxID(t)
	return max(n, l.last[t.name]), err
}

// TestScriptNames: the creatures, objects, spells and conditions a carried script's commands name
// (#1045), and nothing from a set that holds no script or a command whose datalong is no entry.
func TestScriptNames(t *testing.T) {
	row := func(command, datalong, condition string) sqlRow {
		return sqlRow{values: map[string]string{"command": command, "datalong": datalong, "condition_id": condition}}
	}
	script := &carriedKinds[slices.IndexFunc(carriedKinds, func(k carriedKind) bool { return k.key == "startscript" })]
	loot := &carriedKinds[slices.IndexFunc(carriedKinds, func(k carriedKind) bool { return k.key == "loot" })]
	p := carriedPlan{sets: []*importSet{
		{kind: script, id: 1, rows: [][]sqlRow{{row("10", "448", "0"), row("15", "133", "27"), row("74", "0", "0"), row("76", "3000", ""), row("9", "5555", "0"), row("0", "0", "0")}}},
		{kind: loot, id: 2, rows: [][]sqlRow{{{values: map[string]string{"command": "10", "datalong": "1"}}}}},
	}}
	got := p.scriptNames()
	want := map[string][]int{"creature": {448}, "spell": {133}, "object": {3000}, "condition": {27}}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for k, v := range want {
		if !slices.Equal(got[k], v) {
			t.Errorf("%s: got %v, want %v", k, got[k], v)
		}
	}
}

package vmangos

import (
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// knownOnly is a questKnown that knows the given IDs of each kind.
func knownOnly(have map[string][]int) questKnown {
	return func(kind string, ids []int) (map[int]bool, error) {
		out := map[int]bool{}
		for _, id := range have[kind] {
			out[id] = true
		}
		return out, nil
	}
}

func TestCheckQuest(t *testing.T) {
	known := knownOnly(map[string][]int{"item": {2589}, "creature": {6}, "object": {1731}, "quest": {7}, "zone": {12}, "sort": {61}, "faction": {72}, "emote": {1}})
	row := func(kv ...string) map[string]string {
		r := map[string]string{"Title": "Wolves", "Method": "2", "MinLevel": "1"}
		for i := 0; i+1 < len(kv); i += 2 {
			r[kv[i]] = kv[i+1]
		}
		return r
	}
	ch := func(cols ...string) map[string]string {
		c := map[string]string{}
		for _, k := range cols {
			c[k] = "x"
		}
		return c
	}
	good := []struct {
		row     map[string]string
		changed map[string]string
	}{
		{row("ReqItemId1", "2589", "ReqItemCount1", "8"), ch("ReqItemId1", "ReqItemCount1")},
		{row("ReqCreatureOrGOId1", "6", "ReqCreatureOrGOCount1", "10", "ReqCreatureOrGOId2", "-1731", "ReqCreatureOrGOCount2", "1"), ch("ReqCreatureOrGOId1", "ReqCreatureOrGOId2")},
		{row("PrevQuestId", "-7", "ZoneOrSort", "-61"), ch("PrevQuestId", "ZoneOrSort")},
		{row("ZoneOrSort", "12", "RewRepFaction1", "72", "RewRepValue1", "250", "DetailsEmote1", "1"), ch("ZoneOrSort", "RewRepFaction1", "DetailsEmote1")},
		// A broken reference the change doesn't touch is the quest's old problem, not this save's.
		{row("ReqItemId1", "99999", "ReqItemCount1", "1", "QuestLevel", "5"), ch("QuestLevel")},
		{row("RewChoiceItemId1", "2589", "RewChoiceItemCount1", "1"), ch("RewChoiceItemId1")},
		{row("MaxLevel", "0", "MinLevel", "10"), ch("MinLevel")},
		{row("RequiredMinRepFaction", "72", "RequiredMinRepValue", "3000", "RequiredMaxRepValue", "0"), ch("RequiredMinRepValue")},
	}
	for i, c := range good {
		if err := checkQuest(c.row, c.changed, known); err != nil {
			t.Errorf("good %d: %v", i, err)
		}
	}
	bad := []struct {
		row     map[string]string
		changed map[string]string
		want    string
		col     string
	}{
		{row("Title", " "), ch("Title"), "needs a title", "Title"},
		{row("Method", "3"), ch("Method"), "Method is 3", "Method"},
		{row("SpecialFlags", "4"), ch("SpecialFlags"), "SpecialFlags is 4", "SpecialFlags"},
		{row("RequiredClasses", "32"), ch("RequiredClasses"), "no playable class", "RequiredClasses"},
		{row("RequiredRaces", "256"), ch("RequiredRaces"), "no playable race", "RequiredRaces"},
		{row("MinLevel", "10", "MaxLevel", "5"), ch("MaxLevel"), "below MinLevel", "MaxLevel"},
		{row("ReqItemId1", "2589", "ReqItemCount1", "0"), ch("ReqItemId1"), "give it a count", "ReqItemId1"},
		{row("ReqItemId2", "0", "ReqItemCount2", "3"), ch("ReqItemCount2"), "names no item", "ReqItemCount2"},
		{row("ReqItemId1", "99999", "ReqItemCount1", "1"), ch("ReqItemId1"), "ReqItemId1 names item 99999, which the world database doesn't have", "ReqItemId1"},
		{row("ReqCreatureOrGOId1", "-6", "ReqCreatureOrGOCount1", "1"), ch("ReqCreatureOrGOId1"), "names object 6", "ReqCreatureOrGOId1"},
		{row("ReqCreatureOrGOId1", "1731", "ReqCreatureOrGOCount1", "1"), ch("ReqCreatureOrGOId1"), "names creature 1731", "ReqCreatureOrGOId1"},
		{row("NextQuestInChain", "8"), ch("NextQuestInChain"), "names quest 8", "NextQuestInChain"},
		{row("ZoneOrSort", "-12"), ch("ZoneOrSort"), "names sort 12, which the client doesn't have", "ZoneOrSort"},
		{row("RewChoiceItemId1", "0", "RewChoiceItemId2", "2589", "RewChoiceItemCount2", "1"), ch("RewChoiceItemId2"), "no gap", "RewChoiceItemId1"},
		{row("RewRepFaction1", "72", "RewRepValue1", "0"), ch("RewRepFaction1"), "give it an amount", "RewRepFaction1"},
		{row("RewRepFaction2", "0", "RewRepValue2", "100"), ch("RewRepValue2"), "names no faction", "RewRepValue2"},
		{row("RepObjectiveFaction", "0", "RepObjectiveValue", "100"), ch("RepObjectiveValue"), "names no faction", "RepObjectiveValue"},
		{row("RequiredMinRepValue", "3000", "RequiredMaxRepValue", "3000", "RequiredMinRepFaction", "72", "RequiredMaxRepFaction", "72"), ch("RequiredMaxRepValue"), "not above", "RequiredMaxRepValue"},
		{row("RequiredMinRepValue", "50000", "RequiredMinRepFaction", "72"), ch("RequiredMinRepValue"), "most reputation", "RequiredMinRepValue"},
	}
	for i, c := range bad {
		err := checkQuest(c.row, c.changed, known)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("bad %d: %v, want %q", i, err, c.want)
		}
		// The editor opens the tab of the column the refusal names (#597).
		if r := Refused(err); r == nil || r.Column != c.col || r.Message != err.Error() {
			t.Errorf("bad %d: refused %+v, want column %s", i, r, c.col)
		}
	}
	// Every problem is told, a line each.
	err := checkQuest(row("Method", "5", "SrcItemId", "99999", "SrcItemCount", "0"), ch("Method", "SrcItemId"), known)
	if err == nil || len(strings.Split(err.Error(), "\n")) != 3 {
		t.Fatalf("three problems, a line each: %v", err)
	}
}

func TestQuestLinksCoverTheTable(t *testing.T) {
	// The columns the server reads as references, by their names in quest_template.
	for _, c := range []string{"SrcItemId", "ReqItemId4", "ReqSourceId1", "ReqCreatureOrGOId3", "ReqSpellCast2", "RewChoiceItemId6", "RewItemId4", "RewRepFaction5", "RewSpell", "RewSpellCast", "ZoneOrSort", "RequiredSkill", "OfferRewardEmote4", "CompleteEmote", "BreadcrumbForQuestId"} {
		if questLinks[c] == "" {
			t.Errorf("%s is not a reference", c)
		}
	}
}

func TestCreateQuestSQL(t *testing.T) {
	cols := parseColumns([]byte("entry\tmediumint(8) unsigned\tNO\tPRI\t0\t\npatch\ttinyint(3) unsigned\tNO\tPRI\t0\t\n" +
		"Method\ttinyint(3) unsigned\tNO\t\t2\t\nQuestLevel\ttinyint(3) unsigned\tNO\t\t0\t\nTitle\ttext\tYES\t\tNULL\t\n"))
	sql, err := createQuestSQL(cols, 9666, 0, " Wolves ")
	if err != nil || sql != "INSERT INTO `quest_template` (`entry`, `patch`, `Method`, `MinLevel`, `QuestLevel`, `Title`) VALUES (9666, 0, 2, 1, 1, 'Wolves');" {
		t.Fatalf("from scratch: %s %v", sql, err)
	}
	sql, err = createQuestSQL(cols, 9666, 7, "Kobolds again")
	if err != nil || sql != "INSERT INTO `quest_template` (`entry`, `patch`, `Method`, `QuestLevel`, `Title`) SELECT 9666, 0, t.`Method`, t.`QuestLevel`, 'Kobolds again' FROM `quest_template` t WHERE t.`entry` = 7 ORDER BY t.`patch` DESC LIMIT 1;" {
		t.Fatalf("copy: %s %v", sql, err)
	}
	if _, err := createQuestSQL(cols, 1, 0, "  "); err == nil {
		t.Fatal("a quest without a title must be refused")
	}
	if _, err := templateUpdateSQL(questTable, cols, 7, 0, map[string]string{"QuestLevel": "256"}); err == nil {
		t.Fatal("a level past a tinyint's 255 must be refused")
	}
}

func TestQuestGivers(t *testing.T) {
	g := QuestGivers{
		Starts: []QuestGiver{{Kind: "creature", ID: 197, PatchMax: 10}, {Kind: "object", ID: 1731, PatchMin: 2, PatchMax: 10}},
		Ends:   []QuestGiver{{Kind: "creature", ID: 197, PatchMax: 10}, {Kind: "creature", ID: 805, PatchMax: 10}},
	}
	sql, err := questGiversSaveSQL(7, g, []int{805})
	if err != nil {
		t.Fatal(err)
	}
	want := "DELETE FROM `creature_questrelation` WHERE `quest` = 7;\n" +
		"INSERT INTO `creature_questrelation` (`id`, `quest`, `patch_min`, `patch_max`) VALUES (197, 7, 0, 10);\n" +
		"DELETE FROM `gameobject_questrelation` WHERE `quest` = 7;\n" +
		"INSERT INTO `gameobject_questrelation` (`id`, `quest`, `patch_min`, `patch_max`) VALUES (1731, 7, 2, 10);\n" +
		"DELETE FROM `creature_involvedrelation` WHERE `quest` = 7;\n" +
		"INSERT INTO `creature_involvedrelation` (`id`, `quest`, `patch_min`, `patch_max`) VALUES (197, 7, 0, 10);\n" +
		"INSERT INTO `creature_involvedrelation` (`id`, `quest`, `patch_min`, `patch_max`) VALUES (805, 7, 0, 10);\n" +
		"DELETE FROM `gameobject_involvedrelation` WHERE `quest` = 7;\n" +
		"UPDATE `creature_template` SET `npc_flags` = `npc_flags` | 2 WHERE `entry` IN (805);"
	if sql != want {
		t.Fatalf("sql\n%s\nwant\n%s", sql, want)
	}
	for _, bad := range []struct {
		g    QuestGivers
		flag []int
	}{
		{QuestGivers{Starts: []QuestGiver{{Kind: "creature", ID: 6, PatchMax: 10}, {Kind: "creature", ID: 6, PatchMax: 10}}}, nil},
		{QuestGivers{Starts: []QuestGiver{{Kind: "npc", ID: 6, PatchMax: 10}}}, nil},
		{QuestGivers{Ends: []QuestGiver{{Kind: "object", ID: 0, PatchMax: 10}}}, nil},
		{QuestGivers{Ends: []QuestGiver{{Kind: "object", ID: 3, PatchMin: 5, PatchMax: 4}}}, nil},
		{QuestGivers{Ends: []QuestGiver{{Kind: "creature", ID: 3, PatchMax: 10}}}, []int{4}},
	} {
		if _, err := questGiversSaveSQL(7, bad.g, bad.flag); err == nil {
			t.Errorf("%+v %v must be refused", bad.g, bad.flag)
		}
	}
	got := parseQuestGivers([]byte("197\tMarshal McBride\t0\t10\t1\t1\n805\t\t0\t10\t0\t0\n"), "creature")
	if len(got) != 2 || got[0] != (QuestGiver{Kind: "creature", ID: 197, Name: "Marshal McBride", PatchMax: 10, Ready: true, Spawns: 1}) || got[1].Ready || got[1].Name != "" {
		t.Fatalf("parsed %+v", got)
	}
	if s := questGiversSQL("gameobject_questrelation", "object", 7); !strings.Contains(s, "t.type = 2") || !strings.Contains(s, "FROM `gameobject` s") {
		t.Fatalf("object givers: %s", s)
	}
}

func TestTemplateNamesSQL(t *testing.T) {
	sql, err := templateNamesSQL("quest", []int{7, 33})
	if err != nil || sql != "SELECT t.entry, COALESCE(t.Title, ''), 0, 0, t.QuestLevel FROM `quest_template` t WHERE t.entry IN (7,33) AND t.patch = (SELECT MAX(patch) FROM `quest_template` WHERE entry = t.entry)" {
		t.Fatalf("%s %v", sql, err)
	}
	if _, err := templateNamesSQL("spell", []int{1}); err == nil {
		t.Fatal("spells are the client's, not a template table")
	}
}

// TestQuestsLive reads a quest, its givers, the names it uses and the client's quest tables. It
// needs VMANGOS_DIR (database running) and WOW_DIR, and writes nothing.
func TestQuestsLive(t *testing.T) {
	dir, clientDir := testclient.ServerDir(t), testclient.DataDir(t)
	rec, err := ReadQuest(dir, 7) // Kobold Camp Cleanup
	if err != nil {
		t.Fatal(err)
	}
	if rec.Values["Title"] != "Kobold Camp Cleanup" || rec.Values["ReqCreatureOrGOId1"] != "6" || len(rec.Columns) < 130 {
		t.Fatalf("record: %d columns, %q, kills %q", len(rec.Columns), rec.Values["Title"], rec.Values["ReqCreatureOrGOId1"])
	}
	g, err := ReadQuestGivers(dir, 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Starts) != 1 || g.Starts[0].ID != 197 || !g.Starts[0].Ready || g.Starts[0].Spawns == 0 || len(g.Ends) != 1 {
		t.Fatalf("givers %+v", g)
	}
	names, err := TemplateNames(dir, "creature", []int{6, 99999999})
	if err != nil || names[6].Name != "Kobold Vermin" || len(names) != 1 {
		t.Fatalf("names %+v %v", names, err)
	}
	dataDir, err := wow.ResolveDataDir(clientDir)
	if err != nil {
		t.Fatal(err)
	}
	tables, err := LoadQuestTables(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	has := func(list []NamedID, id int, name string) bool {
		for _, n := range list {
			if n.ID == id {
				return n.Name == name
			}
		}
		return false
	}
	// QuestSort 61 is Warlock, SkillLine 164 Blacksmithing, Faction 72 Stormwind (reputation index 1).
	if !has(tables.Sorts, 61, "Warlock") || !has(tables.Skills, 164, "Blacksmithing") || !has(tables.Factions, 72, "Stormwind") {
		t.Fatalf("tables: %d sorts, %d skills, %d factions", len(tables.Sorts), len(tables.Skills), len(tables.Factions))
	}
	// MailTemplate 84 is a letter (#704), named by its body's first line.
	mail := false
	for _, m := range tables.MailTemplates {
		mail = mail || (m.ID == 84 && strings.HasPrefix(m.Name, "Thank you for visiting me, $N."))
	}
	if !mail {
		t.Fatalf("no mail template 84 among %d", len(tables.MailTemplates))
	}
	db, err := worldDatabase(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := checkQuest(rec.Values, map[string]string{"ZoneOrSort": rec.Values["ZoneOrSort"], "ReqCreatureOrGOId1": "6"}, worldKnown(db, dataDir)); err != nil {
		t.Fatalf("quest 7 as it is: %v", err)
	}
}

func TestDeleteQuestSQL(t *testing.T) {
	sql := deleteQuestSQL(77)
	for _, want := range []string{
		"DELETE FROM `quest_start_scripts` WHERE `id` <> 0 AND `id` IN (SELECT `StartScript` FROM `quest_template` WHERE `entry` = 77) AND `id` NOT IN (SELECT `StartScript` FROM `quest_template` WHERE `entry` <> 77);",
		"DELETE FROM `quest_end_scripts`",
		"DELETE FROM `creature_questrelation` WHERE `quest` = 77;",
		"DELETE FROM `creature_involvedrelation` WHERE `quest` = 77;",
		"DELETE FROM `gameobject_questrelation` WHERE `quest` = 77;",
		"DELETE FROM `gameobject_involvedrelation` WHERE `quest` = 77;",
		"DELETE FROM `locales_quest` WHERE `entry` = 77;",
		"DELETE FROM `quest_template` WHERE `entry` = 77;",
		"UPDATE `quest_template` SET `PrevQuestId` = 0 WHERE `PrevQuestId` IN (77, -77) AND `entry` <> 77;",
		"UPDATE `quest_template` SET `BreadcrumbForQuestId` = 0 WHERE",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("missing %q in\n%s", want, sql)
		}
	}
	// The scripts go before the template they are found through.
	if strings.Index(sql, "quest_start_scripts") > strings.Index(sql, "DELETE FROM `quest_template`") {
		t.Error("scripts must be deleted before the quest_template rows")
	}
}

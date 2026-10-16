package vmangos

import "testing"

func TestQuestRelationsSQLKeepsPatchesAndRefusesDuplicates(t *testing.T) {
	sql, err := questRelationsSQL(197, CreatureQuests{
		Starts: []QuestRef{{Quest: 7, PatchMin: 0, PatchMax: 10}, {Quest: 3100, PatchMin: 2, PatchMax: 10}},
		Ends:   []QuestRef{{Quest: 15, PatchMax: 10}},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "DELETE FROM `creature_questrelation` WHERE `id` = 197;\n" +
		"INSERT INTO `creature_questrelation` (`id`, `quest`, `patch_min`, `patch_max`) VALUES (197, 7, 0, 10);\n" +
		"INSERT INTO `creature_questrelation` (`id`, `quest`, `patch_min`, `patch_max`) VALUES (197, 3100, 2, 10);\n" +
		"DELETE FROM `creature_involvedrelation` WHERE `id` = 197;\n" +
		"INSERT INTO `creature_involvedrelation` (`id`, `quest`, `patch_min`, `patch_max`) VALUES (197, 15, 0, 10);"
	if sql != want {
		t.Fatalf("got\n%s\nwant\n%s", sql, want)
	}
	if _, err := questRelationsSQL(1, CreatureQuests{Starts: []QuestRef{{Quest: 7, PatchMax: 10}, {Quest: 7, PatchMax: 10}}}); err == nil {
		t.Fatal("a quest listed twice was accepted")
	}
	if _, err := questRelationsSQL(1, CreatureQuests{Ends: []QuestRef{{Quest: 7, PatchMin: 5, PatchMax: 2}}}); err == nil {
		t.Fatal("patches out of order were accepted")
	}
}

func TestParseQuestRefs(t *testing.T) {
	got := parseQuestRefs([]byte("7\tKobold Camp Cleanup\t2\t0\t10\n"))
	if len(got) != 1 || got[0].Title != "Kobold Camp Cleanup" || got[0].Level != 2 || got[0].PatchMax != 10 {
		t.Fatalf("got %+v", got)
	}
	got = parseQuestRefs([]byte("7\tKobold Camp Cleanup\t2\n"))
	if len(got) != 1 || got[0].PatchMax != 10 || got[0].PatchMin != 0 {
		t.Fatalf("a search row should load in every patch: %+v", got)
	}
}

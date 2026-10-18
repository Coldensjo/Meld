package vmangos

import "testing"

func TestQuestRelationsSQLKeepsPatchesAndRefusesDuplicates(t *testing.T) {
	sql, err := questRelationsSQL("creature", 197, QuestLists{
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
	if _, err := questRelationsSQL("creature", 1, QuestLists{Starts: []QuestRef{{Quest: 7, PatchMax: 10}, {Quest: 7, PatchMax: 10}}}); err == nil {
		t.Fatal("a quest listed twice was accepted")
	}
	if _, err := questRelationsSQL("creature", 1, QuestLists{Ends: []QuestRef{{Quest: 7, PatchMin: 5, PatchMax: 2}}}); err == nil {
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

func TestObjectQuestsRefuseNewQuestsOnANonGiver(t *testing.T) {
	had := QuestLists{Starts: []QuestRef{{Quest: 7}}}
	// A chest (type 3) keeps or drops a quest it already has.
	if err := checkObjectQuests(2855, 3, had, QuestLists{Starts: []QuestRef{{Quest: 7}}}); err != nil {
		t.Fatalf("a quest the object already had was refused: %v", err)
	}
	if err := checkObjectQuests(2855, 3, had, QuestLists{}); err != nil {
		t.Fatalf("dropping a quest was refused: %v", err)
	}
	// It gets no new one, in either list.
	if err := checkObjectQuests(2855, 3, had, QuestLists{Starts: []QuestRef{{Quest: 7}, {Quest: 8}}}); err == nil {
		t.Fatal("a new quest on a chest was accepted")
	}
	if err := checkObjectQuests(2855, 3, had, QuestLists{Ends: []QuestRef{{Quest: 7}}}); err == nil {
		t.Fatal("ending a quest it only starts was accepted on a chest")
	}
}

func TestGiverObjectsRefuseANewNonGiver(t *testing.T) {
	types := map[int]int{100: objectTypeQuestGiver, 200: 3}
	poster := QuestGiver{Kind: "object", ID: 100}
	chest := QuestGiver{Kind: "object", ID: 200}
	npc := QuestGiver{Kind: "creature", ID: 200}
	if err := checkGiverObjects(QuestGivers{}, QuestGivers{Starts: []QuestGiver{poster, npc}, Ends: []QuestGiver{poster}}, types); err != nil {
		t.Fatalf("a quest giver object was refused: %v", err)
	}
	if err := checkGiverObjects(QuestGivers{}, QuestGivers{Starts: []QuestGiver{chest}}, types); err == nil {
		t.Fatal("a chest was accepted as a new giver")
	}
	if err := checkGiverObjects(QuestGivers{Ends: []QuestGiver{chest}}, QuestGivers{Ends: []QuestGiver{chest}}, types); err != nil {
		t.Fatalf("a chest the quest already had was refused: %v", err)
	}
}

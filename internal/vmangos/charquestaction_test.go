package vmangos

import (
	"fmt"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

// TestQuestActionScript checks the quest actions' rows (#962): give in progress with nothing counted,
// complete with the objectives counted, remove dropping the row, and the refusals.
func TestQuestActionScript(t *testing.T) {
	stored := map[int]questRow{
		7:   {status: 3, rest: [12]string{"0", "0", "1792365317", "4", "0", "0", "0", "0", "0", "0", "0", "0"}},
		783: {status: 1, rest: [12]string{"1", "0", "1792365317", "0", "0", "0", "0", "0", "0", "0", "0", "2"}},
	}
	order := []int{7, 783}
	info := map[int]questInfo{7: {known: true}, 783: {known: true}, 33: {known: true, limit: 600}}
	obj := questObjectives{kills: [4]int{10, 0, 2, 0}, items: [4]int{750, 0, 0, 0}, itemCount: [4]int{8, 0, 0, 0}}
	cols := "INSERT INTO character_queststatus (guid, " + questRowColumns + ") VALUES "
	for _, c := range []struct {
		quest  int
		action string
		want   string
	}{
		// A new quest, timed from now.
		{33, QuestGive, "DELETE FROM character_queststatus WHERE guid = 4 AND quest = 33;\n" + cols + "(4, 33, 3, 0, 0, 1600, 0, 0, 0, 0, 0, 0, 0, 0, 0);"},
		// One in progress, completed: its kills and items counted.
		{7, QuestComplete, "DELETE FROM character_queststatus WHERE guid = 4 AND quest = 7;\n" + cols + "(4, 7, 1, 0, 0, 1000, 10, 0, 2, 0, 8, 0, 0, 0, 0);"},
		// One done, given again: not done any more.
		{783, QuestGive, "DELETE FROM character_queststatus WHERE guid = 4 AND quest = 783;\n" + cols + "(4, 783, 3, 0, 0, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0);"},
		{783, QuestRemove, "DELETE FROM character_queststatus WHERE guid = 4 AND quest = 783;"},
	} {
		got, err := questActionScript(4, c.quest, c.action, stored, order, info, obj, 1000)
		if err != nil || got != c.want {
			t.Errorf("%s %d:\n%s\n%v\nwant:\n%s", c.action, c.quest, got, err, c.want)
		}
	}
	for _, c := range []struct {
		quest  int
		action string
	}{{55, QuestGive}, {33, QuestRemove}} {
		if _, err := questActionScript(4, c.quest, c.action, stored, order, info, obj, 1000); Refused(err) == nil || Refused(err).Column != fmt.Sprint(c.quest) {
			t.Errorf("%s %d: got %v, want a refusal", c.action, c.quest, err)
		}
	}
	if _, err := questActionScript(4, 7, "reward", stored, order, info, obj, 1000); err == nil {
		t.Error("an unknown action: no error")
	}
	// A full quest log refuses a new quest, but not one already in it.
	full, fullOrder, fullInfo := map[int]questRow{}, []int{}, map[int]questInfo{33: {known: true}}
	for q := 100; q < 100+maxQuestLog; q++ {
		full[q] = questRow{status: 3, rest: [12]string{"0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"}}
		fullOrder = append(fullOrder, q)
		fullInfo[q] = questInfo{known: true}
	}
	if _, err := questActionScript(4, 33, QuestGive, full, fullOrder, fullInfo, obj, 1000); Refused(err) == nil {
		t.Errorf("a 21st quest: %v", err)
	}
	if _, err := questActionScript(4, 100, QuestComplete, full, fullOrder, fullInfo, obj, 1000); err != nil {
		t.Errorf("a quest in a full log: %v", err)
	}
	if s := itemsText(questObjectives{items: [4]int{750, 0, 2589, 0}, itemCount: [4]int{8, 0, 5, 0}}, map[int]string{750: "Tough Wolf Meat"}); s != "8 × Tough Wolf Meat (750), 5 × item 2589" {
		t.Errorf("items: %q", s)
	}
}

// TestQuestActionLive runs the quest actions' rows on a scratch copy of character_queststatus and
// reads a quest's objectives from the world database (needs the server's database), so no real
// character is written.
func TestQuestActionLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	chars, err := confDatabase(dir, "CharacterDatabase.Info")
	if err != nil {
		t.Fatal(err)
	}
	const scratch = "test_meld_questaction"
	if _, err := runSQL(chars, "DROP DATABASE IF EXISTS "+scratch+"; CREATE DATABASE "+scratch); err != nil {
		t.Skip("no scratch database: " + err.Error())
	}
	defer func() { _, _ = runSQL(chars, "DROP DATABASE IF EXISTS "+scratch) }()
	db := chars
	db.name = scratch
	setup := fmt.Sprintf("SET SESSION sql_mode = '';\nCREATE TABLE `character_queststatus` LIKE `%s`.`character_queststatus`;\n"+
		"INSERT INTO character_queststatus (guid, quest, status, rewarded, explored, timer, mob_count1, reward_choice) VALUES (7, 7, 3, 0, 0, 1792365317, 4, 0), (7, 783, 1, 1, 0, 1792365317, 0, 2);\n", chars.name)
	if err := runScript(db, setup); err != nil {
		t.Fatal(err)
	}
	world, err := worldDatabase(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Quest 33, Wolves Across the Border: eight Tough Wolf Meat.
	obj, err := readQuestObjectives(world, 33)
	if err != nil {
		t.Fatal(err)
	}
	if obj.items[0] != 750 || obj.itemCount[0] != 8 {
		t.Fatalf("quest 33's objectives: %+v", obj)
	}
	if s := itemsNeeded(world, obj); s != "8 × Tough Wolf Meat (750)" {
		t.Errorf("items needed: %q", s)
	}
	info := map[int]questInfo{7: {known: true}, 783: {known: true}, 33: {known: true}}
	for _, step := range []struct {
		quest  int
		action string
		o      questObjectives
	}{{33, QuestComplete, obj}, {783, QuestRemove, questObjectives{}}, {7, QuestGive, questObjectives{}}} {
		stored, order, err := storedQuests(db, 7)
		if err != nil {
			t.Fatal(err)
		}
		script, err := questActionScript(7, step.quest, step.action, stored, order, info, step.o, 1000)
		if err != nil {
			t.Fatal(err)
		}
		if err := runScript(db, script); err != nil {
			t.Fatal(err)
		}
	}
	out, err := runSQL(db, "SELECT "+questRowColumns+" FROM character_queststatus WHERE guid = 7 ORDER BY quest")
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.ReplaceAll(strings.TrimSpace(string(out)), "\t", " "); got != "7 3 0 0 1000 0 0 0 0 0 0 0 0 0\n33 1 0 0 1000 0 0 0 0 8 0 0 0 0" {
		t.Errorf("quests:\n%s", got)
	}
}

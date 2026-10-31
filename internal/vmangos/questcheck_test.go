package vmangos

import (
	"reflect"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

// checkQuests on stand-in rows: who starts and ends each quest, its links and objectives, the spawn
// counts, the summoned and sourced ones and the area triggers come out of one query a kind.
func TestCheckQuests(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		switch {
		case strings.HasPrefix(sql, "SELECT t.entry, t.Title, t.QuestLevel, t.SpecialFlags"):
			if !strings.Contains(sql, "t.entry IN (10,11)") {
				t.Errorf("quest rows asked %q", sql)
			}
			// 10: level 5, after quest 9 (gone), kill creature 600 and object 700, bring item 800.
			// 11: level 14, after 10, next in chain 12, completed at area trigger 90 (gone).
			return []byte("10\tFirst\t5\t0\t0\t9\t0\t0\t0\t600\t-700\t0\t0\t800\t0\t0\t0\n" +
				"11\tSecond\t14\t2\t0\t10\t0\t12\t0\t0\t0\t0\t0\t0\t0\t0\t0\n"), nil
		case strings.HasPrefix(sql, "SELECT DISTINCT 'cs'"):
			for _, want := range []string{"FROM creature_questrelation", "FROM gameobject_involvedrelation", "FROM areatrigger_involvedrelation", "start_quest IN (10,11)"} {
				if !strings.Contains(sql, want) {
					t.Errorf("holders %q lack %q", sql, want)
				}
			}
			return []byte("cs\t100\t10\nce\t101\t10\noe\t200\t11\nat\t90\t11\nit\t850\t11\n"), nil
		case strings.HasPrefix(sql, "SELECT t.entry, t.Title, t.QuestLevel FROM"):
			if !strings.Contains(sql, "IN (9,10,12)") {
				t.Errorf("linked quests asked %q", sql)
			}
			return []byte("10\tFirst\t5\n12\tThird\t20\n"), nil
		case strings.HasPrefix(sql, "SELECT 'creature', t.entry"):
			return []byte("creature\t100\tGiver\ncreature\t101\tEnder\ncreature\t600\tWolf\nobject\t200\tBoard\nobject\t700\tCrate\nitem\t800\tPelt\n"), nil
		case strings.HasPrefix(sql, "SELECT 'creature', x.e"):
			if !strings.Contains(sql, "id5 IN (100,101,600)") || !strings.Contains(sql, "s.id IN (200,700)") {
				t.Errorf("spawn tally %q", sql)
			}
			// The giver twice (once in an event), the board once; the wolf and the crate nowhere.
			return []byte("creature\t100\t2\t1\nobject\t200\t1\t0\n"), nil
		case strings.HasPrefix(sql, "SELECT datalong FROM event_scripts"):
			if !strings.Contains(sql, "datalong IN (600)") {
				t.Errorf("summons asked %q", sql)
			}
			return []byte("600\n"), nil
		case strings.HasPrefix(sql, "SELECT item FROM creature_loot_template"):
			if !strings.Contains(sql, "r.entry IN (SELECT -mincountOrRef") {
				t.Errorf("item sources skip reference loot: %q", sql)
			}
			return nil, nil
		case strings.HasPrefix(sql, "SELECT DISTINCT id FROM areatrigger_template"):
			return nil, nil
		}
		t.Fatalf("unexpected query %s", sql)
		return nil, nil
	}
	r, err := checkQuests(worldDB{}, []int{11, 10, 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Quests) != 2 {
		t.Fatalf("quests %+v", r.Quests)
	}
	a, b := r.Quests[0], r.Quests[1]
	if !reflect.DeepEqual(a.Links, map[string]int{"PrevQuestId": 9}) || !reflect.DeepEqual(a.Kills, []int{600, -700}) || !reflect.DeepEqual(a.Items, []int{800}) {
		t.Errorf("quest 10 %+v", a)
	}
	if !reflect.DeepEqual(a.Givers, []QuestHolder{{"creature", 100}}) || !reflect.DeepEqual(a.Enders, []QuestHolder{{"creature", 101}}) {
		t.Errorf("quest 10 holders %+v %+v", a.Givers, a.Enders)
	}
	if b.SpecialFlags != 2 || !reflect.DeepEqual(b.Links, map[string]int{"PrevQuestId": 10, "NextQuestInChain": 12}) || !reflect.DeepEqual(b.Enders, []QuestHolder{{"object", 200}}) ||
		!reflect.DeepEqual(b.Triggers, []int{90}) || !reflect.DeepEqual(b.ItemStarts, []int{850}) || len(b.Givers) != 0 {
		t.Errorf("quest 11 %+v", b)
	}
	if len(r.Linked) != 2 || r.Linked[1] != (QuestBrief{12, "Third", 20}) {
		t.Errorf("linked %+v", r.Linked)
	}
	want := []SpawnTally{
		{"creature", 100, "Giver", true, 2, 1}, {"creature", 101, "Ender", true, 0, 0}, {"creature", 600, "Wolf", true, 0, 0},
		{"object", 200, "Board", true, 1, 0}, {"object", 700, "Crate", true, 0, 0},
	}
	if !reflect.DeepEqual(r.Spawns, want) {
		t.Errorf("spawns %+v", r.Spawns)
	}
	if !reflect.DeepEqual(r.Summoned, []int{600}) || !reflect.DeepEqual(r.Items, []ItemTally{{800, "Pelt", true, false}}) || !reflect.DeepEqual(r.MissingTriggers, []int{90}) {
		t.Errorf("summoned %v, items %+v, triggers %v", r.Summoned, r.Items, r.MissingTriggers)
	}
}

// No quests asks nothing.
func TestCheckQuestsNone(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		t.Fatalf("asked %s", sql)
		return nil, nil
	}
	if r, err := checkQuests(worldDB{}, []int{0, -3}); err != nil || len(r.Quests) != 0 || r.Spawns == nil {
		t.Errorf("%+v, %v", r, err)
	}
}

// The queries against the server's world database (read only): Elwynn's Kobold Camp Cleanup (7) and
// Wolves Across the Border (33) have a spawned giver, their kill target and item are there, and the
// item drops.
func TestCheckQuestsLive(t *testing.T) {
	db, err := openWorld(testclient.ServerDir(t))
	if err != nil {
		t.Skip("no world database: " + err.Error())
	}
	r, err := checkQuests(db, []int{7, 33})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Quests) != 2 {
		t.Fatalf("quests %+v", r.Quests)
	}
	for _, q := range r.Quests {
		if len(q.Givers) == 0 || len(q.Enders) == 0 {
			t.Errorf("quest %d has no giver or ender: %+v", q.Entry, q)
		}
	}
	if k := r.Quests[0].Kills; len(k) == 0 || k[0] != 6 {
		t.Errorf("quest 7 kills %v, want Kobold Vermin (6)", k)
	}
	for _, s := range r.Spawns {
		if !s.Exists || s.World == 0 {
			t.Errorf("%s %d (%s) is not spawned", s.Kind, s.ID, s.Name)
		}
	}
	if len(r.Items) != 1 || !r.Items[0].Exists || !r.Items[0].Sourced {
		t.Errorf("items %+v, want Tough Wolf Meat dropped", r.Items)
	}
}

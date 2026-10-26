package vmangos

import (
	"Meld/internal/testclient"
	"strconv"
	"strings"
	"testing"
)

func TestConditionText(t *testing.T) {
	dbc := func(kind string, id int) string {
		if kind == "faction" && id == 72 {
			return "Stormwind"
		}
		return ""
	}
	cases := []struct {
		c    conditionEntry
		want string
	}{
		{conditionEntry{kind: 8, v: [4]int{176}, ref: "Wanted: Hogger"}, "Was rewarded quest Wanted: Hogger"},
		{conditionEntry{kind: 8, v: [4]int{176}}, "Was rewarded quest 176"},
		{conditionEntry{kind: 5, v: [4]int{72, 5}}, "Reputation with Stormwind at least Honored"},
		{conditionEntry{kind: 7, v: [4]int{164, 1}}, "Skill 164 at least 1"},
		{conditionEntry{kind: 6, v: [4]int{469}}, "Is Alliance"},
		{conditionEntry{kind: -1, v: [4]int{12, 13}}, "All of conditions 12, 13"},
		{conditionEntry{kind: 2, v: [4]int{11511, 2}, ref: "Cenarion Beacon", flags: 1}, "Not: Carries Cenarion Beacon ×2"},
		{conditionEntry{kind: 15, v: [4]int{10, 1}}, "Level at least 10"},
		{conditionEntry{kind: 99, v: [4]int{1, 2, 3, 4}}, "Type 99 (1, 2, 3, 4)"},
		{conditionEntry{kind: 27, v: [4]int{7}}, "Has no gender"},
	}
	for _, c := range cases {
		if got := conditionText(c.c, dbc); got != c.want {
			t.Errorf("%+v: got %q, want %q", c.c, got, c.want)
		}
	}
}

func TestParseConditions(t *testing.T) {
	got := parseConditions([]byte("4\t7\t164\t1\t0\t0\t0\t\n1\t2\t11511\t1\t0\t0\t1\tCenarion Beacon\nbad\n"))
	if len(got) != 2 || got[0].kind != 7 || got[0].ref != "" || got[1].ref != "Cenarion Beacon" || got[1].flags != 1 {
		t.Fatalf("got %+v", got)
	}
}

func TestMatchConditions(t *testing.T) {
	rows := []NamedID{{ID: 3, Name: "Is Alliance"}, {ID: 30, Name: "Has taken quest 3"}, {ID: 4, Name: "Is Horde"}}
	if got := matchConditions(rows, "3", 10); len(got) != 2 {
		t.Fatalf("by number = %+v", got)
	}
	if got := matchConditions(rows, "horde", 10); len(got) != 1 || got[0].ID != 4 {
		t.Fatalf("by text = %+v", got)
	}
	if got := matchConditions(rows, "is", 1); len(got) != 1 {
		t.Fatalf("limit = %+v", got)
	}
}

// TestCreatureListRefsLive names a row of each of the creature editor's list kinds (#700) and
// searches each by a word, against the running world database (VMANGOS_DIR).
func TestCreatureListRefsLive(t *testing.T) {
	dir := testclient.ServerDir(t)
	db, err := worldDatabase(dir)
	if err != nil {
		t.Fatal(err)
	}
	first := map[string]string{
		"vendor":             "SELECT MIN(entry) FROM npc_vendor_template",
		"trainer":            "SELECT MIN(entry) FROM npc_trainer_template",
		"equipment":          "SELECT MIN(entry) FROM creature_equip_template WHERE item1 > 0",
		"creature loot":      "SELECT MIN(entry) FROM creature_loot_template",
		"pickpocket loot":    "SELECT MIN(entry) FROM pickpocketing_loot_template",
		"skinning loot":      "SELECT MIN(entry) FROM skinning_loot_template",
		"spell list":         "SELECT MIN(entry) FROM creature_spells",
		"gossip script":      "SELECT MIN(id) FROM gossip_scripts",
		"map point":          "SELECT MIN(entry) FROM points_of_interest",
		"quest start script": "SELECT MIN(id) FROM quest_start_scripts",
		"quest end script":   "SELECT MIN(id) FROM quest_end_scripts",
		"exclusive group":    "SELECT MIN(ExclusiveGroup) FROM quest_template WHERE ExclusiveGroup > 0",
		"gossip":             "SELECT MIN(entry) FROM gossip_menu",
	}
	for kind, q := range first {
		raw, err := runSQL(db, q)
		if err != nil {
			t.Fatal(err)
		}
		id, err := strconv.Atoi(strings.TrimSpace(string(raw)))
		if err != nil || id == 0 {
			t.Logf("%s: no rows", kind)
			continue
		}
		names, err := WorldRefNames(dir, kind, []int{id})
		if err != nil || names[id] == "" {
			t.Fatalf("%s %d: %q, %v", kind, id, names[id], err)
		}
		t.Logf("%s %d: %s", kind, id, names[id])
	}
	if hits, err := SearchWorldRefs(dir, "creature loot", "Linen Cloth", 5); err != nil || len(hits) == 0 {
		t.Fatalf("creature loot search: %+v, %v", hits, err)
	}
	conds, err := ConditionNames(dir, "", []int{1, 2})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("conditions: %v", conds)
}

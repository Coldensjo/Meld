package vmangos

import (
	"reflect"
	"strings"
	"testing"
)

// Every kind the pickers name through worldRowsSQL is checked against the table they list it from.
func TestRefTargetsMatchThePickers(t *testing.T) {
	for kind, targets := range refTargets {
		rows, err := worldRowsSQL(kind)
		if err != nil {
			continue // a template kind (creature, quest, spell…), named by TemplateNames
		}
		table, _, _ := strings.Cut(targets[0], ".")
		if !strings.Contains(rows, "FROM "+table) {
			t.Errorf("%s: checked against %s, but the picker lists %s", kind, table, rows)
		}
	}
}

func TestCheckWorldData(t *testing.T) {
	// Port 1: nothing answers there should runSQL not be stood in for (#876).
	root := writeConf(t, "WorldDatabase.Info = \"127.0.0.1;1;mangos;mangos;mangos\"\n")
	old := runSQL
	defer func() { runSQL = old }()
	var asked []string
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		asked = append(asked, sql)
		switch {
		case sql == "SELECT 1":
			return []byte("1\n"), nil
		case sql == "SHOW COLUMNS FROM creature_template":
			return []byte("entry\tint(10) unsigned\tNO\tPRI\t0\t\nname\tvarchar(100)\tNO\t\t\t\ngossip_menu_id\tint(10) unsigned\tNO\t\t0\t\nvendor_id\tint(10) unsigned\tNO\t\t0\t\nloot_id\tint(10) unsigned\tNO\t\t0\t\n"), nil
		case sql == "SHOW COLUMNS FROM gameobject_template":
			return []byte("entry\tint(10) unsigned\tNO\tPRI\t0\t\ntype\ttinyint(3)\tNO\t\t0\t\ndata0\tint(10)\tNO\t\t0\t\ndata1\tint(10)\tNO\t\t0\t\n"), nil
		case strings.HasPrefix(sql, "SELECT t.entry, t.name, t.npc_flags"):
			for _, want := range []string{"t.entry IN (100,101)", "t.`gossip_menu_id`, t.`vendor_id`", "MAX(patch) FROM creature_template"} {
				if !strings.Contains(sql, want) {
					t.Errorf("creature rows %q lack %q", sql, want)
				}
			}
			if strings.Contains(sql, "no_such_col") || strings.Contains(sql, "faction") {
				t.Errorf("creature rows read a column not asked or not in the table: %s", sql)
			}
			// 100: a gossip menu that is gone and a vendor list that is there; 101: nothing set, own vendor rows, EventAI without events.
			return []byte("100\tInnkeeper\t5\tNULL\t0\t0\t0\t900\t30\n101\tBob\t4\tEventAI\t1\t0\t0\t0\t0\n"), nil
		case strings.HasPrefix(sql, "SELECT t.entry, t.name, t.type"):
			// A chest (type 3) with a lock and a loot id, and a door (type 0) whose data1 is not a loot id.
			return []byte("200\tChest\t3\t57\t77\n201\tDoor\t0\t0\t555\n"), nil
		case strings.HasPrefix(sql, "SELECT DISTINCT id, quest FROM creature_questrelation"):
			return []byte("100\t5000\n100\t5001\n"), nil
		case strings.HasPrefix(sql, "SELECT DISTINCT id, quest FROM"):
			return nil, nil
		case strings.Contains(sql, "FROM `gossip_menu`"):
			return nil, nil // 900 is gone
		case strings.Contains(sql, "FROM `npc_vendor_template`"):
			return []byte("30\n"), nil
		case strings.Contains(sql, "FROM `gameobject_loot_template`"):
			if !strings.Contains(sql, "IN (77)") {
				t.Errorf("object loot asked %q, want only the chest's 77", sql)
			}
			return nil, nil
		case strings.Contains(sql, "FROM `quest_template`"):
			return []byte("5000\n"), nil
		case strings.HasPrefix(sql, "SELECT t.entry, t.Title"):
			if !strings.Contains(sql, "IN (5000)") {
				t.Errorf("quest checks asked %q, want only the quest that exists", sql)
			}
			return nil, nil // the quest checks (#952): TestCheckQuests
		case strings.HasPrefix(sql, "SELECT DISTINCT 'cs'"):
			return nil, nil
		}
		t.Fatalf("unexpected query %s", sql)
		return nil, nil
	}
	q := WorldDataQuery{
		CreatureEntries: []int{100, 101, 100},
		ObjectEntries:   []int{200, 201},
		CreatureRefs: []RefColumn{
			{Col: "gossip_menu_id", Kind: "gossip"}, {Col: "vendor_id", Kind: "vendor"}, {Col: "faction", Kind: "faction template"},
			{Col: "no_such_col", Kind: "gossip"}, {Col: "x`; DROP", Kind: "gossip"},
		},
		ObjectRefs: []RefColumn{{Type: 3, Col: "data0", Kind: "lock"}, {Type: 3, Col: "data1", Kind: "loot"}},
	}
	r, err := CheckWorldData(root, "", q)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Creatures) != 2 || len(r.Objects) != 2 {
		t.Fatalf("templates %+v %+v", r.Creatures, r.Objects)
	}
	c := r.Creatures[0]
	if c.Entry != 100 || c.NpcFlags != 5 || c.AIName != "" || !reflect.DeepEqual(c.Values, map[string]int{"gossip_menu_id": 900, "vendor_id": 30}) || !reflect.DeepEqual(c.Starts, []int{5000, 5001}) {
		t.Errorf("creature 100 %+v", c)
	}
	if b := r.Creatures[1]; !b.OwnVendor || b.AIName != "EventAI" || b.AIEvents != 0 || len(b.Values) != 0 {
		t.Errorf("creature 101 %+v", b)
	}
	if d := r.Objects[1]; len(d.Values) != 0 {
		t.Errorf("a door's data1 counted as loot: %+v", d)
	}
	want := map[string][]int{"gossip": {900}, "vendor": {}, "loot": {77}, "quest": {5001}}
	if !reflect.DeepEqual(r.Missing, want) {
		t.Errorf("missing %v, want %v", r.Missing, want)
	}
	if !reflect.DeepEqual(r.Unchecked, []string{"lock"}) {
		t.Errorf("unchecked %v, want the lock (no client)", r.Unchecked)
	}
	if r.Quests.Error != "" || r.Quests.Quests == nil {
		t.Errorf("quests %+v", r.Quests)
	}
	if r.Tables["gossip"] != "gossip_menu" || r.Tables["loot"] != "gameobject_loot_template" {
		t.Errorf("tables %v", r.Tables)
	}
}

func TestExistingSQLAsksEveryTableOfAKind(t *testing.T) {
	got := existingSQL("event", []int{7, 0, 7, 9})
	want := "SELECT DISTINCT `id` FROM `event_scripts` WHERE `id` IN (7,9) UNION SELECT DISTINCT `id` FROM `scripted_event_id` WHERE `id` IN (7,9)"
	if got != want {
		t.Errorf("existingSQL = %q", got)
	}
	if existingSQL("gossip", []int{0, -1}) != "" {
		t.Error("no ids should ask nothing")
	}
}

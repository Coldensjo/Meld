package vmangos

import (
	"strings"
	"testing"
)

func TestGreetingSQLNeverEditsSharedText(t *testing.T) {
	// No menu: a new one with the new text.
	sql := greetingSQL(805, Gossip{}, "Hello, $N.", "")
	for _, want := range []string{
		"VALUES (@text_b, 'Hello, $N.', 'Hello, $N.')", // the female text follows the male one
		"INSERT INTO `npc_text` (`ID`, `BroadcastTextID0`, `Probability0`) VALUES (@text_n, @text_b, 1);",
		"VALUES (@menu, @text_n, 0, 0);",
		"SET `gossip_menu_id` = @menu, `npc_flags` = `npc_flags` | 1 WHERE `entry` = 805;",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("no menu: missing %q in\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "UPDATE `broadcast_text`") || strings.Contains(sql, "UPDATE `npc_text`") {
		t.Fatal("a shared text row was edited")
	}

	// A menu of its own: its unconditioned row now points at the new text.
	own := Gossip{MenuID: 4048, Shared: 1, Texts: []GossipText{{TextID: 5000, Condition: 0}, {TextID: 5001, Condition: 7}}}
	sql = greetingSQL(197, own, "Hi", "Hi there")
	if !strings.Contains(sql, "SET @menu = 4048;") || !strings.Contains(sql, "UPDATE `gossip_menu` SET `text_id` = @text_n WHERE `entry` = @menu AND `text_id` = 5000;") {
		t.Fatalf("own menu:\n%s", sql)
	}
	if strings.Contains(sql, "gossip_menu_option") {
		t.Fatal("an own menu's options were copied")
	}

	// A shared menu: copied with its options, the greeting row swapped, the others kept.
	shared := Gossip{MenuID: 6944, Shared: 42, Texts: []GossipText{{TextID: 8000, Condition: 0}}}
	sql = greetingSQL(1, shared, "Hi", "")
	for _, want := range []string{
		"SELECT @menu, IF(`text_id` = 8000, @text_n, `text_id`), `script_id`, `condition_id` FROM `gossip_menu` WHERE `entry` = 6944;",
		"FROM `gossip_menu_option` WHERE `menu_id` = 6944;",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("shared menu: missing %q in\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "UPDATE `gossip_menu`") {
		t.Fatal("a shared menu was edited")
	}
}

func TestOptionsSQLNeverEditsSharedText(t *testing.T) {
	shown := map[int]string{3000: "I want to browse your goods.", 3001: "Are you sure?"}
	opts := []GossipOption{
		// Its broadcast text unchanged: kept by ID.
		{ID: 0, Icon: 1, Text: "I want to browse your goods.", BroadcastText: 3000, Action: 3, NpcFlag: 128, BoxText: "Are you sure?", BoxBroadcastText: 3001, BoxMoney: 100},
		// An edited broadcast text: the option's own text, the ID dropped.
		{ID: 1, Icon: 0, Text: "Tell me about $N's home.", BroadcastText: 3000, Action: 1, NpcFlag: 1, ActionMenu: -1},
	}
	own := Gossip{MenuID: 4048, Shared: 1}
	sql := optionsSQL(197, own, opts, shown)
	for _, want := range []string{
		"SET @menu = 4048;",
		"DELETE FROM `gossip_menu_option` WHERE `menu_id` = @menu;",
		"VALUES (@menu, 0, 1, '', 3000, 3, 128, 0, 0, 0, 0, 100, '', 3001, 0);",
		"VALUES (@menu, 1, 0, 'Tell me about $N\\'s home.', 0, 1, 1, -1, 0, 0, 0, 0, '', 0, 0);",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("own menu: missing %q in\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "`broadcast_text`") || strings.Contains(sql, "creature_template") {
		t.Fatalf("own menu touched a text or the template:\n%s", sql)
	}

	// A shared menu: copied (text rows only), the creature moved onto the copy, nothing deleted.
	sql = optionsSQL(1, Gossip{MenuID: 6944, Shared: 42}, opts[:1], shown)
	for _, want := range []string{
		"FROM `gossip_menu` WHERE `entry` = 6944;",
		"UPDATE `creature_template` SET `gossip_menu_id` = @menu WHERE `entry` = 1;",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("shared menu: missing %q in\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "DELETE") {
		t.Fatal("a shared menu's options were deleted")
	}
}

func TestCheckGossipOptions(t *testing.T) {
	ok := GossipOption{ID: 0, Text: "Hi", Action: 1, NpcFlag: 1}
	if err := checkGossipOptions([]GossipOption{ok}); err != nil {
		t.Fatal(err)
	}
	for name, bad := range map[string][]GossipOption{
		"duplicate id": {ok, ok},
		"no text":      {{ID: 1, Text: " "}},
		"icon":         {{ID: 1, Text: "a", Icon: 21}},
		"action":       {{ID: 1, Text: "a", Action: 18}},
		"menu":         {{ID: 1, Text: "a", ActionMenu: -2}},
	} {
		if checkGossipOptions(bad) == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestParseGossipOptionsAndLines(t *testing.T) {
	o := parseGossipOptions([]byte("0\t1\tI want to browse your goods.\t3000\t3\t128\t0\t0\t0\t0\t0\t\t0\t0\n"))
	if len(o) != 1 || o[0].BroadcastText != 3000 || o[0].NpcFlag != 128 || o[0].Text != "I want to browse your goods." {
		t.Fatalf("got %+v", o)
	}
	l := parseAILines([]byte("4\t100\t0\t1925\tI'll crush you!\n"))
	if len(l) != 1 || l[0].Event != 4 || l[0].TextID != 1925 || l[0].Text != "I'll crush you!" {
		t.Fatalf("got %+v", l)
	}
}

func TestParseGossipTexts(t *testing.T) {
	got := parseGossipTexts([]byte("5724\t0\tYer no warrior\t\n1215\t98\tThe big wars\tThe big wars\n"))
	if len(got) != 2 || got[0].TextID != 5724 || got[1].Condition != 98 || got[0].Female != "" {
		t.Fatalf("got %+v", got)
	}
}

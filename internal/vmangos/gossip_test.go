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

func TestConditionTextSQL(t *testing.T) {
	own := Gossip{MenuID: 4048, Shared: 1, Texts: []GossipText{{TextID: 5000, Condition: 0}, {TextID: 5001, Condition: 7}}}
	// An edited text: a new text row, the conditioned row repointed with its new condition.
	sql := conditionTextSQL(197, own, 5001, 9, "Welcome back.", "", false)
	for _, want := range []string{
		"VALUES (@text_b, 'Welcome back.', 'Welcome back.')",
		"UPDATE `gossip_menu` SET `text_id` = @text_n, `condition_id` = 9 WHERE `entry` = @menu AND `text_id` = 5001;",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("edited: missing %q in\n%s", want, sql)
		}
	}
	// Only the condition changed: the row keeps its npc_text, no text row is added.
	sql = conditionTextSQL(197, own, 5001, 9, "", "", true)
	if strings.Contains(sql, "broadcast_text") || !strings.Contains(sql, "SET `text_id` = 5001, `condition_id` = 9 WHERE `entry` = @menu AND `text_id` = 5001;") {
		t.Fatalf("kept:\n%s", sql)
	}
	// A new conditioned row.
	sql = conditionTextSQL(197, own, -1, 9, "Hi", "", false)
	if !strings.Contains(sql, "VALUES (@menu, @text_n, 0, 9);") || strings.Contains(sql, "UPDATE `gossip_menu`") {
		t.Fatalf("new:\n%s", sql)
	}
	// A shared menu: copied with the row swapped and its condition set, options copied, nothing edited.
	shared := Gossip{MenuID: 6944, Shared: 42, Texts: []GossipText{{TextID: 8000}, {TextID: 8001, Condition: 3}}}
	sql = conditionTextSQL(1, shared, 8001, 4, "Hi", "", false)
	for _, want := range []string{
		"SELECT @menu, IF(`text_id` = 8001, @text_n, `text_id`), `script_id`, IF(`text_id` = 8001, 4, `condition_id`) FROM `gossip_menu` WHERE `entry` = 6944;",
		"FROM `gossip_menu_option` WHERE `menu_id` = 6944;",
		"SET `gossip_menu_id` = @menu, `npc_flags` = `npc_flags` | 1 WHERE `entry` = 1;",
		// A new menu's number is past every menu named anywhere, not only gossip_menu's rows.
		"SET @menu = GREATEST(",
		"MAX(`gossip_menu_id`), 0) FROM `creature_template`)) + 1;",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("shared: missing %q in\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "UPDATE `gossip_menu`") {
		t.Fatal("a shared menu was edited")
	}

	// Deleting: from its own menu a DELETE; a shared menu is copied without the row.
	var b strings.Builder
	textRowSQL(&b, 197, own, 5001, "", 0)
	if sql = b.String(); !strings.Contains(sql, "DELETE FROM `gossip_menu` WHERE `entry` = @menu AND `text_id` = 5001;") || strings.Contains(sql, "npc_flags") {
		t.Fatalf("delete own:\n%s", sql)
	}
	b.Reset()
	textRowSQL(&b, 1, shared, 8001, "", 0)
	if sql = b.String(); !strings.Contains(sql, "FROM `gossip_menu` WHERE `entry` = 6944 AND `text_id` <> 8001;") || strings.Contains(sql, "DELETE") {
		t.Fatalf("delete shared:\n%s", sql)
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
	l := parseAILines([]byte("4\t100\t0\t1925\tI'll crush you!\t225201\t225201\n"))
	if len(l) != 1 || l[0].Event != 4 || l[0].TextID != 1925 || l[0].Text != "I'll crush you!" || l[0].EventID != 225201 || l[0].ScriptID != 225201 {
		t.Fatalf("got %+v", l)
	}
}

func TestParseGossipTexts(t *testing.T) {
	got := parseGossipTexts([]byte("5724\t0\tYer no warrior\t\n1215\t98\tThe big wars\tThe big wars\n"))
	if len(got) != 2 || got[0].TextID != 5724 || got[1].Condition != 98 || got[0].Female != "" {
		t.Fatalf("got %+v", got)
	}
}

func TestAILineSQL(t *testing.T) {
	// A script only this event runs: a new text swapped into its talk commands, nothing copied.
	sql := aiLineSQL(225201, 225201, 1925, "I'll squash you!", false)
	for _, want := range []string{
		`SELECT @text_b, 'I\'ll squash you!', IF(COALESCE(` + "`female_text`, '') = '', `female_text`, " + `'I\'ll squash you!'), ` + "`chat_type`",
		"FROM `broadcast_text` WHERE `entry` = 1925;",
		"`dataint` = IF(`dataint` = 1925, @text_b, `dataint`)",
		"`dataint4` = IF(`dataint4` = 1925, @text_b, `dataint4`) WHERE `id` = 225201 AND `command` = 0;",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("own: missing %q in\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "UPDATE `broadcast_text`") || strings.Contains(sql, "@script") || strings.Contains(sql, "creature_ai_events") {
		t.Fatalf("own: a shared row was edited or the script copied:\n%s", sql)
	}
	// A script other events run too: copied whole with the text swapped, only this event repointed.
	sql = aiLineSQL(7, 500, 1925, "Hi", true)
	for _, want := range []string{
		"INSERT INTO `creature_ai_scripts` (`id`, `delay`,",
		"SELECT @script, `delay`,",
		"IF(`command` = 0 AND `dataint2` = 1925, @text_b, `dataint2`)",
		"`comments` FROM `creature_ai_scripts` WHERE `id` = 500;",
		"`action3_script` = IF(`action3_script` = 500, @script, `action3_script`) WHERE `id` = 7;",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("shared: missing %q in\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "UPDATE `creature_ai_scripts`") {
		t.Fatalf("shared: the shared script was edited:\n%s", sql)
	}
}

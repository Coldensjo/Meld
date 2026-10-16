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

func TestParseGossipTexts(t *testing.T) {
	got := parseGossipTexts([]byte("5724\t0\tYer no warrior\t\n1215\t98\tThe big wars\tThe big wars\n"))
	if len(got) != 2 || got[0].TextID != 5724 || got[1].Condition != 98 || got[0].Female != "" {
		t.Fatalf("got %+v", got)
	}
}

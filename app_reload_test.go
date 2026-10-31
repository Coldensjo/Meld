package main

import (
	"errors"
	"strings"
	"testing"

	"Meld/internal/vmangos"
)

// TestWorldReloads checks the tables each editor's save has the running world server reload (#961):
// a template by its row when one was written, one command a table, and a restart for what VMaNGOS
// can't reload.
func TestWorldReloads(t *testing.T) {
	cases := []struct {
		save    string
		entries []int
		want    string
		restart bool
	}{
		{"SaveCreature", []int{7}, "creature_template 7", false},
		{"ImportCreatures", []int{7, 8}, "creature_template npc_vendor creature_questrelation creature_involvedrelation", false},
		{"SaveObject", []int{9}, "gameobject_template 9", false},
		{"SaveQuest", nil, "quest_template", false},
		{"SaveQuestGivers", nil, "creature_questrelation creature_involvedrelation gameobject_questrelation gameobject_involvedrelation", false},
		{"SaveQuestGivers", []int{3, 4}, "creature_questrelation creature_involvedrelation gameobject_questrelation gameobject_involvedrelation creature_template", false},
		{"SaveItem", nil, "item_template", false},
		{"SaveObjectLoot", nil, "gameobject_loot_template", false},
		{"SaveVendor", nil, "npc_vendor", false},
		{"SaveGossipOptions", []int{5}, "gossip_menu_option gossip_menu creature_template 5", false},
		{"SaveGreeting", []int{5}, "", true},
		{"SaveSpell", nil, "spell_template", false},
		{"SaveWeather", nil, "game_weather", false},
		{"SaveMap", nil, "", false},
	}
	for _, c := range cases {
		cmds, restart := worldReloads(c.save, c.entries...)
		if got := strings.Join(cmds, " "); got != c.want || (restart != "") != c.restart {
			t.Errorf("%s %v: %q, restart %q", c.save, c.entries, got, restart)
		}
	}
	cmds, restart := worldReloads("DeleteItem")
	if restart == "" || strings.Contains(strings.Join(cmds, " "), "item_template") || len(cmds) != 11 {
		t.Errorf("DeleteItem: %q, restart %q", cmds, restart)
	}
}

func TestReloadMessage(t *testing.T) {
	if m := reloadMessage([]string{"creature_template 7"}, "", nil); !strings.Contains(m, "reloaded on the server (creature_template)") {
		t.Errorf("done: %s", m)
	}
	if m := reloadMessage([]string{"npc_vendor"}, "", vmangos.ErrSoapOff); !strings.Contains(m, "SOAP.Enabled") || !strings.Contains(m, ".reload") {
		t.Errorf("console off: %s", m)
	}
	if m := reloadMessage([]string{"npc_vendor"}, "", errors.New("refused")); !strings.Contains(m, "refused") {
		t.Errorf("failed: %s", m)
	}
	if m := reloadMessage(nil, "the new text", nil); m != "Restart the world server for the new text." {
		t.Errorf("restart only: %s", m)
	}
}

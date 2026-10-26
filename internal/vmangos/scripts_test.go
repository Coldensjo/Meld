package vmangos

import (
	"strings"
	"testing"

	"Meld/internal/testclient"
)

func TestParseSpawnScripts(t *testing.T) {
	raw := []byte("cpp\t0\t\t0\t\n" +
		"ai\t0\tEventAI\t0\t\n" +
		"use\t42\t\t0\t\n" +
		"eventai\t224001\t\t1\tSyndicate Footpad - Flee at 15% HP\n" +
		"path\t617501\t3, 7\t2\tSay something; Emote\n" +
		"gossip\t342\tTeleport me\t1\t\n")
	got := parseSpawnScripts(raw)
	if len(got) != 4 {
		t.Fatalf("parseSpawnScripts = %+v, want the empty script_name and the unused use scripts left out", got)
	}
	if g := got[0]; g.Kind != "ai" || g.Name != "EventAI" {
		t.Errorf("first = %+v", g)
	}
	if g := got[2]; g.Kind != "path" || g.ID != 617501 || g.Name != "3, 7" || g.Commands != 2 || g.Comment != "Say something; Emote" {
		t.Errorf("path = %+v", g)
	}
	if g := got[3]; g.Kind != "gossip" || g.Table != "gossip_scripts" || g.Name != "Teleport me" || g.ID != 342 {
		t.Errorf("gossip = %+v", g)
	}
	if got := parseSpawnScripts(nil); got == nil || len(got) != 0 {
		t.Errorf("no rows should give an empty list, got %#v", got)
	}
}

func TestSpawnScriptsSQL(t *testing.T) {
	obj := spawnScriptsSQL("object", 2576, 42)
	for _, want := range []string{
		"SELECT script_name FROM gameobject_template WHERE entry = 2576 ORDER BY patch DESC LIMIT 1",
		"FROM gameobject_scripts WHERE id = 42",
		"WHEN 10 THEN data2 WHEN 3 THEN data6 WHEN 13 THEN data2", // GetEventScriptId
		"event_scripts", "scripted_event_id",
	} {
		if !strings.Contains(obj, want) {
			t.Errorf("object SQL lacks %q", want)
		}
	}
	cr := spawnScriptsSQL("creature", 6175, 108)
	for _, want := range []string{
		"SELECT ai_name FROM creature_template WHERE entry = 6175",
		"creature_ai_events e WHERE e.creature_id = 6175", "action3_script",
		"creature_movement WHERE id = 108 AND script_id > 0",
		"creature_movement_template WHERE entry = 6175",
		"creature_movement_scripts",
	} {
		if !strings.Contains(cr, want) {
			t.Errorf("creature SQL lacks %q", want)
		}
	}
	for _, want := range []string{"WITH RECURSIVE menus", "gossip_scripts", "creature_questrelation", "creature_involvedrelation", "StartScript", "CompleteScript", "scriptId_8", "creature_spells_scripts"} {
		if !strings.Contains(cr, want) {
			t.Errorf("creature SQL lacks %q", want)
		}
	}
	if !strings.Contains(obj, "gameobject_questrelation") || strings.Contains(obj, "creature_spells") {
		t.Error("an object's SQL reads its own quest relations and has no spell list")
	}
	if strings.Contains(cr, "gameobject_scripts") {
		t.Error("a creature has no gameobject_scripts")
	}
}

// TestSpawnScriptsReal reads the scripts of spawns the VMaNGOS world database has them for: a game
// object used through gameobject_scripts, a goober with an event, a creature with EventAI and one
// whose path runs scripts.
func TestSpawnScriptsReal(t *testing.T) {
	if testing.Short() {
		t.Skip("reads the world database")
	}
	server := testclient.ServerDir(t)
	has := func(kind string, entry, guid int, want string) []SpawnScript {
		t.Helper()
		got, err := SpawnScripts(server, kind, entry, guid)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s %d (guid %d): %+v", kind, entry, guid, got)
		for _, s := range got {
			if s.Kind == want && (s.Commands > 0 || s.Name != "") {
				return got
			}
		}
		t.Errorf("%s %d (guid %d): no %q script in %+v", kind, entry, guid, want, got)
		return got
	}
	has("object", 18901, 34006, "use")
	has("object", 2576, 0, "event")
	has("object", 1728, 0, "cpp")
	has("creature", 2240, 0, "ai")
	has("creature", 2240, 0, "eventai")
	has("creature", 6175, 108, "path")
	has("creature", 295, 0, "gossip")
	has("creature", 197, 0, "queststart")
	has("creature", 234, 0, "questend")
	has("creature", 4064, 0, "spell")
	// A script's commands.
	for _, tc := range []struct {
		table string
		id    int
	}{{"gossip_scripts", 342}, {"quest_start_scripts", 54}, {"creature_spells_scripts", 3019}} {
		cmds, err := ScriptCommands(server, tc.table, tc.id)
		if err != nil || len(cmds) == 0 {
			t.Errorf("ScriptCommands(%s, %d) = %v, %v; want commands", tc.table, tc.id, cmds, err)
		}
		t.Logf("%s %d: %+v", tc.table, tc.id, cmds)
	}
	if _, err := ScriptCommands(server, "account", 1); err == nil {
		t.Error("a table outside the script tables should be refused")
	}
}

func TestParseScriptCommands(t *testing.T) {
	got := parseScriptCommands([]byte("500\t6\t0\t1\t2\t3\t1.5\t2\t3\t0\tGo\n"))
	if len(got) != 1 || got[0].Delay != 500 || got[0].Command != 6 || got[0].Data != [4]int{0, 1, 2, 3} || got[0].X != 1.5 || got[0].Comments != "Go" {
		t.Errorf("parseScriptCommands = %+v", got)
	}
}

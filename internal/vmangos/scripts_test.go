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
		"path\t617501\t3, 7\t2\tSay something; Emote\n")
	got := parseSpawnScripts(raw)
	if len(got) != 3 {
		t.Fatalf("parseSpawnScripts = %+v, want the empty script_name and the unused use scripts left out", got)
	}
	if g := got[0]; g.Kind != "ai" || g.Name != "EventAI" {
		t.Errorf("first = %+v", g)
	}
	if g := got[2]; g.Kind != "path" || g.ID != 617501 || g.Name != "3, 7" || g.Commands != 2 || g.Comment != "Say something; Emote" {
		t.Errorf("path = %+v", g)
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
}

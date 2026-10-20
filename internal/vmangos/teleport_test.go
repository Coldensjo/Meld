package vmangos

import (
	"strings"
	"testing"
)

func TestParseSpawnTeleports(t *testing.T) {
	raw := []byte("Gossip: Please port me to Darnassus.\t1\t9945.13\t2616.89\t1316.46\t4.61\n" +
		"Gossip: Please port me to Darnassus.\t1\t9945.13\t2616.89\t1316.46\t4.61\n" +
		"Casts Portal Effect: Stormwind\t0\t-9003.46\t870.031\t29.6206\t5.28\n")
	got := parseSpawnTeleports(raw)
	if len(got) != 2 {
		t.Fatalf("parseSpawnTeleports = %+v, want the repeated row once", got)
	}
	if g := got[1]; g.Label != "Casts Portal Effect: Stormwind" || g.Dest.Map != 0 || g.Dest.X != -9003.46 || g.Dest.O != 5.28 {
		t.Errorf("second teleport = %+v", g)
	}
	if got := parseSpawnTeleports(nil); got == nil || len(got) != 0 {
		t.Errorf("no rows should give an empty list, got %#v", got)
	}
}

func TestSpawnTeleportSQL(t *testing.T) {
	obj := spawnTeleportSQL("object", 176296, 42)
	for _, want := range []string{
		"WITH RECURSIVE menus",
		"WHEN 2 THEN data3 WHEN 10 THEN data19",  // gossip of a questgiver, a goober
		"WHEN 22 THEN data0 WHEN 10 THEN data10", // spell of a spellcaster, a goober
		"entry = 176296 ORDER BY patch DESC LIMIT 1",
		"42 AS script_id", // gameobject_scripts by guid
		"gameobject_scripts", "event_scripts", "gameobject_questrelation", "quest_end_scripts",
		"s.command = 6", "s.command = 15",
		"5 IN (st.effect1, st.effect2, st.effect3)", "build_min <= 5875",
	} {
		if !strings.Contains(obj, want) {
			t.Errorf("object SQL lacks %q", want)
		}
	}
	if strings.Contains(obj, "creature_ai_scripts") {
		t.Error("an object has no creature AI")
	}
	cr := spawnTeleportSQL("creature", 3838, 7)
	for _, want := range []string{
		"SELECT gossip_menu_id FROM creature_template WHERE entry = 3838",
		"spellId_8", "scriptId_8", "creature_spells_scripts",
		"creature_ai_events WHERE creature_id = 3838", "action3_script",
		"creature_movement WHERE id = 7", "creature_movement_scripts",
		"IF(s.datalong = 0, COALESCE((SELECT map FROM creature WHERE guid = 7 LIMIT 1), 0), s.datalong)",
		"creature_questrelation",
	} {
		if !strings.Contains(cr, want) {
			t.Errorf("creature SQL lacks %q", want)
		}
	}
	if strings.Contains(cr, "gameobject_scripts") {
		t.Error("a creature has no gameobject_scripts")
	}
}

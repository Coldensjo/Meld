package vmangos

import (
	"fmt"
	"strings"
)

// The scripts attached to a spawn (#137), read-only: a first step toward the node editor (#30) and
// Lua (#28). VMaNGOS attaches them so:
//   - a game object: its template's script_name (a C++ script), its gameobject_scripts rows (keyed by
//     the spawn's guid, run when it is used) and the event its template's data names (event_scripts,
//     and scripted_event_id for a C++ event script): a goober's data2, a chest's data6, a camera's
//     data2 (GameObjectInfo::GetEventScriptId);
//   - a creature: its template's script_name and ai_name, its EventAI events (creature_ai_events,
//     whose action scripts are in creature_ai_scripts; they run only with ai_name EventAI) and its
//     path's point scripts (creature_movement_scripts), from the spawn's own path or else its
//     template's;
//   - either: the scripts of its gossip options (gossip_menu_option.action_script_id into
//     gossip_scripts, through the template's menu and the menus its options open), of the quests it
//     starts and ends (quest_template.StartScript, CompleteScript) and, for a creature, of its spell
//     list (creature_spells.scriptId_1..8 into creature_spells_scripts) (#736).
//
// A script's commands are read on demand by ScriptCommands, from the table its kind says.

// SpawnScript is one script attached to a spawn.
type SpawnScript struct {
	// Kind is what attaches it: "cpp" (the template's script_name), "ai" (the template's ai_name),
	// "use" (gameobject_scripts), "event" (an object's event), "eventai" (an EventAI event), "path"
	// (a path point's script), "gossip" (a gossip option's script), "queststart" or "questend" (a
	// quest's start or complete script) or "spell" (a spell list slot's script).
	Kind string `json:"kind"`
	// ID is the script's id in its table (the guid for "use", the event id, the EventAI event's id,
	// the path's script_id); 0 for "cpp" and "ai".
	ID int `json:"id"`
	// Name is the C++ script or AI's name, a C++ event script's name, or the path points that run
	// the script; for "gossip" the option's text, for a quest its title, for "spell" the slot.
	Name string `json:"name"`
	// Commands is how many script commands it has in the database.
	Commands int `json:"commands"`
	// Comment is the script's comments (an EventAI event's own comment), distinct ones joined.
	Comment string `json:"comment"`
	// Table is the script table ScriptCommands reads its commands from; empty when the kind has none
	// to list ("cpp", "ai", "eventai", whose events run up to three scripts).
	Table string `json:"table"`
}

// scriptTables maps a script kind to the table its commands are in.
var scriptTables = map[string]string{
	"use": "gameobject_scripts", "event": "event_scripts", "path": "creature_movement_scripts",
	"gossip": "gossip_scripts", "queststart": "quest_start_scripts", "questend": "quest_end_scripts", "spell": "creature_spells_scripts",
}

// commentsOf gathers the distinct comments of table's script id (a column expression).
func commentsOf(table, id string) string {
	return labelCol(fmt.Sprintf("COALESCE((SELECT GROUP_CONCAT(DISTINCT NULLIF(s.comments, '') SEPARATOR '; ') FROM %s s WHERE s.id = %s), '')", table, id))
}

// spawnScriptsSQL is one query for the scripts of a creature (kind "creature") or game object spawn:
// rows of kind, id, name, commands, comment.
func spawnScriptsSQL(kind string, entry, guid int) string {
	return spawnScriptsMenuCTE(kind, entry) + spawnOwnScriptsSQL(kind, entry, guid) + spawnLinkedScriptsSQL(kind, entry)
}

// spawnScriptsMenuCTE is the WITH clause for the gossip menus a spawn leads to: the template's menu
// and every menu its options open (UNION stops at a loop).
func spawnScriptsMenuCTE(kind string, entry int) string {
	var menu string
	if kind == "object" {
		menu = latest("gameobject_template", fmt.Sprintf("CASE type WHEN %d THEN data3 WHEN %d THEN data19 ELSE 0 END", objectTypeQuestgiver, objectTypeGoober), entry)
	} else {
		menu = latest("creature_template", "gossip_menu_id", entry)
	}
	return fmt.Sprintf("WITH RECURSIVE menus (id) AS (SELECT COALESCE(%s, 0) UNION SELECT o.action_menu_id FROM gossip_menu_option o JOIN menus m ON o.menu_id = m.id WHERE m.id > 0 AND o.action_menu_id > 0) ", menu)
}

// spawnLinkedScriptsSQL is the UNION ALL part for the scripts reached through other tables: gossip
// options, quests and a creature's spell list.
func spawnLinkedScriptsSQL(kind string, entry int) string {
	prefix := "creature"
	if kind == "object" {
		prefix = "gameobject"
	}
	out := fmt.Sprintf(" UNION ALL SELECT 'gossip', o.action_script_id, %s, (SELECT COUNT(*) FROM gossip_scripts WHERE id = o.action_script_id), %s "+
		"FROM menus m JOIN gossip_menu_option o ON o.menu_id = m.id WHERE m.id > 0 AND o.action_script_id > 0",
		labelCol("COALESCE(o.option_text, '')"), commentsOf("gossip_scripts", "o.action_script_id"))
	for _, q := range []struct{ kind, col, table string }{{"queststart", "StartScript", "quest_start_scripts"}, {"questend", "CompleteScript", "quest_end_scripts"}} {
		rel := "involvedrelation"
		if q.kind == "queststart" {
			rel = "questrelation"
		}
		out += fmt.Sprintf(" UNION ALL SELECT '%[1]s', q.%[2]s, %[3]s, (SELECT COUNT(*) FROM %[4]s WHERE id = q.%[2]s), %[5]s FROM %[6]s_%[7]s r JOIN quest_template q ON q.entry = r.quest WHERE r.id = %[8]d AND q.%[2]s > 0",
			q.kind, q.col, labelCol("COALESCE(q.Title, '')"), q.table, commentsOf(q.table, "q."+q.col), prefix, rel, entry)
	}
	if kind != "object" {
		list := latest("creature_template", "spell_list_id", entry)
		var slots []string
		for i := 1; i <= creatureSpellListLen; i++ {
			slots = append(slots, fmt.Sprintf("SELECT %d AS slot, scriptId_%[1]d AS script_id FROM creature_spells WHERE entry = %s", i, list))
		}
		out += fmt.Sprintf(" UNION ALL SELECT 'spell', c.script_id, %s, (SELECT COUNT(*) FROM creature_spells_scripts WHERE id = c.script_id), %s FROM (%s) c WHERE c.script_id > 0",
			labelCol("CONCAT('slot ', c.slot)"), commentsOf("creature_spells_scripts", "c.script_id"), strings.Join(slots, " UNION ALL "))
	}
	return out
}

// spawnOwnScriptsSQL is the scripts attached to the spawn or its template directly.
func spawnOwnScriptsSQL(kind string, entry, guid int) string {
	if kind == "object" {
		event := latest("gameobject_template", fmt.Sprintf("CASE type WHEN %d THEN data2 WHEN %d THEN data6 WHEN %d THEN data2 ELSE 0 END", objectTypeGoober, objectTypeChest, objectTypeCamera), entry)
		return fmt.Sprintf("SELECT 'cpp', 0, %s, 0, ''", labelCol("COALESCE("+latest("gameobject_template", "script_name", entry)+", '')")) +
			fmt.Sprintf(" UNION ALL SELECT 'use', %d, '', COUNT(*), %s FROM gameobject_scripts WHERE id = %[1]d", guid, commentsOf("gameobject_scripts", fmt.Sprint(guid))) +
			fmt.Sprintf(" UNION ALL SELECT 'event', ev.id, %s, (SELECT COUNT(*) FROM event_scripts WHERE id = ev.id), %s FROM (SELECT COALESCE(%s, 0) AS id) ev WHERE ev.id > 0",
				labelCol("COALESCE((SELECT script_name FROM scripted_event_id WHERE id = ev.id), '')"), commentsOf("event_scripts", "ev.id"), event)
	}
	return fmt.Sprintf("SELECT 'cpp', 0, %s, 0, ''", labelCol("COALESCE("+latest("creature_template", "script_name", entry)+", '')")) +
		fmt.Sprintf(" UNION ALL SELECT 'ai', 0, %s, 0, ''", labelCol("COALESCE("+latest("creature_template", "ai_name", entry)+", '')")) +
		fmt.Sprintf(" UNION ALL SELECT 'eventai', e.id, '', (SELECT COUNT(*) FROM creature_ai_scripts s WHERE s.id > 0 AND s.id IN (e.action1_script, e.action2_script, e.action3_script)), %s "+
			"FROM creature_ai_events e WHERE e.creature_id = %d", labelCol("e.comment"), entry) +
		fmt.Sprintf(" UNION ALL SELECT 'path', p.script_id, %s, (SELECT COUNT(*) FROM creature_movement_scripts WHERE id = p.script_id), %s "+
			"FROM (SELECT point, script_id FROM creature_movement WHERE id = %d AND script_id > 0 "+
			"UNION ALL SELECT point, script_id FROM creature_movement_template WHERE entry = %d AND script_id > 0 AND NOT EXISTS (SELECT 1 FROM creature_movement WHERE id = %[3]d)) p "+
			"GROUP BY p.script_id", labelCol("GROUP_CONCAT(p.point ORDER BY p.point SEPARATOR ', ')"), commentsOf("creature_movement_scripts", "p.script_id"), guid, entry)
}

// parseSpawnScripts reads spawnScriptsSQL's rows, leaving out an empty script_name or ai_name and
// an object's use scripts when it has none.
func parseSpawnScripts(raw []byte) []SpawnScript {
	out := []SpawnScript{}
	for _, f := range batchRows(raw, 5) {
		s := SpawnScript{Kind: f[0], ID: f.num(1), Name: f[2], Commands: f.num(3), Comment: f[4], Table: scriptTables[f[0]]}
		if s.Name == "NULL" {
			s.Name = ""
		}
		if s.Comment == "NULL" {
			s.Comment = ""
		}
		switch s.Kind {
		case "cpp", "ai":
			if s.Name == "" {
				continue
			}
		case "use":
			if s.Commands == 0 {
				continue
			}
		}
		out = append(out, s)
	}
	return out
}

// SpawnScripts lists the scripts attached to a creature (kind "creature") or game object (kind
// "object") spawn of template entry and spawn guid, as the world database has them. Empty when it
// has none.
func SpawnScripts(serverRoot, kind string, entry, guid int) ([]SpawnScript, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, spawnScriptsSQL(kind, entry, guid))
	if err != nil {
		return nil, err
	}
	return parseSpawnScripts(raw), nil
}

// ScriptCommand is one row of a script table: what the script does, after how long.
type ScriptCommand struct {
	Delay    int     `json:"delay"`
	Command  int     `json:"command"`
	Data     [4]int  `json:"data"` // datalong..datalong4
	X        float32 `json:"x"`
	Y        float32 `json:"y"`
	Z        float32 `json:"z"`
	O        float32 `json:"o"`
	Comments string  `json:"comments"`
}

// scriptCommandsSQL reads script id's rows of table (one of scriptTables' values), in the order the
// server runs them.
func scriptCommandsSQL(table string, id int) (string, bool) {
	for _, t := range scriptTables {
		if t == table {
			return fmt.Sprintf("SELECT delay, command, datalong, datalong2, datalong3, datalong4, x, y, z, o, %s FROM %s WHERE id = %d ORDER BY delay, priority, command", labelCol("comments"), table, id), true
		}
	}
	return "", false
}

// parseScriptCommands reads scriptCommandsSQL's rows.
func parseScriptCommands(raw []byte) []ScriptCommand {
	out := []ScriptCommand{}
	for _, f := range batchRows(raw, 11) {
		c := ScriptCommand{Delay: f.num(0), Command: f.num(1), X: f.f32(6), Y: f.f32(7), Z: f.f32(8), O: f.f32(9), Comments: f[10]}
		for i := range c.Data {
			c.Data[i] = f.num(2 + i)
		}
		if c.Comments == "NULL" {
			c.Comments = ""
		}
		out = append(out, c)
	}
	return out
}

// ScriptCommands lists the commands of script id in one of the script tables a SpawnScript names
// (SpawnScript.Table), read when the user opens it. Empty for an unknown table or id.
func ScriptCommands(serverRoot, table string, id int) ([]ScriptCommand, error) {
	q, ok := scriptCommandsSQL(table, id)
	if !ok {
		return nil, fmt.Errorf("unknown script table %q", table)
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, q)
	if err != nil {
		return nil, err
	}
	return parseScriptCommands(raw), nil
}

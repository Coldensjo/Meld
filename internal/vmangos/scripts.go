package vmangos

import "fmt"

// The scripts attached to a spawn (#137), read-only: a first step toward the node editor (#30) and
// Lua (#28). VMaNGOS attaches them so:
//   - a game object: its template's script_name (a C++ script), its gameobject_scripts rows (keyed by
//     the spawn's guid, run when it is used) and the event its template's data names (event_scripts,
//     and scripted_event_id for a C++ event script): a goober's data2, a chest's data6, a camera's
//     data2 (GameObjectInfo::GetEventScriptId);
//   - a creature: its template's script_name and ai_name, its EventAI events (creature_ai_events,
//     whose action scripts are in creature_ai_scripts; they run only with ai_name EventAI) and its
//     path's point scripts (creature_movement_scripts), from the spawn's own path or else its
//     template's.

// SpawnScript is one script attached to a spawn.
type SpawnScript struct {
	// Kind is what attaches it: "cpp" (the template's script_name), "ai" (the template's ai_name),
	// "use" (gameobject_scripts), "event" (an object's event), "eventai" (an EventAI event) or "path"
	// (a path point's script).
	Kind string `json:"kind"`
	// ID is the script's id in its table (the guid for "use", the event id, the EventAI event's id,
	// the path's script_id); 0 for "cpp" and "ai".
	ID int `json:"id"`
	// Name is the C++ script or AI's name, a C++ event script's name, or the path points that run
	// the script.
	Name string `json:"name"`
	// Commands is how many script commands it has in the database.
	Commands int `json:"commands"`
	// Comment is the script's comments (an EventAI event's own comment), distinct ones joined.
	Comment string `json:"comment"`
}

// commentsOf gathers the distinct comments of table's script id (a column expression).
func commentsOf(table, id string) string {
	return labelCol(fmt.Sprintf("COALESCE((SELECT GROUP_CONCAT(DISTINCT NULLIF(s.comments, '') SEPARATOR '; ') FROM %s s WHERE s.id = %s), '')", table, id))
}

// spawnScriptsSQL is one query for the scripts of a creature (kind "creature") or game object spawn:
// rows of kind, id, name, commands, comment.
func spawnScriptsSQL(kind string, entry, guid int) string {
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
		s := SpawnScript{Kind: f[0], ID: f.num(1), Name: f[2], Commands: f.num(3), Comment: f[4]}
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

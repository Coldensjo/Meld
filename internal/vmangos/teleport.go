package vmangos

import (
	"fmt"
	"strings"
)

// Teleport to destination (#306, #308): where a creature or game object spawn can send a player, or
// move itself. The world database holds three kinds of teleport:
//   - a spell with a spell_target_position row and a teleport effect (SPELL_EFFECT_TELEPORT_UNITS,
//     5), cast by a spellcaster object (data0, "Portal to Stormwind"), a goober (data10, the
//     Naxxramas portals) or a creature from its spell list (creature_spells);
//   - a script command SCRIPT_COMMAND_TELEPORT_TO (6): datalong the map, x/y/z/o the spot. A player
//     goes to that map; a creature moves within its own (Map::ScriptCommand_TeleportTo), and such
//     scripts often leave datalong 0;
//   - a script command SCRIPT_COMMAND_CAST_SPELL (15) casting a teleport spell (datalong the spell).
//
// The scripts are reached from the spawn the way VMaNGOS runs them: gossip options (the template's
// gossip menu and the menus its options open, action_script_id into gossip_scripts), quests it starts
// or ends (StartScript, CompleteScript), a creature's AI events (creature_ai_scripts), its spell
// list's scripts and its waypoints (creature_movement_scripts), and an object's use
// (gameobject_scripts, keyed by the spawn's guid) and event (event_scripts). Teleports done in C++
// (a template's ScriptName) or by scripts started from other scripts are out of reach.

// Game object types whose data fields this reads (GameObjectDefines.h).
const (
	objectTypeQuestgiver  = 2
	objectTypeGoober      = 10
	objectTypeCamera      = 13
	objectTypeSpellcaster = 22
)

// Script commands (ScriptCommands.h) and the spell effect that teleports (SpellDefines.h).
const (
	scriptTeleportTo     = 6
	scriptCastSpell      = 15
	spellEffectTeleport  = 5
	creatureSpellListLen = 8
)

// SpawnTeleport is one place a spawn sends a player (or itself): what does it, and where to.
type SpawnTeleport struct {
	Label string          `json:"label"`
	Dest  TriggerTeleport `json:"dest"`
}

// teleportSource is a set of scripts a spawn runs: a SELECT giving (label, script_id) rows, the
// script table they are in, and whether a creature runs them on itself (a TELEPORT_TO with map 0
// then stays on the spawn's map).
type teleportSource struct {
	label string // the label column's SQL
	from  string // the rest of the SELECT: FROM ... giving script_id
	table string
	self  bool
}

// spellDestJoin joins a spell id (column expression spell) to its destination for the 1.12.1 build,
// keeping only spells with a teleport effect, as p (spell_target_position) and st (spell_template).
func spellDestJoin(spell string) string {
	return fmt.Sprintf(` JOIN spell_target_position p ON p.id = %[1]s AND p.build_min <= %[2]d AND p.build_max >= %[2]d`+
		` JOIN spell_template st ON st.entry = p.id AND st.build = (SELECT MAX(build) FROM spell_template WHERE entry = p.id AND build <= %[2]d)`+
		` AND %[3]d IN (st.effect1, st.effect2, st.effect3)`, spell, triggerBuild, spellEffectTeleport)
}

// spellDestCols are the destination columns spellDestJoin gives.
const spellDestCols = "p.target_map, p.target_position_x, p.target_position_y, p.target_position_z, p.target_orientation"

// scriptTeleportSQL gives the teleports in a source's scripts: its TELEPORT_TO commands and its casts
// of a teleport spell. selfMap is the spawn's map, for a creature's own TELEPORT_TO.
func scriptTeleportSQL(s teleportSource, selfMap string) string {
	src := fmt.Sprintf("(SELECT %s AS label, %s) src", s.label, s.from)
	mapCol := "s.datalong"
	if s.self {
		mapCol = fmt.Sprintf("IF(s.datalong = 0, COALESCE(%s, 0), s.datalong)", selfMap)
	}
	move := fmt.Sprintf("SELECT %s, %s, s.x, s.y, s.z, s.o FROM %s JOIN %s s ON s.id = src.script_id AND s.command = %d WHERE src.script_id > 0",
		labelCol("CONCAT(src.label, IF(s.comments <> '', CONCAT(': ', s.comments), ''))"), mapCol, src, s.table, scriptTeleportTo)
	cast := fmt.Sprintf("SELECT %s, %s FROM %s JOIN %s s ON s.id = src.script_id AND s.command = %d%s WHERE src.script_id > 0",
		labelCol("CONCAT(src.label, ': ', st.name)"), spellDestCols, src, s.table, scriptCastSpell, spellDestJoin("s.datalong"))
	return move + " UNION ALL " + cast
}

// labelCol gives every label one character set, since the tables a UNION reads them from differ
// in collation (MariaDB refuses the mix).
func labelCol(expr string) string {
	return "CONVERT(" + expr + " USING utf8mb4)"
}

// gossipLabel names a gossip option by its text.
var gossipLabel = labelCol("CONCAT('Gossip: ', COALESCE(o.option_text, ''))")

// latest picks a template column from its latest patch row.
func latest(table, col string, entry int) string {
	return fmt.Sprintf("(SELECT %s FROM %s WHERE entry = %d ORDER BY patch DESC LIMIT 1)", col, table, entry)
}

// questSources are the scripts of the quests a creature or object starts and ends.
func questSources(prefix string, entry int) []teleportSource {
	return []teleportSource{
		{"CONCAT('Quest start: ', COALESCE(q.Title, ''))", fmt.Sprintf("q.StartScript AS script_id FROM %s_questrelation r JOIN quest_template q ON q.entry = r.quest WHERE r.id = %d", prefix, entry), "quest_start_scripts", false},
		{"CONCAT('Quest end: ', COALESCE(q.Title, ''))", fmt.Sprintf("q.CompleteScript AS script_id FROM %s_involvedrelation r JOIN quest_template q ON q.entry = r.quest WHERE r.id = %d", prefix, entry), "quest_end_scripts", false},
	}
}

// spawnTeleportSQL is one query for every teleport of a creature (kind "creature") or game object
// spawn: rows of label, map, x, y, z, o, gossip first.
func spawnTeleportSQL(kind string, entry, guid int) string {
	var menu, spells string
	var sources []teleportSource
	var selfMap string
	if kind == "object" {
		menu = latest("gameobject_template", fmt.Sprintf("CASE type WHEN %d THEN data3 WHEN %d THEN data19 ELSE 0 END", objectTypeQuestgiver, objectTypeGoober), entry)
		spells = fmt.Sprintf("SELECT %s AS spell", latest("gameobject_template", fmt.Sprintf("CASE type WHEN %d THEN data0 WHEN %d THEN data10 ELSE 0 END", objectTypeSpellcaster, objectTypeGoober), entry))
		sources = append(sources,
			teleportSource{"'On use'", fmt.Sprintf("%d AS script_id", guid), "gameobject_scripts", false},
			teleportSource{"'Event'", fmt.Sprintf("%s AS script_id", latest("gameobject_template", fmt.Sprintf("CASE type WHEN %d THEN data2 WHEN %d THEN data6 WHEN %d THEN data2 ELSE 0 END", objectTypeGoober, objectTypeChest, objectTypeCamera), entry)), "event_scripts", false})
		sources = append(sources, questSources("gameobject", entry)...)
	} else {
		menu = latest("creature_template", "gossip_menu_id", entry)
		list := latest("creature_template", "spell_list_id", entry)
		selfMap = fmt.Sprintf("(SELECT map FROM creature WHERE guid = %d LIMIT 1)", guid)
		var cols, scripts []string
		for i := 1; i <= creatureSpellListLen; i++ {
			cols = append(cols, fmt.Sprintf("SELECT spellId_%d AS spell FROM creature_spells WHERE entry = %s", i, list))
			scripts = append(scripts, fmt.Sprintf("SELECT scriptId_%d AS script_id FROM creature_spells WHERE entry = %s", i, list))
		}
		spells = strings.Join(cols, " UNION ")
		var ai []string
		for i := 1; i <= 3; i++ {
			ai = append(ai, fmt.Sprintf("SELECT action%d_script AS script_id FROM creature_ai_events WHERE creature_id = %d", i, entry))
		}
		sources = append(sources,
			teleportSource{"'AI'", "script_id FROM (" + strings.Join(ai, " UNION ") + ") a", "creature_ai_scripts", true},
			teleportSource{"'Spell list'", "script_id FROM (" + strings.Join(scripts, " UNION ") + ") a", "creature_spells_scripts", true},
			teleportSource{"'Path'", fmt.Sprintf("script_id FROM (SELECT script_id FROM creature_movement_template WHERE entry = %d UNION SELECT script_id FROM creature_movement WHERE id = %d) a", entry, guid), "creature_movement_scripts", true})
		sources = append(sources, questSources("creature", entry)...)
	}
	parts := []string{
		// Gossip: the template's menu and every menu its options lead to (UNION stops at a loop).
		fmt.Sprintf("SELECT %s, s.datalong, s.x, s.y, s.z, s.o FROM menus m JOIN gossip_menu_option o ON o.menu_id = m.id JOIN gossip_scripts s ON s.id = o.action_script_id AND s.command = %d WHERE m.id > 0 AND o.action_script_id > 0",
			gossipLabel, scriptTeleportTo),
		fmt.Sprintf("SELECT %s, %s FROM menus m JOIN gossip_menu_option o ON o.menu_id = m.id JOIN gossip_scripts s ON s.id = o.action_script_id AND s.command = %d%s WHERE m.id > 0 AND o.action_script_id > 0",
			gossipLabel, spellDestCols, scriptCastSpell, spellDestJoin("s.datalong")),
		// The spells it casts itself.
		fmt.Sprintf("SELECT %s, %s FROM (%s) c%s WHERE c.spell > 0", labelCol("CONCAT('Casts ', st.name)"), spellDestCols, spells, spellDestJoin("c.spell")),
	}
	for _, s := range sources {
		parts = append(parts, scriptTeleportSQL(s, selfMap))
	}
	with := fmt.Sprintf("WITH RECURSIVE menus (id) AS (SELECT COALESCE(%s, 0) UNION SELECT o.action_menu_id FROM gossip_menu_option o JOIN menus m ON o.menu_id = m.id WHERE m.id > 0 AND o.action_menu_id > 0) ", menu)
	return with + strings.Join(parts, " UNION ALL ")
}

// parseSpawnTeleports reads spawnTeleportSQL's rows, keeping the first of any repeated label and spot.
func parseSpawnTeleports(raw []byte) []SpawnTeleport {
	out := []SpawnTeleport{}
	seen := map[SpawnTeleport]bool{}
	for _, f := range batchRows(raw, 6) {
		t := SpawnTeleport{Label: f[0], Dest: TriggerTeleport{Map: f.u32(1), X: f.f32(2), Y: f.f32(3), Z: f.f32(4), O: f.f32(5)}}
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

// SpawnTeleports lists where a creature (kind "creature") or game object (kind "object") spawn of
// template entry and spawn guid sends a player or moves itself: through its gossip, the spells it
// casts and the scripts it runs. Empty when it teleports no one.
func SpawnTeleports(serverRoot, kind string, entry, guid int) ([]SpawnTeleport, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, spawnTeleportSQL(kind, entry, guid))
	if err != nil {
		return nil, err
	}
	return parseSpawnTeleports(raw), nil
}

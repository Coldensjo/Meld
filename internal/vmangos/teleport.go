package vmangos

import "fmt"

// Teleporting game objects (#306): a spellcaster (type 22, "Portal to Stormwind") casts the spell in
// its data0, a goober (type 10, the Naxxramas portals) the one in its data10, and a teleport spell's
// destination is its spell_target_position row. Other teleports (gossip options, scripts) are out of
// reach of a lookup like this.

// Game object types that cast a spell on use.
const (
	objectTypeGoober      = 10
	objectTypeSpellcaster = 22
)

// teleportSpellSQL picks the spell a game object template casts: data0 for a spellcaster, data10
// for a goober, from the template's latest patch row.
func teleportSpellSQL(entry int) string {
	return fmt.Sprintf("SELECT CASE type WHEN %d THEN data0 WHEN %d THEN data10 ELSE 0 END FROM gameobject_template WHERE entry = %d ORDER BY patch DESC LIMIT 1",
		objectTypeSpellcaster, objectTypeGoober, entry)
}

// spellTargetSQL reads a spell's destination for the 1.12.1 build.
func spellTargetSQL(spell uint32) string {
	return fmt.Sprintf("SELECT target_map, target_position_x, target_position_y, target_position_z, target_orientation FROM spell_target_position WHERE id = %d AND build_min <= %d AND build_max >= %d ORDER BY target_map LIMIT 1",
		spell, triggerBuild, triggerBuild)
}

// parseSpellTarget reads spellTargetSQL's row, nil for none.
func parseSpellTarget(raw []byte) *TriggerTeleport {
	rows := tabRows(raw, 5)
	if len(rows) == 0 {
		return nil
	}
	f := rows[0]
	return &TriggerTeleport{Map: atou(f[0]), X: atof(f[1]), Y: atof(f[2]), Z: atof(f[3]), O: atof(f[4])}
}

// ObjectTeleport is where using game object template entry sends a player: the spell_target_position
// of the spell a spellcaster or goober casts, or nil when it casts none or the spell has no target.
func ObjectTeleport(serverRoot string, entry int) (*TriggerTeleport, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, teleportSpellSQL(entry))
	if err != nil {
		return nil, err
	}
	spell := atou(string(raw))
	if spell == 0 {
		return nil, nil
	}
	if raw, err = runSQL(db, spellTargetSQL(spell)); err != nil {
		return nil, err
	}
	return parseSpellTarget(raw), nil
}

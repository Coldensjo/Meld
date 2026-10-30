package vmangos

import (
	"fmt"
	"strings"
)

// The spawn SQL for a CMaNGOS classic world database (#894), which ExportSQLFor writes for
// CMaNGOSClassic. Its schema (cmangos/mangos-classic, sql/base/mangos.sql at z2836) differs from
// VMaNGOS's in these tables; the pool tables (pool_template, pool_creature, pool_gameobject, pool_pool)
// and gameobject's position and rotation columns are the same, so their SQL is shared.
//   - creature has spawndist and MovementType for wander_distance and movement_type, a spawnMask, and
//     no health, mana, flags, visibility or patch columns; gameobject has no animprogress, state,
//     flags, visibility or patch (gameobject_addon holds the first two; without a row the defaults apply).
//   - creature_addon has stand_state, sheath_state and emote (VMaNGOS's emote_state), and no display
//     or equipment: CMaNGOS sets those per spawn through creature_spawn_data's templates, which Meld
//     doesn't write, so a change of them is reported instead.
//   - creature_movement is Id, Point, PositionX to Orientation, WaitTime and ScriptId: one path a
//     creature, no wander distance at a point, and script ids that name dbscripts_on_creature_movement,
//     not VMaNGOS's creature_movement_scripts, so a path is written without its scripts.
//   - formations are spawn groups (spawn_group, spawn_group_spawn, spawn_group_formation), not
//     creature_groups, so a formation change is reported, not written.

// cmangosCreatureLinks and cmangosObjectLinks are the CMaNGOS tables that name a spawn by its guid,
// whose rows go with it.
var cmangosCreatureLinks = []string{"creature_addon", "creature_battleground", "creature_spawn_data", "creature_spawn_entry", "game_event_creature", "game_event_creature_data", "pool_creature"}
var cmangosObjectLinks = []string{"gameobject_addon", "gameobject_battleground", "gameobject_spawn_entry", "game_event_gameobject", "pool_gameobject"}

// Spawn group types (spawn_group.Type, CMaNGOS's SpawnGroupType).
const (
	cmangosGroupCreature   = 0
	cmangosGroupGameObject = 1
)

// cmangosDeleteSQL removes a spawn and the rows that name it.
func cmangosDeleteSQL(s Spawn) []string {
	table, links, group := "gameobject", cmangosObjectLinks, cmangosGroupGameObject
	if s.Kind == Creature {
		table, links, group = "creature", cmangosCreatureLinks, cmangosGroupCreature
	}
	out := []string{fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d;", table, s.GUID)}
	for _, link := range links {
		out = append(out, fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d;", link, s.GUID))
	}
	if s.Kind == Creature {
		out = append(out, fmt.Sprintf("DELETE FROM `creature_movement` WHERE `Id` = %d;", s.GUID))
		out = append(out, fmt.Sprintf("DELETE FROM `creature_linking` WHERE `guid` = %d OR `master_guid` = %d;", s.GUID, s.GUID))
	}
	// A spawn group lists creatures and game objects by guid alike, told apart by the group's type.
	out = append(out, fmt.Sprintf("DELETE `s` FROM `spawn_group_spawn` `s` JOIN `spawn_group` `g` ON `g`.`Id` = `s`.`Id` WHERE `s`.`Guid` = %d AND `g`.`Type` = %d;", s.GUID, group))
	return out
}

// cmangosInsertSQL adds a spawn, respawning between lo and hi seconds, with rotation q (game objects).
func cmangosInsertSQL(s Spawn, lo, hi int, q [4]float64) string {
	if s.Kind == Creature {
		return fmt.Sprintf("INSERT INTO `creature` (`guid`, `id`, `map`, `spawnMask`, `position_x`, `position_y`, `position_z`, `orientation`, "+
			"`spawntimesecsmin`, `spawntimesecsmax`, `spawndist`, `MovementType`) VALUES (%d, %d, %d, 1, %s, %s, %s, %s, %d, %d, %s, %d);",
			s.GUID, s.Entry, s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), lo, hi, num(s.WanderDistance), s.MovementType)
	}
	return fmt.Sprintf("INSERT INTO `gameobject` (`guid`, `id`, `map`, `spawnMask`, `position_x`, `position_y`, `position_z`, `orientation`, "+
		"`rotation0`, `rotation1`, `rotation2`, `rotation3`, `spawntimesecsmin`, `spawntimesecsmax`) VALUES (%d, %d, %d, 1, %s, %s, %s, %s, %s, %s, %s, %s, %d, %d);",
		s.GUID, s.Entry, s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), num(q[0]), num(q[1]), num(q[2]), num(q[3]), lo, hi)
}

// cmangosCreatureUpdateSQL moves a creature and sets its respawn and movement. A game object's UPDATE
// is VMaNGOS's, whose columns CMaNGOS has too.
func cmangosCreatureUpdateSQL(s Spawn, lo, hi int) string {
	return fmt.Sprintf("UPDATE `creature` SET `map` = %d, `position_x` = %s, `position_y` = %s, `position_z` = %s, "+
		"`orientation` = %s, `spawntimesecsmin` = %d, `spawntimesecsmax` = %d, `spawndist` = %s, `MovementType` = %d WHERE `guid` = %d;",
		s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), lo, hi, num(s.WanderDistance), s.MovementType, s.GUID)
}

// cmangosPathSQL replaces a creature's path (creature_movement) with its points, and says what of
// them CMaNGOS can't take: a wander distance at a point, and the points' scripts.
func cmangosPathSQL(s Spawn) ([]string, []string) {
	out := []string{fmt.Sprintf("DELETE FROM `creature_movement` WHERE `Id` = %d;", s.GUID)}
	if len(s.Path) == 0 {
		return out, nil
	}
	var skipped []string
	wander, scripts := false, false
	rows := make([]string, len(s.Path))
	for i, p := range s.Path {
		wander = wander || p.WanderDistance > 0
		scripts = scripts || p.ScriptID != 0
		rows[i] = fmt.Sprintf("(%d, %d, %s, %s, %s, %s, %d, 0)", s.GUID, i+1, num(p.X), num(p.Y), num(p.Z), num(p.O), max(p.WaitMs, 0))
	}
	out = append(out, "INSERT INTO `creature_movement` (`Id`, `Point`, `PositionX`, `PositionY`, `PositionZ`, `Orientation`, `WaitTime`, `ScriptId`) VALUES "+
		strings.Join(rows, ", ")+";")
	if wander {
		skipped = append(skipped, "its waypoints' wander distances; CMaNGOS's creature_movement has none")
	}
	if scripts {
		skipped = append(skipped, "its waypoints' scripts; their ids name VMaNGOS's scripts, not CMaNGOS's")
	}
	return out, skipped
}

// cmangosAddonSQL writes a creature's pose (creature_addon) when it changed, and says which of its
// changes CMaNGOS's creature_addon can't hold: its display and its equipment.
func cmangosAddonSQL(s Spawn, orig *Spawn) ([]string, []string) {
	base := Spawn{Equipment: -1, SheathState: 1}
	if orig != nil {
		base = *orig
	}
	var skipped []string
	if s.Display != base.Display {
		skipped = append(skipped, "its display; CMaNGOS sets a spawn's model through creature_spawn_data, which Meld doesn't write")
	}
	if s.Equipment != base.Equipment {
		skipped = append(skipped, "its equipment; CMaNGOS sets a spawn's equipment through creature_spawn_data, which Meld doesn't write")
	}
	if s.StandState == base.StandState && s.SheathState == base.SheathState && s.EmoteState == base.EmoteState {
		return nil, skipped
	}
	// The whole pose, as a new row gets the table's defaults for the columns not named.
	return []string{fmt.Sprintf("INSERT INTO `creature_addon` (`guid`, `stand_state`, `sheath_state`, `emote`) VALUES (%d, %d, %d, %d) "+
		"ON DUPLICATE KEY UPDATE `stand_state` = VALUES(`stand_state`), `sheath_state` = VALUES(`sheath_state`), `emote` = VALUES(`emote`);",
		s.GUID, max(s.StandState, 0), max(s.SheathState, 0), max(s.EmoteState, 0))}, skipped
}

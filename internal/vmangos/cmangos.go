package vmangos

import (
	"fmt"
	"math"
	"strconv"
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
//     or equipment: CMaNGOS sets those per spawn through a creature_spawn_data row naming a
//     creature_spawn_data_template, whose ModelId 0 and EquipmentId -1 keep the creature template's
//     (#906). A spawn's own template is cmangosOwnID(guid), copied from the template the spawn had,
//     so its other overrides (faction, flags, relay script) stay. Its EquipmentId is the
//     creature_equip_template row (entry, equipentry1 to equipentry3) with the items of the spawn's
//     VMaNGOS equipment (Spawn.EquipItems), found or made by the SQL (#1042).
//   - creature_movement is Id, Point, PositionX to Orientation, WaitTime and ScriptId: one path a
//     creature, no wander distance at a point, and script ids that name dbscripts_on_creature_movement,
//     not VMaNGOS's creature_movement_scripts, so a path is written without its scripts.
//   - formations are spawn groups (#906): spawn_group (Type 0), spawn_group_spawn (SlotId 0 the leader,
//     the members 1 up with no gap) and spawn_group_formation, a shape and one spread instead of a
//     distance and angle a member. A leader's group is cmangosOwnID(leader guid), and a moving group's
//     leader walks waypoint_path's path of the same ID, not its creature_movement, so that is copied
//     there. A spawn in a pool or game event can't be in a spawn group (the server skips it).
//
// CMaNGOS's own source (ObjectMgr::LoadSpawnGroups, LoadCreatureSpawnDataTemplates, FormationData) is
// GPL: its behaviour is described here, none of its code is copied.

// cmangosCreatureLinks and cmangosObjectLinks are the CMaNGOS tables that name a spawn by its guid,
// whose rows go with it.
var cmangosCreatureLinks = []string{"creature_addon", "creature_battleground", "creature_spawn_data", "creature_spawn_entry", "game_event_creature", "game_event_creature_data", "pool_creature"}
var cmangosObjectLinks = []string{"gameobject_addon", "gameobject_battleground", "gameobject_spawn_entry", "game_event_gameobject", "pool_gameobject"}

// Spawn group types (spawn_group.Type, CMaNGOS's SpawnGroupType).
const (
	cmangosGroupCreature   = 0
	cmangosGroupGameObject = 1
)

// cmangosOwnBase numbers the rows Meld makes for one spawn in a CMaNGOS database it can't read (#906):
// a spawn's creature_spawn_data_template entry, and a formation leader's spawn group and its leader's
// waypoint_path, are cmangosOwnBase plus the guid, far above the IDs CMaNGOS's own data uses, so a
// second export finds and replaces them. spawn_group.Id is a signed int, hence cmangosMaxOwnGUID.
const (
	cmangosOwnBase    = 1000000000
	cmangosMaxOwnGUID = math.MaxInt32 - cmangosOwnBase
)

func cmangosOwnID(guid int) int { return cmangosOwnBase + guid }

// The formation shape Meld gives a group (spawn_group_formation.FormationType, CMaNGOS's
// SPAWN_GROUP_FORMATION_TYPE_FANNED_OUT_BEHIND: the members spread over the half circle behind the
// leader, the spread away), and the spread a group made from its leader's edit starts with. CMaNGOS
// refuses a spread past 15 yards.
const (
	cmangosFormationShape = 4
	cmangosDefaultSpread  = 3
	cmangosMaxSpread      = 15
)

// cmangosGroupFlags turns a formation's VMaNGOS flags (creature_groups.flags) into a CMaNGOS spawn
// group's (spawn_group.Flags, CreatureGroupFlags): aggro, respawn and evade together. Moving together
// is the spawn_group_formation row instead; VMaNGOS's other options have no CMaNGOS flag.
func cmangosGroupFlags(vm int) int {
	out := 0
	if vm&FormationAggro != 0 {
		out |= 0x01
	}
	if vm&0x008 != 0 { // OPTION_RESPAWN_TOGETHER
		out |= 0x02
	}
	if vm&0x004 != 0 { // OPTION_EVADE_TOGETHER
		out |= 0x04
	}
	return out
}

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
	out = append(out, cmangosLeaveGroupsSQL(s.GUID, group, 0))
	if s.Kind == Creature && s.GUID <= cmangosMaxOwnGUID {
		// Its own spawn data template, and the formation it led: a deleted leader takes it with it.
		out = append(out, fmt.Sprintf("DELETE FROM `creature_spawn_data_template` WHERE `Entry` = %d;", cmangosOwnID(s.GUID)))
		out = append(out, cmangosDropGroupSQL(s.GUID)...)
		if s.Leader != 0 && s.Leader != s.GUID && s.Leader <= cmangosMaxOwnGUID {
			out = append(out, cmangosCompactSQL(cmangosOwnID(s.Leader)))
		}
	}
	return out
}

// cmangosLeaveGroupsSQL takes a spawn out of every spawn group of type group but keep (0 for none).
func cmangosLeaveGroupsSQL(guid, group, keep int) string {
	but := ""
	if keep != 0 {
		but = fmt.Sprintf(" AND `s`.`Id` <> %d", keep)
	}
	return fmt.Sprintf("DELETE `s` FROM `spawn_group_spawn` `s` JOIN `spawn_group` `g` ON `g`.`Id` = `s`.`Id` WHERE `s`.`Guid` = %d AND `g`.`Type` = %d%s;", guid, group, but)
}

// cmangosDropGroupSQL removes the formation leader led: its spawn group, formation and path.
func cmangosDropGroupSQL(leader int) []string {
	g := cmangosOwnID(leader)
	return []string{
		fmt.Sprintf("DELETE FROM `spawn_group_spawn` WHERE `Id` = %d;", g),
		fmt.Sprintf("DELETE FROM `spawn_group_formation` WHERE `Id` = %d;", g),
		fmt.Sprintf("DELETE FROM `spawn_group` WHERE `Id` = %d;", g),
		fmt.Sprintf("DELETE FROM `waypoint_path` WHERE `PathId` = %d;", g),
	}
}

// cmangosCompactSQL numbers group g's members 1 up again after one left, as CMaNGOS wants its slots
// without a gap (it renumbers them itself, with an error in its log). The derived table is grouped, so
// it is read in full before the UPDATE writes the table it reads.
func cmangosCompactSQL(g int) string {
	return fmt.Sprintf("UPDATE `spawn_group_spawn` `s` JOIN (SELECT `a`.`Guid`, COUNT(*) AS n FROM `spawn_group_spawn` `a` "+
		"JOIN `spawn_group_spawn` `b` ON `b`.`Id` = `a`.`Id` AND `b`.`SlotId` > 0 AND `b`.`SlotId` <= `a`.`SlotId` "+
		"WHERE `a`.`Id` = %d AND `a`.`SlotId` > 0 GROUP BY `a`.`Guid`) r ON r.`Guid` = `s`.`Guid` SET `s`.`SlotId` = r.n WHERE `s`.`Id` = %d;", g, g)
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

// cmangosAddonSQL writes a creature's pose (creature_addon) and its look (its own spawn data
// template: display and equipment) where they changed.
func cmangosAddonSQL(s Spawn, orig *Spawn) ([]string, []string) {
	base := Spawn{Equipment: -1, SheathState: 1}
	if orig != nil {
		base = *orig
	}
	var out, skipped []string
	if s.StandState != base.StandState || s.SheathState != base.SheathState || s.EmoteState != base.EmoteState {
		// The whole pose, as a new row gets the table's defaults for the columns not named.
		out = append(out, fmt.Sprintf("INSERT INTO `creature_addon` (`guid`, `stand_state`, `sheath_state`, `emote`) VALUES (%d, %d, %d, %d) "+
			"ON DUPLICATE KEY UPDATE `stand_state` = VALUES(`stand_state`), `sheath_state` = VALUES(`sheath_state`), `emote` = VALUES(`emote`);",
			s.GUID, max(s.StandState, 0), max(s.SheathState, 0), max(s.EmoteState, 0)))
	}
	if s.Display != base.Display || s.Equipment != base.Equipment {
		if s.GUID > cmangosMaxOwnGUID {
			return out, append(skipped, "its display and equipment; its guid is past the spawn data templates Meld numbers from it")
		}
		// The equipment as the editor shows it, by its items: the spawn's equipment id is the VMaNGOS
		// database's row, which CMaNGOS's lacks or holds other gear under (#1042).
		equip := strconv.Itoa(max(s.Equipment, -1))
		if s.Equipment > 0 {
			switch {
			case s.EquipItems == nil && s.Equipment == base.Equipment:
				// Not an edit: the creature keeps the equipment CMaNGOS gives it.
				equip = "-1"
			case s.EquipItems == nil:
				skipped = append(skipped, fmt.Sprintf("its equipment; the items of equipment %d couldn't be read from the VMaNGOS world database", s.Equipment))
				if s.Display == base.Display {
					return out, skipped
				}
				equip = "-1"
			case *s.EquipItems == [3]int{}:
				equip = "0"
			default:
				for _, item := range *s.EquipItems {
					if item > vmangosStockItemMax {
						skipped = append(skipped, fmt.Sprintf("its equipment's item %d; it was made in the VMaNGOS world database, so CMaNGOS's item_template lacks it and the server empties that slot", item))
					}
				}
				out = append(out, cmangosEquipSQL(*s.EquipItems)...)
				equip = "@meld_equip"
			}
		}
		out = append(out, cmangosSpawnDataSQL(s, equip)...)
	}
	return out, skipped
}

// vmangosStockItemMax is the highest item_template entry of VMaNGOS's own world database (its
// db-dump's "Monster - Shield, Legion"). Meld makes its items after the table's highest entry
// (planCreate), so an item past it is one made in the user's database, which CMaNGOS's lacks (#1058).
const vmangosStockItemMax = 25818

// cmangosEquipSQL finds the creature_equip_template row holding exactly these items (main hand, off
// hand, ranged) into @meld_equip, made after the highest entry when none does (#1042), as
// EquipmentFor does in VMaNGOS. Not in a range of Meld's own: CMaNGOS keeps the table in an array
// as long as its highest entry, and a spawn data template's EquipmentId is a signed MEDIUMINT.
func cmangosEquipSQL(items [3]int) []string {
	match := fmt.Sprintf("`equipentry1` = %d AND `equipentry2` = %d AND `equipentry3` = %d", items[0], items[1], items[2])
	return []string{
		// The next entry is read in a derived table, so the INSERT's WHERE can leave out its one row.
		fmt.Sprintf("INSERT INTO `creature_equip_template` (`entry`, `equipentry1`, `equipentry2`, `equipentry3`) SELECT n.e, %d, %d, %d "+
			"FROM (SELECT COALESCE(MAX(`entry`), 0) + 1 AS e FROM `creature_equip_template`) n "+
			"WHERE NOT EXISTS (SELECT 1 FROM `creature_equip_template` WHERE %s);", items[0], items[1], items[2], match),
		fmt.Sprintf("SET @meld_equip = (SELECT `entry` FROM `creature_equip_template` WHERE %s ORDER BY `entry` LIMIT 1);", match),
	}
}

// cmangosSpawnDataSQL gives a creature its own spawn data template with its display and equipment:
// a copy of the template it has (CMaNGOS's data gives some spawns one, for a faction or flags), or of
// the default (template 0: nothing overridden) when it has none, then the link to it. The table's key
// spans the model and equipment, but the server keeps one template an Entry, so the old row of the
// spawn's own entry goes once the new one is in. equip is the EquipmentId as SQL: a number, or the
// variable cmangosEquipSQL sets.
func cmangosSpawnDataSQL(s Spawn, equip string) []string {
	t := cmangosOwnID(s.GUID)
	model := max(s.Display, 0)
	name := sqlQuote(fmt.Sprintf("Meld: %s", label(s)))
	cols := "`Entry`, `NpcFlags`, `UnitFlags`, `Faction`, `ModelId`, `EquipmentId`, `CurHealth`, `CurMana`, `SpawnFlags`, `RelayId`, `StringId`, `Name`"
	return []string{
		fmt.Sprintf("INSERT IGNORE INTO `creature_spawn_data_template` (%s) SELECT %d, `t`.`NpcFlags`, `t`.`UnitFlags`, `t`.`Faction`, %d, %s, "+
			"`t`.`CurHealth`, `t`.`CurMana`, `t`.`SpawnFlags`, `t`.`RelayId`, `t`.`StringId`, %s FROM `creature_spawn_data` `d` "+
			"JOIN `creature_spawn_data_template` `t` ON `t`.`Entry` = `d`.`Id` WHERE `d`.`Guid` = %d LIMIT 1;", cols, t, model, equip, name, s.GUID),
		fmt.Sprintf("INSERT INTO `creature_spawn_data_template` (%s) SELECT %d, -1, -1, 0, %d, %s, 0, 0, 0, 0, 0, %s FROM DUAL "+
			"WHERE NOT EXISTS (SELECT 1 FROM `creature_spawn_data_template` WHERE `Entry` = %d AND `ModelId` = %d AND `EquipmentId` = %s);",
			cols, t, model, equip, name, t, model, equip),
		fmt.Sprintf("DELETE FROM `creature_spawn_data_template` WHERE `Entry` = %d AND (`ModelId` <> %d OR `EquipmentId` <> %s);", t, model, equip),
		fmt.Sprintf("INSERT INTO `creature_spawn_data` (`Guid`, `Id`) VALUES (%d, %d) ON DUPLICATE KEY UPDATE `Id` = VALUES(`Id`);", s.GUID, t),
	}
}

// cmangosFormationSQL writes a creature's formation as a spawn group when it changed, or, for a
// leader, when its movement did (moved), which its group's formation row and path carry.
func cmangosFormationSQL(s Spawn, orig *Spawn, moved bool) ([]string, []string) {
	var was Spawn
	if orig != nil {
		was = *orig
	}
	changed := formationChanged(s, orig)
	leads := s.Leader == s.GUID
	if !changed && !(leads && moved) {
		return nil, nil
	}
	if s.GUID > cmangosMaxOwnGUID || s.Leader > cmangosMaxOwnGUID || was.Leader > cmangosMaxOwnGUID {
		return nil, []string{"its formation; a guid is past the spawn group IDs Meld numbers from it"}
	}
	var out []string
	if changed {
		// A creature is in one spawn group at most: the server skips it in a second.
		out = append(out, cmangosLeaveGroupsSQL(s.GUID, cmangosGroupCreature, 0))
		if was.Leader == s.GUID && !leads {
			out = append(out, cmangosDropGroupSQL(s.GUID)...)
		} else if was.Leader != 0 && was.Leader != s.GUID && was.Leader != s.Leader {
			out = append(out, cmangosCompactSQL(cmangosOwnID(was.Leader)))
		}
	}
	if s.Leader == 0 {
		return out, nil
	}
	if s.Pool != 0 {
		return out, []string{"its formation; CMaNGOS keeps a spawn of a pool out of spawn groups"}
	}
	out = append(out, cmangosGroupSQL(s)...)
	if leads {
		return out, nil
	}
	g := cmangosOwnID(s.Leader)
	// The next slot after the group's last; the leader's row, just written, is slot 0.
	out = append(out, fmt.Sprintf("INSERT INTO `spawn_group_spawn` (`Id`, `Guid`, `SlotId`, `Chance`) SELECT %d, %d, COALESCE(MAX(`SlotId`), 0) + 1, 0 "+
		"FROM `spawn_group_spawn` WHERE `Id` = %d;", g, s.GUID, g))
	// A member that moved within the group left a gap behind.
	out = append(out, cmangosCompactSQL(g))
	if s.GroupFlags&FormationMove == 0 {
		return out, nil
	}
	return out, []string{fmt.Sprintf("its place in the formation; CMaNGOS lines the members up by the group's shape, fanned out behind the leader %s yards away",
		num(math.Round(cmangosSpread(s.FollowDist))))}
}

// cmangosSpread is a member's distance as a formation's spread, which CMaNGOS keeps within 15 yards.
func cmangosSpread(dist float64) float64 {
	if math.IsNaN(dist) || dist <= 0 {
		return cmangosDefaultSpread
	}
	return min(dist, cmangosMaxSpread)
}

// cmangosGroupSQL makes or updates the spawn group of s's leader: the group with its flags (a leader's
// own set them, a member's add to them), the leader in slot 0 and in no other group, and for a group
// that moves together its formation row, with the leader's movement read from its creature row, and
// the leader's path copied to waypoint_path.
func cmangosGroupSQL(s Spawn) []string {
	leader, leads := s.Leader, s.Leader == s.GUID
	g := cmangosOwnID(leader)
	flags := "`Flags` = `Flags` | VALUES(`Flags`)"
	if leads {
		flags = "`Flags` = VALUES(`Flags`)"
	}
	out := []string{
		fmt.Sprintf("INSERT INTO `spawn_group` (`Id`, `Name`, `Type`, `MaxCount`, `Flags`) VALUES (%d, %s, %d, 0, %d) ON DUPLICATE KEY UPDATE %s;",
			g, sqlQuote(fmt.Sprintf("Meld: formation led by guid %d", leader)), cmangosGroupCreature, cmangosGroupFlags(s.GroupFlags), flags),
		cmangosLeaveGroupsSQL(leader, cmangosGroupCreature, g),
		fmt.Sprintf("INSERT INTO `spawn_group_spawn` (`Id`, `Guid`, `SlotId`, `Chance`) VALUES (%d, %d, 0, 0) ON DUPLICATE KEY UPDATE `SlotId` = 0;", g, leader),
	}
	if s.GroupFlags&FormationMove == 0 {
		if leads {
			out = append(out, fmt.Sprintf("DELETE FROM `spawn_group_formation` WHERE `Id` = %d;", g), fmt.Sprintf("DELETE FROM `waypoint_path` WHERE `PathId` = %d;", g))
		}
		return out
	}
	spread, update := float64(cmangosDefaultSpread), ""
	if !leads {
		spread, update = math.Round(cmangosSpread(s.FollowDist)), ", `FormationSpread` = VALUES(`FormationSpread`)"
	}
	return append(out,
		fmt.Sprintf("INSERT INTO `spawn_group_formation` (`Id`, `FormationType`, `FormationSpread`, `FormationOptions`, `PathId`, `MovementType`, `Comment`) "+
			"SELECT %d, %d, %s, 0, %d, `c`.`MovementType`, 'Meld' FROM `creature` `c` WHERE `c`.`guid` = %d "+
			"ON DUPLICATE KEY UPDATE `PathId` = VALUES(`PathId`), `MovementType` = VALUES(`MovementType`)%s;", g, cmangosFormationShape, num(spread), g, leader, update),
		fmt.Sprintf("DELETE FROM `waypoint_path` WHERE `PathId` = %d;", g),
		fmt.Sprintf("INSERT INTO `waypoint_path` (`PathId`, `Point`, `PositionX`, `PositionY`, `PositionZ`, `Orientation`, `WaitTime`, `ScriptId`) "+
			"SELECT %d, `Point`, `PositionX`, `PositionY`, `PositionZ`, `Orientation`, `WaitTime`, `ScriptId` FROM `creature_movement` WHERE `Id` = %d;", g, leader),
	)
}

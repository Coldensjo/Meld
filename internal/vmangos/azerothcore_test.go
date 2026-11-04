package vmangos

import (
	"strings"
	"testing"
)

// Every table and column the AzerothCore spawn SQL names is one AzerothCore's world database has
// (#1073): a VMaNGOS column (creature.id, spawntimesecsmin, creature_movement) would fail the import.
func TestAzerothCoreSpawnSQLMatchesTheSchema(t *testing.T) {
	checkSchema(t, schemaFixture(t, "testdata/azerothcore-spawns.sql"), "AzerothCore", ExportSQLFor(AzerothCore, cmangosEdits(), fixedTime).SQL, 40)
}

// The AzerothCore export writes AzerothCore's columns under Meld's own guids and pools, and reports
// what its tables can't hold.
func TestAzerothCoreSpawnSQL(t *testing.T) {
	res := ExportSQLFor(AzerothCore, cmangosEdits(), fixedTime)
	if res.Added != 4 || res.Changed != 2 || res.Deleted != 2 {
		t.Fatalf("counts = %d/%d/%d", res.Added, res.Changed, res.Deleted)
	}
	for _, want := range []string{
		"-- Meld spawn edits for an AzerothCore world database (`acore_world`).",
		"DELETE FROM `creature` WHERE `guid` = 100000500 AND `id1` IN (3);",
		// The guard's equipment by its items, a row of its entry after the highest (2 at least).
		"INSERT INTO `creature_equip_template` (`CreatureID`, `ID`, `ItemID1`, `ItemID2`, `ItemID3`) SELECT 3, n.i, 1899, 0, 2550 " +
			"FROM (SELECT GREATEST(COALESCE(MAX(`ID`), 0), 1) + 1 AS i FROM `creature_equip_template` WHERE `CreatureID` = 3) n " +
			"WHERE n.i <= 127 AND NOT EXISTS (SELECT 1 FROM `creature_equip_template` WHERE `CreatureID` = 3 AND `ItemID1` = 1899 AND `ItemID2` = 0 AND `ItemID3` = 2550);",
		"SET @meld_equip = COALESCE((SELECT `ID` FROM `creature_equip_template` WHERE `CreatureID` = 3 AND `ItemID1` = 1899 AND `ItemID2` = 0 AND `ItemID3` = 2550 ORDER BY `ID` LIMIT 1), 1);",
		"`spawntimesecs`, `wander_distance`, `MovementType`, `Comment`) VALUES (100000500, 3, 0, 1, 1, @meld_equip, 1, 2, 3, 1, 300, 0, 2, 'Meld: Guard (guid 500, entry 3)');",
		// Its path, under ten times its guid, named by its addon, copied from the template's.
		"DELETE FROM `waypoint_data` WHERE `id` = 1000005000;",
		"VALUES (1000005000, 1, 1, 2, 3, NULL, 1000, 0), (1000005000, 2, 4, 5, 6, 2, 0, 0);",
		"INSERT IGNORE INTO `creature_addon` (`guid`, `path_id`, `mount`, `bytes1`, `bytes2`, `emote`, `visibilityDistanceType`, `auras`) SELECT 100000500, `path_id`,",
		"FROM `creature_template_addon` WHERE `entry` = 3;",
		"INSERT IGNORE INTO `creature_addon` (`guid`) VALUES (100000500);",
		"UPDATE `creature_addon` SET `path_id` = 1000005000, `bytes1` = (`bytes1` & 4294967040) | 1, `bytes2` = (`bytes2` & 4294967040) | 1, `emote` = 10 WHERE `guid` = 100000500;",
		// Its formation: its slot, and the leader's own row; the grunt's angle in degrees.
		"VALUES (100000501, 100000500, 3, 0, 515, 0, 0);",
		"INSERT IGNORE INTO `creature_formations` (`leaderGUID`, `memberGUID`, `dist`, `angle`, `groupAI`, `point_1`, `point_2`) VALUES (100000501, 100000501, 0, 0, 515, 0, 0);",
		"REPLACE INTO `creature_formations` (`leaderGUID`, `memberGUID`, `dist`, `angle`, `groupAI`, `point_1`, `point_2`) VALUES (100000501, 100000501, 0, 0, 515, 0, 0);",
		"VALUES (100000501, 100000502, 4, 171.887339, 515, 0, 0);",
		// Its pool, under Meld's pool entries.
		"INSERT INTO `pool_creature` (`guid`, `pool_entry`, `chance`, `description`) VALUES (100000500, 100000077, 50, 'Guards')",
		"SELECT 100000077, 1, 'Guards' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `pool_template` WHERE `entry` = 100000077);",
		"VALUES (100000077, 100000078, 0, 'Guards')",
		"SELECT 100000078, 2, 'Meld pool 78' FROM DUAL",
		"UPDATE `pool_template` SET `max_limit` = 2 WHERE `entry` = 100000078;",
		"`state`, `Comment`) VALUES (100000600, 7, 1, 1, 1, 4, 5, 6, 1.5, 0, 0, 0.681639, 0.731689, 300, 100, 1, 'Meld: Chest (guid 600, entry 7)');",
		"`spawntimesecs` = 300, `wander_distance` = 8, `MovementType` = 1 WHERE `guid` = 100000042;",
		"UPDATE `gameobject` SET `id` = 9,",
		"DELETE FROM `creature_sparring` WHERE `GUID` = 100000044;",
		"DELETE FROM `creature_formations` WHERE `leaderGUID` = 100000044 OR `memberGUID` = 100000044;",
		"DELETE FROM `smart_scripts` WHERE `entryorguid` = -100000044 AND `source_type` = 0;",
		"DELETE FROM `smart_scripts` WHERE `entryorguid` = -100000045 AND `source_type` = 1;",
		"DELETE FROM `gameobject_addon` WHERE `guid` = 100000045;",
	} {
		if !strings.Contains(res.SQL, want) {
			t.Errorf("SQL lacks %q\n%s", want, res.SQL)
		}
	}
	// creature_sparring's foreign key wants its rows gone before the creature.
	if a, b := strings.Index(res.SQL, "DELETE FROM `creature_sparring` WHERE `GUID` = 100000044;"), strings.Index(res.SQL, "DELETE FROM `creature` WHERE `guid` = 100000044;"); b < 0 || a > b {
		t.Errorf("the rat's creature row goes before its sparring row (%d, %d)", a, b)
	}
	for _, not := range []string{"`creature_movement`", "creature_groups", "spawntimesecsmin", "spawndist", "emote_state", "display_id", "`patch", "health_percent", "creature_spawn_data", "WHERE `guid` = 500"} {
		if strings.Contains(res.SQL, not) {
			t.Errorf("SQL has %s, which AzerothCore lacks or numbers otherwise\n%s", not, res.SQL)
		}
	}
	skipped := strings.Join(res.Skipped, "\n")
	for _, want := range []string{"Guard (guid 500, entry 3): its display (3167); AzerothCore's spawns take the template's model",
		"Guard (guid 500, entry 3): its waypoints' wander distances", "Guard (guid 500, entry 3): its waypoints' VMaNGOS scripts (9)",
		"Boar (guid 42, entry 4): its scale (2); AzerothCore takes scale"} {
		if !strings.Contains(skipped, want) {
			t.Errorf("Skipped lacks %q:\n%s", want, skipped)
		}
	}
	if len(res.Skipped) != 4 {
		t.Errorf("Skipped = %d lines, want 4:\n%s", len(res.Skipped), skipped)
	}
	if !strings.Contains(res.SQL, "-- Not exported:") {
		t.Error("the skipped changes are not listed in the file")
	}
	// The Changes window names the spawns by the editor's guids.
	if len(res.Spawns) != 8 || res.Spawns[0].GUID != 42 || !strings.Contains(res.Spawns[0].SQL, "100000042") {
		t.Errorf("Spawns = %+v", res.Spawns)
	}
	if ParseCore("azerothcore") != AzerothCore || AzerothCore.Title() != "AzerothCore" {
		t.Error("ParseCore or Title")
	}
}

// A creature's equipment goes to AzerothCore as an equipment_id of its entry: the template's (1), none
// (0), or its items' row; unknown items and an unchanged equipment leave it, and one respawn time is
// all AzerothCore keeps of a range.
func TestAzerothCoreEquipmentAndRespawn(t *testing.T) {
	export := func(e Edit) Result {
		res := ExportSQLFor(AzerothCore, []Edit{e}, fixedTime)
		res.SQL = res.SQL[strings.Index(res.SQL, "\n\n"):] // the statements: the header names the tables too
		return res
	}
	add := Spawn{Kind: Creature, GUID: 9, Entry: 1, Name: "Guard", Equipment: -1, SheathState: 1, Scale: 1}
	if res := export(Edit{Spawn: add, Created: true}); !strings.Contains(res.SQL, "VALUES (100000009, 1, 0, 1, 1, 1,") || len(res.Skipped) != 0 ||
		strings.Contains(res.SQL, "creature_addon") || strings.Contains(res.SQL, "creature_formations") {
		t.Errorf("a plain new creature: %v\n%s", res.Skipped, res.SQL)
	}
	bare := add
	bare.Equipment = 0
	if res := export(Edit{Spawn: bare, Created: true}); !strings.Contains(res.SQL, "VALUES (100000009, 1, 0, 1, 1, 0,") {
		t.Errorf("a new creature with no equipment:\n%s", res.SQL)
	}
	unknown := add
	unknown.Equipment = 5
	if res := export(Edit{Spawn: unknown, Created: true}); !strings.Contains(res.SQL, "VALUES (100000009, 1, 0, 1, 1, 1,") ||
		len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0], "the items of equipment 5 couldn't be read") {
		t.Errorf("a new creature of unknown equipment: %v\n%s", res.Skipped, res.SQL)
	}
	if res := export(Edit{Spawn: unknown, Original: &add}); strings.Contains(res.SQL, "equipment_id") || len(res.Skipped) != 1 {
		t.Errorf("a changed equipment of unknown items is written: %v\n%s", res.Skipped, res.SQL)
	}
	moved := unknown
	moved.X = 4
	if res := export(Edit{Spawn: moved, Original: &unknown}); strings.Contains(res.SQL, "equipment_id") || len(res.Skipped) != 0 {
		t.Errorf("an unchanged equipment is written: %v\n%s", res.Skipped, res.SQL)
	}
	made := add
	made.Equipment, made.EquipItems = 6, &[3]int{25819, 0, 0}
	if res := export(Edit{Spawn: made, Original: &add}); !strings.Contains(res.SQL, ", `equipment_id` = @meld_equip WHERE `guid` = 100000009;") ||
		len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0], "item 25819; it was made in the VMaNGOS world database") {
		t.Errorf("a changed equipment by its items: %v\n%s", res.Skipped, res.SQL)
	}

	ranged := add
	ranged.RespawnMin, ranged.RespawnMax = 300, 600
	if res := export(Edit{Spawn: ranged, Created: true}); !strings.Contains(res.SQL, "1, 1, 1, 0, 0, 0, 0, 300, 0, 0,") ||
		len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0], "its respawn range (300 to 600 seconds); AzerothCore has one respawn time, so 300") {
		t.Errorf("a respawn range: %v\n%s", res.Skipped, res.SQL)
	}
	again := ranged
	again.X = 3
	if res := export(Edit{Spawn: again, Original: &ranged}); len(res.Skipped) != 0 {
		t.Errorf("an unchanged respawn range is reported again: %v", res.Skipped)
	}

	if res := ExportSQLFor(AzerothCore, []Edit{{Spawn: Spawn{Kind: Creature, GUID: acMaxGUID + 1, Entry: 1}, Created: true}}, fixedTime); res.Added != 0 || len(res.Skipped) != 1 {
		t.Errorf("a guid past acMaxGUID is written: %v", res.Skipped)
	}
}

// A leader that stops leading takes its formation's rows with it, a member that leaves drops its own,
// a formation that doesn't move together keeps no slot, and a flag AzerothCore lacks is reported.
func TestAzerothCoreFormationChanges(t *testing.T) {
	sql := func(s, orig Spawn) Result {
		return ExportSQLFor(AzerothCore, []Edit{{Spawn: s, Original: &orig}}, fixedTime)
	}
	leader := Spawn{Kind: Creature, GUID: 7, Entry: 1, Equipment: -1, SheathState: 1, Leader: 7, GroupFlags: FormationDefault}
	alone := leader
	alone.Leader, alone.GroupFlags = 0, 0
	if got := sql(alone, leader).SQL; !strings.Contains(got, "DELETE FROM `creature_formations` WHERE `leaderGUID` = 100000007 OR `memberGUID` = 100000007;") ||
		strings.Contains(got, "INTO `creature_formations`") {
		t.Errorf("a leader that stopped leading:\n%s", got)
	}
	member := Spawn{Kind: Creature, GUID: 8, Entry: 1, Equipment: -1, SheathState: 1, Leader: 7, FollowDist: 3, FollowAngle: 1, GroupFlags: FormationDefault}
	left := member
	left.Leader, left.GroupFlags = 0, 0
	if got := sql(left, member).SQL; !strings.Contains(got, "DELETE FROM `creature_formations` WHERE `memberGUID` = 100000008;") || strings.Contains(got, "`leaderGUID` = 100000008") {
		t.Errorf("a member that left:\n%s", got)
	}
	still := member
	still.GroupFlags = FormationAggro | 0x008
	res := sql(still, member)
	if !strings.Contains(res.SQL, "VALUES (100000007, 100000008, 0, 0, 3, 0, 0);") || len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0], "respawning together") {
		t.Errorf("a formation that doesn't move together: %v\n%s", res.Skipped, res.SQL)
	}
}

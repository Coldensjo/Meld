package vmangos

import (
	"strings"
	"testing"
)

// Every table and column the CMaNGOS TBC spawn SQL names is one CMaNGOS TBC's world database has (#1076).
func TestCMaNGOSTBCSpawnSQLMatchesTheSchema(t *testing.T) {
	checkSchema(t, schemaFixture(t, "testdata/cmangos-tbc-spawns.sql"), "CMaNGOS TBC", ExportSQLFor(CMaNGOSTBC, cmangosEdits(), fixedTime).SQL, 30)
}

// The CMaNGOS TBC export is CMaNGOS classic's under Meld's own guids, and names Meld's pools by the
// pool_template rows it finds or makes for them.
func TestCMaNGOSTBCSpawnSQL(t *testing.T) {
	if ParseCore("cmangos-tbc") != CMaNGOSTBC || CMaNGOSTBC.Title() != "CMaNGOS TBC" || !CMaNGOSTBC.cmangos() || AzerothCore.cmangos() {
		t.Error("ParseCore, Title or cmangos")
	}
	res := ExportSQLFor(CMaNGOSTBC, cmangosEdits(), fixedTime)
	if res.Added != 4 || res.Changed != 2 || res.Deleted != 2 {
		t.Fatalf("counts = %d/%d/%d", res.Added, res.Changed, res.Deleted)
	}
	sql := res.SQL
	for _, want := range []string{
		"-- Meld spawn edits for a CMaNGOS TBC world database (`tbcmangos`).",
		"-- Meld's spawns are numbered 10000000 plus the editor's guid",
		"DELETE FROM `creature` WHERE `guid` = 10000500 AND `id` IN (3);",
		"`spawntimesecsmax`, `spawndist`, `MovementType`) VALUES (10000500, 3, 0, 1, 1, 2, 3, 1, 300, 300, 0, 2);",
		"VALUES (10000600, 7, 1, 1, 4, 5, 6, 1.5, 0, 0, 0.681639, 0.731689, 300, 300);",
		"`spawndist` = 8, `MovementType` = 1 WHERE `guid` = 10000042;",
		"VALUES (10000500, 1, 1, 2, 3, 0, 1000, 0), (10000500, 2, 4, 5, 6, 2, 0, @meld_script + 0);",
		"'Meld: guid 10000500, VMaNGOS waypoint script 9: Hello'",
		"INSERT INTO `creature_addon` (`guid`, `stand_state`, `sheath_state`, `emote`) VALUES (10000500, 1, 1, 10)",
		// Its own spawn data template and the formation's spawn group, numbered from Meld's guids.
		"SELECT 1010000500, -1, -1, 0, 3167, @meld_equip, 0, 0, 0, 0, 0, 'Meld: Guard (guid 10000500, entry 3)' FROM DUAL",
		"INSERT INTO `creature_spawn_data` (`Guid`, `Id`) VALUES (10000500, 1010000500)",
		"VALUES (1010000501, 'Meld: formation led by guid 10000501', 0, 0, 1)",
		"SELECT 1010000501, 10000502, COALESCE(MAX(`SlotId`), 0) + 1, 0 FROM `spawn_group_spawn` WHERE `Id` = 1010000501;",
		"FROM `creature_movement` WHERE `Id` = 10000501;",
		// Deleting a spawn of the VMaNGOS database deletes only Meld's copy.
		"DELETE FROM `creature` WHERE `guid` = 10000044;",
		"DELETE FROM `gameobject` WHERE `guid` = 10000045;",
		"DELETE FROM `creature_spawn_data_template` WHERE `Entry` = 1010000044;",
		// Meld's pools, found or made under 65536 before anything names them.
		"INSERT INTO `pool_template` (`entry`, `max_limit`, `description`) SELECT n.e, 0, 'Meld pool 77' FROM (SELECT COALESCE(MAX(`entry`), 0) + 1 AS e FROM `pool_template`) n " +
			"WHERE n.e <= 65535 AND NOT EXISTS (SELECT 1 FROM `pool_template` WHERE (`description` = 'Meld pool 77' OR `description` LIKE 'Meld pool 77:%'));",
		"SET @meld_pool_77 = (SELECT `entry` FROM `pool_template` WHERE (`description` = 'Meld pool 77' OR `description` LIKE 'Meld pool 77:%') ORDER BY `entry` LIMIT 1);",
		"SET @meld_pool_78 = (SELECT `entry` FROM `pool_template` WHERE",
		"INSERT INTO `pool_creature` (`guid`, `pool_entry`, `chance`, `description`) VALUES (10000500, @meld_pool_77, 50, 'Guards')",
		"INSERT INTO `pool_pool` (`pool_id`, `mother_pool`, `chance`, `description`) VALUES (@meld_pool_77, @meld_pool_78, 0,",
		"UPDATE `pool_template` SET `max_limit` = 1, `description` = 'Meld pool 77: Guards' WHERE `entry` = @meld_pool_77;",
		"UPDATE `pool_template` SET `max_limit` = 2 WHERE `entry` = @meld_pool_78;",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("SQL lacks %q\n%s", want, sql)
		}
	}
	// No statement names a spawn by the editor's guid or a pool by its entry.
	for _, not := range []string{"`guid` = 500 ", "`guid` = 44;", "(500, ", "`Id` = 501;", "VALUES (500,", "`pool_entry` = 77", "`entry` = 77", "VALUES (77,"} {
		if strings.Contains(sql, not) {
			t.Errorf("SQL has %q\n%s", not, sql)
		}
	}
	if def, use := strings.Index(sql, "SET @meld_pool_77"), strings.Index(sql, "@meld_pool_77, 50"); def < 0 || use < def {
		t.Errorf("pool 77's variable is set at %d, after its first use at %d", def, use)
	}
	// The spawns keep the editor's guids for the Changes window.
	for _, s := range res.Spawns {
		if s.GUID >= tbcGUIDBase {
			t.Errorf("spawn %d (%s) has the database's guid", s.GUID, s.Name)
		}
	}
	if !strings.Contains(strings.Join(res.Skipped, "\n"), "its scale (2); CMaNGOS TBC takes scale") {
		t.Errorf("Skipped: %v", res.Skipped)
	}
}

// A guid past what CMaNGOS TBC's 24-bit counter holds under Meld's base is skipped, and an item made in
// the VMaNGOS database is named as one TBC may hold another item under.
func TestCMaNGOSTBCLimits(t *testing.T) {
	far := Spawn{Kind: Creature, GUID: tbcMaxGUID + 1, Entry: 3, Name: "Far", Equipment: -1, SheathState: 1}
	near := Spawn{Kind: Creature, GUID: tbcMaxGUID, Entry: 3, Name: "Near", Equipment: -1, SheathState: 1}
	armed := Spawn{Kind: Creature, GUID: 7, Entry: 3, Name: "Armed", Equipment: 30000, EquipItems: &[3]int{30001, 0, 0}, SheathState: 1}
	res := ExportSQLFor(CMaNGOSTBC, []Edit{{Spawn: far, Created: true}, {Spawn: near, Created: true}, {Spawn: armed, Created: true}}, fixedTime)
	skipped := strings.Join(res.Skipped, "\n")
	if res.Added != 2 || !strings.Contains(skipped, "Far (guid 6777216, entry 3): its guid or its formation leader's is past 6777215") {
		t.Errorf("added %d, skipped:\n%s", res.Added, skipped)
	}
	if !strings.Contains(res.SQL, "VALUES (16777215, 3,") {
		t.Errorf("the last guid isn't 0xFFFFFF:\n%s", res.SQL)
	}
	if !strings.Contains(skipped, "its equipment's item 30001; it was made in the VMaNGOS world database, so CMaNGOS TBC's item_template lacks it or holds another item there") {
		t.Errorf("Skipped:\n%s", skipped)
	}
	// A pool with no name keeps the bare key as its description.
	if got := tbcPoolDescription(Spawn{Pool: 5}); got != "Meld pool 5" {
		t.Errorf("tbcPoolDescription = %q", got)
	}
	if got := tbcPoolDescription(Spawn{Pool: 5, PoolName: "Ore"}); got != "Meld pool 5: Ore" {
		t.Errorf("tbcPoolDescription = %q", got)
	}
}

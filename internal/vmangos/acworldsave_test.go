package vmangos

import (
	"strings"
	"testing"
)

// Edits of the AzerothCore database's own spawns are saved under its own guids and pools: a stock
// creature moved and given a path and a pool, a creature placed from a template (its template's
// equipment by number, as the Place tool gives it), a rabbit placed without equipment and a stock
// object deleted.
func TestACSpawnSQLDirect(t *testing.T) {
	sword := ACEquipmentFor([3]int{1899, 0, 0})
	stock := WorldSpawn{Kind: KindMonster, GUID: 120000, Entry: 26000, Name: "Wolf", X: 10, Z: 10, Y: 190, Scale: 1, RespawnSecs: 300, RespawnMaxSecs: 300, SheathState: 1}
	moved := stock
	moved.X, moved.MovementType = 20, 2
	moved.Waypoints = []Waypoint{{X: 20, Z: 10, Y: 190}, {X: 30, Z: 10, Y: 190, WaitMs: 1000}}
	moved.Pool, moved.PoolLimit, moved.PoolName = 100000003, 1, "Wolves"
	guard := WorldSpawn{Kind: KindMonster, GUID: 10000002, Entry: 100, Name: "Guard", Scale: 1, RespawnSecs: 300, RespawnMaxSecs: 300, Equipment: sword, SheathState: 1}
	rabbit := WorldSpawn{Kind: KindMonster, GUID: 10000003, Entry: 721, Name: "Rabbit", Scale: 1, RespawnSecs: 120, RespawnMaxSecs: 120, SheathState: 1}
	ore := WorldSpawn{Kind: KindObject, GUID: 20000, Entry: 181555, Name: "Saronite Deposit", Scale: 1}
	res := acSpawnSQL(571, 30, 21, []SpawnEdit{
		{Spawn: moved, Original: &stock},
		{Spawn: guard, Created: true},
		{Spawn: rabbit, Created: true},
		{Spawn: ore, Original: &ore, Deleted: true},
	}, fixedTime)
	if res.Added != 2 || res.Changed != 1 || res.Deleted != 1 {
		t.Fatalf("counts = %d/%d/%d\n%s", res.Added, res.Changed, res.Deleted, res.SQL)
	}
	for _, want := range []string{
		"-- Meld spawn edits of an AzerothCore world database (`acore_world`), made in the editor from its own spawns.",
		"WHERE `guid` = 120000;",
		"DELETE FROM `waypoint_data` WHERE `id` = 1200000;",
		"UPDATE `creature_addon` SET `path_id` = 1200000 WHERE `guid` = 120000;",
		"INSERT INTO `pool_creature` (`guid`, `pool_entry`, `chance`, `description`) VALUES (120000, 100000003, 0,",
		"SELECT 100000003, 1, 'Wolves' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `pool_template` WHERE `entry` = 100000003);",
		"DELETE FROM `creature` WHERE `guid` = 10000002 AND `id` IN (100);",
		"WHERE `CreatureID` = 100 AND `ItemID1` = 1899 AND `ItemID2` = 0 AND `ItemID3` = 0 ORDER BY `ID` LIMIT 1), 1);",
		"VALUES (10000002, 100, 571, 1, 1, @meld_equip,",
		"VALUES (10000003, 721, 571, 1, 1, 0,",
		"DELETE FROM `gameobject` WHERE `guid` = 20000;",
	} {
		if !strings.Contains(res.SQL, want) {
			t.Errorf("SQL lacks %q\n%s", want, res.SQL)
		}
	}
	for _, not := range []string{"10120000", "20000000", "200000003", "10010000002"} {
		if strings.Contains(res.SQL, not) {
			t.Errorf("SQL has %s: an editor number moved by the export's base\n%s", not, res.SQL)
		}
	}
	if len(res.Skipped) != 0 {
		t.Errorf("skipped: %v", res.Skipped)
	}
	checkSchema(t, schemaFixture(t, "testdata/azerothcore-spawns.sql"), "AzerothCore", res.SQL, 20)
}

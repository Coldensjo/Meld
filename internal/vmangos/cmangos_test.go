package vmangos

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// cmangosSchema reads the CMaNGOS classic fixture's tables and their columns, lower-cased.
func cmangosSchema(t *testing.T) map[string]map[string]bool {
	t.Helper()
	b, err := os.ReadFile("testdata/cmangos-classic-spawns.sql")
	if err != nil {
		t.Fatal(err)
	}
	tables := map[string]map[string]bool{}
	var cols map[string]bool
	column := regexp.MustCompile("^\\s+`(\\w+)` ")
	for _, line := range strings.Split(string(b), "\n") {
		if m := regexp.MustCompile("^CREATE TABLE `(\\w+)`").FindStringSubmatch(line); m != nil {
			cols = map[string]bool{}
			tables[strings.ToLower(m[1])] = cols
		} else if m := column.FindStringSubmatch(line); m != nil && cols != nil {
			cols[strings.ToLower(m[1])] = true
		}
	}
	return tables
}

// cmangosEdits is an export that reaches every statement the CMaNGOS writer has: a creature added with
// a path, a pose, a display, a formation and a pool; a game object added; a creature and a game object
// changed (the object turned into another); a creature and a game object deleted; a pool put into a
// mother pool.
func cmangosEdits() []Edit {
	walker := Spawn{Kind: Creature, GUID: 500, Entry: 3, Name: "Guard", Map: 0, X: 1, Y: 2, Z: 3, O: 1, Scale: 1, MovementType: 2,
		Display: 3167, Equipment: 7, StandState: 1, SheathState: 1, EmoteState: 10, Leader: 501, FollowDist: 3, GroupFlags: FormationDefault,
		Pool: 77, PoolLimit: 1, PoolName: "Guards", PoolChance: 50, MotherPool: 78, MotherLimit: 2,
		Path: []PathPoint{{X: 1, Y: 2, Z: 3, WaitMs: 1000}, {X: 4, Y: 5, Z: 6, O: 2, WanderDistance: 3, ScriptID: 9}}}
	chest := Spawn{Kind: GameObject, GUID: 600, Entry: 7, Name: "Chest", Map: 1, X: 4, Y: 5, Z: 6, O: 1.5, Scale: 1}
	boar := Spawn{Kind: Creature, GUID: 42, Entry: 4, Name: "Boar", Map: 0, Scale: 1, MovementType: 1, WanderDistance: 5, Equipment: -1, SheathState: 1}
	moved := boar
	moved.X, moved.WanderDistance, moved.Scale = 10, 8, 2
	door := Spawn{Kind: GameObject, GUID: 43, Entry: 8, Name: "Door", Map: 0, Scale: 1}
	turned := door
	turned.Entry = 9
	return []Edit{
		{Spawn: walker, Created: true},
		{Spawn: chest, Created: true},
		{Spawn: moved, Original: &boar},
		{Spawn: turned, Original: &door},
		{Spawn: Spawn{Kind: Creature, GUID: 44, Entry: 5, Name: "Rat"}, Original: &Spawn{Kind: Creature, GUID: 44, Entry: 5}, Deleted: true},
		{Spawn: Spawn{Kind: GameObject, GUID: 45, Entry: 6, Name: "Vein"}, Original: &Spawn{Kind: GameObject, GUID: 45, Entry: 6}, Deleted: true},
	}
}

// Every table and column the CMaNGOS spawn SQL names is one CMaNGOS classic's world database has
// (#894): a VMaNGOS column (wander_distance, emote_state, patch) would fail the import.
func TestCMaNGOSSpawnSQLMatchesTheSchema(t *testing.T) {
	schema := cmangosSchema(t)
	res := ExportSQLFor(CMaNGOSClassic, cmangosEdits(), fixedTime)
	ident := regexp.MustCompile("`(\\w+)`")
	tableRef := regexp.MustCompile("(?:FROM|INTO|UPDATE|JOIN) `(\\w+)`(?: `(\\w+)`)?")
	statements := 0
	for _, line := range strings.Split(res.SQL, "\n") {
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		statements++
		tables, aliases := map[string]bool{}, map[string]bool{}
		// ON DUPLICATE KEY UPDATE names columns, not a table.
		for _, m := range tableRef.FindAllStringSubmatch(strings.ReplaceAll(line, "KEY UPDATE", "KEY SET"), -1) {
			name := strings.ToLower(m[1])
			if schema[name] == nil {
				t.Errorf("CMaNGOS has no table %s: %s", m[1], line)
			}
			tables[name] = true
			if m[2] != "" {
				aliases[strings.ToLower(m[2])] = true
			}
		}
		if len(tables) == 0 {
			t.Errorf("a statement names no table: %s", line)
		}
		for _, m := range ident.FindAllStringSubmatch(line, -1) {
			id := strings.ToLower(m[1])
			if tables[id] || aliases[id] {
				continue
			}
			found := false
			for name := range tables {
				found = found || schema[name][id]
			}
			if !found {
				t.Errorf("no table of the statement has a column %s: %s", m[1], line)
			}
		}
	}
	if statements < 30 {
		t.Errorf("only %d statements; the export should reach every writer:\n%s", statements, res.SQL)
	}
}

// The CMaNGOS export writes its own columns and reports what its tables can't hold.
func TestCMaNGOSSpawnSQL(t *testing.T) {
	res := ExportSQLFor(CMaNGOSClassic, cmangosEdits(), fixedTime)
	if res.Added != 2 || res.Changed != 2 || res.Deleted != 2 {
		t.Fatalf("counts = %d/%d/%d", res.Added, res.Changed, res.Deleted)
	}
	for _, want := range []string{
		"-- Meld spawn edits for a CMaNGOS classic world database (`classicmangos`).",
		"DELETE FROM `creature` WHERE `guid` = 500 AND `id` IN (3);",
		"`spawntimesecsmax`, `spawndist`, `MovementType`) VALUES (500, 3, 0, 1, 1, 2, 3, 1, 300, 300, 0, 2);",
		"INSERT INTO `gameobject` (`guid`, `id`, `map`, `spawnMask`,",
		"VALUES (600, 7, 1, 1, 4, 5, 6, 1.5, 0, 0, 0.681639, 0.731689, 300, 300);",
		"UPDATE `creature` SET `map` = 0, `position_x` = 10,",
		"`spawndist` = 8, `MovementType` = 1 WHERE `guid` = 42;",
		"UPDATE `gameobject` SET `id` = 9,",
		"DELETE FROM `creature_movement` WHERE `Id` = 500;",
		"VALUES (500, 1, 1, 2, 3, 0, 1000, 0), (500, 2, 4, 5, 6, 2, 0, 0);",
		"INSERT INTO `creature_addon` (`guid`, `stand_state`, `sheath_state`, `emote`) VALUES (500, 1, 1, 10) ON DUPLICATE KEY UPDATE",
		"INSERT INTO `pool_creature` (`guid`, `pool_entry`, `chance`, `description`) VALUES (500, 77, 50,",
		"INSERT INTO `pool_pool` (`pool_id`, `mother_pool`, `chance`, `description`) VALUES (77, 78, 0,",
		"DELETE FROM `creature_spawn_data` WHERE `guid` = 44;",
		"DELETE FROM `creature_movement` WHERE `Id` = 44;",
		"WHERE `s`.`Guid` = 44 AND `g`.`Type` = 0;",
		"DELETE FROM `gameobject_addon` WHERE `guid` = 45;",
		"WHERE `s`.`Guid` = 45 AND `g`.`Type` = 1;",
	} {
		if !strings.Contains(res.SQL, want) {
			t.Errorf("SQL lacks %q\n%s", want, res.SQL)
		}
	}
	for _, not := range []string{"creature_groups", "wander_distance", "movement_type", "emote_state", "display_id", "`patch", "health_percent"} {
		if strings.Contains(res.SQL, not) {
			t.Errorf("SQL has VMaNGOS's %s\n%s", not, res.SQL)
		}
	}
	skipped := strings.Join(res.Skipped, "\n")
	for _, want := range []string{"Guard (guid 500, entry 3): its display", "Guard (guid 500, entry 3): its equipment", "Guard (guid 500, entry 3): its formation",
		"Guard (guid 500, entry 3): its waypoints' wander distances", "Guard (guid 500, entry 3): its waypoints' scripts", "Boar (guid 42, entry 4): its scale (2); CMaNGOS classic takes scale"} {
		if !strings.Contains(skipped, want) {
			t.Errorf("Skipped lacks %q:\n%s", want, skipped)
		}
	}
	if !strings.Contains(res.SQL, "-- Not exported:") {
		t.Error("the skipped changes are not listed in the file")
	}
}

// A creature whose pose and look are unchanged writes no creature_addon row, and the VMaNGOS export is
// unchanged by the core setting.
func TestCMaNGOSAddonOnlyWhenThePoseChanged(t *testing.T) {
	boar := Spawn{Kind: Creature, GUID: 42, Entry: 4, Name: "Boar", Equipment: -1, SheathState: 1}
	moved := boar
	moved.X = 3
	res := ExportSQLFor(CMaNGOSClassic, []Edit{{Spawn: moved, Original: &boar}, {Spawn: Spawn{Kind: Creature, GUID: 50, Entry: 4, Equipment: -1, SheathState: 1}, Created: true}}, fixedTime)
	if strings.Contains(res.SQL, "creature_addon") || len(res.Skipped) > 0 {
		t.Errorf("an unchanged pose is written or reported: %v\n%s", res.Skipped, res.SQL)
	}
	if ParseCore("") != VMaNGOS || ParseCore("nonsense") != VMaNGOS || ParseCore("cmangos-classic") != CMaNGOSClassic {
		t.Error("ParseCore")
	}
	if ExportSQL(cmangosEdits(), fixedTime).SQL != ExportSQLFor(VMaNGOS, cmangosEdits(), fixedTime).SQL {
		t.Error("ExportSQL is not the VMaNGOS export")
	}
}

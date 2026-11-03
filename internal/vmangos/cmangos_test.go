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
// a path, a pose, a display, a formation and a pool (which keeps it out of the spawn group); a walking
// formation's leader and a member added; a game object added; a creature and a game object changed
// (the object turned into another); a creature and a game object deleted; a pool put into a mother pool.
func cmangosEdits() []Edit {
	walker := Spawn{Kind: Creature, GUID: 500, Entry: 3, Name: "Guard", Map: 0, X: 1, Y: 2, Z: 3, O: 1, Scale: 1, MovementType: 2,
		Display: 3167, Equipment: 7, EquipItems: &[3]int{1899, 0, 2550}, StandState: 1, SheathState: 1, EmoteState: 10, Leader: 501, FollowDist: 3, GroupFlags: FormationDefault,
		Pool: 77, PoolLimit: 1, PoolName: "Guards", PoolChance: 50, MotherPool: 78, MotherLimit: 2,
		Path: []PathPoint{{X: 1, Y: 2, Z: 3, WaitMs: 1000}, {X: 4, Y: 5, Z: 6, O: 2, WanderDistance: 3, ScriptID: 9}}}
	captain := Spawn{Kind: Creature, GUID: 501, Entry: 3, Name: "Captain", Scale: 1, MovementType: 2, Equipment: -1, SheathState: 1,
		Leader: 501, GroupFlags: FormationDefault, Path: []PathPoint{{X: 1, Y: 2, Z: 3}, {X: 7, Y: 8, Z: 9}}}
	grunt := Spawn{Kind: Creature, GUID: 502, Entry: 3, Name: "Grunt", Scale: 1, Equipment: -1, SheathState: 1, Leader: 501, FollowDist: 4, FollowAngle: 3, GroupFlags: FormationDefault}
	chest := Spawn{Kind: GameObject, GUID: 600, Entry: 7, Name: "Chest", Map: 1, X: 4, Y: 5, Z: 6, O: 1.5, Scale: 1}
	boar := Spawn{Kind: Creature, GUID: 42, Entry: 4, Name: "Boar", Map: 0, Scale: 1, MovementType: 1, WanderDistance: 5, Equipment: -1, SheathState: 1}
	moved := boar
	moved.X, moved.WanderDistance, moved.Scale = 10, 8, 2
	door := Spawn{Kind: GameObject, GUID: 43, Entry: 8, Name: "Door", Map: 0, Scale: 1}
	turned := door
	turned.Entry = 9
	return []Edit{
		{Spawn: walker, Created: true},
		{Spawn: captain, Created: true},
		{Spawn: grunt, Created: true},
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
	if res.Added != 4 || res.Changed != 2 || res.Deleted != 2 {
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
		// The guard's equipment row by its items (#1042), found or made after the highest entry.
		"INSERT INTO `creature_equip_template` (`entry`, `equipentry1`, `equipentry2`, `equipentry3`) SELECT n.e, 1899, 0, 2550 " +
			"FROM (SELECT COALESCE(MAX(`entry`), 0) + 1 AS e FROM `creature_equip_template`) n " +
			"WHERE NOT EXISTS (SELECT 1 FROM `creature_equip_template` WHERE `equipentry1` = 1899 AND `equipentry2` = 0 AND `equipentry3` = 2550);",
		"SET @meld_equip = (SELECT `entry` FROM `creature_equip_template` WHERE `equipentry1` = 1899 AND `equipentry2` = 0 AND `equipentry3` = 2550 ORDER BY `entry` LIMIT 1);",
		// Its own spawn data template (#906): copied from the one it has, else made, then linked.
		"INSERT IGNORE INTO `creature_spawn_data_template` (`Entry`, `NpcFlags`,",
		"SELECT 1000000500, `t`.`NpcFlags`, `t`.`UnitFlags`, `t`.`Faction`, 3167, @meld_equip,",
		"SELECT 1000000500, -1, -1, 0, 3167, @meld_equip, 0, 0, 0, 0, 0, 'Meld: Guard (guid 500, entry 3)' FROM DUAL",
		"`ModelId` = 3167 AND `EquipmentId` = @meld_equip);",
		"DELETE FROM `creature_spawn_data_template` WHERE `Entry` = 1000000500 AND (`ModelId` <> 3167 OR `EquipmentId` <> @meld_equip);",
		"INSERT INTO `creature_spawn_data` (`Guid`, `Id`) VALUES (500, 1000000500) ON DUPLICATE KEY UPDATE",
		// The captain's formation: its group, slot 0, the walking formation and its path.
		"INSERT INTO `spawn_group` (`Id`, `Name`, `Type`, `MaxCount`, `Flags`) VALUES (1000000501, 'Meld: formation led by guid 501', 0, 0, 1) ON DUPLICATE KEY UPDATE `Flags` = VALUES(`Flags`);",
		"WHERE `s`.`Guid` = 501 AND `g`.`Type` = 0 AND `s`.`Id` <> 1000000501;",
		"VALUES (1000000501, 501, 0, 0) ON DUPLICATE KEY UPDATE `SlotId` = 0;",
		"SELECT 1000000501, 4, 3, 0, 1000000501, `c`.`MovementType`, 'Meld' FROM `creature` `c` WHERE `c`.`guid` = 501 ON DUPLICATE KEY UPDATE `PathId` = VALUES(`PathId`), `MovementType` = VALUES(`MovementType`);",
		"DELETE FROM `waypoint_path` WHERE `PathId` = 1000000501;",
		"FROM `creature_movement` WHERE `Id` = 501;",
		// The grunt joins it in the next slot, its distance the spread.
		"ON DUPLICATE KEY UPDATE `Flags` = `Flags` | VALUES(`Flags`);",
		"SELECT 1000000501, 502, COALESCE(MAX(`SlotId`), 0) + 1, 0 FROM `spawn_group_spawn` WHERE `Id` = 1000000501;",
		"SELECT 1000000501, 4, 4, 0, 1000000501,",
		"`MovementType` = VALUES(`MovementType`), `FormationSpread` = VALUES(`FormationSpread`);",
		"UPDATE `spawn_group_spawn` `s` JOIN (SELECT",
		// The rat takes its own template and any formation it led with it.
		"DELETE FROM `creature_spawn_data_template` WHERE `Entry` = 1000000044;",
		"DELETE FROM `spawn_group` WHERE `Id` = 1000000044;",
		"DELETE FROM `waypoint_path` WHERE `PathId` = 1000000044;",
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
	for _, want := range []string{"Guard (guid 500, entry 3): its formation; CMaNGOS keeps a spawn of a pool out of spawn groups",
		"Grunt (guid 502, entry 3): its place in the formation; CMaNGOS lines the members up by the group's shape, fanned out behind the leader 4 yards away",
		"Guard (guid 500, entry 3): its waypoints' wander distances", "Guard (guid 500, entry 3): its waypoints' scripts", "Boar (guid 42, entry 4): its scale (2); CMaNGOS classic takes scale"} {
		if !strings.Contains(skipped, want) {
			t.Errorf("Skipped lacks %q:\n%s", want, skipped)
		}
	}
	if !strings.Contains(res.SQL, "-- Not exported:") {
		t.Error("the skipped changes are not listed in the file")
	}
	for _, not := range []string{"its display", "its equipment", "Captain (guid 501, entry 3): its formation"} {
		if strings.Contains(skipped, not) {
			t.Errorf("Skipped still has %q, which the export writes:\n%s", not, skipped)
		}
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

// A leader that stops leading takes its group with it, a member that leaves one group for another
// leaves a gap the old group's slots close over, a leader whose path changed copies it to its group's
// path again, and a change that touches none of it writes no spawn group (#906).
func TestCMaNGOSFormationChanges(t *testing.T) {
	sql := func(s Spawn, orig Spawn) string {
		return ExportSQLFor(CMaNGOSClassic, []Edit{{Spawn: s, Original: &orig}}, fixedTime).SQL
	}
	leader := Spawn{Kind: Creature, GUID: 7, Entry: 1, Equipment: -1, SheathState: 1, Leader: 7, GroupFlags: FormationDefault, MovementType: 2,
		Path: []PathPoint{{X: 1}, {X: 2}}}
	alone := leader
	alone.Leader, alone.GroupFlags = 0, 0
	got := sql(alone, leader)
	for _, want := range []string{"DELETE FROM `spawn_group_spawn` WHERE `Id` = 1000000007;", "DELETE FROM `spawn_group` WHERE `Id` = 1000000007;",
		"DELETE FROM `waypoint_path` WHERE `PathId` = 1000000007;"} {
		if !strings.Contains(got, want) {
			t.Errorf("a leader that stopped leading: lacks %q\n%s", want, got)
		}
	}
	if strings.Contains(got, "INSERT INTO `spawn_group") {
		t.Errorf("a creature in no formation joins a group:\n%s", got)
	}

	member := Spawn{Kind: Creature, GUID: 8, Entry: 1, Equipment: -1, SheathState: 1, Leader: 7, FollowDist: 30, GroupFlags: FormationDefault}
	moved := member
	moved.Leader = 9
	got = sql(moved, member)
	for _, want := range []string{"WHERE `s`.`Guid` = 8 AND `g`.`Type` = 0;", "WHERE `a`.`Id` = 1000000007 AND", "SELECT 1000000009, 8, COALESCE(",
		"SELECT 1000000009, 4, 15, 0, 1000000009,"} {
		if !strings.Contains(got, want) {
			t.Errorf("a member that changed leader: lacks %q\n%s", want, got)
		}
	}

	walked := leader
	walked.Path = []PathPoint{{X: 1}, {X: 5}}
	got = sql(walked, leader)
	if !strings.Contains(got, "SELECT 1000000007, `Point`,") || strings.Contains(got, "WHERE `s`.`Guid` = 7 AND `g`.`Type` = 0;") {
		t.Errorf("a leader whose path changed: its group's path is not copied again, or it left its group:\n%s", got)
	}

	still := leader
	still.X = 4
	got = sql(still, leader)
	if body := got[strings.Index(got, "-- Change"):]; strings.Contains(body, "spawn_group") || strings.Contains(body, "creature_spawn_data") {
		t.Errorf("a leader that only moved rewrites its group or look:\n%s", got)
	}
}

// A spawn's equipment goes to CMaNGOS by its items, since the id is the VMaNGOS database's row
// (#1042): an equipment whose items are unknown is reported and left to CMaNGOS, one with no items is
// none, and an unchanged one the editor read the items of is written by them too when the look is.
func TestCMaNGOSEquipmentByItems(t *testing.T) {
	orig := Spawn{Kind: Creature, GUID: 9, Entry: 1, Name: "Guard", Equipment: 4, SheathState: 1}
	// The statements only: the header names the tables too.
	export := func(s Spawn) Result {
		res := ExportSQLFor(CMaNGOSClassic, []Edit{{Spawn: s, Original: &orig}}, fixedTime)
		res.SQL = res.SQL[strings.Index(res.SQL, "-- Change"):]
		return res
	}
	unknown := orig
	unknown.Equipment = 5
	res := export(unknown)
	if strings.Contains(res.SQL, "creature_spawn_data") || strings.Contains(res.SQL, "creature_equip_template") ||
		len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0], "the items of equipment 5 couldn't be read") {
		t.Errorf("an equipment with unknown items: %v\n%s", res.Skipped, res.SQL)
	}
	unknown.Display = 100
	if res = export(unknown); !strings.Contains(res.SQL, "SELECT 1000000009, -1, -1, 0, 100, -1,") || len(res.Skipped) != 1 {
		t.Errorf("a new display beside an equipment with unknown items keeps the creature's equipment: %v\n%s", res.Skipped, res.SQL)
	}

	bare := orig
	bare.Equipment, bare.EquipItems = 6, &[3]int{}
	if res = export(bare); !strings.Contains(res.SQL, "SELECT 1000000009, -1, -1, 0, 0, 0,") || strings.Contains(res.SQL, "creature_equip_template") {
		t.Errorf("an equipment with no items is not none:\n%s", res.SQL)
	}

	look := orig
	look.Display = 100
	if res = export(look); !strings.Contains(res.SQL, "SELECT 1000000009, -1, -1, 0, 100, -1,") || len(res.Skipped) != 0 {
		t.Errorf("an unchanged equipment of unknown items: %v\n%s", res.Skipped, res.SQL)
	}
	look.EquipItems = &[3]int{12, 0, 0}
	if res = export(look); !strings.Contains(res.SQL, "WHERE `equipentry1` = 12 AND `equipentry2` = 0 AND `equipentry3` = 0") ||
		!strings.Contains(res.SQL, "SELECT 1000000009, -1, -1, 0, 100, @meld_equip,") {
		t.Errorf("an unchanged equipment of known items is not written by them:\n%s", res.SQL)
	}

	// SpawnSQL hands the items to the spawns that name the equipment, and SpawnEquipmentIDs lists
	// the ones to read.
	edits := []SpawnEdit{
		{Spawn: WorldSpawn{Kind: KindNPC, GUID: 1, Entry: 2, Equipment: 7}, Created: true},
		{Spawn: WorldSpawn{Kind: KindNPC, GUID: 2, Entry: 2, Equipment: 7}, Created: true},
		{Spawn: WorldSpawn{Kind: KindNPC, GUID: 3, Entry: 2, Equipment: 8}, Deleted: true},
		{Spawn: WorldSpawn{Kind: KindNPC, GUID: 4, Entry: 2, Equipment: -1}, Created: true},
	}
	if ids := SpawnEquipmentIDs(edits); len(ids) != 1 || ids[0] != 7 {
		t.Errorf("SpawnEquipmentIDs = %v, want [7]", ids)
	}
	data := clientWithMaps(t, []uint32{0}, []string{"Azeroth"})
	got, err := SpawnSQL(CMaNGOSClassic, "", data, "Azeroth", 32, 32, 1, edits, map[int][3]int{7: {11, 0, 0}}, fixedTime)
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(got.SQL, "SET @meld_equip = (SELECT `entry` FROM `creature_equip_template` WHERE `equipentry1` = 11 AND"); n != 2 || len(got.Skipped) != 0 {
		t.Errorf("SpawnSQL wrote %d equipment rows by the items, want 2 (%v):\n%s", n, got.Skipped, got.SQL)
	}
}

package vmangos

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// acWorldRows answers the editor's AzerothCore queries for one region: a guard (entry 100) with its
// template's equipment, a path in its addon, leading a formation and in a pool with a mother pool; a
// member of its formation with equipment of its own (row 2); a rabbit without equipment rows; and a
// game object in an event. It records every query.
func acWorldRows(t *testing.T, queries *[]string) func(worldDB, string) ([]byte, error) {
	return func(db worldDB, sql string) ([]byte, error) {
		*queries = append(*queries, sql)
		if db.name != "acore_world" {
			t.Errorf("query on %s: %s", db.name, sql)
		}
		switch {
		case strings.HasPrefix(sql, "SELECT c.`guid`"):
			// guid, id, name, subname, levels, faction, npcflag, rank, type, x, y, z, o, respawn, display,
			// scale, own display, equipment_id, stand, emote, sheath, movement, wander, respawn, 0 0 0 0
			return []byte("" +
				"10000100\t100\tGuard\t\t70\t70\t1802\t0\t1\t7\t5580\t850\t191\t1.5\t300\t24944\t1\t0\t1\t0\t0\t1\t2\t0\t300\t0\t0\t0\t0\n" +
				"10000101\t100\tGuard\t\t70\t70\t1802\t0\t1\t7\t5582\t848\t191\t1.5\t300\t24944\t1\t0\t2\t1\t10\t0\t0\t0\t300\t0\t0\t0\t0\n" +
				"10000102\t721\tRabbit\t\t1\t1\t31\t0\t0\t8\t5583\t850\t191.2\t0\t120\t328\t1.2\t0\t0\t0\t0\t1\t1\t5\t120\t0\t0\t0\t0\n"), nil
		case strings.HasPrefix(sql, "SELECT g.`guid`"):
			return []byte("20000\t181555\tSaronite Deposit\t\t0\t0\t0\t0\t0\t3\t5590\t860\t192\t0.5\t900\t7804\t1\t0\t0\t0\t0\t0\t0\t0\t900\t0\t0\t0.247404\t0.968912\n"), nil
		case strings.HasPrefix(sql, "SELECT `CreatureID`, `ID`"):
			if !strings.Contains(sql, "IN (100, 721)") {
				t.Errorf("equipment of %s", sql)
			}
			return []byte("100\t1\t1899\t0\t0\n100\t2\t1907\t1984\t0\n"), nil
		case strings.HasPrefix(sql, "SELECT `entry`, `displayid`"):
			return []byte("1899\t5010\t13\n1907\t6014\t13\n1984\t18705\t14\n"), nil
		case strings.Contains(sql, "FROM `creature_addon` a JOIN `waypoint_data`"):
			return []byte("10000100\t1\t5580\t850\t191\t0\t0\t0\t0\n10000100\t2\t5600\t850\t191\t3.1\t2000\t0\t0\n"), nil
		case strings.Contains(sql, "FROM `creature_template_addon` a JOIN `waypoint_data`"):
			t.Errorf("no creature walks a template's path: %s", sql)
		case strings.Contains(sql, "FROM `game_event_gameobject`"):
			return []byte("20000\t-7\n"), nil
		case strings.Contains(sql, "FROM `pool_creature` p"):
			return []byte("10000100\t100000001\t1\tMeld pool 1\t0\n"), nil
		case strings.Contains(sql, "COUNT(*) FROM `pool_creature`"):
			return []byte("100000001\t2\n"), nil
		case strings.Contains(sql, "FROM `pool_pool` pp"):
			return []byte("100000001\t100000002\t3\tNorthrend guards\t4\n"), nil
		case strings.HasPrefix(sql, "SELECT `leaderGUID`"):
			return []byte("10000100\t10000100\t0\t0\t515\n10000100\t10000101\t3\t90\t515\n"), nil
		}
		return nil, nil
	}
}

func acTestDB() worldDB {
	return worldDB{host: "127.0.0.1", port: "3306", user: "acore", password: "acore", name: "acore_world"}
}

// The editor reads an AzerothCore region's spawns from AzerothCore's tables: templates' displays from
// creature_template_model, equipment by entry and row as a number for its items, the pose from the
// addon's bytes, the path from waypoint_data, the formation's angle from degrees and its flags from
// groupAI, pools without patch columns.
func TestReadACSpawns(t *testing.T) {
	var queries []string
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = acWorldRows(t, &queries)
	spawns, err := readACSpawns(acTestDB(), nil, 571, 30, 21, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(spawns) != 4 {
		t.Fatalf("%d spawns", len(spawns))
	}
	guard, member, rabbit, ore := spawns[0], spawns[1], spawns[2], spawns[3]
	if guard.Kind != KindMonster || guard.Entry != 100 || guard.LevelMin != 70 || guard.Display != 24944 || guard.Rank != 1 {
		t.Errorf("guard = %+v", guard)
	}
	if guard.EquipItems != [3]int{1899, 0, 0} || guard.Equipment != acEquipKey([3]int{1899, 0, 0}) || guard.OwnEquipment {
		t.Errorf("guard's equipment = %d %v own %v, want its template's row 1", guard.Equipment, guard.EquipItems, guard.OwnEquipment)
	}
	if member.EquipItems != [3]int{1907, 1984, 0} || !member.OwnEquipment || ACEquipmentItems(member.Equipment) != member.EquipItems {
		t.Errorf("member's equipment = %d %v own %v, want row 2's items", member.Equipment, member.EquipItems, member.OwnEquipment)
	}
	if member.StandState != 1 || member.EmoteState != 10 || member.SheathState != 0 {
		t.Errorf("member's pose = %d %d %d", member.StandState, member.EmoteState, member.SheathState)
	}
	if rabbit.Equipment != 0 || rabbit.EquipItems != [3]int{} || rabbit.OwnEquipment {
		t.Errorf("rabbit's equipment = %d %v own %v", rabbit.Equipment, rabbit.EquipItems, rabbit.OwnEquipment)
	}
	if rabbit.Y != 191.2 || rabbit.Scale < 1.19 || rabbit.Scale > 1.21 || rabbit.MovementType != 1 || rabbit.WanderDistance != 5 || rabbit.RespawnSecs != 120 || rabbit.RespawnMaxSecs != 120 {
		t.Errorf("rabbit = %+v", rabbit)
	}
	if len(guard.Waypoints) != 2 || guard.Waypoints[1].WaitMs != 2000 || guard.Waypoints[1].Orientation != 3.1 || guard.PathFromTemplate {
		t.Errorf("guard's path = %+v", guard.Waypoints)
	}
	if guard.Leader != guard.GUID || guard.GroupFlags != FormationDefault || member.Leader != guard.GUID || member.FollowDist != 3 || math.Abs(float64(member.FollowAngle)-math.Pi/2) > 1e-5 {
		t.Errorf("formation: guard %d %d, member %d %v %v", guard.Leader, guard.GroupFlags, member.Leader, member.FollowDist, member.FollowAngle)
	}
	if guard.Pool != 100000001 || guard.PoolLimit != 1 || guard.PoolElsewhere != 2 || guard.MotherPool != 100000002 || guard.MotherLimit != 3 || guard.MotherSize != 4 {
		t.Errorf("guard's pool = %+v", guard)
	}
	if ore.Kind != KindObject || ore.Type != 3 || len(ore.Events) != 1 || ore.Events[0] != -7 || ore.RespawnSecs != 900 {
		t.Errorf("ore = %+v", ore)
	}
	checkSchema(t, schemaFixture(t, "testdata/azerothcore-spawns.sql"), "AzerothCore", strings.Join(queries, "\n"), 10)
}

// Every other query of the editor's AzerothCore reads names AzerothCore's tables and columns.
func TestACQueriesMatchTheSchema(t *testing.T) {
	queries := []string{
		acCreatureTemplateSQL("t.`name` LIKE '%Guard%'", "ORDER BY t.`name`, t.`entry` LIMIT 100"),
		acObjectTemplatesSQL,
		acWeaponsSQL,
		acNextGUIDSQL("creature"),
		acNextGUIDSQL("gameobject"),
		"SELECT `CreatureID`, `ItemID1`, `ItemID2`, `ItemID3` FROM `creature_equip_template` WHERE `ID` = 1",
		acPathsSQL("creature_template_addon", "entry", "100"),
		"SELECT `guid`, `eventEntry` FROM `game_event_creature` WHERE `guid` IN (1)",
	}
	checkSchema(t, schemaFixture(t, "testdata/azerothcore-spawns.sql"), "AzerothCore", strings.Join(queries, "\n"), len(queries))
}

// A placed spawn's guid comes after Meld's own range's highest, from acGUIDBase, below the room left for
// the server's own spawns.
func TestACNextGUIDs(t *testing.T) {
	got := acNextGUIDSQL("creature")
	if !strings.Contains(got, "GREATEST(COALESCE(MAX(`guid`), 0), 10000000) + 1 FROM `creature` WHERE `guid` > 10000000 AND `guid` < 15777215") {
		t.Errorf("next guid: %s", got)
	}
}

// An equipment's number depends on its items only, is never 0 or -1, and comes back to its items.
func TestACEquipKey(t *testing.T) {
	a := ACEquipmentFor([3]int{1899, 0, 0})
	if a <= 0 || a != acEquipKey([3]int{1899, 0, 0}) || ACEquipmentItems(a) != [3]int{1899, 0, 0} {
		t.Errorf("key %d", a)
	}
	if ACEquipmentFor([3]int{}) != 0 || acEquipKey([3]int{0, 1899, 0}) == a {
		t.Error("no items is 0, and another slot another number")
	}
}

// The world database's connection comes from worldserver.conf's WorldDatabaseInfo.
func TestACWorldDB(t *testing.T) {
	dir := t.TempDir()
	conf := filepath.Join(dir, "worldserver.conf")
	text := "LoginDatabaseInfo     = \"127.0.0.1;3306;acore;acore;acore_auth\"\n" +
		"#WorldDatabaseInfo = \"x;1;x;x;x\"\nWorldDatabaseInfo     = \"127.0.0.1;3306;acore;secret;acore_world\"\n"
	if err := os.WriteFile(conf, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	db, err := acWorldDB(AzerothCoreServer{Root: dir, Conf: conf})
	if err != nil || db != (worldDB{host: "127.0.0.1", port: "3306", user: "acore", password: "secret", name: "acore_world"}) {
		t.Errorf("db = %+v, %v", db, err)
	}
	if _, err := acWorldDB(AzerothCoreServer{Root: dir}); err == nil {
		t.Error("no conf: no error")
	}
}

package vmangos

import (
	"strings"
	"testing"
	"time"
)

// A creature that joins a formation gets its creature_groups row; one that leaves loses it; a leader
// that disbands takes its group's rows; a deleted creature leaves its formation.
func TestFormationSQL(t *testing.T) {
	base := Spawn{Kind: Creature, GUID: 10, Entry: 1, Map: 0}
	joined := base
	joined.Leader, joined.FollowDist, joined.FollowAngle, joined.GroupFlags = 20, 3, -1, FormationDefault
	left := Spawn{Kind: Creature, GUID: 11, Entry: 1}
	wasIn := joined
	wasIn.GUID = 12
	leader := Spawn{Kind: Creature, GUID: 20, Entry: 1, Leader: 20, GroupFlags: 3}
	disbanded := leader
	disbanded.Leader = 0
	gone := Spawn{Kind: Creature, GUID: 30, Entry: 1}
	res := ExportSQL([]Edit{
		{Spawn: joined, Original: &base},
		{Spawn: left, Original: &Spawn{Kind: Creature, GUID: 11, Entry: 1, Leader: 20}},
		{Spawn: disbanded, Original: &leader},
		{Spawn: gone, Original: &gone, Deleted: true},
		{Spawn: wasIn, Original: &wasIn},
	}, time.Unix(0, 0))
	for _, want := range []string{
		"REPLACE INTO `creature_groups` (`leader_guid`, `member_guid`, `dist`, `angle`, `flags`) VALUES (20, 10, 3, 5.283185, 3);",
		"DELETE FROM `creature_groups` WHERE `leader_guid` = 20 OR `member_guid` = 20;",
		"DELETE FROM `creature_groups` WHERE `member_guid` = 30 OR `leader_guid` = 30;",
		"DELETE FROM `creature_groups` WHERE `member_guid` = 11;",
	} {
		if !strings.Contains(res.SQL, want) {
			t.Errorf("SQL lacks %q:\n%s", want, res.SQL)
		}
	}
	if strings.Count(res.SQL, "REPLACE INTO `creature_groups`") != 1 {
		t.Errorf("an unchanged formation is written again:\n%s", res.SQL)
	}
}

// A spawn that joins a pool gets its pool row and the pool its template row; one that leaves loses
// its row; an unchanged member writes nothing of its pool.
func TestPoolSQL(t *testing.T) {
	vein := Spawn{Kind: GameObject, GUID: 5, Entry: 324}
	joined := vein
	joined.Pool, joined.PoolLimit, joined.PoolName, joined.PoolChance = 43848, 1, "Mine veins", 150
	rare := Spawn{Kind: Creature, GUID: 6, Entry: 9, Pool: 77, PoolLimit: 1}
	left := rare
	left.Pool, left.PoolLimit = 0, 0
	same := Spawn{Kind: GameObject, GUID: 7, Entry: 324, Pool: 43848, PoolLimit: 1, PoolName: "Mine veins"}
	tooBig := Spawn{Kind: GameObject, GUID: 8, Entry: 324, Pool: 70000}
	res := ExportSQL([]Edit{
		{Spawn: joined, Original: &vein},
		{Spawn: left, Original: &rare},
		{Spawn: same, Original: &same},
		{Spawn: tooBig, Original: &vein},
	}, time.Unix(0, 0))
	for _, want := range []string{
		"INSERT INTO `pool_gameobject` (`guid`, `pool_entry`, `chance`, `description`) VALUES (5, 43848, 100, 'Mine veins') " +
			"ON DUPLICATE KEY UPDATE `pool_entry` = VALUES(`pool_entry`), `chance` = VALUES(`chance`);",
		"DELETE FROM `pool_creature` WHERE `guid` = 6;",
		"INSERT INTO `pool_template` (`entry`, `max_limit`, `description`) SELECT 43848, 1, 'Mine veins' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `pool_template` WHERE `entry` = 43848);",
		"UPDATE `pool_template` SET `max_limit` = 1, `description` = 'Mine veins' WHERE `entry` = 43848;",
	} {
		if !strings.Contains(res.SQL, want) {
			t.Errorf("SQL lacks %q:\n%s", want, res.SQL)
		}
	}
	if strings.Count(res.SQL, "INSERT INTO `pool_template`") != 1 || strings.Contains(res.SQL, "(8, 70000") {
		t.Errorf("pool templates:\n%s", res.SQL)
	}
	if len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0], "pool 70000") {
		t.Errorf("skipped %q", res.Skipped)
	}
}

// serverSpawn carries the formation and the pool; an object has no formation.
func TestServerSpawnGroups(t *testing.T) {
	w := WorldSpawn{Kind: KindMonster, GUID: 3, Leader: 2, FollowDist: 4, FollowAngle: 1.5, GroupFlags: 3, Pool: 9, PoolLimit: 1, PoolName: "p", PoolChance: 50}
	s := serverSpawn(w, 0, 0, 0)
	if s.Leader != 2 || s.FollowDist != 4 || s.FollowAngle != 1.5 || s.GroupFlags != 3 || s.Pool != 9 || s.PoolLimit != 1 || s.PoolName != "p" || s.PoolChance != 50 {
		t.Fatalf("%+v", s)
	}
	w.Kind = KindObject
	if s := serverSpawn(w, 0, 0, 0); s.Leader != 0 || s.Pool != 9 {
		t.Fatalf("object %+v", s)
	}
}

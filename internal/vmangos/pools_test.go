package vmangos

import (
	"strings"
	"testing"
)

func TestReadSpawnPools(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	var asked []string
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		asked = append(asked, sql)
		switch {
		case strings.Contains(sql, "FROM pool_pool pp"):
			return []byte("22972\t1080\t15\tAshenvale - Tin Vein (Master Pool)\t113\n22972\t1080\t15\tolder row\t1\n"), nil
		case strings.Contains(sql, "COUNT(*) FROM pool_gameobject"):
			return []byte("22972\t1\n"), nil
		case strings.Contains(sql, "FROM pool_gameobject p"):
			// Two veins sharing a spot; the pool has two patch rows, the first counts.
			return []byte("23509\t22972\t1\tTruesilver Deposit / Small Thorium Vein - Silithus\t0\n" +
				"23510\t22972\t1\tTruesilver Deposit / Small Thorium Vein - Silithus\t25.5\n" +
				"23510\t22972\t2\tolder row\t0\n"), nil
		}
		return nil, nil
	}
	spawns := []WorldSpawn{{Kind: KindObject, GUID: 23509}, {Kind: KindObject, GUID: 23510}, {Kind: KindObject, GUID: 7}, {Kind: KindMonster, GUID: 23509}}
	if err := readSpawnPools(worldDB{}, spawns); err != nil {
		t.Fatal(err)
	}
	if len(asked) != 4 || !strings.Contains(asked[1], "WHERE p.guid IN (7, 23509, 23510)") ||
		!strings.Contains(asked[2], "pool_entry IN (22972) AND guid NOT IN (7, 23509, 23510)") || !strings.Contains(asked[3], "pp.pool_id IN (22972)") {
		t.Fatalf("queries %q", asked)
	}
	for i, want := range []int{22972, 22972, 0, 0} {
		if spawns[i].Pool != want {
			t.Errorf("spawn %d: pool %d, want %d", i, spawns[i].Pool, want)
		}
	}
	s := spawns[1]
	if s.PoolLimit != 1 || !strings.HasPrefix(s.PoolName, "Truesilver Deposit") || s.PoolChance != 25.5 || s.PoolElsewhere != 1 {
		t.Fatalf("pool %+v", s)
	}
	if s.MotherPool != 1080 || s.MotherLimit != 15 || s.MotherSize != 113 || !strings.HasPrefix(s.MotherName, "Ashenvale") {
		t.Fatalf("mother pool %+v", s)
	}
	if spawns[2].MotherPool != 0 {
		t.Fatalf("a spawn without a pool got a mother: %+v", spawns[2])
	}
}

func TestReadFormations(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	var asked string
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		asked = sql
		// Leader 51427 with its own row, and 51403 without one; 300840 is outside the region.
		return []byte("51403\t51414\t4.55934\t6.62359\t3\n51403\t300840\t8.05\t6.11\t1\n" +
			"51427\t51427\t0\t1.56702\t1\n51427\t51428\t3.0284\t5.90644\t1\n"), nil
	}
	spawns := []WorldSpawn{{Kind: KindMonster, GUID: 51403}, {Kind: KindMonster, GUID: 51414}, {Kind: KindNPC, GUID: 51427}, {Kind: KindMonster, GUID: 51428},
		{Kind: KindMonster, GUID: 9}, {Kind: KindObject, GUID: 51414}}
	if err := readFormations(worldDB{}, spawns); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(asked, "member_guid IN (9, 51403, 51414, 51427, 51428) OR leader_guid IN (9, 51403") {
		t.Fatalf("query %q", asked)
	}
	want := []struct {
		leader, flags int
		dist          float32
	}{{51403, 3, 0}, {51403, 3, 4.55934}, {51427, 1, 0}, {51427, 1, 3.0284}, {0, 0, 0}, {0, 0, 0}}
	for i, w := range want {
		s := spawns[i]
		if s.Leader != w.leader || s.GroupFlags != w.flags || s.FollowDist != w.dist {
			t.Errorf("spawn %d: leader %d flags %d dist %v, want %+v", i, s.Leader, s.GroupFlags, s.FollowDist, w)
		}
	}
	if spawns[3].FollowAngle != 5.90644 {
		t.Errorf("angle %v", spawns[3].FollowAngle)
	}
}

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
		if strings.Contains(sql, "pool_gameobject") {
			// Two veins sharing a spot; the pool has two patch rows, the first counts.
			return []byte("23509\t22972\t1\tTruesilver Deposit / Small Thorium Vein - Silithus\n" +
				"23510\t22972\t1\tTruesilver Deposit / Small Thorium Vein - Silithus\n" +
				"23510\t22972\t2\tolder row\n"), nil
		}
		return nil, nil
	}
	spawns := []WorldSpawn{{Kind: KindObject, GUID: 23509}, {Kind: KindObject, GUID: 23510}, {Kind: KindObject, GUID: 7}, {Kind: KindMonster, GUID: 23509}}
	if err := readSpawnPools(worldDB{}, spawns); err != nil {
		t.Fatal(err)
	}
	if len(asked) != 2 || !strings.Contains(asked[1], "WHERE p.guid IN (7, 23509, 23510)") {
		t.Fatalf("queries %q", asked)
	}
	for i, want := range []int{22972, 22972, 0, 0} {
		if spawns[i].Pool != want {
			t.Errorf("spawn %d: pool %d, want %d", i, spawns[i].Pool, want)
		}
	}
	if spawns[1].PoolLimit != 1 || !strings.HasPrefix(spawns[1].PoolName, "Truesilver Deposit") {
		t.Fatalf("pool %+v", spawns[1])
	}
}

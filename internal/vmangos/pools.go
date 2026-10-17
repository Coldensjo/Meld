package vmangos

import (
	"fmt"
	"strconv"
)

// spawnPool is a spawn's pool as poolsSQL reads it.
type spawnPool struct {
	pool, limit int
	name        string
}

// poolsSQL lists the pools of the guids in list from table (pool_creature or pool_gameobject): guid,
// pool, the pool's limit and its description (the member's own when the pool has none). A pool
// template may have a row per patch range, so a guid can come more than once; the first row counts.
func poolsSQL(table, list string) string {
	return fmt.Sprintf("SELECT p.guid, p.pool_entry, COALESCE(t.max_limit, 0), COALESCE(NULLIF(t.description, ''), p.description, '') "+
		"FROM %s p LEFT JOIN pool_template t ON t.entry = p.pool_entry WHERE p.guid IN (%s) ORDER BY p.guid, t.patch_max DESC", table, list)
}

// readSpawnPools gives each spawn the pool it belongs to by its guid (pool_creature,
// pool_gameobject), so the editor can show which spawns share a spot and take turns.
func readSpawnPools(db worldDB, spawns []WorldSpawn) error {
	creatures, objects := map[int]bool{}, map[int]bool{}
	for _, s := range spawns {
		if s.Kind == KindObject {
			objects[s.GUID] = true
		} else {
			creatures[s.GUID] = true
		}
	}
	for _, q := range []struct {
		table string
		guids map[int]bool
		obj   bool
	}{{"pool_creature", creatures, false}, {"pool_gameobject", objects, true}} {
		if len(q.guids) == 0 {
			continue
		}
		raw, err := runSQL(db, poolsSQL(q.table, intList(q.guids)))
		if err != nil {
			return err
		}
		pools := parseSpawnPools(raw)
		for i := range spawns {
			s := &spawns[i]
			if (s.Kind == KindObject) != q.obj {
				continue
			}
			if p, ok := pools[s.GUID]; ok {
				s.Pool, s.PoolLimit, s.PoolName = p.pool, p.limit, p.name
			}
		}
	}
	return nil
}

// parseSpawnPools reads poolsSQL's rows into each guid's pool, the first row of a guid counting.
func parseSpawnPools(raw []byte) map[int]spawnPool {
	out := map[int]spawnPool{}
	for _, f := range tsvRows(raw, 4) {
		guid, err1 := strconv.Atoi(f[0])
		pool, err2 := strconv.Atoi(f[1])
		limit, err3 := strconv.Atoi(f[2])
		if err1 != nil || err2 != nil || err3 != nil || pool == 0 {
			continue
		}
		if _, seen := out[guid]; !seen {
			out[guid] = spawnPool{pool: pool, limit: limit, name: unescapeBatch(f[3])}
		}
	}
	return out
}

package vmangos

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// spawnPool is a spawn's pool as poolsSQL reads it.
type spawnPool struct {
	pool, limit int
	name        string
	chance      float32
}

// motherPool is the pool a pool belongs to (pool_pool) as mothersSQL reads it: its entry, limit,
// description and how many pools it holds.
type motherPool struct {
	pool, limit, size int
	name              string
}

// poolsSQL lists the pools of the guids in list from table (pool_creature or pool_gameobject): guid,
// pool, the pool's limit, its description (the member's own when the pool has none) and the member's
// chance. A pool template may have a row per patch range, so a guid can come more than once; the
// first row counts.
func poolsSQL(table, list string) string {
	return fmt.Sprintf("SELECT p.guid, p.pool_entry, COALESCE(t.max_limit, 0), COALESCE(NULLIF(t.description, ''), p.description, ''), p.chance "+
		"FROM %s p LEFT JOIN pool_template t ON t.entry = p.pool_entry WHERE p.guid IN (%s) ORDER BY p.guid, t.patch_max DESC", table, list)
}

// elsewhereSQL counts the members of each pool in pools that table has under other guids than those
// in guids: the pool's spawns outside the region.
func elsewhereSQL(table, pools, guids string) string {
	return fmt.Sprintf("SELECT pool_entry, COUNT(*) FROM %s WHERE pool_entry IN (%s) AND guid NOT IN (%s) GROUP BY pool_entry", table, pools, guids)
}

// mothersSQL lists the mother pools (pool_pool) of the pools in list: the pool, its mother, the
// mother's limit and description, and how many pools the mother holds. The first row of a pool counts.
func mothersSQL(list string) string {
	return fmt.Sprintf("SELECT pp.pool_id, pp.mother_pool, COALESCE(t.max_limit, 0), COALESCE(NULLIF(t.description, ''), pp.description, ''), "+
		"(SELECT COUNT(*) FROM pool_pool c WHERE c.mother_pool = pp.mother_pool) "+
		"FROM pool_pool pp LEFT JOIN pool_template t ON t.entry = pp.mother_pool WHERE pp.pool_id IN (%s) ORDER BY pp.pool_id, t.patch_max DESC", list)
}

// readSpawnPools gives each spawn the pool it belongs to by its guid (pool_creature,
// pool_gameobject), with its chance, the pool's members outside the region and the pool's mother
// pool (pool_pool), so the editor can show which spawns share a spot and take turns, and how many of
// a zone's veins the server spawns at once.
func readSpawnPools(db worldDB, spawns []WorldSpawn) error {
	creatures, objects := map[int]bool{}, map[int]bool{}
	for _, s := range spawns {
		if s.Kind == KindObject {
			objects[s.GUID] = true
		} else {
			creatures[s.GUID] = true
		}
	}
	all := map[int]bool{}
	for _, q := range []struct {
		table string
		guids map[int]bool
		obj   bool
	}{{"pool_creature", creatures, false}, {"pool_gameobject", objects, true}} {
		if len(q.guids) == 0 {
			continue
		}
		guids := intList(q.guids)
		raw, err := runSQL(db, poolsSQL(q.table, guids))
		if err != nil {
			return err
		}
		pools := parseSpawnPools(raw)
		if len(pools) == 0 {
			continue
		}
		entries := map[int]bool{}
		for _, p := range pools {
			entries[p.pool] = true
			all[p.pool] = true
		}
		raw, err = runSQL(db, elsewhereSQL(q.table, intList(entries), guids))
		if err != nil {
			return err
		}
		elsewhere := parseCounts(raw)
		for i := range spawns {
			s := &spawns[i]
			if (s.Kind == KindObject) != q.obj {
				continue
			}
			if p, ok := pools[s.GUID]; ok {
				s.Pool, s.PoolLimit, s.PoolName, s.PoolChance = p.pool, p.limit, p.name, p.chance
				s.PoolElsewhere = elsewhere[p.pool]
			}
		}
	}
	if len(all) == 0 {
		return nil
	}
	raw, err := runSQL(db, mothersSQL(intList(all)))
	if err != nil {
		return err
	}
	mothers := parseMothers(raw)
	for i := range spawns {
		s := &spawns[i]
		if m, ok := mothers[s.Pool]; ok && s.Pool != 0 {
			s.MotherPool, s.MotherLimit, s.MotherName, s.MotherSize = m.pool, m.limit, m.name, m.size
		}
	}
	return nil
}

// parseSpawnPools reads poolsSQL's rows into each guid's pool, the first row of a guid counting.
func parseSpawnPools(raw []byte) map[int]spawnPool {
	out := map[int]spawnPool{}
	for _, f := range batchRows(raw, 5) {
		guid, err1 := strconv.Atoi(f[0])
		pool, err2 := strconv.Atoi(f[1])
		limit, err3 := strconv.Atoi(f[2])
		chance, err4 := strconv.ParseFloat(f[4], 32)
		if err1 != nil || err2 != nil || err3 != nil || pool == 0 {
			continue
		}
		if err4 != nil {
			chance = 0
		}
		if _, seen := out[guid]; !seen {
			out[guid] = spawnPool{pool: pool, limit: limit, name: f[3], chance: float32(chance)}
		}
	}
	return out
}

// parseCounts reads rows of an id and a count.
func parseCounts(raw []byte) map[int]int {
	out := map[int]int{}
	for _, f := range batchRows(raw, 2) {
		if v, ok := atoiAll(f); ok {
			out[v[0]] = v[1]
		}
	}
	return out
}

// parseMothers reads mothersSQL's rows into each pool's mother, the first row of a pool counting.
func parseMothers(raw []byte) map[int]motherPool {
	out := map[int]motherPool{}
	for _, f := range batchRows(raw, 5) {
		pool, err1 := strconv.Atoi(f[0])
		mother, err2 := strconv.Atoi(f[1])
		limit, err3 := strconv.Atoi(f[2])
		size, err4 := strconv.Atoi(f[4])
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil || mother == 0 {
			continue
		}
		if _, seen := out[pool]; !seen {
			out[pool] = motherPool{pool: mother, limit: limit, size: size, name: f[3]}
		}
	}
	return out
}

// MaxPoolEntry is the highest pool entry the world database can hold (pool_template.entry is a
// smallint unsigned).
const MaxPoolEntry = 65535

// NextPoolEntry is the first pool entry above every one the world database uses, in pool_template
// and in the tables that name pools, for a pool made in the editor.
func NextPoolEntry(serverRoot string) (int, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return 0, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return 0, err
	}
	raw, err := runSQL(db, "SELECT GREATEST((SELECT COALESCE(MAX(entry), 0) FROM pool_template), (SELECT COALESCE(MAX(pool_entry), 0) FROM pool_creature), "+
		"(SELECT COALESCE(MAX(pool_entry), 0) FROM pool_gameobject), (SELECT COALESCE(MAX(mother_pool), 0) FROM pool_pool), "+
		"(SELECT COALESCE(MAX(pool_id), 0) FROM pool_pool)) + 1")
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		return 0, err
	}
	if n > MaxPoolEntry {
		return 0, fmt.Errorf("the world database uses every pool entry up to %d", MaxPoolEntry)
	}
	return n, nil
}

// poolDescription is a pool's description for pool_template: its name, or one made of its number.
func poolDescription(s Spawn) string {
	if d := strings.TrimSpace(s.PoolName); d != "" {
		return d
	}
	return fmt.Sprintf("Meld pool %d", s.Pool)
}

// poolSQL is the SQL for a spawn's pool membership when it changed from orig's (nil for a spawn the
// database doesn't have): its row in pool_creature or pool_gameobject (table names the spawn's own
// table) written, or removed when it left its pool. The reason is given instead for a pool entry the
// database can't hold.
func poolSQL(s Spawn, orig *Spawn, table string) ([]string, string) {
	var was Spawn
	if orig != nil {
		was = *orig
	}
	if s.Pool == was.Pool && math.Abs(s.PoolChance-was.PoolChance) < 1e-4 {
		return nil, ""
	}
	link := "pool_gameobject"
	if table == "creature" {
		link = "pool_creature"
	}
	if s.Pool == 0 {
		return []string{fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d;", link, s.GUID)}, ""
	}
	if s.Pool < 0 || s.Pool > MaxPoolEntry {
		return nil, fmt.Sprintf("its pool %d, which the database can't hold (1 to %d)", s.Pool, MaxPoolEntry)
	}
	chance := math.Min(math.Max(s.PoolChance, 0), 100)
	return []string{fmt.Sprintf("INSERT INTO `%s` (`guid`, `pool_entry`, `chance`, `description`) VALUES (%d, %d, %s, %s) "+
		"ON DUPLICATE KEY UPDATE `pool_entry` = VALUES(`pool_entry`), `chance` = VALUES(`chance`);", link, s.GUID, s.Pool, num(chance), sqlQuote(poolDescription(s)))}, ""
}

// motherSQL is the SQL that puts spawn s's pool into its mother pool (pool_pool), or takes it out of
// the one it had when s has none. The reason is given instead for a mother the database can't hold
// or that is the pool itself (the server skips a pool that holds itself).
func motherSQL(s Spawn) ([]string, string) {
	head := fmt.Sprintf("-- Master pool of pool %d", s.Pool)
	if s.MotherPool == 0 {
		return []string{head, fmt.Sprintf("DELETE FROM `pool_pool` WHERE `pool_id` = %d;", s.Pool)}, ""
	}
	if s.MotherPool < 0 || s.MotherPool > MaxPoolEntry {
		return nil, fmt.Sprintf("its master pool %d, which the database can't hold (1 to %d)", s.MotherPool, MaxPoolEntry)
	}
	if s.MotherPool == s.Pool {
		return nil, "its master pool is the pool itself"
	}
	return []string{head, fmt.Sprintf("INSERT INTO `pool_pool` (`pool_id`, `mother_pool`, `chance`, `description`) VALUES (%d, %d, 0, %s) "+
		"ON DUPLICATE KEY UPDATE `mother_pool` = VALUES(`mother_pool`);", s.Pool, s.MotherPool, sqlQuote(poolDescription(s)))}, ""
}

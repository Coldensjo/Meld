package vmangos

import (
	"fmt"
	"sort"
	"strings"
)

// The spawn SQL for a CMaNGOS TBC world database (#1076), which ExportSQLFor writes for CMaNGOSTBC, the
// 2.4.3 core (cmangos/mangos-tbc). Its spawn tables (sql/base/mangos.sql at s2491, read 2026-11) are
// CMaNGOS classic's column for column, but for game_event_creature_data's vendor_id, which Meld only
// deletes rows of, and its script commands (dbscripts_on_creature_movement) are classic's but for the
// vanilla-only meeting stone, which Meld never writes; so the SQL is the CMaNGOS classic writer's
// (cmangos.go). What differs is the data the SQL lands among:
//   - CMaNGOS TBC's data (tbc-db 1.11.0) uses creature guids up to 9000404 and game object guids up to
//     9000109, over the whole range of VMaNGOS's, whose numbers the editor gives its spawns, so Meld's
//     spawns live there under guids of their own, tbcGUIDBase plus the editor's guid. A change to a
//     spawn of the VMaNGOS database therefore reaches only the copy Meld exported before, never CMaNGOS
//     TBC's own spawn of it, which has another guid. The server builds a creature's or game object's
//     object guid from its database guid in 24 bits (ObjectGuid's counter), hence tbcMaxGUID.
//   - its pools go up to entry 49707, and the server reads pool entries as 16 bits (PoolManager's
//     max_pool_id), so no offset fits the editor's pools in above them. A Meld pool is instead the
//     pool_template row whose description starts "Meld pool <editor's entry>", found or made after
//     the highest entry by the SQL into @meld_pool_<entry>, which every statement naming the pool uses.
//
// CMaNGOS's own source (ObjectGuid, PoolManager::LoadFromDB) is GPL: its behaviour is described here,
// none of its code is copied.

// tbcGUIDBase numbers Meld's spawns in a CMaNGOS TBC database (see above), and tbcMaxGUID is the
// highest editor's guid that stays within the server's 24-bit counter.
const (
	tbcGUIDBase = 10000000
	tbcMaxGUID  = 0xFFFFFF - tbcGUIDBase
)

// tbcMaxPool is the highest pool entry CMaNGOS TBC reads.
const tbcMaxPool = 65535

func tbcGUID(guid int) int {
	if guid <= 0 {
		return guid
	}
	return tbcGUIDBase + guid
}

// tbcSpawn is s under Meld's guids in a CMaNGOS TBC database: its own and its formation leader's.
func tbcSpawn(s Spawn) Spawn {
	s.GUID, s.Leader = tbcGUID(s.GUID), tbcGUID(s.Leader)
	return s
}

// tbcEdits are the edits under Meld's guids in a CMaNGOS TBC database, without those whose guid (or
// formation leader's) is past tbcMaxGUID, which skipped lists.
func tbcEdits(edits []Edit) (out []Edit, skipped []string) {
	out = make([]Edit, 0, len(edits))
	for _, e := range edits {
		s := e.Spawn
		if s.GUID > tbcMaxGUID || s.Leader > tbcMaxGUID || (e.Original != nil && e.Original.Leader > tbcMaxGUID) {
			skipped = append(skipped, fmt.Sprintf("%s: its guid or its formation leader's is past %d, the last Meld numbers CMaNGOS TBC's spawns from", label(s), tbcMaxGUID))
			continue
		}
		e.Spawn = tbcSpawn(s)
		if e.Original != nil {
			o := tbcSpawn(*e.Original)
			e.Original = &o
		}
		out = append(out, e)
	}
	return out, skipped
}

// tbcPools names Meld's pools in a CMaNGOS TBC database by the variables the SQL sets, and remembers
// which an export named, for tbcPoolsSQL.
type tbcPools map[int]bool

func (u tbcPools) ref(p int) string {
	u[p] = true
	return fmt.Sprintf("@meld_pool_%d", p)
}

// tbcPoolKey is the condition that finds the pool_template row of Meld's pool p.
func tbcPoolKey(p int) string {
	return fmt.Sprintf("(`description` = 'Meld pool %d' OR `description` LIKE 'Meld pool %d:%%')", p, p)
}

// tbcPoolDescription is pool_template's description of the pool of s, which starts with the key that
// finds it again.
func tbcPoolDescription(s Spawn) string {
	head := fmt.Sprintf("Meld pool %d", s.Pool)
	if d := strings.TrimSpace(poolDescription(s)); d != head {
		return head + ": " + d
	}
	return head
}

// tbcPoolsSQL finds or makes the pool_template row of each pool the export named, into its variable.
// A pool made after entry 65535 isn't made, so its variable is NULL and the first row naming it fails
// the import, rather than the server reading the entry as another.
func tbcPoolsSQL(used tbcPools) []string {
	pools := make([]int, 0, len(used))
	for p := range used {
		pools = append(pools, p)
	}
	sort.Ints(pools)
	var out []string
	for _, p := range pools {
		key := tbcPoolKey(p)
		out = append(out, fmt.Sprintf("-- Meld pool %d", p),
			// The next entry is read in a derived table, so the INSERT's WHERE can leave out its one row.
			fmt.Sprintf("INSERT INTO `pool_template` (`entry`, `max_limit`, `description`) SELECT n.e, 0, 'Meld pool %d' "+
				"FROM (SELECT COALESCE(MAX(`entry`), 0) + 1 AS e FROM `pool_template`) n WHERE n.e <= %d AND NOT EXISTS (SELECT 1 FROM `pool_template` WHERE %s);",
				p, tbcMaxPool, key),
			fmt.Sprintf("SET @meld_pool_%d = (SELECT `entry` FROM `pool_template` WHERE %s ORDER BY `entry` LIMIT 1);", p, key))
	}
	return out
}

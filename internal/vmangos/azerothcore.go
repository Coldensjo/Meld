package vmangos

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The spawn SQL for an AzerothCore world database (#1073), which ExportSQLFor writes for AzerothCore,
// the 3.3.5a core (azerothcore/azerothcore-wotlk). Its schema (data/sql/base/db_world, read 2026-11)
// differs from VMaNGOS's in nearly every spawn table:
//   - Meld's spawns live there under guids of their own, acGUIDBase plus the editor's guid, and its pools
//     under acPoolBase plus the editor's entry. AzerothCore's own data uses creature guids up to about
//     5.3 million, game object guids up to 5.7 million and pool entries up to 201212, over the whole
//     range of VMaNGOS's (whose numbers the editor gives new spawns and pools), so the editor's numbers
//     would land on other spawns. A change to a spawn of the VMaNGOS database therefore reaches only the
//     copy Meld exported before, never AzerothCore's own spawn of it, which has another guid.
//   - creature names its template in id1 (id2 and id3 0, no alternative), has one respawn time
//     (spawntimesecs), wander_distance and MovementType, spawnMask and phaseMask (1: normal difficulty,
//     the first phase), zoneId and areaId (left 0, which worldserver.conf's
//     Calculate.Creature.Zone.Area.Data fills), and no display: the model is the template's.
//   - equipment_id picks the creature_equip_template row of the spawn's entry by its ID: 1, the first,
//     is the template's own (what AzerothCore's own spawns use), 0 none. Other equipment is the row of
//     the entry holding its items, made after the entry's highest ID (2 at least, so the spawns of ID 1
//     don't take it) when none has them.
//   - creature_addon is the spawn's whole addon, used instead of creature_template_addon's: a new row
//     copies the template's, then takes the path, the stand state (bytes1's low byte), the sheath state
//     (bytes2's low byte) and the looping emote.
//   - a path is waypoint_data under the path ID guid × 10 (AzerothCore's own convention), named by
//     creature_addon.path_id: a point's facing (NULL for none) and delay, no wander distance. Its
//     scripts (waypoint_scripts) are not translated: they are listed as not exported.
//   - a formation is creature_formations: a row for each member and one for the leader (memberGUID its
//     own guid), which the server needs to find the group's leader. The angle is in degrees, and the
//     flags (groupAI) are AzerothCore's own: following the leader, assisting and evading.
//   - pool_template, pool_creature, pool_gameobject and pool_pool have VMaNGOS's columns.
//   - creature_sparring names its creature by a foreign key, so a spawn's rows go before the spawn.
//
// AzerothCore's own source (CreatureGroups.cpp, Creature::LoadCreaturesAddon) is GPL: its behaviour is
// described here, none of its code is copied.

// acGUIDBase and acPoolBase number Meld's spawns and pools in an AzerothCore database (see above). A
// path's ID is ten times the guid in an int unsigned, which bounds the editor's guids at acMaxGUID.
const (
	acGUIDBase = 100000000
	acPoolBase = 100000000
	acMaxGUID  = math.MaxUint32/10 - acGUIDBase
)

// sameRespawn says whether s respawns between lo and hi seconds.
func sameRespawn(s Spawn, lo, hi int) bool {
	a, b := respawn(s)
	return a == lo && b == hi
}

func acGUID(guid int) int { return acGUIDBase + guid }
func acPool(pool int) int { return acPoolBase + pool }
func acPath(guid int) int { return acGUID(guid) * 10 }

// acCreatureLinks and acObjectLinks are the AzerothCore tables that name a spawn by its guid in a
// `guid` column, whose rows go with it.
var acCreatureLinks = []string{"creature_addon", "game_event_creature", "game_event_model_equip", "game_event_npcflag", "pool_creature"}
var acObjectLinks = []string{"gameobject_addon", "game_event_gameobject", "pool_gameobject"}

// AzerothCore's spawn types (spawn_group.spawnType, smart_scripts.source_type) and linked respawn types
// (linked_respawn.linkType: creature to creature, creature to object, object to object, object to creature).
const (
	acTypeCreature   = 0
	acTypeGameObject = 1
)

// AzerothCore's formation flags (creature_formations.groupAI, GroupAIFlags).
const (
	acAssistEachOther = 0x003 // the members help the leader and the leader the members
	acEvadeTogether   = 0x004
	acFollowLeader    = 0x200
)

// acGroupAI turns a formation's VMaNGOS flags (creature_groups.flags) into AzerothCore's, and says what
// of them it has no flag for.
func acGroupAI(vm int) (int, []string) {
	out := 0
	if vm&FormationMove != 0 {
		out |= acFollowLeader
	}
	if vm&FormationAggro != 0 {
		out |= acAssistEachOther
	}
	if vm&0x004 != 0 { // OPTION_EVADE_TOGETHER
		out |= acEvadeTogether
	}
	var skipped []string
	if vm&0x008 != 0 { // OPTION_RESPAWN_TOGETHER
		skipped = append(skipped, "its formation's respawning together; AzerothCore's formations have no such flag")
	}
	return out, skipped
}

// acDeleteSQL removes a spawn and, first, the rows that name it.
func acDeleteSQL(s Spawn) []string {
	g := acGUID(s.GUID)
	table, links, kind := "gameobject", acObjectLinks, acTypeGameObject
	if s.Kind == Creature {
		table, links, kind = "creature", acCreatureLinks, acTypeCreature
	}
	var out []string
	for _, link := range links {
		out = append(out, fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d;", link, g))
	}
	if s.Kind == Creature {
		out = append(out,
			fmt.Sprintf("DELETE FROM `creature_movement_override` WHERE `SpawnId` = %d;", g),
			fmt.Sprintf("DELETE FROM `creature_sparring` WHERE `GUID` = %d;", g),
			// A deleted leader takes its formation with it.
			fmt.Sprintf("DELETE FROM `creature_formations` WHERE `leaderGUID` = %d OR `memberGUID` = %d;", g, g),
			fmt.Sprintf("DELETE FROM `waypoint_data` WHERE `id` = %d;", acPath(s.GUID)),
			fmt.Sprintf("DELETE FROM `linked_respawn` WHERE (`guid` = %d AND `linkType` IN (0, 1)) OR (`linkedGuid` = %d AND `linkType` IN (0, 3));", g, g))
	} else {
		out = append(out, fmt.Sprintf("DELETE FROM `linked_respawn` WHERE (`guid` = %d AND `linkType` IN (2, 3)) OR (`linkedGuid` = %d AND `linkType` IN (1, 2));", g, g))
	}
	out = append(out,
		fmt.Sprintf("DELETE FROM `smart_scripts` WHERE `entryorguid` = %d AND `source_type` = %d;", -g, kind),
		fmt.Sprintf("DELETE FROM `spawn_group` WHERE `spawnType` = %d AND `spawnId` = %d;", kind, g),
		fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d;", table, g))
	return out
}

// acInsertSQL adds a spawn, respawning after secs seconds, with rotation q (game objects) and equipment
// equip (creatures; SQL, a number or @meld_equip).
func acInsertSQL(s Spawn, secs int, q [4]float64, equip string) string {
	g := acGUID(s.GUID)
	if s.Kind == Creature {
		return fmt.Sprintf("INSERT INTO `creature` (`guid`, `id1`, `map`, `spawnMask`, `phaseMask`, `equipment_id`, `position_x`, `position_y`, `position_z`, `orientation`, "+
			"`spawntimesecs`, `wander_distance`, `MovementType`, `Comment`) VALUES (%d, %d, %d, 1, 1, %s, %s, %s, %s, %s, %d, %s, %d, %s);",
			g, s.Entry, s.Map, equip, num(s.X), num(s.Y), num(s.Z), num(s.O), secs, num(max(s.WanderDistance, 0)), max(s.MovementType, 0), sqlQuote("Meld: "+label(s)))
	}
	return fmt.Sprintf("INSERT INTO `gameobject` (`guid`, `id`, `map`, `spawnMask`, `phaseMask`, `position_x`, `position_y`, `position_z`, `orientation`, "+
		"`rotation0`, `rotation1`, `rotation2`, `rotation3`, `spawntimesecs`, `animprogress`, `state`, `Comment`) VALUES (%d, %d, %d, 1, 1, %s, %s, %s, %s, %s, %s, %s, %s, %d, 100, 1, %s);",
		g, s.Entry, s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), num(q[0]), num(q[1]), num(q[2]), num(q[3]), secs, sqlQuote("Meld: "+label(s)))
}

// acUpdateSQL moves a spawn and sets its respawn, its movement (creatures; and its equipment when
// equip isn't empty) or its entry and rotation (game objects, which can be turned into another, #136).
func acUpdateSQL(s Spawn, secs int, q [4]float64, equip string) string {
	g := acGUID(s.GUID)
	if s.Kind == Creature {
		set := ""
		if equip != "" {
			set = ", `equipment_id` = " + equip
		}
		return fmt.Sprintf("UPDATE `creature` SET `map` = %d, `position_x` = %s, `position_y` = %s, `position_z` = %s, `orientation` = %s, "+
			"`spawntimesecs` = %d, `wander_distance` = %s, `MovementType` = %d%s WHERE `guid` = %d;",
			s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), secs, num(max(s.WanderDistance, 0)), max(s.MovementType, 0), set, g)
	}
	return fmt.Sprintf("UPDATE `gameobject` SET `id` = %d, `map` = %d, `position_x` = %s, `position_y` = %s, `position_z` = %s, `orientation` = %s, "+
		"`rotation0` = %s, `rotation1` = %s, `rotation2` = %s, `rotation3` = %s, `spawntimesecs` = %d WHERE `guid` = %d;",
		s.Entry, s.Map, num(s.X), num(s.Y), num(s.Z), num(s.O), num(q[0]), num(q[1]), num(q[2]), num(q[3]), secs, g)
}

// acEquipSQL is a creature's equipment_id as SQL, with the statements that find or make its row first,
// or "" to leave it as it is (a change that kept the equipment, or one whose items are unknown). base
// is what it was: the original, or the defaults for a spawn AzerothCore doesn't have.
func acEquipSQL(s, base Spawn, created bool) ([]string, string, []string) {
	if !created && s.Equipment == base.Equipment {
		return nil, "", nil
	}
	switch {
	case s.Equipment < 0:
		return nil, "1", nil
	case s.Equipment == 0 || (s.EquipItems != nil && *s.EquipItems == [3]int{}):
		return nil, "0", nil
	case s.EquipItems == nil:
		why := []string{fmt.Sprintf("its equipment; the items of equipment %d couldn't be read from the VMaNGOS world database", s.Equipment)}
		if created {
			return nil, "1", why
		}
		return nil, "", why
	}
	items := *s.EquipItems
	var skipped []string
	for _, item := range items {
		if item > vmangosStockItemMax {
			skipped = append(skipped, fmt.Sprintf("its equipment's item %d; it was made in the VMaNGOS world database, so AzerothCore's item_template lacks it or holds another item there", item))
		}
	}
	match := fmt.Sprintf("`CreatureID` = %d AND `ItemID1` = %d AND `ItemID2` = %d AND `ItemID3` = %d", s.Entry, items[0], items[1], items[2])
	return []string{
		// The next ID is read in a derived table, so the INSERT's WHERE can leave out its one row. A
		// creature's equipment_id is a signed TINYINT, hence the 127.
		fmt.Sprintf("INSERT INTO `creature_equip_template` (`CreatureID`, `ID`, `ItemID1`, `ItemID2`, `ItemID3`) SELECT %d, n.i, %d, %d, %d "+
			"FROM (SELECT GREATEST(COALESCE(MAX(`ID`), 0), 1) + 1 AS i FROM `creature_equip_template` WHERE `CreatureID` = %d) n "+
			"WHERE n.i <= 127 AND NOT EXISTS (SELECT 1 FROM `creature_equip_template` WHERE %s);", s.Entry, items[0], items[1], items[2], s.Entry, match),
		fmt.Sprintf("SET @meld_equip = COALESCE((SELECT `ID` FROM `creature_equip_template` WHERE %s ORDER BY `ID` LIMIT 1), 1);", match),
	}, "@meld_equip", skipped
}

// acPathSQL replaces a creature's path (waypoint_data) with its points, and says what of them
// AzerothCore can't take: a wander distance at a point, and the points' scripts.
func acPathSQL(s Spawn) ([]string, []string) {
	id := acPath(s.GUID)
	out := []string{fmt.Sprintf("DELETE FROM `waypoint_data` WHERE `id` = %d;", id)}
	if len(s.Path) == 0 {
		return out, nil
	}
	wander := false
	var scripts []int
	seen := map[int]bool{}
	rows := make([]string, len(s.Path))
	for i, p := range s.Path {
		wander = wander || p.WanderDistance > 0
		if p.ScriptID > 0 && !seen[p.ScriptID] {
			seen[p.ScriptID] = true
			scripts = append(scripts, p.ScriptID)
		}
		facing := "NULL"
		if p.O != 0 {
			facing = num(p.O)
		}
		rows[i] = fmt.Sprintf("(%d, %d, %s, %s, %s, %s, %d, 0)", id, i+1, num(p.X), num(p.Y), num(p.Z), facing, max(p.WaitMs, 0))
	}
	out = append(out, "INSERT INTO `waypoint_data` (`id`, `point`, `position_x`, `position_y`, `position_z`, `orientation`, `delay`, `move_type`) VALUES "+
		strings.Join(rows, ", ")+";")
	var skipped []string
	if wander {
		skipped = append(skipped, "its waypoints' wander distances; AzerothCore's waypoint_data has none")
	}
	if len(scripts) > 0 {
		sort.Ints(scripts)
		ids := make([]string, len(scripts))
		for i, n := range scripts {
			ids[i] = strconv.Itoa(n)
		}
		skipped = append(skipped, fmt.Sprintf("its waypoints' VMaNGOS scripts (%s); Meld doesn't translate them into AzerothCore's waypoint_scripts", strings.Join(ids, ", ")))
	}
	return out, skipped
}

// acAddonSQL writes a creature's addon where its pose changed from base or its path was written
// (path): the row, copied from its template's addon when it has none, then the changed columns.
func acAddonSQL(s, base Spawn, path bool) []string {
	pose := s.StandState != base.StandState || s.SheathState != base.SheathState || s.EmoteState != base.EmoteState
	if !pose && !path {
		return nil
	}
	g := acGUID(s.GUID)
	var set []string
	if path {
		id := 0
		if len(s.Path) > 0 {
			id = acPath(s.GUID)
		}
		set = append(set, fmt.Sprintf("`path_id` = %d", id))
	}
	if pose {
		// The low byte only: bytes1 holds the animation tier and visibility flags above it, bytes2
		// the PvP and pet flags.
		set = append(set, fmt.Sprintf("`bytes1` = (`bytes1` & 4294967040) | %d", min(max(s.StandState, 0), 255)),
			fmt.Sprintf("`bytes2` = (`bytes2` & 4294967040) | %d", min(max(s.SheathState, 0), 255)),
			fmt.Sprintf("`emote` = %d", max(s.EmoteState, 0)))
	}
	cols := "`path_id`, `mount`, `bytes1`, `bytes2`, `emote`, `visibilityDistanceType`, `auras`"
	return []string{
		fmt.Sprintf("INSERT IGNORE INTO `creature_addon` (`guid`, %s) SELECT %d, %s FROM `creature_template_addon` WHERE `entry` = %d;", cols, g, cols, s.Entry),
		fmt.Sprintf("INSERT IGNORE INTO `creature_addon` (`guid`) VALUES (%d);", g),
		fmt.Sprintf("UPDATE `creature_addon` SET %s WHERE `guid` = %d;", strings.Join(set, ", "), g),
	}
}

// acFormationSQL writes a creature's formation (creature_formations) when it changed from was's: its
// row replaced or removed, a leader that stopped leading taking the group's rows with it, and the
// leader's own row, which the server needs to find the group's leader.
func acFormationSQL(s, was Spawn) ([]string, []string) {
	if !formationChanged(s, &was) {
		return nil, nil
	}
	if s.Leader > acMaxGUID || was.Leader > acMaxGUID {
		return nil, []string{"its formation; a guid is past the guids Meld numbers AzerothCore's spawns from"}
	}
	g := acGUID(s.GUID)
	var out []string
	if was.Leader == s.GUID && s.Leader != s.GUID {
		out = append(out, fmt.Sprintf("DELETE FROM `creature_formations` WHERE `leaderGUID` = %d OR `memberGUID` = %d;", g, g))
	} else if s.Leader == 0 {
		out = append(out, fmt.Sprintf("DELETE FROM `creature_formations` WHERE `memberGUID` = %d;", g))
	}
	if s.Leader == 0 {
		return out, nil
	}
	ai, skipped := acGroupAI(s.GroupFlags)
	l := acGUID(s.Leader)
	cols := "`leaderGUID`, `memberGUID`, `dist`, `angle`, `groupAI`, `point_1`, `point_2`"
	// The server keeps a slot only for a member that follows its leader, and drops it with an error
	// in its log otherwise.
	dist, angle := 0.0, 0.0
	if s.Leader != s.GUID && ai&acFollowLeader != 0 {
		dist, angle = max(s.FollowDist, 0), slotAngle(s.FollowAngle)*180/math.Pi
	}
	out = append(out, fmt.Sprintf("REPLACE INTO `creature_formations` (%s) VALUES (%d, %d, %s, %s, %d, 0, 0);", cols, l, g, num(dist), num(angle), ai))
	if s.Leader != s.GUID {
		out = append(out, fmt.Sprintf("INSERT IGNORE INTO `creature_formations` (%s) VALUES (%d, %d, 0, 0, %d, 0, 0);", cols, l, l, ai))
	}
	return out, skipped
}

// acPoolSQL is the SQL for a spawn's pool membership when it changed from orig's (nil for a spawn the
// database doesn't have), under Meld's pool entries, or the reason it can't be written.
func acPoolSQL(s Spawn, orig *Spawn) ([]string, string) {
	var was Spawn
	if orig != nil {
		was = *orig
	}
	if s.Pool == was.Pool && math.Abs(s.PoolChance-was.PoolChance) < 1e-4 {
		return nil, ""
	}
	link := "pool_gameobject"
	if s.Kind == Creature {
		link = "pool_creature"
	}
	if s.Pool == 0 {
		return []string{fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d;", link, acGUID(s.GUID))}, ""
	}
	if s.Pool < 0 || s.Pool > MaxPoolEntry {
		return nil, fmt.Sprintf("its pool %d, which the database can't hold (1 to %d)", s.Pool, MaxPoolEntry)
	}
	chance := math.Min(math.Max(s.PoolChance, 0), 100)
	return []string{fmt.Sprintf("INSERT INTO `%s` (`guid`, `pool_entry`, `chance`, `description`) VALUES (%d, %d, %s, %s) "+
		"ON DUPLICATE KEY UPDATE `pool_entry` = VALUES(`pool_entry`), `chance` = VALUES(`chance`);", link, acGUID(s.GUID), acPool(s.Pool), num(chance), sqlQuote(poolDescription(s)))}, ""
}

// acMotherSQL puts spawn s's pool into its mother pool (pool_pool), or takes it out of the one it had,
// as motherSQL does under Meld's pool entries.
func acMotherSQL(s Spawn) ([]string, string) {
	head := fmt.Sprintf("-- Master pool of pool %d", s.Pool)
	if s.MotherPool == 0 {
		return []string{head, fmt.Sprintf("DELETE FROM `pool_pool` WHERE `pool_id` = %d;", acPool(s.Pool))}, ""
	}
	if s.MotherPool < 0 || s.MotherPool > MaxPoolEntry {
		return nil, fmt.Sprintf("its master pool %d, which the database can't hold (1 to %d)", s.MotherPool, MaxPoolEntry)
	}
	if s.MotherPool == s.Pool {
		return nil, "its master pool is the pool itself"
	}
	return []string{head, fmt.Sprintf("INSERT INTO `pool_pool` (`pool_id`, `mother_pool`, `chance`, `description`) VALUES (%d, %d, 0, %s) "+
		"ON DUPLICATE KEY UPDATE `mother_pool` = VALUES(`mother_pool`);", acPool(s.Pool), acPool(s.MotherPool), sqlQuote(poolDescription(s)))}, ""
}

// acPoolTemplateSQL makes pool p's pool_template row with description desc (SQL) when it has none,
// then sets its limit, and its description too when named is set. A mother pool keeps its own
// description, but needs a row: AzerothCore drops a pool_pool row whose mother pool has none.
func acPoolTemplateSQL(p, limit int, desc string, named bool) []string {
	set := ""
	if named {
		set = ", `description` = " + desc
	}
	return []string{
		fmt.Sprintf("INSERT INTO `pool_template` (`entry`, `max_limit`, `description`) SELECT %d, %d, %s FROM DUAL "+
			"WHERE NOT EXISTS (SELECT 1 FROM `pool_template` WHERE `entry` = %d);", acPool(p), max(limit, 0), desc, acPool(p)),
		fmt.Sprintf("UPDATE `pool_template` SET `max_limit` = %d%s WHERE `entry` = %d;", max(limit, 0), set, acPool(p)),
	}
}

// azerothcoreSQL is ExportSQLFor for AzerothCore: the same edits in AzerothCore's tables, under Meld's
// own guids and pool entries there. Running it twice gives the same result.
func azerothcoreSQL(edits []Edit, now time.Time) Result {
	sorted := append([]Edit(nil), edits...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Spawn.GUID < sorted[j].Spawn.GUID })

	var out []string
	var res Result
	poolRows := map[int]Spawn{}
	var poolOrder []int
	motherRows, motherLimits := map[int]Spawn{}, map[int]int{}
	var motherOrder, limitOrder []int
	var cur *SpawnChange
	from := 0
	flush := func() {
		if cur != nil {
			cur.SQL = strings.Join(out[from:], "\n")
			res.Spawns = append(res.Spawns, *cur)
			cur = nil
		}
	}
	begin := func(s Spawn, action string, fields []string) {
		cur = &SpawnChange{GUID: s.GUID, Entry: s.Entry, Name: s.Name, Object: s.Kind == GameObject, Action: action, Fields: fields}
		from = len(out)
	}
	skip := func(name string, why []string) {
		for _, w := range why {
			res.Skipped = append(res.Skipped, name+": "+w)
		}
	}
	for _, e := range sorted {
		flush()
		s := e.Spawn
		name := label(s)
		if s.Map > MaxGameMap || s.GUID <= 0 {
			res.Skipped = append(res.Skipped, name+": not on a map the server has")
			continue
		}
		if s.GUID > acMaxGUID {
			res.Skipped = append(res.Skipped, fmt.Sprintf("%s: its guid is past %d, the last Meld numbers AzerothCore's spawns from", name, acMaxGUID))
			continue
		}
		if e.Deleted {
			if e.Created {
				continue
			}
			begin(s, "delete", nil)
			out = append(out, "-- Delete "+name)
			out = append(out, acDeleteSQL(s)...)
			res.Deleted++
			continue
		}

		// What the spawn was: the database's row, or for a spawn AzerothCore doesn't have, the defaults.
		base := Spawn{Equipment: -1, SheathState: 1}
		if e.Original != nil && !e.Created {
			base = *e.Original
		}
		entryChanged := e.Original != nil && e.Original.Entry != s.Entry
		if e.Original != nil && !entryChanged && math.Abs(e.Original.Scale-s.Scale) > 1e-3 {
			skip(name, []string{fmt.Sprintf("its scale (%s); AzerothCore takes scale from the template", num(s.Scale))})
		}
		q := quaternion(s)
		lo, hi := respawn(s)
		if hi > lo && (e.Created || e.Original == nil || !sameRespawn(*e.Original, lo, hi)) {
			skip(name, []string{fmt.Sprintf("its respawn range (%d to %d seconds); AzerothCore has one respawn time, so %d", lo, hi, lo)})
		}
		var pre []string
		equip := ""
		if s.Kind == Creature {
			var why []string
			pre, equip, why = acEquipSQL(s, base, e.Created)
			skip(name, why)
			if s.Display != base.Display {
				skip(name, []string{fmt.Sprintf("its display (%d); AzerothCore's spawns take the template's model", s.Display)})
			}
		}
		if e.Created {
			begin(s, "add", nil)
			out = append(out, "-- Add "+name)
			// Only a row of this entry goes, the spawn's own earlier export, so a guid taken since
			// fails the INSERT on its key instead of losing that spawn (#199).
			col, ids := "id", strconv.Itoa(s.Entry)
			if s.Kind == Creature {
				col = "id1"
			}
			if entryChanged {
				ids = fmt.Sprintf("%d, %d", e.Original.Entry, s.Entry)
			}
			table := "gameobject"
			if s.Kind == Creature {
				table = "creature"
			}
			out = append(out, fmt.Sprintf("DELETE FROM `%s` WHERE `guid` = %d AND `%s` IN (%s);", table, acGUID(s.GUID), col, ids))
			out = append(out, pre...)
			out = append(out, acInsertSQL(s, lo, q, equip))
			res.Added++
		} else {
			begin(s, "change", spawnFields(s, e.Original))
			out = append(out, "-- Change "+name)
			out = append(out, pre...)
			out = append(out, acUpdateSQL(s, lo, q, equip))
			res.Changed++
		}

		if s.Kind == Creature {
			path := !samePath(s.Path, base.Path) || (e.Created && len(s.Path) > 0)
			if path {
				lines, why := acPathSQL(s)
				out = append(out, lines...)
				skip(name, why)
			}
			out = append(out, acAddonSQL(s, base, path)...)
			lines, why := acFormationSQL(s, base)
			out = append(out, lines...)
			skip(name, why)
		}

		orig := e.Original
		if e.Created {
			orig = nil
		}
		lines, why := acPoolSQL(s, orig)
		out = append(out, lines...)
		if why != "" {
			skip(name, []string{why})
		} else if s.Pool != 0 && (orig == nil || orig.Pool != s.Pool || orig.PoolLimit != s.PoolLimit || orig.PoolName != s.PoolName) {
			if _, seen := poolRows[s.Pool]; !seen {
				poolOrder = append(poolOrder, s.Pool)
			}
			poolRows[s.Pool] = s
		}
		if why == "" && s.Pool != 0 && (orig == nil || orig.MotherPool != s.MotherPool) {
			if _, seen := motherRows[s.Pool]; !seen {
				motherOrder = append(motherOrder, s.Pool)
			}
			motherRows[s.Pool] = s
		}
		if s.MotherPool != 0 && s.MotherPool != s.Pool && (orig == nil || orig.MotherPool != s.MotherPool || orig.MotherLimit != s.MotherLimit) {
			if _, seen := motherLimits[s.MotherPool]; !seen {
				limitOrder = append(limitOrder, s.MotherPool)
			}
			motherLimits[s.MotherPool] = s.MotherLimit
		}
	}
	flush()

	for _, p := range poolOrder {
		s := poolRows[p]
		out = append(out, fmt.Sprintf("-- Pool %d", p))
		out = append(out, acPoolTemplateSQL(p, s.PoolLimit, sqlQuote(poolDescription(s)), true)...)
	}
	for _, p := range motherOrder {
		lines, why := acMotherSQL(motherRows[p])
		out = append(out, lines...)
		if why != "" {
			res.Skipped = append(res.Skipped, fmt.Sprintf("Pool %d: %s", p, why))
		}
	}
	for _, m := range limitOrder {
		if m < 1 || m > MaxPoolEntry {
			continue
		}
		out = append(out, fmt.Sprintf("-- Master pool %d", m))
		out = append(out, acPoolTemplateSQL(m, motherLimits[m], sqlQuote(fmt.Sprintf("Meld pool %d", m)), false)...)
	}

	header := []string{
		"-- Meld spawn edits for an AzerothCore world database (`acore_world`).",
		fmt.Sprintf("-- Exported %s: %d added, %d changed, %d deleted.", now.UTC().Format(time.RFC3339), res.Added, res.Changed, res.Deleted),
		"-- Import it into the world database, then restart the world server (worldserver).",
		"-- The world tables keep no undo: to go back, restore the world database from its dump.",
		fmt.Sprintf("-- Meld's spawns are numbered %d plus the editor's guid, and its pools %d plus the editor's pool, clear of AzerothCore's own;", acGUIDBase, acPoolBase),
		"-- so a change to a spawn of the VMaNGOS database changes only what Meld exported of it before, never AzerothCore's own copy.",
		"-- The entries (creature and game object templates, items) are the VMaNGOS database's. A path is waypoint_data under ten times the guid.",
		"-- zoneId and areaId are left 0: Calculate.Creature.Zone.Area.Data and Calculate.Gameoject.Zone.Area.Data in worldserver.conf fill them.",
	}
	if len(res.Skipped) > 0 {
		header = append(header, "--", "-- Not exported:")
		for _, s := range res.Skipped {
			header = append(header, "--   "+strings.NewReplacer("\r", " ", "\n", " ").Replace(s))
		}
	}
	res.SQL = strings.Join(append(append(header, ""), append(out, "")...), "\n")
	return res
}

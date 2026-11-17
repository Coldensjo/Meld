package vmangos

import (
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/adt"
)

// The editor's world database for a 3.3.5a client is an AzerothCore server's acore_world (phase 4 of the
// WotLK work): its spawns show in the region, its creature and game object templates in the asset browser
// and the Place tool. VMaNGOS's readers cannot serve it, since nearly every spawn table differs (see
// azerothcore.go for the write side's notes). What the readers here take from AzerothCore's tables:
//   - creature names its template in id; a template's displays are creature_template_model rows (Idx 0
//     to 3, the lowest shown) with their DisplayScale, which is all the scale a creature has (the
//     template's own scale column is gone, update 2026_03_22_03). A game object's scale is its
//     template's size.
//   - one respawn time (spawntimesecs), which the editor's range gets as both ends.
//   - a spawn's pose is its creature_addon, else its template's creature_template_addon: the stand
//     state in bytes1's low byte, the sheath state in bytes2's, the looping emote in emote.
//   - its path is waypoint_data under the addon's path_id (its own, or the template's for a creature
//     that walks waypoints without its own), with a NULL facing for none and no wander distance.
//   - equipment_id picks the creature_equip_template row of the spawn's entry by its ID (1 the
//     template's own, 0 none, -1 a random one of the entry's rows). The editor numbers an equipment by
//     its items instead (acEquipKey), as no ID of AzerothCore's names one across entries, and the save
//     finds or makes the entry's row holding them (acEquipSQL).
//   - formations are creature_formations, with the angle in degrees and AzerothCore's groupAI flags;
//     pools are pool_creature, pool_gameobject, pool_template and pool_pool, events
//     game_event_creature and game_event_gameobject, all without VMaNGOS's patch columns.
//
// AzerothCore's own source (ObjectMgr.cpp, CreatureGroups.cpp) is GPL: its behaviour is described here,
// none of its code is copied.

// acWorldDB is the connection of an AzerothCore server's world database: worldserver.conf's
// WorldDatabaseInfo, "host;port;user;password;database".
func acWorldDB(s AzerothCoreServer) (worldDB, error) {
	if s.Conf == "" {
		return worldDB{}, errors.New("the AzerothCore server folder has no worldserver.conf")
	}
	db, err := readConfDatabase(s.Conf, "WorldDatabaseInfo")
	if err != nil {
		return worldDB{}, fmt.Errorf("%s has no WorldDatabaseInfo", s.Conf)
	}
	return db, nil
}

// acDatabase is the AzerothCore world database, once it answers. Meld never starts it: it is the
// machine's own MySQL service.
func acDatabase(s AzerothCoreServer) (worldDB, error) {
	db, err := acWorldDB(s)
	if err != nil {
		return db, err
	}
	if _, err := runSQL(db, "SELECT 1"); err != nil {
		if cantConnect(err) {
			return db, fmt.Errorf("the AzerothCore world database at %s:%s does not answer: start its MySQL server (Meld does not start it): %w", db.host, db.port, err)
		}
		return db, err
	}
	return db, nil
}

// ACWorldCheck says whether the AzerothCore server's world database answers, for the status line.
func ACWorldCheck(s AzerothCoreServer) error {
	_, err := acDatabase(s)
	return err
}

// acCreatureSpawnsSQL selects a region's creatures in the 29 columns parseSpawnRows reads, where is the
// bounds on c. Their own display stays 0 (AzerothCore's spawns take the template's model), the equipment
// column is equipment_id as it is (acDressEquipment turns it into the editor's), and the last four are 0.
func acCreatureSpawnsSQL(where string) string {
	return "SELECT c.`guid`, c.`id`, t.`name`, COALESCE(t.`subname`, ''), t.`minlevel`, t.`maxlevel`, t.`faction`, t.`npcflag`, t.`rank`, t.`type`, " +
		"c.`position_x`, c.`position_y`, c.`position_z`, c.`orientation`, c.`spawntimesecs`, COALESCE(m.`CreatureDisplayID`, 0), COALESCE(m.`DisplayScale`, 1), 0, c.`equipment_id`, " +
		"COALESCE(a.`bytes1`, ta.`bytes1`, 0) & 255, COALESCE(a.`emote`, ta.`emote`, 0), COALESCE(a.`bytes2`, ta.`bytes2`, 1) & 255, c.`MovementType`, c.`wander_distance`, c.`spawntimesecs`, 0, 0, 0, 0 " +
		"FROM `creature` c JOIN `creature_template` t ON t.`entry` = c.`id` " +
		"LEFT JOIN `creature_template_model` m ON m.`CreatureID` = c.`id` AND m.`Idx` = (SELECT MIN(`Idx`) FROM `creature_template_model` WHERE `CreatureID` = c.`id`) " +
		"LEFT JOIN `creature_addon` a ON a.`guid` = c.`guid` LEFT JOIN `creature_template_addon` ta ON ta.`entry` = c.`id` WHERE " + where
}

// acObjectSpawnsSQL selects a region's game objects in parseSpawnRows' columns, where is the bounds on g.
func acObjectSpawnsSQL(where string) string {
	return "SELECT g.`guid`, g.`id`, gt.`name`, '', 0, 0, 0, 0, 0, gt.`type`, g.`position_x`, g.`position_y`, g.`position_z`, g.`orientation`, g.`spawntimesecs`, " +
		"gt.`displayId`, gt.`size`, 0, 0, 0, 0, 0, 0, 0, g.`spawntimesecs`, g.`rotation0`, g.`rotation1`, g.`rotation2`, g.`rotation3` " +
		"FROM `gameobject` g JOIN `gameobject_template` gt ON gt.`entry` = g.`id` WHERE " + where
}

// acBounds is the SQL condition (on alias p) for the spawns of map mapID in the block of size tiles at
// (x, y).
func acBounds(p string, mapID, x, y, size int) string {
	side := float64(size) * adt.TileSize
	xLo, yLo := adt.ToServer(side, side, x, y)
	xHi, yHi := adt.ToServer(0, 0, x, y)
	return fmt.Sprintf("%s.`map` = %d AND %s.`position_x` BETWEEN %f AND %f AND %s.`position_y` BETWEEN %f AND %f", p, mapID, p, xLo, xHi, p, yLo, yHi)
}

// ReadACSpawns is ReadSpawns for an AzerothCore world database: the creatures and game objects it places
// in the block of size tiles at (x, y) of the named map, whose ID the client's Map.dbc gives.
func ReadACSpawns(s AzerothCoreServer, dataDir, mapName string, x, y, size int) ([]WorldSpawn, error) {
	if err := checkRegion(x, y, size); err != nil {
		return nil, err
	}
	id, ok := ClientMapID(dataDir, mapName)
	if !ok {
		return nil, errors.New("the client has no map " + mapName)
	}
	db, err := acDatabase(s)
	if err != nil {
		return nil, err
	}
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	return readACSpawns(db, tables, int(id), x, y, size)
}

// readACSpawns is ReadACSpawns once the database answers and the client's tables are read.
func readACSpawns(db worldDB, tables *modelTables, mapID, x, y, size int) ([]WorldSpawn, error) {
	var rows []spawnRow
	for _, q := range []struct {
		sql  string
		kind string
	}{{acCreatureSpawnsSQL(acBounds("c", mapID, x, y, size)), "creature"}, {acObjectSpawnsSQL(acBounds("g", mapID, x, y, size)), "object"}} {
		raw, err := runSQL(db, q.sql)
		if err != nil {
			return nil, err
		}
		got, err := parseSpawnRows(raw, q.kind)
		if err != nil {
			return nil, err
		}
		rows = append(rows, got...)
	}
	weapons, err := acDressEquipment(db, rows)
	if err != nil {
		return nil, err
	}
	out := make([]WorldSpawn, len(rows))
	for i, r := range rows {
		out[i] = regionSpawn(r, x, y, tables, weapons[i])
	}
	if err := acReadWaypoints(db, out, x, y); err != nil {
		return nil, err
	}
	if err := acReadEvents(db, out); err != nil {
		return nil, err
	}
	if err := acReadPools(db, out); err != nil {
		return nil, err
	}
	if err := acReadFormations(db, out); err != nil {
		return nil, err
	}
	return out, nil
}

// acEquipRows are creature_equip_template rows' items, by the entry and the row's ID.
type acEquipRows map[int]map[int][3]int

// acEquipmentRowsSQL lists the equipment rows of the entries in list, in ID order.
func acEquipmentRowsSQL(list string) string {
	return "SELECT `CreatureID`, `ID`, `ItemID1`, `ItemID2`, `ItemID3` FROM `creature_equip_template` WHERE `CreatureID` IN (" + list + ") ORDER BY `CreatureID`, `ID`"
}

// readACEquipRows reads the equipment rows of entries.
func readACEquipRows(db worldDB, entries map[int]bool) (acEquipRows, error) {
	out := acEquipRows{}
	if len(entries) == 0 {
		return out, nil
	}
	raw, err := runSQL(db, acEquipmentRowsSQL(intList(entries)))
	if err != nil {
		return nil, err
	}
	for _, f := range batchRows(raw, 5) {
		n, ok := atoiAll(f)
		if !ok {
			continue
		}
		if out[n[0]] == nil {
			out[n[0]] = map[int][3]int{}
		}
		out[n[0]][n[1]] = [3]int{n[2], n[3], n[4]}
	}
	return out, nil
}

// items are the items equipment_id id gives entry: its row, the first row for -1 (the server picks one
// at random), none for 0 or a row the entry lacks.
func (r acEquipRows) items(entry, id int) [3]int {
	rows := r[entry]
	if id == -1 {
		first := math.MaxInt
		for k := range rows {
			first = min(first, k)
		}
		id = first
	}
	return rows[id]
}

// acDressEquipment turns the creature rows' equipment_id into the editor's equipment (acEquipKey of its
// items, 0 for none) and returns the items each row holds, by row, with their displays from
// item_template. A spawn whose equipment is not its entry's usual one (row 1, or none for an entry without
// rows) has its own equipment.
func acDressEquipment(db worldDB, rows []spawnRow) ([][3]heldItem, error) {
	out := make([][3]heldItem, len(rows))
	entries := map[int]bool{}
	for _, r := range rows {
		if r.Kind != KindObject {
			entries[r.Entry] = true
		}
	}
	equip, err := readACEquipRows(db, entries)
	if err != nil {
		return nil, err
	}
	itemIDs := map[int]bool{}
	for i := range rows {
		r := &rows[i]
		if r.Kind == KindObject {
			continue
		}
		usual := 0
		if _, ok := equip[r.Entry][1]; ok {
			usual = 1
		}
		items := equip.items(r.Entry, r.Equipment)
		r.OwnEquipment = r.Equipment != usual
		r.Equipment = rememberACEquip(items)
		for k, it := range items {
			out[i][k].entry = it
			if it > 0 {
				itemIDs[it] = true
			}
		}
	}
	held, err := acHeldItems(db, itemIDs)
	if err != nil {
		return nil, err
	}
	for i := range out {
		for k := range out[i] {
			if h, ok := held[out[i][k].entry]; ok {
				out[i][k] = h
			}
		}
	}
	return out, nil
}

// acHeldItems are the displays and inventory types of items, from AzerothCore's item_template.
func acHeldItems(db worldDB, ids map[int]bool) (map[int]heldItem, error) {
	out := map[int]heldItem{}
	if len(ids) == 0 {
		return out, nil
	}
	raw, err := runSQL(db, "SELECT `entry`, `displayid`, `InventoryType` FROM `item_template` WHERE `entry` IN ("+intList(ids)+")")
	if err != nil {
		return nil, err
	}
	for _, f := range batchRows(raw, 3) {
		if n, ok := atoiAll(f); ok {
			out[n[0]] = heldItem{entry: n[0], display: uint32(max(n[1], 0)), invType: n[2]}
		}
	}
	return out, nil
}

// The editor's equipment for an AzerothCore creature is a number for its items (main hand, off hand,
// ranged): acEquipKey, the same for the same items whichever entry holds them, never 0 (no items) or -1.
// The numbers seen are remembered, so the bindings that take an equipment (its items, its displays, a
// look) can turn one back into its items; the save takes the spawn's items as the editor sends them.
var (
	acEquipMu    sync.Mutex
	acEquipItems = map[int][3]int{}
)

// acEquipKey numbers items: FNV-1a over them, in 1 to 2^30.
func acEquipKey(items [3]int) int {
	if items == [3]int{} {
		return 0
	}
	h := fnv.New32a()
	for _, it := range items {
		v := uint32(it)
		_, _ = h.Write([]byte{byte(v), byte(v >> 8), byte(v >> 16), byte(v >> 24)})
	}
	return int(h.Sum32()&(1<<30-1)) + 1
}

// rememberACEquip is acEquipKey of items, remembered for ACEquipmentItems.
func rememberACEquip(items [3]int) int {
	k := acEquipKey(items)
	if k != 0 {
		acEquipMu.Lock()
		acEquipItems[k] = items
		acEquipMu.Unlock()
	}
	return k
}

// ACEquipmentFor is EquipmentFor for an AzerothCore database: the editor's number for items. Nothing is
// written: the save finds or makes the spawn's entry's row holding them.
func ACEquipmentFor(items [3]int) int { return rememberACEquip(items) }

// ACEquipmentItems are the items of the editor's equipment number k, none for one never seen.
func ACEquipmentItems(k int) [3]int {
	acEquipMu.Lock()
	defer acEquipMu.Unlock()
	return acEquipItems[k]
}

// ACEquipmentDisplays is EquipmentDisplays for an AzerothCore database: the displays of the items of each
// equipment number in keys. A number never seen is left out.
func ACEquipmentDisplays(s AzerothCoreServer, keys []int) (map[int][3]int, error) {
	out := map[int][3]int{}
	items := map[int][3]int{}
	ids := map[int]bool{}
	for _, k := range keys {
		acEquipMu.Lock()
		it, ok := acEquipItems[k]
		acEquipMu.Unlock()
		if !ok {
			continue
		}
		items[k] = it
		for _, e := range it {
			if e > 0 {
				ids[e] = true
			}
		}
	}
	if len(items) == 0 {
		return out, nil
	}
	db, err := acDatabase(s)
	if err != nil {
		return nil, err
	}
	held, err := acHeldItems(db, ids)
	if err != nil {
		return nil, err
	}
	for k, it := range items {
		var d [3]int
		for i, e := range it {
			d[i] = int(held[e].display)
		}
		out[k] = d
	}
	return out, nil
}

// ACCreatureLook is CreatureLook for an AzerothCore database: a display dressed in the items of
// equipment number equipment and a pose.
func ACCreatureLook(s AzerothCoreServer, dataDir string, display, equipment, stand, emote, sheath int) (LookResult, error) {
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return LookResult{}, err
	}
	var weapons [3]heldItem
	if items := ACEquipmentItems(equipment); items != [3]int{} {
		db, err := acDatabase(s)
		if err != nil {
			return LookResult{}, err
		}
		ids := map[int]bool{}
		for _, e := range items {
			if e > 0 {
				ids[e] = true
			}
		}
		held, err := acHeldItems(db, ids)
		if err != nil {
			return LookResult{}, err
		}
		for k, e := range items {
			weapons[k] = held[e]
			weapons[k].entry = e
		}
	}
	d := tables.creatureLook(uint32(max(display, 0)), gear{weapons: weapons, sheath: sheath, stand: stand, emote: emote})
	anim := d.look.Anim
	d.look.Anim = 0
	return LookResult{Model: d.model, Look: d.look.Query(), Anim: anim, DisplayScale: d.scale}, nil
}

// acPathsSQL lists the paths (waypoint_data) the addons in table (creature_addon by guid or
// creature_template_addon by entry) name for the owners in list: owner, point, x, y, z, facing (0 for
// none), delay, then 0 for the script and the wander distance, which AzerothCore's points lack.
func acPathsSQL(table, owner, list string) string {
	return fmt.Sprintf("SELECT a.`%s`, w.`point`, w.`position_x`, w.`position_y`, w.`position_z`, COALESCE(w.`orientation`, 0), w.`delay`, 0, 0 "+
		"FROM `%s` a JOIN `waypoint_data` w ON w.`id` = a.`path_id` WHERE a.`%s` IN (%s) AND a.`path_id` <> 0 ORDER BY a.`%s`, w.`point`", owner, table, owner, list, owner)
}

// acReadWaypoints gives the region's creatures their paths: the one each one's addon names, else for
// one that walks waypoints its template's addon's (PathFromTemplate).
func acReadWaypoints(db worldDB, spawns []WorldSpawn, x, y int) error {
	guids := map[int]bool{}
	for _, s := range spawns {
		if s.Kind != KindObject {
			guids[s.GUID] = true
		}
	}
	if len(guids) == 0 {
		return nil
	}
	raw, err := runSQL(db, acPathsSQL("creature_addon", "guid", intList(guids)))
	if err != nil {
		return err
	}
	own := parseWaypoints(raw, x, y)
	entries := map[int]bool{}
	for i := range spawns {
		s := &spawns[i]
		if s.Kind == KindObject {
			continue
		}
		if p, ok := own[s.GUID]; ok {
			s.Waypoints = p
		} else if s.MovementType == 2 {
			entries[s.Entry] = true
		}
	}
	if len(entries) == 0 {
		return nil
	}
	raw, err = runSQL(db, acPathsSQL("creature_template_addon", "entry", intList(entries)))
	if err != nil {
		return err
	}
	shared := parseWaypoints(raw, x, y)
	for i := range spawns {
		s := &spawns[i]
		if s.Kind != KindObject && s.Waypoints == nil && s.MovementType == 2 {
			if p, ok := shared[s.Entry]; ok {
				s.Waypoints = append([]Waypoint(nil), p...)
				s.PathFromTemplate = true
			}
		}
	}
	return nil
}

// byKind splits the spawns' guids into creatures and game objects.
func byKind(spawns []WorldSpawn) (creatures, objects map[int]bool) {
	creatures, objects = map[int]bool{}, map[int]bool{}
	for _, s := range spawns {
		if s.Kind == KindObject {
			objects[s.GUID] = true
		} else {
			creatures[s.GUID] = true
		}
	}
	return creatures, objects
}

// acReadEvents gives each spawn its events (game_event_creature, game_event_gameobject), as
// readSpawnEvents does.
func acReadEvents(db worldDB, spawns []WorldSpawn) error {
	creatures, objects := byKind(spawns)
	for _, q := range []struct {
		table string
		guids map[int]bool
		obj   bool
	}{{"game_event_creature", creatures, false}, {"game_event_gameobject", objects, true}} {
		if len(q.guids) == 0 {
			continue
		}
		raw, err := runSQL(db, fmt.Sprintf("SELECT `guid`, `eventEntry` FROM `%s` WHERE `guid` IN (%s) ORDER BY `guid`, `eventEntry`", q.table, intList(q.guids)))
		if err != nil {
			return err
		}
		events := parseSpawnEvents(raw)
		for i := range spawns {
			s := &spawns[i]
			if (s.Kind == KindObject) == q.obj {
				s.Events = events[s.GUID]
			}
		}
	}
	return nil
}

// acPoolsSQL is poolsSQL for AzerothCore's tables, which have no patch columns.
func acPoolsSQL(table, list string) string {
	return fmt.Sprintf("SELECT p.`guid`, p.`pool_entry`, COALESCE(t.`max_limit`, 0), COALESCE(NULLIF(t.`description`, ''), p.`description`, ''), p.`chance` "+
		"FROM `%s` p LEFT JOIN `pool_template` t ON t.`entry` = p.`pool_entry` WHERE p.`guid` IN (%s) ORDER BY p.`guid`", table, list)
}

// acMothersSQL is mothersSQL for AzerothCore's tables.
func acMothersSQL(list string) string {
	return fmt.Sprintf("SELECT pp.`pool_id`, pp.`mother_pool`, COALESCE(t.`max_limit`, 0), COALESCE(NULLIF(t.`description`, ''), pp.`description`, ''), "+
		"(SELECT COUNT(*) FROM `pool_pool` c WHERE c.`mother_pool` = pp.`mother_pool`) "+
		"FROM `pool_pool` pp LEFT JOIN `pool_template` t ON t.`entry` = pp.`mother_pool` WHERE pp.`pool_id` IN (%s) ORDER BY pp.`pool_id`", list)
}

// acReadPools gives each spawn its pool, the pool's members elsewhere and its mother pool, as
// readSpawnPools does.
func acReadPools(db worldDB, spawns []WorldSpawn) error {
	creatures, objects := byKind(spawns)
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
		raw, err := runSQL(db, acPoolsSQL(q.table, guids))
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
		raw, err = runSQL(db, fmt.Sprintf("SELECT `pool_entry`, COUNT(*) FROM `%s` WHERE `pool_entry` IN (%s) AND `guid` NOT IN (%s) GROUP BY `pool_entry`", q.table, intList(entries), guids))
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
	raw, err := runSQL(db, acMothersSQL(intList(all)))
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

// vmangosGroupFlags turns AzerothCore's formation flags (groupAI) into the editor's, VMaNGOS's: the
// inverse of acGroupAI.
func vmangosGroupFlags(ai int) int {
	out := 0
	if ai&acFollowLeader != 0 {
		out |= FormationMove
	}
	if ai&acAssistEachOther != 0 {
		out |= FormationAggro
	}
	if ai&acEvadeTogether != 0 {
		out |= 0x004 // OPTION_EVADE_TOGETHER
	}
	return out
}

// acFormationsSQL lists the creature_formations rows of the guids in list, as members or as leaders.
func acFormationsSQL(list string) string {
	return fmt.Sprintf("SELECT `leaderGUID`, `memberGUID`, `dist`, `angle`, `groupAI` FROM `creature_formations` "+
		"WHERE `memberGUID` IN (%s) OR `leaderGUID` IN (%s) ORDER BY `leaderGUID`, `memberGUID`", list, list)
}

// acReadFormations gives the region's creatures their formation, as readFormations does: the angle
// from degrees to radians, the flags to the editor's.
func acReadFormations(db worldDB, spawns []WorldSpawn) error {
	guids, _ := byKind(spawns)
	if len(guids) == 0 {
		return nil
	}
	raw, err := runSQL(db, acFormationsSQL(intList(guids)))
	if err != nil {
		return err
	}
	rows := parseFormations(raw)
	byMember := map[int]formationRow{}
	leaders := map[int]bool{}
	for i := range rows {
		r := &rows[i]
		r.angle = float32(slotAngle(float64(r.angle) * math.Pi / 180))
		r.flags = vmangosGroupFlags(r.flags)
		byMember[r.member] = *r
		if r.member != r.leader {
			leaders[r.leader] = true
		}
	}
	for i := range spawns {
		s := &spawns[i]
		if s.Kind == KindObject {
			continue
		}
		if r, ok := byMember[s.GUID]; ok {
			s.Leader, s.FollowDist, s.FollowAngle, s.GroupFlags = r.leader, r.dist, r.angle, r.flags
			if r.leader == s.GUID {
				// The leader's own row holds no slot.
				s.FollowDist, s.FollowAngle = 0, 0
			}
		} else if leaders[s.GUID] {
			s.Leader = s.GUID
			for _, r := range rows {
				if r.leader == s.GUID {
					s.GroupFlags |= r.flags
				}
			}
		}
	}
	return nil
}

// acCreatureTemplateSQL selects the columns parseCreatureTemplates reads from AzerothCore's
// creature_template, for the templates matching where: the first display and its scale come from
// creature_template_model, and the equipment is the template's own row's (row 1), as a number for its
// items that acTemplateEquipment fills in (the column is 0 here).
func acCreatureTemplateSQL(where, tail string) string {
	return "SELECT t.`entry`, t.`name`, COALESCE(t.`subname`, ''), t.`minlevel`, t.`maxlevel`, t.`faction`, t.`npcflag`, t.`rank`, t.`type`, " +
		"COALESCE(m.`CreatureDisplayID`, 0), COALESCE(m.`DisplayScale`, 1), 0 FROM `creature_template` t " +
		"LEFT JOIN `creature_template_model` m ON m.`CreatureID` = t.`entry` AND m.`Idx` = (SELECT MIN(`Idx`) FROM `creature_template_model` WHERE `CreatureID` = t.`entry`) " +
		"WHERE " + where + " " + tail
}

// acTemplateEquipment gives the templates the editor's number for their own equipment (row 1 of
// creature_equip_template), which a spawn placed from one starts with.
func acTemplateEquipment(db worldDB, list []CreatureTemplate) error {
	if len(list) == 0 {
		return nil
	}
	raw, err := runSQL(db, "SELECT `CreatureID`, `ItemID1`, `ItemID2`, `ItemID3` FROM `creature_equip_template` WHERE `ID` = 1")
	if err != nil {
		return err
	}
	own := map[int][3]int{}
	for _, f := range batchRows(raw, 4) {
		if n, ok := atoiAll(f); ok {
			own[n[0]] = [3]int{n[1], n[2], n[3]}
		}
	}
	for i := range list {
		list[i].Equipment = rememberACEquip(own[list[i].Entry])
	}
	return nil
}

var (
	acTemplatesMu    sync.Mutex
	acCreaturesCache = map[string][]CreatureTemplate{}
	acObjectsCache   = map[string][]ObjectTemplate{}
	acWeaponsCache   = map[string][]WeaponEntry{}
)

// ListACCreatureTemplates is ListCreatureTemplates for an AzerothCore database: every creature template,
// dressed in its first display for a thumbnail, by name. Made once per server and client.
func ListACCreatureTemplates(s AzerothCoreServer, dataDir string) ([]CreatureTemplate, error) {
	key := dataDir + "|" + s.Conf
	acTemplatesMu.Lock()
	defer acTemplatesMu.Unlock()
	if c, ok := acCreaturesCache[key]; ok {
		return c, nil
	}
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	db, err := acDatabase(s)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, acCreatureTemplateSQL("1", "ORDER BY t.`name`, t.`entry`"))
	if err != nil {
		return nil, err
	}
	out := parseCreatureTemplates(raw)
	if err := acTemplateEquipment(db, out); err != nil {
		return nil, err
	}
	for i := range out {
		c := &out[i]
		look := tables.creatureLook(uint32(c.Display), gear{sheath: sheathMelee})
		c.Model, c.Look, c.DisplayScale = look.model, look.look.Query(), look.scale
	}
	acCreaturesCache[key] = out
	return out, nil
}

// SearchACCreatures is SearchCreatures for an AzerothCore database.
func SearchACCreatures(s AzerothCoreServer, text string, limit int) ([]CreatureTemplate, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	db, err := acDatabase(s)
	if err != nil {
		return nil, err
	}
	match := "t.`name` LIKE " + likePattern(text)
	if n, err := strconv.Atoi(text); err == nil {
		match = fmt.Sprintf("(%s OR t.`entry` = %d)", match, n)
	}
	raw, err := runSQL(db, acCreatureTemplateSQL(match, fmt.Sprintf("ORDER BY t.`name`, t.`entry` LIMIT %d", max(limit, 1))))
	if err != nil {
		return nil, err
	}
	out := parseCreatureTemplates(raw)
	return out, acTemplateEquipment(db, out)
}

// acObjectTemplatesSQL lists every game object template: entry, name, type, display and size.
const acObjectTemplatesSQL = "SELECT t.`entry`, t.`name`, t.`type`, t.`displayId`, t.`size` FROM `gameobject_template` t ORDER BY t.`name`, t.`entry`"

// ListACObjectTemplates is ListObjectTemplates for an AzerothCore database.
func ListACObjectTemplates(s AzerothCoreServer, dataDir string) ([]ObjectTemplate, error) {
	key := dataDir + "|" + s.Conf
	acTemplatesMu.Lock()
	defer acTemplatesMu.Unlock()
	if o, ok := acObjectsCache[key]; ok {
		return o, nil
	}
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	db, err := acDatabase(s)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, acObjectTemplatesSQL)
	if err != nil {
		return nil, err
	}
	var out []ObjectTemplate
	for _, f := range batchRows(raw, 5) {
		entry, err1 := strconv.Atoi(f[0])
		typ, err2 := strconv.Atoi(f[2])
		display, err3 := strconv.Atoi(f[3])
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		size, _ := strconv.ParseFloat(f[4], 32)
		if size <= 0 {
			size = 1
		}
		out = append(out, ObjectTemplate{Entry: entry, Name: f[1], Type: typ, Display: display, Size: float32(size), Model: tables.objectModel(uint32(max(display, 0)))})
	}
	acObjectsCache[key] = out
	return out, nil
}

// acWeaponsSQL lists the items a creature can hold from AzerothCore's item_template.
const acWeaponsSQL = "SELECT i.`entry`, i.`name`, i.`displayid`, i.`InventoryType`, i.`Quality`, i.`class`, i.`subclass` FROM `item_template` i WHERE i.`InventoryType` IN (" + heldInvTypes + ") ORDER BY i.`entry`"

// ListACWeapons is ListWeapons for an AzerothCore database.
func ListACWeapons(s AzerothCoreServer, dataDir string) ([]WeaponEntry, error) {
	key := dataDir + "|" + s.Conf
	acTemplatesMu.Lock()
	defer acTemplatesMu.Unlock()
	if w, ok := acWeaponsCache[key]; ok {
		return w, nil
	}
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	db, err := acDatabase(s)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, acWeaponsSQL)
	if err != nil {
		return nil, err
	}
	var out []WeaponEntry
	for _, f := range batchRows(raw, 7) {
		entry, err1 := strconv.Atoi(f[0])
		display, err2 := strconv.Atoi(f[2])
		inv, err3 := strconv.Atoi(f[3])
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		e := WeaponEntry{Entry: entry, Name: f[1], Display: display, InvType: inv}
		e.Quality, _ = strconv.Atoi(f[4])
		e.Class, _ = strconv.Atoi(f[5])
		e.Subclass, _ = strconv.Atoi(f[6])
		e.Model, e.Texture = tables.heldItemPaths(heldItem{display: uint32(max(display, 0)), invType: inv})
		out = append(out, e)
	}
	acWeaponsCache[key] = out
	return out, nil
}

// ForgetACTemplates drops the cached AzerothCore lists, when the server folder changes.
func ForgetACTemplates() {
	acTemplatesMu.Lock()
	defer acTemplatesMu.Unlock()
	clear(acCreaturesCache)
	clear(acObjectsCache)
	clear(acWeaponsCache)
}

// acNextGUIDSQL is the next guid for a spawn Meld places in table (creature or gameobject): after the
// highest of Meld's range (acGUIDBase up to the room it leaves the server under acSpawnLimit), from
// acGUIDBase + 1, so placed spawns stay clear of AzerothCore's own guids and of the ones the world server
// numbers after the highest (see azerothcore.go).
func acNextGUIDSQL(table string) string {
	return fmt.Sprintf("SELECT GREATEST(COALESCE(MAX(`guid`), 0), %d) + 1 FROM `%s` WHERE `guid` > %d AND `guid` < %d", acGUIDBase, table, acGUIDBase, acSpawnLimit-acSpawnRoom)
}

// acNext runs a query of one number.
func acNext(s AzerothCoreServer, sql string) (int, error) {
	db, err := acDatabase(s)
	if err != nil {
		return 0, err
	}
	raw, err := runSQL(db, sql)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(raw)))
}

// NextACCreatureGUID is NextCreatureGUID for an AzerothCore database (acNextGUIDSQL).
func NextACCreatureGUID(s AzerothCoreServer) (int, error) {
	return acNext(s, acNextGUIDSQL("creature"))
}

// NextACObjectGUID is NextObjectGUID for an AzerothCore database (acNextGUIDSQL).
func NextACObjectGUID(s AzerothCoreServer) (int, error) {
	return acNext(s, acNextGUIDSQL("gameobject"))
}

// NextACPoolEntry is the first pool entry after Meld's pools in an AzerothCore database (acPoolBase up),
// which no pool of AzerothCore's own reaches.
func NextACPoolEntry(s AzerothCoreServer) (int, error) {
	return acNext(s, fmt.Sprintf("SELECT GREATEST(COALESCE(MAX(`entry`), 0), %d) + 1 FROM `pool_template` WHERE `entry` > %d", acPoolBase, acPoolBase))
}

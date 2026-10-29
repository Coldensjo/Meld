package vmangos

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"Meld/internal/mpq"
)

// The Characters and Accounts tool's Quests, Explored and Flight paths tabs (#881): a character's
// character_queststatus rows, the areas it has uncovered on the world map (characters.explored_zones)
// and the flight masters it knows (characters.known_taxi_mask). As the other tabs (charsheet.go), each
// is changed only while the character is out of the world, and checked as the server reads it at
// login: Player::_LoadQuestStatus (a quest quest_template lacks is skipped, at most 20 quests in the
// log), Player::_LoadIntoDataField for the explored areas (64 numbers or none at all) and
// PlayerTaxi::LoadTaxiMask (8 numbers, a stop with no flight from it dropped).

// The quest statuses (QuestDef.h QuestStatus): 2 (unavailable) and 4 (available) are the server's
// own and never stored for a player.
const (
	questStatusNone       = 0
	questStatusComplete   = 1
	questStatusIncomplete = 3
	questStatusFailed     = 5
)

// maxQuestLog is how many quests the quest log holds (QuestDef.h MAX_QUEST_LOG_SIZE); the server
// leaves out of the log the ones after it.
const maxQuestLog = 20

// questFlagRepeatable is quest_template.SpecialFlags' repeatable bit (QUEST_SPECIAL_FLAG_REPEATABLE).
const questFlagRepeatable = 1

// CharacterQuest is a row of character_queststatus with what quest_template says of the quest:
// Status (0 none, 1 objectives complete, 3 in progress, 5 failed) and Rewarded (turned in: done).
// A quest is in the quest log when its status is 1, 3 or 5 and it is not done, or is repeatable.
// Known is false for a quest quest_template lacks, which the server skips.
type CharacterQuest struct {
	Quest      int    `json:"quest"`
	Title      string `json:"title"`
	Level      int    `json:"level"`
	Status     int    `json:"status"`
	Rewarded   bool   `json:"rewarded"`
	Repeatable bool   `json:"repeatable"`
	// TimeLimit is the quest's time limit in seconds (quest_template.LimitTime), 0 for none.
	TimeLimit int  `json:"timeLimit"`
	Known     bool `json:"known"`
}

// questRow is a stored character_queststatus row's columns after quest and status, as text: rewarded,
// explored, timer, mob_count1-4, item_count1-4 and reward_choice.
type questRow struct {
	status int
	rest   [12]string
}

// questRowColumns are character_queststatus' columns, quest and status first, then questRow's rest.
const questRowColumns = "quest, status, rewarded, explored, timer, mob_count1, mob_count2, mob_count3, mob_count4, item_count1, item_count2, item_count3, item_count4, reward_choice"

// storedQuests reads character guid's character_queststatus rows by quest, and their order (the
// order the server fills the quest log in).
func storedQuests(db worldDB, guid int) (map[int]questRow, []int, error) {
	raw, err := runSQL(db, fmt.Sprintf("SELECT %s FROM character_queststatus WHERE guid = %d", questRowColumns, guid))
	if err != nil {
		return nil, nil, err
	}
	rows := map[int]questRow{}
	var order []int
	for _, f := range batchRows(raw, 14) {
		r := questRow{status: f.num(1)}
		copy(r.rest[:], f[2:])
		rows[f.num(0)] = r
		order = append(order, f.num(0))
	}
	return rows, order, nil
}

// questInfo is what quest_template says of a quest: its title, level, repeatable flag and time limit.
type questInfo struct {
	title             string
	level, limit      int
	repeatable, known bool
}

// readQuestInfo reads quest_template's newest row of each of ids.
func readQuestInfo(world worldDB, ids []int) (map[int]questInfo, error) {
	out := map[int]questInfo{}
	if len(ids) == 0 {
		return out, nil
	}
	in := make([]string, len(ids))
	for i, id := range ids {
		in[i] = strconv.Itoa(id)
	}
	raw, err := runSQL(world, fmt.Sprintf("SELECT t.entry, COALESCE(t.Title, ''), t.QuestLevel, t.LimitTime, t.SpecialFlags FROM quest_template t JOIN "+
		"(SELECT entry, MAX(patch) AS patch FROM quest_template WHERE entry IN (%s) GROUP BY entry) n ON n.entry = t.entry AND n.patch = t.patch", strings.Join(in, ", ")))
	if err != nil {
		return nil, err
	}
	for _, f := range batchRows(raw, 5) {
		out[f.num(0)] = questInfo{title: f[1], level: f.num(2), limit: f.num(3), repeatable: f.num(4)&questFlagRepeatable != 0, known: true}
	}
	return out, nil
}

// ReadCharacterQuests reads character guid's quests, in the order the server fills the quest log in.
func ReadCharacterQuests(serverRoot string, guid int) ([]CharacterQuest, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if _, err := readCharacter(db, guid); err != nil {
		return nil, err
	}
	rows, order, err := storedQuests(db, guid)
	if err != nil {
		return nil, err
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	info, err := readQuestInfo(world, order)
	if err != nil {
		return nil, err
	}
	out := make([]CharacterQuest, 0, len(order))
	for _, id := range order {
		r, q := rows[id], info[id]
		out = append(out, CharacterQuest{Quest: id, Title: q.title, Level: q.level, Status: r.status, Rewarded: r.rest[0] != "0", Repeatable: q.repeatable, TimeLimit: q.limit, Known: q.known})
	}
	return out, nil
}

// inQuestLog is whether the server puts a quest with status and rewarded into the quest log.
func inQuestLog(status int, rewarded, repeatable bool) bool {
	return (status == questStatusComplete || status == questStatusIncomplete || status == questStatusFailed) && (!rewarded || repeatable)
}

// questsScript checks quests against what the server reads at login and writes them as character
// guid's whole list, in their order. A row kept as stored keeps its every column; a changed one keeps
// its objectives' counts, explored flag and reward choice. A row new or with a new status gets the
// timer the server would give it at now (now plus the time limit for a timed quest not done, which the
// server would otherwise fail at once). A quest newly done takes the status the server's RewardQuest
// gives it: none for a repeatable one, complete for the rest.
func questsScript(guid int, quests []CharacterQuest, stored map[int]questRow, info map[int]questInfo, now int64) (string, error) {
	seen := map[int]bool{}
	log := 0
	rows := make([]string, 0, len(quests))
	for _, q := range quests {
		col := strconv.Itoa(q.Quest)
		if seen[q.Quest] {
			return "", refuse(col, "Quest %d is in the list twice", q.Quest)
		}
		seen[q.Quest] = true
		old, was := stored[q.Quest]
		qi := info[q.Quest]
		rewarded := strconv.Itoa(b2i(q.Rewarded))
		status := q.Status
		// The columns after status (questRow's rest), the stored row's or a new one's.
		vals := old.rest
		if !was || old.status != q.Status || old.rest[0] != rewarded {
			if !qi.known {
				return "", refuse(col, "The server has no quest %d (its quest_template): it skips the row", q.Quest)
			}
			if q.Rewarded && !was && status == questStatusComplete && qi.repeatable {
				status = questStatusNone
			}
			switch status {
			case questStatusNone, questStatusComplete, questStatusIncomplete, questStatusFailed:
			default:
				return "", refuse(col, "Status %d is not one a character's quest has (0 none, 1 complete, 3 in progress, 5 failed)", status)
			}
			if !was {
				vals = [12]string{"0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"}
			}
			timer := now
			if qi.limit > 0 && status != questStatusNone && !q.Rewarded {
				timer += int64(qi.limit)
			}
			vals[0], vals[2] = rewarded, strconv.FormatInt(timer, 10)
		}
		if inQuestLog(status, q.Rewarded, qi.repeatable) {
			if log++; log > maxQuestLog {
				return "", refuse(col, "The quest log holds %d quests: the server leaves this one and the ones after it out", maxQuestLog)
			}
		}
		rows = append(rows, fmt.Sprintf("(%d, %d, %d, %s)", guid, q.Quest, status, strings.Join(vals[:], ", ")))
	}
	var b strings.Builder
	fmt.Fprintf(&b, "DELETE FROM character_queststatus WHERE guid = %d;", guid)
	if len(rows) > 0 {
		fmt.Fprintf(&b, "\nINSERT INTO character_queststatus (guid, %s) VALUES %s;", questRowColumns, strings.Join(rows, ", "))
	}
	return b.String(), nil
}

// SaveCharacterQuests makes quests character guid's quests while it is out of the world, and returns
// the SQL it ran, or the quest (its ID as the column) it refused.
func SaveCharacterQuests(serverRoot string, guid int, quests []CharacterQuest, worldRunning func() bool) (string, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	if _, err := offlineCharacter(db, guid, worldRunning, "quests"); err != nil {
		return "", err
	}
	stored, _, err := storedQuests(db, guid)
	if err != nil {
		return "", err
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	ids := make([]int, len(quests))
	for i, q := range quests {
		ids[i] = q.Quest
	}
	info, err := readQuestInfo(world, ids)
	if err != nil {
		return "", err
	}
	script, err := questsScript(guid, quests, stored, info, time.Now().Unix())
	if err != nil {
		return "", err
	}
	return script, runScript(db, script)
}

// Explored areas and flight paths.

// The sizes of the two masks (Player.h PLAYER_EXPLORED_ZONES_SIZE, DBCStructure.h TaxiMaskSize).
const (
	exploredFields = 64
	taxiFields     = 8
)

// maskBits reads a mask column (numbers each followed by a space, as the server writes it) into the
// bits it sets, or none when it has not size numbers and exact (the server reads explored_zones only
// when it has all 64; known_taxi_mask as far as it goes).
func maskBits(s string, size int, exact bool) []int {
	f := strings.Fields(s)
	out := []int{}
	if exact && len(f) != size {
		return out
	}
	for i, v := range f {
		if i >= size {
			break
		}
		n, _ := strconv.ParseUint(v, 10, 32)
		for b := 0; b < 32; b++ {
			if n&(1<<b) != 0 {
				out = append(out, i*32+b)
			}
		}
	}
	return out
}

// maskText writes bits as a mask column of size numbers, each followed by a space as the server
// writes it, refusing a bit outside it.
func maskText(bits []int, size int, what string) (string, error) {
	m := make([]uint32, size)
	for _, b := range bits {
		if b < 0 || b >= size*32 {
			return "", refuse(strconv.Itoa(b), "%s %d is outside the %d the server keeps", what, b, size*32)
		}
		m[b/32] |= 1 << (b % 32)
	}
	var s strings.Builder
	for _, v := range m {
		s.WriteString(strconv.FormatUint(uint64(v), 10))
		s.WriteByte(' ')
	}
	return s.String(), nil
}

// ExploreArea is an area with an exploration bit (AreaTable.dbc's explore flag), which the world
// map uncovers once the character has been there.
type ExploreArea struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Bit  int    `json:"bit"`
}

// ExploreZone is a zone with its subzones, on its map.
type ExploreZone struct {
	ExploreArea
	MapID    int           `json:"mapId"`
	MapName  string        `json:"mapName"`
	Subzones []ExploreArea `json:"subzones"`
}

// CharacterExploration is the exploration bits a character has, with the client's zones.
type CharacterExploration struct {
	Explored []int         `json:"explored"`
	Zones    []ExploreZone `json:"zones"`
}

// exploreZones groups AreaTable.dbc's areas (1.12: ID, map, parent, explore flag, then the name in
// field 11) into zones by map, the two continents first, then by name; maps names the maps.
func exploreZones(dbc []byte, maps map[int]string) ([]ExploreZone, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	if t.fields <= areaName {
		return nil, fmt.Errorf("AreaTable.dbc has %d fields, not the 1.12 layout", t.fields)
	}
	type row struct {
		ExploreArea
		mapID, parent int
	}
	rows := make([]row, 0, t.records)
	zones := map[int]*ExploreZone{}
	for r := 0; r < t.records; r++ {
		a := row{ExploreArea{int(t.u32(r, areaID)), t.str(r, areaName), int(t.u32(r, areaBit))}, int(t.u32(r, areaMap)), int(t.u32(r, areaParent))}
		if a.ID == 0 || a.Bit >= MaxAreaBit {
			continue
		}
		rows = append(rows, a)
		if a.parent == 0 {
			zones[a.ID] = &ExploreZone{ExploreArea: a.ExploreArea, MapID: a.mapID, MapName: maps[a.mapID], Subzones: []ExploreArea{}}
		}
	}
	for _, a := range rows {
		if a.parent == 0 {
			continue
		}
		z, ok := zones[a.parent]
		if !ok {
			// A subzone of no zone stands as a zone of its own.
			zones[a.ID] = &ExploreZone{ExploreArea: a.ExploreArea, MapID: a.mapID, MapName: maps[a.mapID], Subzones: []ExploreArea{}}
			continue
		}
		z.Subzones = append(z.Subzones, a.ExploreArea)
	}
	rank := func(m int) int {
		if m <= 1 {
			return m
		}
		return 2
	}
	out := make([]ExploreZone, 0, len(zones))
	for _, z := range zones {
		sort.Slice(z.Subzones, func(i, j int) bool {
			return z.Subzones[i].Name < z.Subzones[j].Name || z.Subzones[i].Name == z.Subzones[j].Name && z.Subzones[i].ID < z.Subzones[j].ID
		})
		out = append(out, *z)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if rank(a.MapID) != rank(b.MapID) {
			return rank(a.MapID) < rank(b.MapID)
		}
		if a.MapID != b.MapID {
			return a.MapID < b.MapID
		}
		return a.Name < b.Name || a.Name == b.Name && a.ID < b.ID
	})
	return out, nil
}

// readMaskColumn reads one of character guid's mask columns.
func readMaskColumn(db worldDB, guid int, column string) (string, error) {
	raw, err := runSQL(db, fmt.Sprintf("SELECT COALESCE(%s, '') FROM characters WHERE guid = %d", column, guid))
	if err != nil {
		return "", err
	}
	rows := batchRows(raw, 1)
	if len(rows) == 0 {
		return "", fmt.Errorf("there is no character %d", guid)
	}
	return rows[0][0], nil
}

// ReadCharacterExploration reads the areas character guid has explored, with the client's zones.
func ReadCharacterExploration(serverRoot, dataDir string, guid int) (CharacterExploration, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return CharacterExploration{}, err
	}
	defer set.Close()
	areas, err := set.ReadFile(`DBFilesClient\AreaTable.dbc`)
	if err != nil {
		return CharacterExploration{}, err
	}
	maps := map[int]string{}
	if b, err := set.ReadFile(`DBFilesClient\Map.dbc`); err == nil {
		if list, err := ReadMapEntries(b); err == nil {
			for _, m := range list {
				maps[int(m.ID)] = m.Name
			}
		}
	}
	zones, err := exploreZones(areas, maps)
	if err != nil {
		return CharacterExploration{}, err
	}
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return CharacterExploration{}, err
	}
	s, err := readMaskColumn(db, guid, "explored_zones")
	if err != nil {
		return CharacterExploration{}, err
	}
	return CharacterExploration{Explored: maskBits(s, exploredFields, true), Zones: zones}, nil
}

// SaveCharacterExploration makes explored (exploration bits) the areas character guid has explored
// while it is out of the world, and returns the SQL it ran.
func SaveCharacterExploration(serverRoot string, guid int, explored []int, worldRunning func() bool) (string, error) {
	return saveMask(serverRoot, guid, worldRunning, "explored_zones", "explored areas", explored, exploredFields, "Exploration bit")
}

// maskScript writes bits into character guid's mask column of size numbers.
func maskScript(guid int, column string, bits []int, size int, bitName string) (string, error) {
	text, err := maskText(bits, size, bitName)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("UPDATE characters SET %s = %s WHERE guid = %d;", column, sqlQuote(text), guid), nil
}

// saveMask writes bits into character guid's mask column while it is out of the world (what names
// the column's contents for the refusal).
func saveMask(serverRoot string, guid int, worldRunning func() bool, column, what string, bits []int, size int, bitName string) (string, error) {
	script, err := maskScript(guid, column, bits, size, bitName)
	if err != nil {
		return "", err
	}
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	if _, err := offlineCharacter(db, guid, worldRunning, what); err != nil {
		return "", err
	}
	return script, runScript(db, script)
}

// TaxiStop is a flight master's stop a character can know: the world database's taxi_nodes row (the
// server reads the stops there), the sides that can fly from it (a mount for each), and whether a
// flight leaves it in the client's TaxiPath.dbc (the server forgets a stop no flight leaves).
type TaxiStop struct {
	ID       int    `json:"id"`
	MapID    int    `json:"mapId"`
	Name     string `json:"name"`
	Horde    bool   `json:"horde"`
	Alliance bool   `json:"alliance"`
	Routes   bool   `json:"routes"`
}

// CharacterTaxi is the stops a character knows, with the server's stops.
type CharacterTaxi struct {
	Known []int      `json:"known"`
	Stops []TaxiStop `json:"stops"`
}

// taxiSources lists the stops a flight leaves in TaxiPath.dbc, or nil when it can't be read.
func taxiSources(dataDir string) map[int]bool {
	if dataDir == "" {
		return nil
	}
	tt, err := LoadTaxiTables(dataDir)
	if err != nil {
		return nil
	}
	p, err := taxiTable(tt.Paths, "TaxiPath.dbc", taxiPathFields)
	if err != nil {
		return nil
	}
	out := map[int]bool{}
	for r := 0; r < p.records; r++ {
		out[int(p.u32(r, 1))] = true
	}
	return out
}

// ReadCharacterTaxi reads the stops character guid knows, with the world database's stops (each
// marked for a flight leaving it when dataDir names a client, and taken to have one without).
func ReadCharacterTaxi(serverRoot, dataDir string, guid int) (CharacterTaxi, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return CharacterTaxi{}, err
	}
	s, err := readMaskColumn(db, guid, "known_taxi_mask")
	if err != nil {
		return CharacterTaxi{}, err
	}
	known := []int{}
	for _, b := range maskBits(s, taxiFields, false) {
		known = append(known, b+1)
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return CharacterTaxi{}, err
	}
	raw, err := runSQL(world, fmt.Sprintf("SELECT t.id, t.map_id, COALESCE(t.name, ''), t.mount_creature_id1, t.mount_creature_id2 FROM taxi_nodes t JOIN "+
		"(SELECT id, MAX(build) AS build FROM taxi_nodes WHERE build <= %d GROUP BY id) n ON n.id = t.id AND n.build = t.build ORDER BY t.map_id, t.name, t.id", taxiBuild))
	if err != nil {
		return CharacterTaxi{}, err
	}
	sources := taxiSources(dataDir)
	stops := []TaxiStop{}
	for _, f := range batchRows(raw, 5) {
		id := f.num(0)
		if id < 1 || id > MaxTaxiNode {
			continue
		}
		stops = append(stops, TaxiStop{ID: id, MapID: f.num(1), Name: f[2], Horde: f.num(3) != 0, Alliance: f.num(4) != 0, Routes: sources == nil || sources[id]})
	}
	return CharacterTaxi{Known: known, Stops: stops}, nil
}

// SaveCharacterTaxi makes known (taxi_nodes IDs) the stops character guid knows while it is out of
// the world, and returns the SQL it ran.
func SaveCharacterTaxi(serverRoot string, guid int, known []int, worldRunning func() bool) (string, error) {
	bits := make([]int, len(known))
	for i, id := range known {
		if id < 1 || id > MaxTaxiNode {
			return "", refuse(strconv.Itoa(id), "Stop %d is outside the 1 to %d a character can know", id, MaxTaxiNode)
		}
		bits[i] = id - 1
	}
	return saveMask(serverRoot, guid, worldRunning, "known_taxi_mask", "flight paths", bits, taxiFields, "Stop bit")
}

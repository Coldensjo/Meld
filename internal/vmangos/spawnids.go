package vmangos

import (
	"fmt"
	"strconv"
	"strings"
)

// File › Check Map (#195): what the world database already holds under the guids and entries the
// editor's unsaved spawns use. A created spawn is saved as a DELETE of its guid followed by an
// INSERT (ExportSQL), so a guid another spawn has taken since the editor picked it would delete that
// spawn; and a spawn of an entry without a template does not appear in the game.

// SpawnIDQuery is the guids of the created spawns and the entries of every unsaved spawn, by kind.
type SpawnIDQuery struct {
	CreatureGUIDs   []int `json:"creatureGuids"`
	ObjectGUIDs     []int `json:"objectGuids"`
	CreatureEntries []int `json:"creatureEntries"`
	ObjectEntries   []int `json:"objectEntries"`
}

// GUIDRow is a spawn row the database has under one of the asked guids.
type GUIDRow struct {
	GUID  int `json:"guid"`
	Entry int `json:"entry"`
	Map   int `json:"map"`
}

// SpawnIDReport is what the database has of a SpawnIDQuery.
type SpawnIDReport struct {
	Creatures []GUIDRow `json:"creatures"`
	Objects   []GUIDRow `json:"objects"`
	// The asked entries no template row has.
	MissingCreatureEntries []int `json:"missingCreatureEntries"`
	MissingObjectEntries   []int `json:"missingObjectEntries"`
}

// idList is ids as an SQL list, without duplicates or non-positive ids; "" for none.
func idList(ids []int) string {
	seen := map[int]bool{}
	var b strings.Builder
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		if b.Len() > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.Itoa(id))
	}
	return b.String()
}

// guidRowsSQL selects the rows of table (creature or gameobject) under the guids.
func guidRowsSQL(table string, guids []int) string {
	list := idList(guids)
	if list == "" {
		return ""
	}
	return fmt.Sprintf("SELECT `guid`, `id`, `map` FROM `%s` WHERE `guid` IN (%s) ORDER BY `guid`", table, list)
}

// knownEntriesSQL selects the entries of a template table that are among the asked ones.
func knownEntriesSQL(table string, entries []int) string {
	list := idList(entries)
	if list == "" {
		return ""
	}
	return fmt.Sprintf("SELECT DISTINCT `entry` FROM `%s` WHERE `entry` IN (%s)", table, list)
}

func parseGUIDRows(raw []byte) []GUIDRow {
	var out []GUIDRow
	for _, f := range batchRows(raw, 3) {
		g, err1 := strconv.Atoi(f[0])
		e, err2 := strconv.Atoi(f[1])
		m, err3 := strconv.Atoi(f[2])
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		out = append(out, GUIDRow{GUID: g, Entry: e, Map: m})
	}
	return out
}

// missingEntries is the asked entries that raw (knownEntriesSQL's output) doesn't list, in order.
func missingEntries(asked []int, raw []byte) []int {
	known := map[int]bool{}
	for _, line := range strings.Split(string(raw), "\n") {
		if v, err := strconv.Atoi(strings.TrimSpace(line)); err == nil {
			known[v] = true
		}
	}
	var out []int
	seen := map[int]bool{}
	for _, e := range asked {
		if e > 0 && !known[e] && !seen[e] {
			seen[e] = true
			out = append(out, e)
		}
	}
	return out
}

// CheckSpawnIDs asks the world database what it has under the query's guids and entries.
func CheckSpawnIDs(serverRoot string, q SpawnIDQuery) (SpawnIDReport, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return SpawnIDReport{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return SpawnIDReport{}, err
	}
	var r SpawnIDReport
	rows := func(table string, guids []int) ([]GUIDRow, error) {
		sql := guidRowsSQL(table, guids)
		if sql == "" {
			return nil, nil
		}
		raw, err := runSQL(db, sql)
		if err != nil {
			return nil, err
		}
		return parseGUIDRows(raw), nil
	}
	missing := func(table string, entries []int) ([]int, error) {
		sql := knownEntriesSQL(table, entries)
		if sql == "" {
			return nil, nil
		}
		raw, err := runSQL(db, sql)
		if err != nil {
			return nil, err
		}
		return missingEntries(entries, raw), nil
	}
	if r.Creatures, err = rows("creature", q.CreatureGUIDs); err != nil {
		return r, err
	}
	if r.Objects, err = rows("gameobject", q.ObjectGUIDs); err != nil {
		return r, err
	}
	if r.MissingCreatureEntries, err = missing("creature_template", q.CreatureEntries); err != nil {
		return r, err
	}
	if r.MissingObjectEntries, err = missing("gameobject_template", q.ObjectEntries); err != nil {
		return r, err
	}
	// Empty, not nil, so the editor gets [] and not null.
	for _, l := range []*[]int{&r.MissingCreatureEntries, &r.MissingObjectEntries} {
		if *l == nil {
			*l = []int{}
		}
	}
	if r.Creatures == nil {
		r.Creatures = []GUIDRow{}
	}
	if r.Objects == nil {
		r.Objects = []GUIDRow{}
	}
	return r, nil
}

// guidCollisions names the created spawns of edits whose guid the report shows under another
// entry: saving them would meet another spawn's row.
func guidCollisions(edits []SpawnEdit, r SpawnIDReport) []string {
	held := map[bool]map[int]GUIDRow{false: {}, true: {}}
	for _, row := range r.Creatures {
		held[false][row.GUID] = row
	}
	for _, row := range r.Objects {
		held[true][row.GUID] = row
	}
	var out []string
	for _, e := range edits {
		if !e.Created || e.Deleted {
			continue
		}
		obj := e.Spawn.Kind == KindObject
		if row, ok := held[obj][e.Spawn.GUID]; ok && row.Entry != e.Spawn.Entry {
			kind := "creature"
			if obj {
				kind = "object"
			}
			out = append(out, fmt.Sprintf("%s (guid %d, now %s %d's)", e.Spawn.Name, e.Spawn.GUID, kind, row.Entry))
		}
	}
	return out
}

// CheckCreatedGUIDs refuses edits whose created spawns have guids the database has given other
// spawns since the editor picked them (#199), naming them, so the save changes nothing.
func CheckCreatedGUIDs(serverRoot string, edits []SpawnEdit) error {
	var q SpawnIDQuery
	for _, e := range edits {
		if !e.Created || e.Deleted {
			continue
		}
		if e.Spawn.Kind == KindObject {
			q.ObjectGUIDs = append(q.ObjectGUIDs, e.Spawn.GUID)
		} else {
			q.CreatureGUIDs = append(q.CreatureGUIDs, e.Spawn.GUID)
		}
	}
	if len(q.CreatureGUIDs)+len(q.ObjectGUIDs) == 0 {
		return nil
	}
	r, err := CheckSpawnIDs(serverRoot, q)
	if err != nil {
		return err
	}
	if taken := guidCollisions(edits, r); len(taken) > 0 {
		return fmt.Errorf("nothing was saved: the database gave the guids of these new spawns to other spawns since they were placed, and saving would replace those: %s. Delete them and place them again for new guids", strings.Join(taken, ", "))
	}
	return nil
}

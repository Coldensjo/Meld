package vmangos

import (
	"fmt"
	"strconv"
)

// GameEvent is a world event of the world database's game_event table (a holiday, the Darkmoon Faire,
// an invasion), whose spawns appear (or leave) while it runs.
type GameEvent struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// GameEvents lists the world database's events, by ID.
func GameEvents(serverRoot string) ([]GameEvent, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	raw, err := runSQL(db, "SELECT entry, description FROM game_event ORDER BY entry")
	if err != nil {
		return nil, err
	}
	return parseGameEvents(raw), nil
}

// parseGameEvents reads (entry, description) rows.
func parseGameEvents(raw []byte) []GameEvent {
	var out []GameEvent
	for _, f := range batchRows(raw, 2) {
		id, err := strconv.Atoi(f[0])
		if err != nil {
			continue
		}
		out = append(out, GameEvent{ID: id, Name: f[1]})
	}
	return out
}

// readSpawnEvents gives each spawn its events from game_event_creature and game_event_gameobject: a
// positive event spawns it only while that event runs, a negative one takes it away while event
// -n runs.
func readSpawnEvents(db worldDB, spawns []WorldSpawn) error {
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
	}{{"game_event_creature", creatures, false}, {"game_event_gameobject", objects, true}} {
		if len(q.guids) == 0 {
			continue
		}
		raw, err := runSQL(db, fmt.Sprintf("SELECT guid, event FROM %s WHERE guid IN (%s) ORDER BY guid, event", q.table, intList(q.guids)))
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

// parseSpawnEvents reads (guid, event) rows into the events of each guid, in the rows' order.
func parseSpawnEvents(raw []byte) map[int][]int {
	out := map[int][]int{}
	for _, f := range batchRows(raw, 2) {
		guid, err1 := strconv.Atoi(f[0])
		event, err2 := strconv.Atoi(f[1])
		if err1 != nil || err2 != nil || event == 0 {
			continue
		}
		out[guid] = append(out[guid], event)
	}
	return out
}

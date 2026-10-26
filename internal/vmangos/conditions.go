package vmangos

import (
	"fmt"
	"strconv"
	"strings"
)

// The conditions table (#700): a row is named by what it tests ("Has quest 123 Wanted: Hogger
// rewarded", "Reputation with Stormwind at least Honored"), the things it names read from the world
// database (spells, items, quests, creatures, objects, game events) and the client (factions,
// skills, zones), so the creature editor's Messages tab can offer conditions to pick from.

// conditionEntry is a conditions row with the name of the thing its first value names, if any.
type conditionEntry struct {
	id, kind, flags int
	v               [4]int
	ref             string
}

// conditionSQL lists the conditions rows that where picks (with `id` the row's number), each with
// its type, values, flags and the name of what value1 names.
func conditionSQL(where string) string {
	ref := "CASE type WHEN 1 THEN " + spellNameSQL("value1") + " WHEN 17 THEN " + spellNameSQL("value1") +
		" WHEN 2 THEN " + itemNameSQL("value1") + " WHEN 3 THEN " + itemNameSQL("value1") + " WHEN 23 THEN " + itemNameSQL("value1") +
		" WHEN 8 THEN (SELECT Title FROM quest_template WHERE entry = value1 ORDER BY patch DESC LIMIT 1)" +
		" WHEN 9 THEN (SELECT Title FROM quest_template WHERE entry = value1 ORDER BY patch DESC LIMIT 1)" +
		" WHEN 19 THEN (SELECT Title FROM quest_template WHERE entry = value1 ORDER BY patch DESC LIMIT 1)" +
		" WHEN 22 THEN (SELECT Title FROM quest_template WHERE entry = value1 ORDER BY patch DESC LIMIT 1)" +
		" WHEN 20 THEN (SELECT name FROM creature_template WHERE entry = value1 ORDER BY patch DESC LIMIT 1)" +
		" WHEN 21 THEN (SELECT name FROM gameobject_template WHERE entry = value1 ORDER BY patch DESC LIMIT 1)" +
		" WHEN 12 THEN (SELECT description FROM game_event WHERE entry = value1 LIMIT 1) END"
	return "SELECT id, type, value1, value2, value3, value4, flags, COALESCE(ref, '') FROM (SELECT condition_entry AS id, type, value1, value2, value3, value4, flags, " +
		ref + " AS ref FROM conditions) r WHERE " + where + " ORDER BY id"
}

// parseConditions reads conditionSQL's rows.
func parseConditions(raw []byte) []conditionEntry {
	var out []conditionEntry
	for _, f := range batchRows(raw, 8) {
		n, ok := atoiAll(f[:7])
		if !ok {
			continue
		}
		out = append(out, conditionEntry{id: n[0], kind: n[1], v: [4]int{n[2], n[3], n[4], n[5]}, flags: n[6], ref: f[7]})
	}
	return out
}

// repRanks are the reputation ranks by number (VMaNGOS' ReputationRank).
var repRanks = []string{"Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"}

// compareText is a condition's comparison (0 equal to, 1 at least, 2 at most) before its value.
func compareText(op int) string {
	switch op {
	case 1:
		return "at least "
	case 2:
		return "at most "
	}
	return ""
}

// listText joins the non-zero values of a condition that lists them ("12, 13").
func listText(v []int) string {
	var parts []string
	for _, n := range v {
		if n != 0 {
			parts = append(parts, strconv.Itoa(n))
		}
	}
	return strings.Join(parts, ", ")
}

// conditionText is what condition c tests, in words. dbc names a client table row ("faction",
// "skill", "zone"), or "" when it doesn't know it.
func conditionText(c conditionEntry, dbc func(kind string, id int) string) string {
	v := c.v
	named := func(what string, id int, name string) string {
		if name != "" {
			return what + " " + name
		}
		return fmt.Sprintf("%s %d", what, id)
	}
	ref := func(what string) string { return named(what, v[0], c.ref) }
	client := func(kind, what string, id int) string { return named(what, id, dbc(kind, id)) }
	rank := func(n int) string {
		if n >= 0 && n < len(repRanks) {
			return repRanks[n]
		}
		return fmt.Sprintf("rank %d", n)
	}
	var s string
	switch c.kind {
	case -3:
		s = "Not condition " + strconv.Itoa(v[0])
	case -2:
		s = "Any of conditions " + listText(v[:])
	case -1:
		s = "All of conditions " + listText(v[:])
	case 0:
		s = "Always"
	case 1:
		s = ref("Has the aura of")
		if v[1] != 0 {
			s += fmt.Sprintf(" (effect %d)", v[1])
		}
	case 2:
		s = ref("Carries")
		if v[1] > 1 {
			s += fmt.Sprintf(" ×%d", v[1])
		}
	case 3:
		s = ref("Has equipped")
	case 4:
		s = client("zone", "Is in", v[0])
	case 5:
		s = client("faction", "Reputation with", v[0]) + " at least " + rank(v[1])
	case 6:
		switch v[0] {
		case 469:
			s = "Is Alliance"
		case 67:
			s = "Is Horde"
		default:
			s = fmt.Sprintf("Is of team %d", v[0])
		}
	case 7:
		s = client("skill", "Skill", v[0]) + fmt.Sprintf(" at least %d", v[1])
	case 8:
		s = ref("Was rewarded quest")
	case 9:
		s = ref("Has taken quest")
		switch v[1] {
		case 1:
			s += " (not complete)"
		case 2:
			s += " (complete)"
		}
	case 10:
		s = "Has an Argent Dawn commission"
	case 11:
		s = fmt.Sprintf("Saved variable %d is %s%d", v[0], compareText(v[2]), v[1])
	case 12:
		s = named("Game event", v[0], c.ref) + " is on"
	case 13:
		s = "Can't reach its victim"
	case 14:
		s = fmt.Sprintf("Race mask %d, class mask %d", v[0], v[1])
	case 15:
		s = fmt.Sprintf("Level %s%d", compareText(v[1]), v[0])
	case 16:
		s = "Source is entry " + listText(v[:])
	case 17:
		if v[1] == 1 {
			s = ref("Hasn't learned")
		} else {
			s = ref("Has learned")
		}
	case 18:
		s = fmt.Sprintf("Instance script condition %d (map %d)", v[1], v[0])
	case 19:
		s = ref("Can take quest")
	case 20:
		s = ref("Near creature")
		if v[1] > 0 {
			s += fmt.Sprintf(" within %d", v[1])
		}
		if v[2] != 0 {
			s += " (dead)"
		}
	case 21:
		s = ref("Near object")
		if v[1] > 0 {
			s += fmt.Sprintf(" within %d", v[1])
		}
	case 22:
		s = ref("Has never taken quest")
	case 23:
		s = ref("Carries or banks")
		if v[1] > 1 {
			s += fmt.Sprintf(" ×%d", v[1])
		}
	case 24:
		s = fmt.Sprintf("Content patch %s%d", compareText(v[1]), v[0])
	case 25:
		s = fmt.Sprintf("Escort state (flags %d)", v[0])
	case 26:
		s = fmt.Sprintf("Holiday %d is on", v[0])
	case 27:
		s = [...]string{"Is male", "Is female", "Has no gender"}[min(max(v[0], 0), 2)]
	case 28:
		if v[0] == 1 {
			s = "Is a player or theirs"
		} else {
			s = "Is a player"
		}
	case 29:
		if v[1] <= 1 {
			s = "Doesn't know " + client("skill", "skill", v[0])
		} else {
			s = client("skill", "Skill", v[0]) + fmt.Sprintf(" below %d", v[1])
		}
	case 30:
		s = client("faction", "Reputation with", v[0]) + " at most " + rank(v[1])
	case 31:
		s = fmt.Sprintf("Field %d has flag %d", v[0], v[1])
	case 32:
		s = fmt.Sprintf("Last waypoint %s%d", compareText(v[1]), v[0])
	case 33:
		s = fmt.Sprintf("Is on map %d", v[0])
	case 34:
		s = fmt.Sprintf("Instance data %d is %s%d", v[0], compareText(v[2]), v[1])
	case 35:
		s = fmt.Sprintf("Map event %d data %d is %s%d", v[0], v[1], compareText(v[3]), v[2])
	case 36:
		s = fmt.Sprintf("Map event %d is on", v[0])
	case 37:
		s = "In line of sight"
	case 38:
		s = fmt.Sprintf("Distance to target %s%d", compareText(v[1]), v[0])
	case 39:
		s = "Is moving"
	case 40:
		s = "Has a pet"
	case 41:
		s = fmt.Sprintf("Health %s%d%%", compareText(v[1]), v[0])
	case 42:
		s = fmt.Sprintf("Mana %s%d%%", compareText(v[1]), v[0])
	case 43:
		s = "Is in combat"
	case 44:
		s = "Reaction " + compareText(v[1]) + rank(v[0])
	case 45:
		s = "Is in a group"
	case 46:
		s = "Is alive"
	case 47:
		s = fmt.Sprintf("Map event %d's targets meet condition %d", v[0], v[1])
	case 48:
		s = "Object is spawned"
	case 49:
		s = fmt.Sprintf("Object loot state %d", v[0])
	case 50:
		s = fmt.Sprintf("Object %d meets condition %d", v[0], v[1])
	case 51:
		s = fmt.Sprintf("Honor rank %s%d", compareText(v[1]), v[0])
	case 52:
		s = "Source is spawn " + listText(v[:])
	case 53:
		s = fmt.Sprintf("Time between %02d:%02d and %02d:%02d", v[0], v[1], v[2], v[3])
	case 54:
		s = fmt.Sprintf("Within %d of %d, %d, %d", v[3], v[0], v[1], v[2])
	case 55:
		s = fmt.Sprintf("Object state %d", v[0])
	case 56:
		s = [...]string{"A player", "A hostile player", "A friendly player"}[min(max(v[0], 0), 2)] + " nearby"
		if v[1] > 0 {
			s += fmt.Sprintf(" within %d", v[1])
		}
	case 57:
		s = "Is in a creature group"
	case 58:
		s = "Its creature group is dead"
	case 59:
		s = client("zone", "Has explored", v[0])
	default:
		s = fmt.Sprintf("Type %d (%d, %d, %d, %d)", c.kind, v[0], v[1], v[2], v[3])
	}
	if c.flags&1 != 0 {
		s = "Not: " + s
	}
	return s
}

// conditionDBC names client table rows for conditionText from dataDir, reading each table once per
// call (empty names when the client can't be read).
func conditionDBC(dataDir string) func(kind string, id int) string {
	tables := map[string]map[int]string{}
	return func(kind string, id int) string {
		t, ok := tables[kind]
		if !ok {
			t, _ = questDBCNames(dataDir, kind)
			tables[kind] = t
		}
		return t[id]
	}
}

// readConditions names the conditions rows where picks.
func readConditions(serverRoot, dataDir, where string) ([]NamedID, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, conditionSQL(where))
	if err != nil {
		return nil, err
	}
	dbc := conditionDBC(dataDir)
	rows := parseConditions(raw)
	out := make([]NamedID, len(rows))
	for i, c := range rows {
		out[i] = NamedID{ID: c.id, Name: conditionText(c, dbc)}
	}
	return out, nil
}

// ConditionNames names the conditions rows numbered ids by what they test, leaving out those the
// table doesn't have.
func ConditionNames(serverRoot, dataDir string, ids []int) (map[int]string, error) {
	out := map[int]string{}
	if len(ids) == 0 {
		return out, nil
	}
	list := make([]string, len(ids))
	for i, id := range ids {
		list[i] = strconv.Itoa(id)
	}
	rows, err := readConditions(serverRoot, dataDir, "id IN ("+strings.Join(list, ",")+")")
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ID] = r.Name
	}
	return out, nil
}

// SearchConditions lists the conditions rows numbered text or whose words have it, at most limit of
// them. The words are made here, so the table (about 2,000 rows) is read whole.
func SearchConditions(serverRoot, dataDir, text string, limit int) ([]NamedID, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return []NamedID{}, nil
	}
	rows, err := readConditions(serverRoot, dataDir, "TRUE")
	if err != nil {
		return nil, err
	}
	return matchConditions(rows, text, max(limit, 1)), nil
}

// matchConditions keeps the rows numbered text, then those whose name has it, at most limit.
func matchConditions(rows []NamedID, text string, limit int) []NamedID {
	n, numErr := strconv.Atoi(text)
	low := strings.ToLower(text)
	out := []NamedID{}
	for _, r := range rows {
		if (numErr == nil && r.ID == n) || strings.Contains(strings.ToLower(r.Name), low) {
			out = append(out, r)
			if len(out) == limit {
				break
			}
		}
	}
	return out
}

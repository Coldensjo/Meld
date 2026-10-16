package vmangos

import (
	"fmt"
	"strconv"
	"strings"
)

// NpcFlagQuestGiver is creature_template.npc_flags' quest giver bit (UNIT_NPC_FLAG_QUESTGIVER in
// 1.12): without it the creature offers no quests, whatever the relation tables say.
const NpcFlagQuestGiver = 0x2

// QuestRef is a quest a creature starts or ends: the quest's entry, its title and level from
// quest_template, and the content patches the relation row loads in (patch_min to patch_max).
type QuestRef struct {
	Quest    int    `json:"quest"`
	Title    string `json:"title"`
	Level    int    `json:"level"`
	PatchMin int    `json:"patchMin"`
	PatchMax int    `json:"patchMax"`
}

// CreatureQuests is what a creature does with quests: the ones it starts (creature_questrelation)
// and the ones it ends (creature_involvedrelation).
type CreatureQuests struct {
	Starts []QuestRef `json:"starts"`
	Ends   []QuestRef `json:"ends"`
}

// questNamesJoin joins each row's quest to the newest patch of its quest_template row, as `q`.
const questNamesJoin = "LEFT JOIN (SELECT t.entry, t.Title, t.QuestLevel FROM quest_template t JOIN " +
	"(SELECT entry, MAX(patch) AS patch FROM quest_template GROUP BY entry) n ON n.entry = t.entry AND n.patch = t.patch) q ON q.entry = r.quest"

// questRelationSQL selects a relation table's quests of creature id, with their titles.
func questRelationSQL(table string, id int) string {
	return fmt.Sprintf("SELECT r.quest, COALESCE(q.Title, ''), COALESCE(q.QuestLevel, 0), r.patch_min, r.patch_max FROM `%s` r %s WHERE r.id = %d ORDER BY q.QuestLevel, r.quest",
		table, questNamesJoin, id)
}

// parseQuestRefs reads questRelationSQL's output (or a search's, with the patches left out).
func parseQuestRefs(raw []byte) []QuestRef {
	var out []QuestRef
	for _, line := range strings.Split(strings.TrimRight(string(raw), "\r\n"), "\n") {
		f := strings.Split(strings.TrimRight(line, "\r"), "\t")
		if len(f) != 5 && len(f) != 3 {
			continue
		}
		n := func(i int) int {
			if i >= len(f) {
				return 0
			}
			v, _ := strconv.Atoi(f[i])
			return v
		}
		r := QuestRef{Quest: n(0), Title: unescapeBatch(f[1]), Level: n(2), PatchMin: n(3), PatchMax: n(4)}
		if len(f) == 3 {
			r.PatchMax = 10
		}
		out = append(out, r)
	}
	return out
}

// ReadCreatureQuests reads the quests creature template entry starts and ends.
func ReadCreatureQuests(serverRoot string, entry int) (CreatureQuests, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return CreatureQuests{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return CreatureQuests{}, err
	}
	var q CreatureQuests
	raw, err := runSQL(db, questRelationSQL("creature_questrelation", entry))
	if err != nil {
		return q, err
	}
	q.Starts = parseQuestRefs(raw)
	raw, err = runSQL(db, questRelationSQL("creature_involvedrelation", entry))
	if err != nil {
		return q, err
	}
	q.Ends = parseQuestRefs(raw)
	return q, nil
}

// questRelationsSQL replaces creature entry's rows in both relation tables with q's. A quest
// listed twice in one list is refused, as each table's key is (id, quest).
func questRelationsSQL(entry int, q CreatureQuests) (string, error) {
	var b strings.Builder
	for _, t := range []struct {
		table string
		list  []QuestRef
	}{{"creature_questrelation", q.Starts}, {"creature_involvedrelation", q.Ends}} {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "DELETE FROM `%s` WHERE `id` = %d;", t.table, entry)
		seen := map[int]bool{}
		for _, r := range t.list {
			if r.Quest <= 0 {
				return "", fmt.Errorf("a quest with no entry")
			}
			if seen[r.Quest] {
				return "", fmt.Errorf("quest %d is listed twice", r.Quest)
			}
			seen[r.Quest] = true
			if r.PatchMin < 0 || r.PatchMax > 10 || r.PatchMin > r.PatchMax {
				return "", fmt.Errorf("quest %d: the patches must run from 0 to 10, the first no later than the last", r.Quest)
			}
			fmt.Fprintf(&b, "\nINSERT INTO `%s` (`id`, `quest`, `patch_min`, `patch_max`) VALUES (%d, %d, %d, %d);", t.table, entry, r.Quest, r.PatchMin, r.PatchMax)
		}
	}
	return b.String(), nil
}

// SaveCreatureQuests replaces the quests creature template entry starts and ends with q's, and
// returns the SQL it ran. Every quest must exist in quest_template.
func SaveCreatureQuests(serverRoot string, entry int, q CreatureQuests) (string, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return "", err
	}
	var ids []string
	for _, r := range append(append([]QuestRef{}, q.Starts...), q.Ends...) {
		ids = append(ids, strconv.Itoa(r.Quest))
	}
	if len(ids) > 0 {
		raw, err := runSQL(db, "SELECT DISTINCT `entry` FROM `quest_template` WHERE `entry` IN ("+strings.Join(ids, ",")+")")
		if err != nil {
			return "", err
		}
		known := map[string]bool{}
		for _, l := range strings.Fields(string(raw)) {
			known[l] = true
		}
		for _, id := range ids {
			if !known[id] {
				return "", fmt.Errorf("the world database has no quest %s", id)
			}
		}
	}
	sql, err := questRelationsSQL(entry, q)
	if err != nil {
		return "", err
	}
	return sql, runScript(db, sql)
}

// SearchQuests lists the quests whose title has text in it, or whose entry is text, by title, at
// most limit of them.
func SearchQuests(serverRoot, text string, limit int) ([]QuestRef, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return nil, err
	}
	match := "t.Title LIKE " + likePattern(text)
	if n, err := strconv.Atoi(text); err == nil {
		match = fmt.Sprintf("(%s OR t.entry = %d)", match, n)
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT t.entry, COALESCE(t.Title, ''), t.QuestLevel FROM quest_template t JOIN "+
		"(SELECT entry, MAX(patch) AS patch FROM quest_template GROUP BY entry) n ON n.entry = t.entry AND n.patch = t.patch "+
		"WHERE %s ORDER BY t.Title, t.entry LIMIT %d", match, max(limit, 1)))
	if err != nil {
		return nil, err
	}
	return parseQuestRefs(raw), nil
}

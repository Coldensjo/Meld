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

// QuestLists is what a creature or game object template does with quests: the ones it starts (the
// questrelation table of its kind) and the ones it ends (the involvedrelation table).
type QuestLists struct {
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
	for _, f := range batchLines(raw) {
		if len(f) != 5 && len(f) != 3 {
			continue
		}
		r := QuestRef{Quest: f.num(0), Title: f[1], Level: f.num(2), PatchMin: f.num(3), PatchMax: f.num(4)}
		if len(f) == 3 {
			r.PatchMax = 10
		}
		out = append(out, r)
	}
	return out
}

// ReadCreatureQuests reads the quests creature template entry starts and ends.
func ReadCreatureQuests(serverRoot string, entry int) (QuestLists, error) {
	return readQuestRelations(serverRoot, "creature", entry)
}

// ReadObjectQuests reads the quests game object template entry starts and ends.
func ReadObjectQuests(serverRoot string, entry int) (QuestLists, error) {
	return readQuestRelations(serverRoot, "object", entry)
}

// relationTables are kind's ("creature" or "object") relation tables: the one for the quests it
// starts and the one for those it ends.
func relationTables(kind string) (starts, ends string) {
	if kind == "object" {
		return "gameobject_questrelation", "gameobject_involvedrelation"
	}
	return "creature_questrelation", "creature_involvedrelation"
}

// readQuestRelations reads the quests kind's template entry starts and ends.
func readQuestRelations(serverRoot, kind string, entry int) (QuestLists, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return QuestLists{}, err
	}
	starts, ends := relationTables(kind)
	var q QuestLists
	raw, err := runSQL(db, questRelationSQL(starts, entry))
	if err != nil {
		return q, err
	}
	q.Starts = parseQuestRefs(raw)
	raw, err = runSQL(db, questRelationSQL(ends, entry))
	if err != nil {
		return q, err
	}
	q.Ends = parseQuestRefs(raw)
	return q, nil
}

// questRelationsSQL replaces kind's template entry's rows in both relation tables with q's. A quest
// listed twice in one list is refused, as each table's key is (id, quest).
func questRelationsSQL(kind string, entry int, q QuestLists) (string, error) {
	starts, ends := relationTables(kind)
	var b strings.Builder
	for _, t := range []struct {
		table string
		list  []QuestRef
	}{{starts, q.Starts}, {ends, q.Ends}} {
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
func SaveCreatureQuests(serverRoot string, entry int, q QuestLists) (string, error) {
	return saveQuestRelations(serverRoot, "creature", entry, q)
}

// SaveObjectQuests replaces the quests game object template entry starts and ends with q's, and
// returns the SQL it ran. Every quest must exist in quest_template, and an object that is not of the
// quest giver type is refused any quest it does not already have (#293: the server ignores its
// rows, and Meld never changes the object's type for the author).
func SaveObjectQuests(serverRoot string, entry int, q QuestLists) (string, error) {
	return saveQuestRelations(serverRoot, "object", entry, q)
}

func saveQuestRelations(serverRoot, kind string, entry int, q QuestLists) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	var ids []int
	for _, r := range append(append([]QuestRef{}, q.Starts...), q.Ends...) {
		ids = append(ids, r.Quest)
	}
	known, err := knownEntries(db, questTable, ids)
	if err != nil {
		return "", err
	}
	for _, id := range ids {
		if !known[id] {
			return "", fmt.Errorf("the world database has no quest %d", id)
		}
	}
	if kind == "object" {
		types, err := objectTypes(db, []int{entry})
		if err != nil {
			return "", err
		}
		if t, ok := types[entry]; !ok {
			return "", fmt.Errorf("the world database has no game object %d", entry)
		} else if t != objectTypeQuestGiver {
			had, err := readQuestRelations(serverRoot, kind, entry)
			if err != nil {
				return "", err
			}
			if err := checkObjectQuests(entry, t, had, q); err != nil {
				return "", err
			}
		}
	}
	sql, err := questRelationsSQL(kind, entry, q)
	if err != nil {
		return "", err
	}
	return sql, runScript(db, sql)
}

// notQuestGiver is the refusal for game object id of type t, which cannot offer or take quests.
func notQuestGiver(id, t int) error {
	return fmt.Errorf("game object %d is of type %d, not a Quest giver (type %d), and the server ignores the quests of any other type: make it a Quest giver under Object in the game object editor first, or pick another object",
		id, t, objectTypeQuestGiver)
}

// checkObjectQuests refuses lists that give object id, of type t (not a quest giver), a quest in
// either list that had does not already hold there. Rows it already has may stay or go.
func checkObjectQuests(id, t int, had, q QuestLists) error {
	for _, l := range []struct{ had, now []QuestRef }{{had.Starts, q.Starts}, {had.Ends, q.Ends}} {
		old := map[int]bool{}
		for _, r := range l.had {
			old[r.Quest] = true
		}
		for _, r := range l.now {
			if !old[r.Quest] {
				return notQuestGiver(id, t)
			}
		}
	}
	return nil
}

// objectTypes reads the type of each game object template of ids, from its newest patch's row.
// An entry the table lacks is left out.
func objectTypes(db worldDB, ids []int) (map[int]int, error) {
	out := map[int]int{}
	if len(ids) == 0 {
		return out, nil
	}
	list := make([]string, len(ids))
	for i, id := range ids {
		list[i] = strconv.Itoa(id)
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT t.entry, t.type FROM `%s` t WHERE t.entry IN (%s) AND "+
		"t.patch = (SELECT MAX(patch) FROM `%s` WHERE entry = t.entry)", objectTable, strings.Join(list, ","), objectTable))
	if err != nil {
		return nil, err
	}
	for _, f := range batchRows(raw, 2) {
		e, err1 := strconv.Atoi(f[0])
		t, err2 := strconv.Atoi(f[1])
		if err1 == nil && err2 == nil {
			out[e] = t
		}
	}
	return out, nil
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

package vmangos

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// The Game Login character's quest actions (#962): give it a quest, complete one or remove one from
// the quest editor's and the Quests tabs' menus. VMaNGOS refuses the `.quest` commands from the
// console, so, by the owner's decision on #962 (B), they write the character's character_queststatus
// row as the Characters and Accounts tool's Quests tab does (charquests.go), only while the character
// is out of the world: the world server writes its quests over the rows when it logs out.

// The quest actions.
const (
	QuestGive     = "give"
	QuestComplete = "complete"
	QuestRemove   = "remove"
)

// questObjectives is what a quest needs done: the counts of its creatures, objects or spell casts
// (ReqCreatureOrGOId/Count) and of its items (ReqItemId/Count), as quest_template's newest row has them.
type questObjectives struct {
	kills     [4]int
	items     [4]int
	itemCount [4]int
}

// readQuestObjectives reads quest's objectives from quest_template's newest row of it.
func readQuestObjectives(world worldDB, quest int) (questObjectives, error) {
	var cols []string
	for i := 1; i <= 4; i++ {
		cols = append(cols, fmt.Sprintf("IF(t.ReqCreatureOrGOId%d <> 0, t.ReqCreatureOrGOCount%d, 0)", i, i))
	}
	for i := 1; i <= 4; i++ {
		cols = append(cols, fmt.Sprintf("t.ReqItemId%d, t.ReqItemCount%d", i, i))
	}
	raw, err := runSQL(world, fmt.Sprintf("SELECT %s FROM quest_template t WHERE t.entry = %d ORDER BY t.patch DESC LIMIT 1", strings.Join(cols, ", "), quest))
	if err != nil {
		return questObjectives{}, err
	}
	var o questObjectives
	for _, f := range batchRows(raw, 12) {
		for i := 0; i < 4; i++ {
			o.kills[i] = f.num(i)
			if id, n := f.num(4+2*i), f.num(5+2*i); id > 0 && n > 0 {
				o.items[i], o.itemCount[i] = id, n
			}
		}
	}
	return o, nil
}

// questActionScript writes action on quest into character guid's quests (stored, in their order):
// give puts it in the quest log fresh (in progress, nothing counted, not done), complete puts it there
// with its objectives counted (ready to turn in), remove drops its row (the quest is new to the
// character again). Giving or completing a quest done before makes it not done, so it can be tested
// again. It refuses a quest the server doesn't have, one to remove the character doesn't have, and
// one more than the quest log holds.
func questActionScript(guid, quest int, action string, stored map[int]questRow, order []int, info map[int]questInfo, obj questObjectives, now int64) (string, error) {
	col := strconv.Itoa(quest)
	del := fmt.Sprintf("DELETE FROM character_queststatus WHERE guid = %d AND quest = %d;", guid, quest)
	old, has := stored[quest]
	switch action {
	case QuestRemove:
		if !has {
			return "", refuse(col, "The character doesn't have quest %d", quest)
		}
		return del, nil
	case QuestGive, QuestComplete:
	default:
		return "", fmt.Errorf("%q isn't a quest action", action)
	}
	qi := info[quest]
	if !qi.known {
		return "", refuse(col, "The server has no quest %d (its quest_template)", quest)
	}
	if !has || !inQuestLog(old.status, old.rest[0] != "0", qi.repeatable) {
		log := 0
		for _, id := range order {
			r := stored[id]
			if id != quest && inQuestLog(r.status, r.rest[0] != "0", info[id].repeatable) {
				log++
			}
		}
		if log >= maxQuestLog {
			return "", refuse(col, "The quest log is full (%d quests): remove one first", maxQuestLog)
		}
	}
	status := questStatusIncomplete
	vals := [12]string{"0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"}
	if action == QuestComplete {
		status = questStatusComplete
		for i := 0; i < 4; i++ {
			vals[3+i] = strconv.Itoa(obj.kills[i])
			vals[7+i] = strconv.Itoa(obj.itemCount[i])
		}
	}
	timer := now
	if qi.limit > 0 {
		timer += int64(qi.limit)
	}
	vals[2] = strconv.FormatInt(timer, 10)
	return fmt.Sprintf("%s\nINSERT INTO character_queststatus (guid, %s) VALUES (%d, %d, %d, %s);", del, questRowColumns, guid, quest, status, strings.Join(vals[:], ", ")), nil
}

// CharacterOnline says whether the character called name is in the world by its row's online flag
// (left at 1 by a world server that stopped without logging its players out, so a caller checks the
// world server runs too). It reads the database only when it already runs.
func CharacterOnline(serverRoot, name string) (bool, error) {
	db, err := confDatabase(serverRoot, "CharacterDatabase.Info")
	if err != nil {
		return false, err
	}
	out, err := runSQL(db, "SELECT online FROM characters WHERE name = "+sqlQuote(strings.TrimSpace(name)))
	if err != nil {
		return false, err
	}
	switch strings.TrimSpace(string(out)) {
	case "":
		return false, fmt.Errorf("the server has no character called %s", name)
	case "0":
		return false, nil
	}
	return true, nil
}

// SetCharacterQuest gives (QuestGive), completes (QuestComplete) or removes (QuestRemove) quest for
// the character called name while it is out of the world, and returns a note for the status line:
// for a completed quest that needs items, the items to have in the bags to turn it in.
func SetCharacterQuest(serverRoot, name string, quest int, action string, worldRunning func() bool) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("Game Login has no character")
	}
	if quest <= 0 {
		return "", fmt.Errorf("quest %d isn't a quest's entry", quest)
	}
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	raw, err := runSQL(db, "SELECT guid FROM characters WHERE name = "+sqlQuote(name))
	if err != nil {
		return "", err
	}
	rows := batchRows(raw, 1)
	if len(rows) == 0 {
		return "", fmt.Errorf("the server has no character called %s", name)
	}
	guid := rows[0].num(0)
	if _, err := offlineCharacter(db, guid, worldRunning, "quests"); err != nil {
		return "", err
	}
	stored, order, err := storedQuests(db, guid)
	if err != nil {
		return "", err
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	info, err := readQuestInfo(world, append(append([]int{}, order...), quest))
	if err != nil {
		return "", err
	}
	var obj questObjectives
	if action == QuestComplete {
		if obj, err = readQuestObjectives(world, quest); err != nil {
			return "", err
		}
	}
	script, err := questActionScript(guid, quest, action, stored, order, info, obj, time.Now().Unix())
	if err != nil {
		return "", err
	}
	if err := runScript(db, script); err != nil {
		return "", err
	}
	return itemsNeeded(world, obj), nil
}

// itemsNeeded names the items obj needs in the bags to turn the quest in ("5 × Linen Cloth (2589)"),
// "" for none.
func itemsNeeded(world worldDB, obj questObjectives) string {
	var ids []string
	for _, id := range obj.items {
		if id > 0 {
			ids = append(ids, strconv.Itoa(id))
		}
	}
	if len(ids) == 0 {
		return ""
	}
	names := map[int]string{}
	if raw, err := runSQL(world, fmt.Sprintf("SELECT entry, COALESCE(name, '') FROM item_template WHERE entry IN (%s) ORDER BY patch", strings.Join(ids, ", "))); err == nil {
		for _, f := range batchRows(raw, 2) {
			names[f.num(0)] = f[1]
		}
	}
	return itemsText(obj, names)
}

// itemsText lists obj's items with their counts and names (the entry alone for an unnamed one).
func itemsText(obj questObjectives, names map[int]string) string {
	var parts []string
	for i, id := range obj.items {
		if id <= 0 {
			continue
		}
		what := fmt.Sprintf("item %d", id)
		if n := names[id]; n != "" {
			what = fmt.Sprintf("%s (%d)", n, id)
		}
		parts = append(parts, fmt.Sprintf("%d × %s", obj.itemCount[i], what))
	}
	return strings.Join(parts, ", ")
}

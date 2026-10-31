package vmangos

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// The quest editor's Export and Import (#940): quests written to an SQL script of their
// quest_template rows (sqlscript.go) and the creatures and game objects that start and end each one
// (listscripts.go), the four relation tables keyed by the quest. Every quest row the import would
// write is held to the rules the quest editor's Save is (checkQuest), each thing it names looked for
// on this server (the script's own quests count), and the import is refused whole if one breaks a
// rule. What else hangs off a quest (its start and end scripts, event links and translations) and what
// it names (items, creatures, spells) are not in the script.

var questScript = scriptTable{name: questTable, key: "patch", entryMax: 1<<24 - 1, keyMax: 255, title: "Title",
	thing: "quest", things: "Quests", editor: "Meld's quest editor (Tools > Quests)"}

// questLists are the givers: who starts and who ends a quest, of each kind, keyed by the quest.
var questLists = []scriptList{
	{table: "creature_questrelation", entry: "quest", item: "id", order: "`id`", what: "creatures that start it", thing: "quest", names: "creature"},
	{table: "gameobject_questrelation", entry: "quest", item: "id", order: "`id`", what: "game objects that start it", thing: "quest", names: "object"},
	{table: "creature_involvedrelation", entry: "quest", item: "id", order: "`id`", what: "creatures that end it", thing: "quest", names: "creature"},
	{table: "gameobject_involvedrelation", entry: "quest", item: "id", order: "`id`", what: "game objects that end it", thing: "quest", names: "object"},
}

// questHeader is the comment the script's header gives after the template's.
const questHeader = "-- With the creatures and game objects that start and end each quest (creature_questrelation,\n" +
	"-- gameobject_questrelation, creature_involvedrelation, gameobject_involvedrelation), each list cleared\n" +
	"-- first, so loading the script replaces the givers. Its start and end scripts, event links and\n" +
	"-- translations are not in the script, nor the items, creatures, objects and spells it names.\n"

// ExportQuests is an SQL script that puts quests back as they are now: every patch row of each
// entry's quest_template, as REPLACE statements that name their columns, then each one's givers.
func ExportQuests(serverRoot string, entries []int) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := templateColumns(db, questTable)
	if err != nil {
		return "", err
	}
	var found []int
	script, err := exportScript(db, questScript, cols, entries, func(_ []TemplateColumn, rows []batchRow) (string, error) {
		for _, f := range rows {
			found = addOnce(found, f.num(0))
		}
		return questHeader, nil
	})
	if err != nil {
		return "", err
	}
	lists, err := exportLists(db, questLists, func(scriptList) []int { return found })
	if err != nil {
		return "", err
	}
	return script + lists, nil
}

// questPlan is what a script of quests would write: its template rows and its givers.
type questPlan struct {
	template scriptPlan
	lists    []listPlan
	// skipped counts the statements that are neither, unknown the columns left out of either.
	skipped int
	unknown []string
}

// readQuestScript parses a script of quests against the world database's columns.
func readQuestScript(db worldDB, script string) (questPlan, error) {
	tmpl, err := readScript(db, questScript, script)
	if err != nil {
		return questPlan{}, err
	}
	entries := tmpl.entries()
	lists, stmts, unknown, err := readLists(db, questLists, script, func(scriptList) []int { return entries })
	if err != nil {
		return questPlan{}, err
	}
	return questPlan{template: tmpl, lists: lists, skipped: tmpl.skipped - stmts, unknown: append(append([]string{}, tmpl.unknown...), unknown...)}, nil
}

// questRowValues is a script row's values as checkQuest reads them: NULL as "".
func questRowValues(r sqlRow) map[string]string {
	out := make(map[string]string, len(r.values))
	for k, v := range r.values {
		if r.null[k] {
			v = ""
		}
		out[k] = v
	}
	return out
}

// prefetchKnown looks up, once a kind, everything rows name (questLinks), and answers checkQuest
// from that; own are quests the script brings, which count as there.
func prefetchKnown(rows []map[string]string, known questKnown, own []int) (questKnown, error) {
	asked := map[string][]int{}
	seen := map[string]map[int]bool{}
	for _, row := range rows {
		for c, link := range questLinks {
			n, _ := strconv.ParseInt(strings.TrimSpace(row[c]), 10, 64)
			kind, id := questLinkTarget(link, n)
			if kind == "" {
				continue
			}
			if seen[kind] == nil {
				seen[kind] = map[int]bool{}
			}
			if !seen[kind][id] {
				seen[kind][id] = true
				asked[kind] = append(asked[kind], id)
			}
		}
	}
	have := map[string]map[int]bool{}
	kinds := make([]string, 0, len(asked))
	for k := range asked {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	for _, k := range kinds {
		ids := asked[k]
		sort.Ints(ids)
		h, err := known(k, ids)
		if err != nil {
			return nil, err
		}
		have[k] = h
	}
	if have["quest"] == nil {
		have["quest"] = map[int]bool{}
	}
	for _, e := range own {
		have["quest"][e] = true
	}
	return func(kind string, ids []int) (map[int]bool, error) {
		return have[kind], nil
	}, nil
}

// questRefusals holds each quest row of a plan to the quest editor's rules (every column it gives
// counted as changed), and gives each problem as a line naming its quest and patch.
func questRefusals(plan scriptPlan, known questKnown) ([]string, error) {
	rows := make([]map[string]string, len(plan.rows))
	for i, r := range plan.rows {
		rows[i] = questRowValues(r)
	}
	k, err := prefetchKnown(rows, known, plan.entries())
	if err != nil {
		return nil, err
	}
	var out []string
	for i, row := range rows {
		err := checkQuest(row, row, k)
		if err == nil {
			continue
		}
		if Refused(err) == nil {
			return nil, err
		}
		key := plan.keys[i]
		for _, line := range strings.Split(err.Error(), "\n") {
			out = append(out, fmt.Sprintf("quest %d (patch %d): %s", key.entry, key.key, line))
		}
	}
	return out, nil
}

// QuestImport is what an SQL script of quests would write: its quest rows, the givers it replaces,
// and what of it is left out or refused.
type QuestImport struct {
	Quests []QuestImportRow `json:"quests"`
	Lists  []ListImport     `json:"lists"`
	// Refused are the rules a quest row breaks, a line each ("quest 7 (patch 0): ..."): with any,
	// importing writes nothing.
	Refused []string `json:"refused"`
	// Skipped is how many statements are neither quest_template rows nor the givers' rows and
	// DELETEs, which importing leaves out.
	Skipped int `json:"skipped"`
	// Others counts the givers' rows and DELETEs of quests the script has no template row of, left out.
	Others int `json:"others"`
	// Unknown are columns the script names that this server's tables lack, left out.
	Unknown []string `json:"unknown"`
	// MissingCreatures and MissingObjects are the givers the world database lacks: importing writes
	// their rows, which the server leaves out.
	MissingCreatures []int `json:"missingCreatures"`
	MissingObjects   []int `json:"missingObjects"`
	// Unready are givers here that can't give quests (a creature without the Quest giver flag, a game
	// object not of the quest giver type), which the server leaves out too.
	Unready []UnreadyGiver `json:"unready"`
}

// QuestImportRow is one quest row of a script: its entry, patch and title, and whether the world
// database has that row already, which importing replaces.
type QuestImportRow struct {
	Entry  int    `json:"entry"`
	Patch  int    `json:"patch"`
	Title  string `json:"title"`
	Exists bool   `json:"exists"`
}

// UnreadyGiver is a creature or game object (Kind) that a script makes a quest giver but that can't
// give quests on this server.
type UnreadyGiver struct {
	Kind string `json:"kind"`
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// unreadyGiversSQL selects the creatures (kind "creature") or game objects among ids, newest patch,
// that can't give quests: a creature without the Quest giver flag, an object not of that type.
func unreadyGiversSQL(kind string, ids []int) string {
	table, cond := creatureTable, fmt.Sprintf("t.npc_flags & %d = 0", NpcFlagQuestGiver)
	if kind == "object" {
		table, cond = objectTable, fmt.Sprintf("t.type <> %d", objectTypeQuestGiver)
	}
	return fmt.Sprintf("SELECT t.entry, t.name FROM `%s` t WHERE t.entry IN (%s) AND %s AND %s ORDER BY t.name, t.entry", table, idList(ids), newestRow(table), cond)
}

// PlanQuestImport reads an SQL script of quests and says what importing it would write and what it
// refuses, without writing anything (dataDir is the client's, for the zones, sorts, skills, factions
// and emotes a quest names).
func PlanQuestImport(serverRoot, dataDir, script string) (QuestImport, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return QuestImport{}, err
	}
	plan, err := readQuestScript(db, script)
	if err != nil {
		return QuestImport{}, err
	}
	have, err := existingRows(db, questScript, plan.template)
	if err != nil {
		return QuestImport{}, err
	}
	out := QuestImport{Skipped: plan.skipped, Unknown: plan.unknown}
	for _, k := range plan.template.keys {
		out.Quests = append(out.Quests, QuestImportRow{Entry: k.entry, Patch: k.key, Title: k.name, Exists: have[rowKey(k.entry, k.key)]})
	}
	if out.Refused, err = questRefusals(plan.template, worldKnown(db, dataDir)); err != nil {
		return QuestImport{}, err
	}
	var named map[string][]int
	if out.Lists, out.Others, named, err = listsImport(db, plan.lists); err != nil {
		return QuestImport{}, err
	}
	if out.MissingCreatures, err = lacking(db, creatureTable, named["creature"]); err != nil {
		return QuestImport{}, err
	}
	if out.MissingObjects, err = lacking(db, objectTable, named["object"]); err != nil {
		return QuestImport{}, err
	}
	for _, kind := range []string{"creature", "object"} {
		if len(named[kind]) == 0 {
			continue
		}
		raw, err := runSQL(db, unreadyGiversSQL(kind, named[kind]))
		if err != nil {
			return QuestImport{}, err
		}
		for _, f := range batchRows(raw, 2) {
			out.Unready = append(out.Unready, UnreadyGiver{Kind: kind, ID: f.num(0), Name: f[1]})
		}
	}
	return out, nil
}

// ImportQuests writes the quest rows of an SQL script into the world database, replacing rows of the
// same entry and patch, and replaces the givers it carries for those quests, all in one transaction;
// it returns the entries it wrote. Every row is checked against its table's columns and every quest
// row against the quest editor's rules first, and nothing is written if one is refused.
func ImportQuests(serverRoot, dataDir, script string) ([]int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	cols, err := templateColumns(db, questTable)
	if err != nil {
		return nil, err
	}
	plan, err := readQuestScript(db, script)
	if err != nil {
		return nil, err
	}
	refused, err := questRefusals(plan.template, worldKnown(db, dataDir))
	if err != nil {
		return nil, err
	}
	if len(refused) > 0 {
		return nil, errors.New("the script's quests break the server's rules, so nothing was imported: " + strings.Join(refused, "; "))
	}
	sql, err := importSQL(questScript, cols, plan.template.rows)
	if err != nil {
		return nil, err
	}
	lists, err := listsSQL(db, plan.lists)
	if err != nil {
		return nil, err
	}
	if err := runScript(db, sql+lists); err != nil {
		return nil, err
	}
	return plan.template.entries(), nil
}

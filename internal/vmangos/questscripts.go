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
// (listscripts.go), the four relation tables keyed by the quest, with its event links and
// translations (game_event_quest, locales_quest) and its start and end scripts (#993; carried.go,
// since quests can share a script, which travels by its ID). Every quest row the import would
// write is held to the rules the quest editor's Save is (checkQuest), each thing it names looked for
// on this server (the script's own quests count), and the import is refused whole if one breaks a
// rule. What it names (items, creatures, spells) is not in the script.

var questScript = scriptTable{name: questTable, key: "patch", entryMax: 1<<24 - 1, keyMax: 255, title: "Title",
	thing: "quest", things: "Quests", editor: "Meld's quest editor (Tools > Quests)"}

// questLists are the givers (who starts and who ends a quest, of each kind), the game events the quest
// is offered in and its translations, keyed by the quest.
var questLists = []scriptList{
	{table: "creature_questrelation", entry: "quest", item: "id", order: "`id`", what: "creatures that start it", thing: "quest", names: "creature"},
	{table: "gameobject_questrelation", entry: "quest", item: "id", order: "`id`", what: "game objects that start it", thing: "quest", names: "object"},
	{table: "creature_involvedrelation", entry: "quest", item: "id", order: "`id`", what: "creatures that end it", thing: "quest", names: "creature"},
	{table: "gameobject_involvedrelation", entry: "quest", item: "id", order: "`id`", what: "game objects that end it", thing: "quest", names: "object"},
	{table: "game_event_quest", entry: "quest", item: "event", order: "`event`", what: "game events it is offered in", thing: "quest", names: "event"},
	// A translation row is the quest's only one, so its other key is the quest too.
	{table: "locales_quest", entry: "entry", item: "entry", order: "`entry`", what: "translations", thing: "quest"},
}

// questHeader is the comment the script's header gives after the template's.
const questHeader = "-- With the creatures and game objects that start and end each quest (creature_questrelation,\n" +
	"-- gameobject_questrelation, creature_involvedrelation, gameobject_involvedrelation), the game events it is\n" +
	"-- offered in (game_event_quest) and its translations (locales_quest), each list cleared first, so loading\n" +
	"-- the script replaces them. Then its start and end scripts (quest_start_scripts, quest_end_scripts, by the\n" +
	"-- StartScript and CompleteScript it names) with the broadcast texts their talk commands say, each by its ID.\n" +
	"-- Run on a server, the script puts those back under their IDs; Import gives a script or text a fresh ID\n" +
	"-- where the server holds other rows under its own, so the server's other quests keep theirs.\n" +
	"-- The items, creatures, objects and spells the quest and its scripts name are named by ID only, not in the script.\n"

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
	var carried string
	script, err := exportScript(db, questScript, cols, entries, func(all []TemplateColumn, rows []batchRow) (string, error) {
		for _, f := range rows {
			found = addOnce(found, f.num(0))
		}
		var err error
		carried, err = exportCarried(newDBSource(db), questRoots, all, rows)
		return questHeader, err
	})
	if err != nil {
		return "", err
	}
	lists, err := exportLists(db, questLists, func(scriptList) []int { return found })
	if err != nil {
		return "", err
	}
	return script + lists + carried, nil
}

// questPlan is what a script of quests would write: its template rows (StartScript and CompleteScript
// rewritten to the IDs the scripts come to), its lists and the scripts.
type questPlan struct {
	template scriptPlan
	lists    []listPlan
	carried  carriedPlan
	// skipped counts the statements that are neither, unknown the columns left out of either.
	skipped int
	unknown []string
}

// readQuestScript parses a script of quests against the world database's columns and works out the
// IDs its scripts come to there.
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
	carried, err := planCarried(newDBSource(db), script, questRoots, tmpl.rows)
	if err != nil {
		return questPlan{}, err
	}
	return questPlan{template: tmpl, lists: lists, carried: carried, skipped: tmpl.skipped - stmts - carried.stmts,
		unknown: append(append(append([]string{}, tmpl.unknown...), unknown...), carried.unknown...)}, nil
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

// QuestImport is what an SQL script of quests would write: its quest rows, the givers, event links
// and translations it replaces, the scripts it brings, and what of it is left out or refused.
type QuestImport struct {
	Quests []QuestImportRow `json:"quests"`
	Lists  []ListImport     `json:"lists"`
	// Carried are the start and end scripts the quests name, with the broadcast texts they say
	// (carried.go): kept where this server holds the same, else written under fresh IDs.
	Carried []CarriedImport `json:"carried"`
	// Refused are the rules a quest row breaks, a line each ("quest 7 (patch 0): ..."): with any,
	// importing writes nothing.
	Refused []string `json:"refused"`
	// Skipped is how many statements are neither quest_template rows nor the lists' or scripts' rows
	// and DELETEs, which importing leaves out.
	Skipped int `json:"skipped"`
	// Others counts the lists' rows and DELETEs of quests the script has no template row of, and the
	// rows and DELETEs of scripts and texts no quest names, left out.
	Others int `json:"others"`
	// Unknown are columns the script names that this server's tables lack, left out.
	Unknown []string `json:"unknown"`
	// MissingCreatures and MissingObjects are the givers the world database lacks: importing writes
	// their rows, which the server leaves out.
	MissingCreatures []int `json:"missingCreatures"`
	MissingObjects   []int `json:"missingObjects"`
	// MissingEvents are the game events the quests are offered in that the world database lacks:
	// importing writes their links, which the server leaves out.
	MissingEvents []int `json:"missingEvents"`
	// Unready are givers here that can't give quests (a creature without the Quest giver flag, a game
	// object not of the quest giver type), which the server leaves out too.
	Unready []UnreadyGiver `json:"unready"`
	// ScriptLacks are the creatures, game objects, spells and conditions the carried scripts'
	// commands name that this server lacks (#1045): the script does nothing or stops at that step.
	ScriptLacks []ScriptLack `json:"scriptLacks"`
}

// ScriptLack is a kind of thing ("creature", "game object", "spell", "condition") the carried
// scripts' commands name, with the IDs of it the world database lacks, in increasing order.
type ScriptLack struct {
	What string `json:"what"`
	IDs  []int  `json:"ids"`
}

// scriptLackTables are the kinds scriptNames gives, in the plan's order: what each is called, and
// the table and column that hold it. The server reads its spells from spell_template alone.
var scriptLackTables = []struct{ kind, what, table, column string }{
	{"creature", "creature", creatureTable, "entry"},
	{"object", "game object", objectTable, "entry"},
	{"spell", "spell", spellTable, "entry"},
	{"condition", "condition", "conditions", "condition_entry"},
}

// scriptLacks looks up which of the things the plan's script commands name the world database lacks.
func scriptLacks(db worldDB, p *carriedPlan) ([]ScriptLack, error) {
	var out []ScriptLack
	named := p.scriptNames()
	for _, t := range scriptLackTables {
		ids := named[t.kind]
		if len(ids) == 0 {
			continue
		}
		raw, err := runSQL(db, fmt.Sprintf("SELECT DISTINCT `%s` FROM `%s` WHERE `%s` IN (%s)", t.column, t.table, t.column, idList(ids)))
		if err != nil {
			return nil, err
		}
		if miss := missingEntries(ids, raw); len(miss) > 0 {
			sort.Ints(miss)
			out = append(out, ScriptLack{What: t.what, IDs: miss})
		}
	}
	return out, nil
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
	out.Carried = plan.carried.imports()
	out.Others += plan.carried.others
	if out.ScriptLacks, err = scriptLacks(db, &plan.carried); err != nil {
		return QuestImport{}, err
	}
	if out.MissingEvents, err = lacking(db, "game_event", named["event"]); err != nil {
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
// same entry and patch, replaces the givers, event links and translations it carries for those
// quests and writes the scripts they name under fresh IDs where this server holds other rows under
// theirs, the quests rewritten to them, all in one transaction; it returns the entries it wrote. Every row is checked against its table's columns and every quest
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
	carried, err := plan.carried.sql(newDBSource(db))
	if err != nil {
		return nil, err
	}
	if err := runScript(db, sql+lists+carried); err != nil {
		return nil, err
	}
	return plan.template.entries(), nil
}

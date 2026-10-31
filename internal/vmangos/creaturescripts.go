package vmangos

import (
	"fmt"
	"strings"
)

// The creature editor's Export and Import (#938): creatures written to an SQL script of their
// creature_template rows (sqlscript.go) and the lists keyed by their entry that the editor saves
// beside the template (the shop, and the quests it starts and ends; listscripts.go), and read back.
// What the template names by ID (its spell list, equipment, loot, gossip menu, shared vendor list) is
// not in the script.

var creatureScript = scriptTable{name: creatureTable, key: "patch", entryMax: 1<<24 - 1, keyMax: 255,
	thing: "creature", things: "Creatures", editor: "Meld's creature editor (Tools > Creatures)"}

var creatureLists = []scriptList{
	{table: "npc_vendor", entry: "entry", item: "item", order: "`slot`, `item`", what: "shop items", thing: "creature", names: "item"},
	{table: "creature_questrelation", entry: "id", item: "quest", order: "`quest`", what: "quests it starts", thing: "creature", names: "quest"},
	{table: "creature_involvedrelation", entry: "id", item: "quest", order: "`quest`", what: "quests it ends", thing: "creature", names: "quest"},
}

// creatureHeader is the comment the script's header gives after the template's.
const creatureHeader = "-- With each creature's shop (npc_vendor) and the quests it starts and ends (creature_questrelation,\n" +
	"-- creature_involvedrelation), each list cleared first, so loading the script replaces the lists.\n" +
	"-- Its spell list, equipment, loot, gossip menu and shared vendor list are named by ID only, not in the script.\n"

// ExportCreatures is an SQL script that puts creatures back as they are now: every patch row of
// each entry's creature_template, as REPLACE statements that name their columns, then each one's
// lists (creatureLists).
func ExportCreatures(serverRoot string, entries []int) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := templateColumns(db, creatureTable)
	if err != nil {
		return "", err
	}
	var found []int
	script, err := exportScript(db, creatureScript, cols, entries, func(_ []TemplateColumn, rows []batchRow) (string, error) {
		for _, f := range rows {
			if n := f.num(0); len(found) == 0 || found[len(found)-1] != n {
				found = append(found, n)
			}
		}
		return creatureHeader, nil
	})
	if err != nil {
		return "", err
	}
	lists, err := exportLists(db, creatureLists, func(scriptList) []int { return found })
	if err != nil {
		return "", err
	}
	return script + lists, nil
}

// creaturePlan is what a script of creatures would write: its template rows and its lists.
type creaturePlan struct {
	template scriptPlan
	lists    []listPlan
	// skipped counts the statements that are neither, unknown the columns left out of either.
	skipped int
	unknown []string
}

// readCreatureScript parses a script of creatures against the world database's columns.
func readCreatureScript(db worldDB, script string) (creaturePlan, error) {
	tmpl, err := readScript(db, creatureScript, script)
	if err != nil {
		return creaturePlan{}, err
	}
	entries := tmpl.entries()
	lists, stmts, unknown, err := readLists(db, creatureLists, script, func(scriptList) []int { return entries })
	if err != nil {
		return creaturePlan{}, err
	}
	return creaturePlan{template: tmpl, lists: lists, skipped: tmpl.skipped - stmts, unknown: append(append([]string{}, tmpl.unknown...), unknown...)}, nil
}

// CreatureImport is what an SQL script of creatures would write: its creature rows, the lists it
// replaces, and what of it is left out.
type CreatureImport struct {
	Creatures []CreatureImportRow `json:"creatures"`
	Lists     []ListImport        `json:"lists"`
	// Skipped is how many statements are neither creature_template rows nor the lists' rows and
	// DELETEs, which importing leaves out.
	Skipped int `json:"skipped"`
	// Others counts the list rows and DELETEs of creatures the script has no template row of, left out.
	Others int `json:"others"`
	// Unknown are columns the script names that this server's tables lack, left out.
	Unknown []string `json:"unknown"`
	// MissingItems and MissingQuests are the items the shops sell and the quests the creatures start
	// or end that the world database lacks: importing writes their rows, which the server leaves out.
	MissingItems  []int `json:"missingItems"`
	MissingQuests []int `json:"missingQuests"`
}

// CreatureImportRow is one creature row of a script: its entry, patch and name, and whether the
// world database has that row already, which importing replaces.
type CreatureImportRow struct {
	Entry  int    `json:"entry"`
	Patch  int    `json:"patch"`
	Name   string `json:"name"`
	Exists bool   `json:"exists"`
}

// PlanCreatureImport reads an SQL script of creatures and says what importing it would write,
// without writing anything.
func PlanCreatureImport(serverRoot, script string) (CreatureImport, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return CreatureImport{}, err
	}
	plan, err := readCreatureScript(db, script)
	if err != nil {
		return CreatureImport{}, err
	}
	have, err := existingRows(db, creatureScript, plan.template)
	if err != nil {
		return CreatureImport{}, err
	}
	out := CreatureImport{Skipped: plan.skipped, Unknown: plan.unknown}
	for _, k := range plan.template.keys {
		out.Creatures = append(out.Creatures, CreatureImportRow{Entry: k.entry, Patch: k.key, Name: k.name, Exists: have[rowKey(k.entry, k.key)]})
	}
	var named map[string][]int
	if out.Lists, out.Others, named, err = listsImport(db, plan.lists); err != nil {
		return CreatureImport{}, err
	}
	if out.MissingItems, err = lacking(db, itemTable, named["item"]); err != nil {
		return CreatureImport{}, err
	}
	if out.MissingQuests, err = lacking(db, questTable, named["quest"]); err != nil {
		return CreatureImport{}, err
	}
	return out, nil
}

// ImportCreatures writes the creature rows of an SQL script into the world database, replacing rows
// of the same entry and patch, and replaces the lists it carries for those creatures, all in one
// transaction; it returns the entries it wrote. Every row is checked against its table's columns
// first (and a creature's class against the server's class level stats), and nothing is written if
// one is refused.
func ImportCreatures(serverRoot, script string) ([]int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	cols, err := templateColumns(db, creatureTable)
	if err != nil {
		return nil, err
	}
	plan, err := readCreatureScript(db, script)
	if err != nil {
		return nil, err
	}
	var classes []string
	for i, r := range plan.template.rows {
		v, ok := r.values["unit_class"]
		if !ok {
			continue
		}
		if classes == nil {
			raw, err := runSQL(db, "SELECT DISTINCT `class` FROM `creature_classlevelstats` ORDER BY `class`")
			if err != nil {
				return nil, err
			}
			classes = strings.Fields(string(raw))
		}
		if err := unitClassAllowed(v, classes); err != nil {
			return nil, fmt.Errorf("creature %d: %w", plan.template.keys[i].entry, err)
		}
	}
	sql, err := importSQL(creatureScript, cols, plan.template.rows)
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
	forgetDisplays()
	return plan.template.entries(), nil
}

package vmangos

import (
	"fmt"
	"strconv"
)

// The game object editor's Export and Import (#939): game objects written to an SQL script of their
// gameobject_template rows (sqlscript.go) and the lists the editor saves beside the template
// (listscripts.go): the quests the object starts and ends, keyed by its entry, and a chest's or
// fishing hole's contents, the gameobject_loot_template list its data1 names. A loot list can be
// shared by several objects, so the import's plan names the objects on the server, other than the
// script's, that hold a list it replaces. What else the template names by ID (its text, the reference
// loot the contents name) and the display's sounds, which are the client's, are not in the script.

var objectScript = scriptTable{name: objectTable, key: "patch", entryMax: 1<<24 - 1, keyMax: 255,
	thing: "game object", things: "Game objects", editor: "Meld's game object editor (Tools > Game Objects)"}

// objectLootList is the chests' contents, keyed by the loot list a template's data1 names.
var objectLootList = scriptList{table: lootTable, entry: "entry", item: "item", order: "`mincountOrRef` < 0, `groupid`, `item`",
	what: "contents", thing: "loot list", names: "item", ref: "mincountOrRef"}

var objectLists = []scriptList{
	{table: "gameobject_questrelation", entry: "id", item: "quest", order: "`quest`", what: "quests it starts", thing: "object", names: "quest"},
	{table: "gameobject_involvedrelation", entry: "id", item: "quest", order: "`quest`", what: "quests it ends", thing: "object", names: "quest"},
	objectLootList,
}

// objectHeader is the comment the script's header gives after the template's.
const objectHeader = "-- With the quests each object starts and ends (gameobject_questrelation, gameobject_involvedrelation)\n" +
	"-- and a chest's or fishing hole's contents (the gameobject_loot_template list its data1 names), each\n" +
	"-- list cleared first, so loading the script replaces the lists; other objects holding the same loot list get it too.\n" +
	"-- Its text (page_text), the reference loot its contents name and its display's sounds are not in the script.\n"

// objectLoot is the loot list a template row of type typ and data1 names, or 0 for none.
func objectLoot(typ, data1 string) int {
	t, _ := strconv.Atoi(typ)
	if t != objectTypeChest && t != objectTypeFishingHole {
		return 0
	}
	n, err := strconv.Atoi(data1)
	if err != nil || n <= 0 || n > listIDMax {
		return 0
	}
	return n
}

// addOnce appends n to ids unless it is 0 or there already.
func addOnce(ids []int, n int) []int {
	if n == 0 {
		return ids
	}
	for _, e := range ids {
		if e == n {
			return ids
		}
	}
	return append(ids, n)
}

// objectListIDs gives each of objectLists its IDs: the loot list its loot ids, the others entries.
func objectListIDs(entries, loots []int) func(scriptList) []int {
	return func(l scriptList) []int {
		if l.table == lootTable {
			return loots
		}
		return entries
	}
}

// ExportObjects is an SQL script that puts game objects back as they are now: every patch row of
// each entry's gameobject_template, as REPLACE statements that name their columns, then each one's
// lists (objectLists).
func ExportObjects(serverRoot string, entries []int) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := templateColumns(db, objectTable)
	if err != nil {
		return "", err
	}
	var found, loots []int
	script, err := exportScript(db, objectScript, cols, entries, func(all []TemplateColumn, rows []batchRow) (string, error) {
		typ, data1 := -1, -1
		for i, c := range all {
			switch c.Name {
			case "type":
				typ = i
			case "data1":
				data1 = i
			}
		}
		for _, f := range rows {
			found = addOnce(found, f.num(0))
			if typ >= 0 && data1 >= 0 {
				loots = addOnce(loots, objectLoot(f[typ], f[data1]))
			}
		}
		return objectHeader, nil
	})
	if err != nil {
		return "", err
	}
	lists, err := exportLists(db, objectLists, objectListIDs(found, loots))
	if err != nil {
		return "", err
	}
	return script + lists, nil
}

// objectPlan is what a script of game objects would write: its template rows and its lists.
type objectPlan struct {
	template scriptPlan
	lists    []listPlan
	// loots are the loot lists the template rows name.
	loots []int
	// skipped counts the statements that are neither, unknown the columns left out of either.
	skipped int
	unknown []string
}

// readObjectScript parses a script of game objects against the world database's columns.
func readObjectScript(db worldDB, script string) (objectPlan, error) {
	tmpl, err := readScript(db, objectScript, script)
	if err != nil {
		return objectPlan{}, err
	}
	var loots []int
	for _, r := range tmpl.rows {
		loots = addOnce(loots, objectLoot(r.values["type"], r.values["data1"]))
	}
	lists, stmts, unknown, err := readLists(db, objectLists, script, objectListIDs(tmpl.entries(), loots))
	if err != nil {
		return objectPlan{}, err
	}
	return objectPlan{template: tmpl, lists: lists, loots: loots, skipped: tmpl.skipped - stmts, unknown: append(append([]string{}, tmpl.unknown...), unknown...)}, nil
}

// ObjectImport is what an SQL script of game objects would write: its template rows, the lists it
// replaces, and what of it is left out.
type ObjectImport struct {
	Objects []ObjectImportRow `json:"objects"`
	Lists   []ListImport      `json:"lists"`
	// Shared are the objects on this server, other than the script's, that hold a loot list the
	// import replaces: their contents change too.
	Shared []LootShare `json:"shared"`
	// Skipped is how many statements are neither gameobject_template rows nor the lists' rows and
	// DELETEs, which importing leaves out.
	Skipped int `json:"skipped"`
	// Others counts the list rows and DELETEs of objects (or loot lists) the script's template rows
	// don't name, left out.
	Others int `json:"others"`
	// Unknown are columns the script names that this server's tables lack, left out.
	Unknown []string `json:"unknown"`
	// MissingItems and MissingQuests are the items the contents hold and the quests the objects start
	// or end that the world database lacks: importing writes their rows, which the server leaves out.
	MissingItems  []int `json:"missingItems"`
	MissingQuests []int `json:"missingQuests"`
}

// ObjectImportRow is one game object row of a script: its entry, patch and name, and whether the
// world database has that row already, which importing replaces.
type ObjectImportRow struct {
	Entry  int    `json:"entry"`
	Patch  int    `json:"patch"`
	Name   string `json:"name"`
	Exists bool   `json:"exists"`
}

// LootShare is an object on the server that holds loot list Loot, with its spawn count.
type LootShare struct {
	Loot   int    `json:"loot"`
	Entry  int    `json:"entry"`
	Name   string `json:"name"`
	Spawns int    `json:"spawns"`
}

// sharedLootSQL lists the chests and fishing holes (newest patch) other than entries that hold one
// of the loot lists loots, with their spawn counts.
func sharedLootSQL(loots, entries []int) string {
	not := ""
	if len(entries) > 0 {
		not = " AND t.entry NOT IN (" + idList(entries) + ")"
	}
	return fmt.Sprintf("SELECT t.data1, t.entry, t.name, (SELECT COUNT(*) FROM gameobject s WHERE s.id = t.entry) FROM %s "+
		"WHERE t.type IN (%d, %d) AND t.data1 IN (%s)%s ORDER BY t.data1, t.name, t.entry",
		newestObjects, objectTypeChest, objectTypeFishingHole, idList(loots), not)
}

// PlanObjectImport reads an SQL script of game objects and says what importing it would write,
// without writing anything.
func PlanObjectImport(serverRoot, script string) (ObjectImport, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return ObjectImport{}, err
	}
	plan, err := readObjectScript(db, script)
	if err != nil {
		return ObjectImport{}, err
	}
	have, err := existingRows(db, objectScript, plan.template)
	if err != nil {
		return ObjectImport{}, err
	}
	out := ObjectImport{Skipped: plan.skipped, Unknown: plan.unknown}
	for _, k := range plan.template.keys {
		out.Objects = append(out.Objects, ObjectImportRow{Entry: k.entry, Patch: k.key, Name: k.name, Exists: have[rowKey(k.entry, k.key)]})
	}
	var named map[string][]int
	if out.Lists, out.Others, named, err = listsImport(db, plan.lists); err != nil {
		return ObjectImport{}, err
	}
	var replaced []int
	for _, lp := range plan.lists {
		if lp.list.table == lootTable {
			replaced = lp.replaced
		}
	}
	if len(replaced) > 0 {
		raw, err := runSQL(db, sharedLootSQL(replaced, plan.template.entries()))
		if err != nil {
			return ObjectImport{}, err
		}
		for _, f := range batchRows(raw, 4) {
			out.Shared = append(out.Shared, LootShare{Loot: f.num(0), Entry: f.num(1), Name: f[2], Spawns: f.num(3)})
		}
	}
	if out.MissingItems, err = lacking(db, itemTable, named["item"]); err != nil {
		return ObjectImport{}, err
	}
	if out.MissingQuests, err = lacking(db, questTable, named["quest"]); err != nil {
		return ObjectImport{}, err
	}
	return out, nil
}

// ImportObjects writes the game object rows of an SQL script into the world database, replacing rows
// of the same entry and patch, and replaces the lists it carries for them, all in one transaction;
// it returns the entries it wrote. Every row is checked against its table's columns first, and
// nothing is written if one is refused.
func ImportObjects(serverRoot, script string) ([]int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	cols, err := templateColumns(db, objectTable)
	if err != nil {
		return nil, err
	}
	plan, err := readObjectScript(db, script)
	if err != nil {
		return nil, err
	}
	sql, err := importSQL(objectScript, cols, plan.template.rows)
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
	forgetObjectTemplates()
	return plan.template.entries(), nil
}

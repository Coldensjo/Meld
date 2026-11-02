package vmangos

import "strconv"

// The game object editor's Export and Import (#939): game objects written to an SQL script of their
// gameobject_template rows (sqlscript.go) and the lists the editor saves beside the template
// (listscripts.go), the quests the object starts and ends, keyed by its entry, then a chest's or
// fishing hole's contents, the gameobject_loot_template list its data1 names, with the reference loot
// that names (carried.go, #991: a list several objects share comes to a fresh ID on a server holding
// other rows under its own, so the server's other objects keep theirs). The text the template names
// by ID (page_text) and the display's sounds, which are the client's, are not in the script.

var objectScript = scriptTable{name: objectTable, key: "patch", entryMax: 1<<24 - 1, keyMax: 255,
	thing: "game object", things: "Game objects", editor: "Meld's game object editor (Tools > Game Objects)"}

var objectLists = []scriptList{
	{table: "gameobject_questrelation", entry: "id", item: "quest", order: "`quest`", what: "quests it starts", thing: "object", names: "quest"},
	{table: "gameobject_involvedrelation", entry: "id", item: "quest", order: "`quest`", what: "quests it ends", thing: "object", names: "quest"},
}

// objectHeader is the comment the script's header gives after the template's.
const objectHeader = "-- With the quests each object starts and ends (gameobject_questrelation, gameobject_involvedrelation),\n" +
	"-- each list cleared first, so loading the script replaces the lists, then a chest's or fishing hole's\n" +
	"-- contents (the gameobject_loot_template list its data1 names, with the reference loot it names) by its ID.\n" +
	"-- Run on a server, the script puts the contents back under their IDs; Import gives them fresh IDs where the\n" +
	"-- server holds other rows under their own, so the server's other objects keep theirs.\n" +
	"-- Its text (page_text), the conditions the loot names and its display's sounds are not in the script.\n"

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

// ExportObjects is an SQL script that puts game objects back as they are now: every patch row of
// each entry's gameobject_template, as REPLACE statements that name their columns, then each one's
// lists (objectLists) and the contents its data1 names (objectRoots).
func ExportObjects(serverRoot string, entries []int) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := templateColumns(db, objectTable)
	if err != nil {
		return "", err
	}
	var found []int
	var carried string
	script, err := exportScript(db, objectScript, cols, entries, func(all []TemplateColumn, rows []batchRow) (string, error) {
		for _, f := range rows {
			found = addOnce(found, f.num(0))
		}
		var err error
		carried, err = exportCarried(newDBSource(db), objectRoots, all, rows)
		return objectHeader, err
	})
	if err != nil {
		return "", err
	}
	lists, err := exportLists(db, objectLists, func(scriptList) []int { return found })
	if err != nil {
		return "", err
	}
	return script + lists + carried, nil
}

// objectPlan is what a script of game objects would write: its template rows (data1 rewritten to the
// ID the contents come to), its lists and the contents.
type objectPlan struct {
	template scriptPlan
	lists    []listPlan
	carried  carriedPlan
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
	entries := tmpl.entries()
	lists, stmts, unknown, err := readLists(db, objectLists, script, func(scriptList) []int { return entries })
	if err != nil {
		return objectPlan{}, err
	}
	carried, err := planCarried(newDBSource(db), script, objectRoots, tmpl.rows)
	if err != nil {
		return objectPlan{}, err
	}
	return objectPlan{template: tmpl, lists: lists, carried: carried, skipped: tmpl.skipped - stmts - carried.stmts,
		unknown: append(append(append([]string{}, tmpl.unknown...), unknown...), carried.unknown...)}, nil
}

// ObjectImport is what an SQL script of game objects would write: its template rows, the lists it
// replaces, and what of it is left out.
type ObjectImport struct {
	Objects []ObjectImportRow `json:"objects"`
	Lists   []ListImport      `json:"lists"`
	// Carried are the contents (and the reference loot they name) the script carries (carried.go):
	// kept where this server holds the same, else written under fresh IDs.
	Carried []CarriedImport `json:"carried"`
	// Skipped is how many statements are neither gameobject_template rows nor the lists' rows and
	// DELETEs, which importing leaves out.
	Skipped int `json:"skipped"`
	// Others counts the list rows and DELETEs of objects the script has no template row of, and the
	// rows and DELETEs of loot lists no template names, left out.
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
	out.Carried = plan.carried.imports()
	out.Others += plan.carried.others
	if out.MissingItems, err = lacking(db, itemTable, append(named["item"], plan.carried.items()...)); err != nil {
		return ObjectImport{}, err
	}
	if out.MissingQuests, err = lacking(db, questTable, named["quest"]); err != nil {
		return ObjectImport{}, err
	}
	return out, nil
}

// ImportObjects writes the game object rows of an SQL script into the world database, replacing rows
// of the same entry and patch, replaces the lists it carries for them and writes the contents under
// fresh IDs where this server holds other rows under theirs, data1 rewritten to them, all in one
// transaction;
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
	carried, err := plan.carried.sql(newDBSource(db))
	if err != nil {
		return nil, err
	}
	if err := runScript(db, sql+lists+carried); err != nil {
		return nil, err
	}
	forgetObjectTemplates()
	return plan.template.entries(), nil
}

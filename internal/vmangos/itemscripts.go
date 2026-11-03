package vmangos

// The item editor's Export and Import (#353): items written to an SQL script of their item_template
// rows (sqlscript.go), then what each names by ID (#1044): its contents, the item_loot_template list
// keyed by the item (a bag or clam opened with right-click; listscripts.go), and, carried as sets of
// their own (carried.go, the owner's choice B on #991), its text (the page_text chain its page_text
// names), its disenchant loot (disenchant_loot_template, by disenchant_id) and the reference loot
// those loot rows name. A set the destination holds other rows under comes to a fresh ID there, the
// item's column (or the contents row's mincountOrRef) rewritten to it, so the server's other items
// and objects keep theirs.

// itemLists is an item's contents, keyed by the item; a reference row names a reference loot list.
var itemLists = []scriptList{
	{table: "item_loot_template", entry: "entry", item: "item", order: "`mincountOrRef` < 0, `groupid`, `item`", what: "contents", thing: "item", names: "item", ref: "mincountOrRef"},
}

// itemHeader is the comment the script's header gives after the template's.
const itemHeader = "-- With each item's contents (item_loot_template, cleared first, so loading the script replaces them),\n" +
	"-- then what an item names by ID: its text (the page_text pages from the one its page_text names), its\n" +
	"-- disenchant loot (disenchant_loot_template, by disenchant_id) and the reference loot the loot names.\n" +
	"-- Run on a server, the script puts them back under their IDs; Import gives them fresh IDs where the\n" +
	"-- server holds other rows under their own, so the server's other items and objects keep theirs.\n" +
	"-- The conditions the loot names are not in the script.\n"

// ExportItems is an SQL script that puts items back as they are now: every patch row of each
// entry, as REPLACE statements that name their columns, so the script loads on a server whose
// table has its columns in another order, then each item's contents (itemLists) and what it names
// (itemRoots).
func ExportItems(serverRoot string, entries []int) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := templateColumns(db, itemTable)
	if err != nil {
		return "", err
	}
	var lists, carried string
	script, err := exportScript(db, itemScript, cols, entries, func(all []TemplateColumn, rows []batchRow) (string, error) {
		var found []int
		for _, f := range rows {
			found = addOnce(found, f.num(0))
		}
		from := []carriedRows{{all, rows}}
		for _, l := range itemLists {
			lc, lr, err := listRows(db, l, found)
			if err != nil {
				return "", err
			}
			lists += listScript(l, lc, lr, found)
			from = append(from, carriedRows{lc, lr})
		}
		var err error
		carried, err = exportCarriedFrom(newDBSource(db), itemRoots, from...)
		return itemHeader, err
	})
	if err != nil {
		return "", err
	}
	return script + lists + carried, nil
}

// itemPlan is what a script of items would write: its template rows and contents (page_text,
// disenchant_id and the contents' references rewritten to the IDs the sets come to), and the sets.
type itemPlan struct {
	template scriptPlan
	lists    []listPlan
	carried  carriedPlan
	// skipped counts the statements that are none of those, unknown the columns left out of them.
	skipped int
	unknown []string
}

// readItemScript parses a script of items against the world database's columns and works out the
// IDs what they name comes to there.
func readItemScript(db worldDB, script string) (itemPlan, error) {
	tmpl, err := readScript(db, itemScript, script)
	if err != nil {
		return itemPlan{}, err
	}
	entries := tmpl.entries()
	lists, stmts, unknown, err := readLists(db, itemLists, script, func(scriptList) []int { return entries })
	if err != nil {
		return itemPlan{}, err
	}
	// The roots are read from the template rows and the contents' rows alike (a column only one has).
	rows := append([]sqlRow{}, tmpl.rows...)
	for _, lp := range lists {
		rows = append(rows, lp.rows...)
	}
	carried, err := planCarried(newDBSource(db), script, itemRoots, rows)
	if err != nil {
		return itemPlan{}, err
	}
	return itemPlan{template: tmpl, lists: lists, carried: carried, skipped: tmpl.skipped - stmts - carried.stmts,
		unknown: append(append(append([]string{}, tmpl.unknown...), unknown...), carried.unknown...)}, nil
}

// ItemImport is what an SQL script of items would write: its item rows, the contents it replaces,
// what they name, and what of it is left out.
type ItemImport struct {
	Items []ItemImportRow `json:"items"`
	// Lists are the items' contents the import replaces.
	Lists []ListImport `json:"lists"`
	// Carried are the pages, disenchant loot and reference loot the script carries (carried.go):
	// kept where this server holds the same, else written under fresh IDs.
	Carried []CarriedImport `json:"carried"`
	// Skipped is how many statements are none of those (another table), which importing leaves out.
	Skipped int `json:"skipped"`
	// Others counts the contents rows and DELETEs of items the script has no template row of, and the
	// rows and DELETEs of pages and loot lists nothing it imports names, left out.
	Others int `json:"others"`
	// Unknown are columns the script names that this server's tables lack, left out.
	Unknown []string `json:"unknown"`
	// MissingItems are the items the loot holds that neither the world database nor the script has:
	// importing writes their rows, which the server leaves out.
	MissingItems []int `json:"missingItems"`
}

// ItemImportRow is one item row of a script: its entry, patch and name, and whether the world
// database has that row already, which importing replaces.
type ItemImportRow struct {
	Entry  int    `json:"entry"`
	Patch  int    `json:"patch"`
	Name   string `json:"name"`
	Exists bool   `json:"exists"`
}

// PlanItemImport reads an SQL script of items and says what importing it would write, without
// writing anything.
func PlanItemImport(serverRoot, script string) (ItemImport, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return ItemImport{}, err
	}
	plan, err := readItemScript(db, script)
	if err != nil {
		return ItemImport{}, err
	}
	have, err := existingRows(db, itemScript, plan.template)
	if err != nil {
		return ItemImport{}, err
	}
	out := ItemImport{Skipped: plan.skipped, Unknown: plan.unknown}
	for _, k := range plan.template.keys {
		out.Items = append(out.Items, ItemImportRow{Entry: k.entry, Patch: k.key, Name: k.name, Exists: have[rowKey(k.entry, k.key)]})
	}
	var named map[string][]int
	if out.Lists, out.Others, named, err = listsImport(db, plan.lists); err != nil {
		return ItemImport{}, err
	}
	out.Carried = plan.carried.imports()
	out.Others += plan.carried.others
	// The script's own items come in with it.
	own := map[int]bool{}
	for _, e := range plan.template.entries() {
		own[e] = true
	}
	var held []int
	for _, n := range append(named["item"], plan.carried.items()...) {
		if !own[n] {
			held = append(held, n)
		}
	}
	if out.MissingItems, err = lacking(db, itemTable, held); err != nil {
		return ItemImport{}, err
	}
	return out, nil
}

// ImportItems writes the item rows of an SQL script into the world database, replacing rows of the
// same entry and patch, replaces the contents it carries for them and writes the pages and loot they
// name under fresh IDs where this server holds other rows under theirs, the items' columns rewritten
// to them, all in one script; it returns the entries it wrote. Every row is checked against its
// table's columns first, and nothing is written if one is refused.
func ImportItems(serverRoot, script string) ([]int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	cols, err := templateColumns(db, itemTable)
	if err != nil {
		return nil, err
	}
	plan, err := readItemScript(db, script)
	if err != nil {
		return nil, err
	}
	sql, err := importSQL(itemScript, cols, plan.template.rows)
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
	forgetWeapons()
	return plan.template.entries(), nil
}

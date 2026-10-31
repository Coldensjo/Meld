package vmangos

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// The creature editor's Export and Import (#938): creatures written to an SQL script of their
// creature_template rows (sqlscript.go) and the lists keyed by their entry that the editor saves
// beside the template (the shop, and the quests it starts and ends), and read back. A list is
// written as a DELETE of the creature's old rows and then its rows, so the script run on a server
// replaces the list rather than merging it, and the import does the same. What the template names
// by ID (its spell list, equipment, loot, gossip menu, shared vendor list) is not in the script.

var creatureScript = scriptTable{name: creatureTable, key: "patch", entryMax: 1<<24 - 1, keyMax: 255,
	thing: "creature", things: "Creatures", editor: "Meld's creature editor (Tools > Creatures)"}

// creatureList is a table of rows keyed by a creature's entry that a creature's script carries.
type creatureList struct {
	table string
	// entry is the column that holds the creature's entry; item the row's other key, which every row
	// of a script must give.
	entry, item string
	// order sorts a creature's rows as the editor lists them.
	order string
	// what names the rows in messages.
	what string
}

var creatureLists = []creatureList{
	{table: "npc_vendor", entry: "entry", item: "item", order: "`slot`, `item`", what: "shop items"},
	{table: "creature_questrelation", entry: "id", item: "quest", order: "`quest`", what: "quests it starts"},
	{table: "creature_involvedrelation", entry: "id", item: "quest", order: "`quest`", what: "quests it ends"},
}

// creatureHeader is the comment the script's header gives after the template's.
const creatureHeader = "-- With each creature's shop (npc_vendor) and the quests it starts and ends (creature_questrelation,\n" +
	"-- creature_involvedrelation), each list cleared first, so loading the script replaces the lists.\n" +
	"-- Its spell list, equipment, loot, gossip menu and shared vendor list are named by ID only, not in the script.\n"

// listColumns are a list table's columns, the entry column first.
func listColumns(db worldDB, l creatureList) ([]TemplateColumn, error) {
	cols, err := templateColumns(db, l.table)
	if err != nil {
		return nil, err
	}
	out := []TemplateColumn{{Name: l.entry, Kind: "uint", Max: int64(creatureScript.entryMax)}}
	for _, c := range cols {
		if c.Name != l.entry {
			out = append(out, c)
		}
	}
	return out, nil
}

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
	var b strings.Builder
	b.WriteString(script)
	for _, l := range creatureLists {
		lc, err := listColumns(db, l)
		if err != nil {
			return "", err
		}
		raw, err := runSQL(db, fmt.Sprintf("SELECT %s FROM `%s` WHERE `%s` IN (%s) ORDER BY `%s`, %s",
			columnNames(lc), l.table, l.entry, idList(found), l.entry, l.order))
		if err != nil {
			return "", err
		}
		b.WriteString(listScript(l, lc, batchRows(raw, len(lc)), found))
	}
	return b.String(), nil
}

// columnNames is cols' names in backticks, comma separated.
func columnNames(cols []TemplateColumn) string {
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = "`" + c.Name + "`"
	}
	return strings.Join(names, ", ")
}

// listScript writes each of entries' rows of a list table (rows, in the order of cols, the entry
// first) after a DELETE of its old ones.
func listScript(l creatureList, cols []TemplateColumn, rows []batchRow, entries []int) string {
	by := map[string][]batchRow{}
	for _, f := range rows {
		by[f[0]] = append(by[f[0]], f)
	}
	var b strings.Builder
	for _, e := range entries {
		mine := by[strconv.Itoa(e)]
		fmt.Fprintf(&b, "\n-- Creature %d: the %s (%d %s)\nDELETE FROM `%s` WHERE `%s` = %d;\n", e, l.what, len(mine), plural(len(mine), "row", "rows"), l.table, l.entry, e)
		if len(mine) == 0 {
			continue
		}
		fmt.Fprintf(&b, "REPLACE INTO `%s` (%s) VALUES\n", l.table, columnNames(cols))
		for i, f := range mine {
			vals := make([]string, len(cols))
			for j, c := range cols {
				vals[j] = scriptValue(c, f[j])
			}
			end := ",\n"
			if i == len(mine)-1 {
				end = ";\n"
			}
			fmt.Fprintf(&b, "(%s)%s", strings.Join(vals, ", "), end)
		}
	}
	return b.String()
}

// listPlan is what a script would write into a list table.
type listPlan struct {
	list creatureList
	// replaced are the creatures whose list importing replaces, in the script's order: those of the
	// script's creatures it clears the list of or gives rows of.
	replaced []int
	// rows are the replaced creatures' rows (values checked later, by listSQL).
	rows []sqlRow
	// stmts counts the script's statements of the table: its rows and the DELETEs the plan reads.
	stmts int
	// others counts the rows and DELETEs of creatures the script has no template row of, left out.
	others int
	// unknown are the columns the script names that the table lacks ("table.column"), left out.
	unknown []string
}

// planList reads a script's rows and DELETEs of a list table for the creatures of entries (the
// script's template rows), the columns of a row without a column list taken in the table's order.
func planList(l creatureList, script string, entries []int, order []string) (listPlan, error) {
	stmts, _, err := parseInserts(script, l.table)
	if err != nil {
		return listPlan{}, err
	}
	dels, err := parseDeletes(script, l.table, l.entry)
	if err != nil {
		return listPlan{}, err
	}
	want := map[int]bool{}
	for _, e := range entries {
		want[e] = true
	}
	have := map[string]bool{}
	for _, c := range order {
		have[c] = true
	}
	p := listPlan{list: l, stmts: len(stmts) + len(dels)}
	seen := map[int]bool{}
	mark := func(e int) bool {
		if !want[e] {
			p.others++
			return false
		}
		if !seen[e] {
			seen[e] = true
			p.replaced = append(p.replaced, e)
		}
		return true
	}
	for _, e := range dels {
		mark(e)
	}
	unknown := map[string]bool{}
	for _, st := range stmts {
		names := st.columns
		if names == nil {
			names = order
		}
		for _, tuple := range st.rows {
			if len(tuple) != len(names) {
				return listPlan{}, fmt.Errorf("a %s row has %d values for %d columns", l.table, len(tuple), len(names))
			}
			r := sqlRow{values: map[string]string{}, null: map[string]bool{}}
			for i, n := range names {
				if !have[n] {
					unknown[l.table+"."+n] = true
					continue
				}
				r.values[n] = tuple[i].text
				r.null[n] = tuple[i].null
			}
			e, err := strconv.Atoi(r.values[l.entry])
			if err != nil || e <= 0 {
				return listPlan{}, fmt.Errorf("a %s row has no creature in %s (%q)", l.table, l.entry, r.values[l.entry])
			}
			if n, err := strconv.Atoi(r.values[l.item]); err != nil || n <= 0 {
				return listPlan{}, fmt.Errorf("a %s row of creature %d has no %s (%q)", l.table, e, l.item, r.values[l.item])
			}
			if mark(e) {
				p.rows = append(p.rows, r)
			}
		}
	}
	for n := range unknown {
		p.unknown = append(p.unknown, n)
	}
	sort.Strings(p.unknown)
	return p, nil
}

// listSQL replaces each of the plan's creatures' rows of its table with the script's, every value
// checked against cols (the table's columns, the entry first).
func listSQL(p listPlan, cols []TemplateColumn) (string, error) {
	var b strings.Builder
	for _, e := range p.replaced {
		fmt.Fprintf(&b, "DELETE FROM `%s` WHERE `%s` = %d;\n", p.list.table, p.list.entry, e)
	}
	for _, r := range p.rows {
		var names, vals []string
		for _, c := range cols {
			v, ok := r.values[c.Name]
			if !ok {
				continue
			}
			s, err := importValue(c, v, r.null[c.Name])
			if err != nil {
				return "", fmt.Errorf("creature %s, %s %s: %w", r.values[p.list.entry], p.list.item, r.values[p.list.item], err)
			}
			names = append(names, "`"+c.Name+"`")
			vals = append(vals, s)
		}
		fmt.Fprintf(&b, "REPLACE INTO `%s` (%s) VALUES (%s);\n", p.list.table, strings.Join(names, ", "), strings.Join(vals, ", "))
	}
	return b.String(), nil
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
	p := creaturePlan{template: tmpl, skipped: tmpl.skipped, unknown: append([]string{}, tmpl.unknown...)}
	for _, l := range creatureLists {
		order, err := columnOrder(db, l.table)
		if err != nil {
			return creaturePlan{}, err
		}
		lp, err := planList(l, script, tmpl.entries(), order)
		if err != nil {
			return creaturePlan{}, err
		}
		p.lists = append(p.lists, lp)
		p.skipped -= lp.stmts
		p.unknown = append(p.unknown, lp.unknown...)
	}
	return p, nil
}

// CreatureImport is what an SQL script of creatures would write: its creature rows, the lists it
// replaces, and what of it is left out.
type CreatureImport struct {
	Creatures []CreatureImportRow  `json:"creatures"`
	Lists     []CreatureListImport `json:"lists"`
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

// CreatureListImport is a creature's list the import replaces: the table, what its rows are, how
// many rows the script gives and how many the world database has now, which go.
type CreatureListImport struct {
	Entry int    `json:"entry"`
	Table string `json:"table"`
	What  string `json:"what"`
	Rows  int    `json:"rows"`
	Had   int    `json:"had"`
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
	var items, quests []int
	for _, lp := range plan.lists {
		out.Others += lp.others
		if len(lp.replaced) == 0 {
			continue
		}
		raw, err := runSQL(db, fmt.Sprintf("SELECT `%s`, COUNT(*) FROM `%s` WHERE `%s` IN (%s) GROUP BY `%s`", lp.list.entry, lp.list.table, lp.list.entry, idList(lp.replaced), lp.list.entry))
		if err != nil {
			return CreatureImport{}, err
		}
		had := map[int]int{}
		for _, f := range batchRows(raw, 2) {
			had[f.num(0)] = f.num(1)
		}
		count := map[int]int{}
		for _, r := range lp.rows {
			e, _ := strconv.Atoi(r.values[lp.list.entry])
			count[e]++
			n, _ := strconv.Atoi(r.values[lp.list.item])
			if lp.list.item == "item" {
				items = append(items, n)
			} else {
				quests = append(quests, n)
			}
		}
		for _, e := range lp.replaced {
			out.Lists = append(out.Lists, CreatureListImport{Entry: e, Table: lp.list.table, What: lp.list.what, Rows: count[e], Had: had[e]})
		}
	}
	if out.MissingItems, err = lacking(db, itemTable, items); err != nil {
		return CreatureImport{}, err
	}
	if out.MissingQuests, err = lacking(db, questTable, quests); err != nil {
		return CreatureImport{}, err
	}
	return out, nil
}

// lacking are the ids table has no row of, each once, in increasing order.
func lacking(db worldDB, table string, ids []int) ([]int, error) {
	q := knownEntriesSQL(table, ids)
	if q == "" {
		return nil, nil
	}
	raw, err := runSQL(db, q)
	if err != nil {
		return nil, err
	}
	out := missingEntries(ids, raw)
	sort.Ints(out)
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
	for _, lp := range plan.lists {
		lc, err := listColumns(db, lp.list)
		if err != nil {
			return nil, err
		}
		s, err := listSQL(lp, lc)
		if err != nil {
			return nil, err
		}
		sql += s
	}
	if err := runScript(db, sql); err != nil {
		return nil, err
	}
	forgetDisplays()
	return plan.template.entries(), nil
}

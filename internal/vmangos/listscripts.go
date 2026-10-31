package vmangos

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// The lists an editor's SQL script carries beside its template rows (#938, #939): rows of another
// table keyed by an ID the template rows give (a creature's shop and quests by its entry, a chest's
// contents by the loot list its data1 names). A list is written as a DELETE of the ID's old rows and
// then its rows, so the script run on a server replaces the list rather than merging it, and the
// import does the same.

// scriptList is a table of rows keyed by an ID that a script's template rows give.
type scriptList struct {
	table string
	// entry is the column that holds the ID; item the row's other key, which every row of a script
	// must give.
	entry, item string
	// order sorts an ID's rows as the editor lists them.
	order string
	// what names the rows in messages; thing what the ID is ("creature", "loot list").
	what, thing string
	// ref, when set, is a column whose negative value makes the row a reference rather than an item
	// (a loot row's mincountOrRef), so its item column names no item.
	ref string
}

// listIDMax is the largest ID a list's entry column holds (a mediumint unsigned).
const listIDMax = 1<<24 - 1

// listColumns are a list table's columns, the entry column first.
func listColumns(db worldDB, l scriptList) ([]TemplateColumn, error) {
	cols, err := templateColumns(db, l.table)
	if err != nil {
		return nil, err
	}
	out := []TemplateColumn{{Name: l.entry, Kind: "uint", Max: listIDMax}}
	for _, c := range cols {
		if c.Name != l.entry {
			out = append(out, c)
		}
	}
	return out, nil
}

// columnNames is cols' names in backticks, comma separated.
func columnNames(cols []TemplateColumn) string {
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = "`" + c.Name + "`"
	}
	return strings.Join(names, ", ")
}

// exportLists writes each list's rows of the IDs ids gives it (none: the list is left out).
func exportLists(db worldDB, lists []scriptList, ids func(scriptList) []int) (string, error) {
	var b strings.Builder
	for _, l := range lists {
		keys := ids(l)
		if len(keys) == 0 {
			continue
		}
		lc, err := listColumns(db, l)
		if err != nil {
			return "", err
		}
		raw, err := runSQL(db, fmt.Sprintf("SELECT %s FROM `%s` WHERE `%s` IN (%s) ORDER BY `%s`, %s",
			columnNames(lc), l.table, l.entry, idList(keys), l.entry, l.order))
		if err != nil {
			return "", err
		}
		b.WriteString(listScript(l, lc, batchRows(raw, len(lc)), keys))
	}
	return b.String(), nil
}

// listScript writes each of ids' rows of a list table (rows, in the order of cols, the entry first)
// after a DELETE of its old ones.
func listScript(l scriptList, cols []TemplateColumn, rows []batchRow, ids []int) string {
	by := map[string][]batchRow{}
	for _, f := range rows {
		by[f[0]] = append(by[f[0]], f)
	}
	thing := strings.ToUpper(l.thing[:1]) + l.thing[1:]
	var b strings.Builder
	for _, e := range ids {
		mine := by[strconv.Itoa(e)]
		fmt.Fprintf(&b, "\n-- %s %d: the %s (%d %s)\nDELETE FROM `%s` WHERE `%s` = %d;\n", thing, e, l.what, len(mine), plural(len(mine), "row", "rows"), l.table, l.entry, e)
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
	list scriptList
	// replaced are the IDs whose list importing replaces, in the script's order: those of the
	// script's IDs it clears the list of or gives rows of.
	replaced []int
	// rows are the replaced IDs' rows (values checked later, by listSQL).
	rows []sqlRow
	// stmts counts the script's statements of the table: its rows and the DELETEs the plan reads.
	stmts int
	// others counts the rows and DELETEs of IDs the script's template rows don't give, left out.
	others int
	// unknown are the columns the script names that the table lacks ("table.column"), left out.
	unknown []string
}

// planList reads a script's rows and DELETEs of a list table for the IDs of ids (those the script's
// template rows give), the columns of a row without a column list taken in the table's order.
func planList(l scriptList, script string, ids []int, order []string) (listPlan, error) {
	stmts, _, err := parseInserts(script, l.table)
	if err != nil {
		return listPlan{}, err
	}
	dels, err := parseDeletes(script, l.table, l.entry)
	if err != nil {
		return listPlan{}, err
	}
	want := map[int]bool{}
	for _, e := range ids {
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
				return listPlan{}, fmt.Errorf("a %s row has no %s in %s (%q)", l.table, l.thing, l.entry, r.values[l.entry])
			}
			if n, err := strconv.Atoi(r.values[l.item]); err != nil || n <= 0 {
				return listPlan{}, fmt.Errorf("a %s row of %s %d has no %s (%q)", l.table, l.thing, e, l.item, r.values[l.item])
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

// readLists plans each list of a script for the IDs ids gives it, the columns read from the world
// database; stmts counts the statements the lists took, unknown the columns they left out.
func readLists(db worldDB, lists []scriptList, script string, ids func(scriptList) []int) (plans []listPlan, stmts int, unknown []string, err error) {
	for _, l := range lists {
		order, err := columnOrder(db, l.table)
		if err != nil {
			return nil, 0, nil, err
		}
		lp, err := planList(l, script, ids(l), order)
		if err != nil {
			return nil, 0, nil, err
		}
		plans = append(plans, lp)
		stmts += lp.stmts
		unknown = append(unknown, lp.unknown...)
	}
	return plans, stmts, unknown, nil
}

// listSQL replaces each of the plan's IDs' rows of its table with the script's, every value checked
// against cols (the table's columns, the entry first).
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
				return "", fmt.Errorf("%s %s, %s %s: %w", p.list.thing, r.values[p.list.entry], p.list.item, r.values[p.list.item], err)
			}
			names = append(names, "`"+c.Name+"`")
			vals = append(vals, s)
		}
		fmt.Fprintf(&b, "REPLACE INTO `%s` (%s) VALUES (%s);\n", p.list.table, strings.Join(names, ", "), strings.Join(vals, ", "))
	}
	return b.String(), nil
}

// listsSQL is listSQL of every plan, each table's columns read from the world database.
func listsSQL(db worldDB, plans []listPlan) (string, error) {
	var b strings.Builder
	for _, lp := range plans {
		lc, err := listColumns(db, lp.list)
		if err != nil {
			return "", err
		}
		s, err := listSQL(lp, lc)
		if err != nil {
			return "", err
		}
		b.WriteString(s)
	}
	return b.String(), nil
}

// ListImport is a list the import replaces: the ID it is keyed by and what that is (a creature, an
// object, a loot list), the table, what its rows are, how many rows the script gives and how many the
// world database has now, which go.
type ListImport struct {
	Entry int    `json:"entry"`
	Of    string `json:"of"`
	Table string `json:"table"`
	What  string `json:"what"`
	Rows  int    `json:"rows"`
	Had   int    `json:"had"`
}

// listsImport says what the plans would replace, how many of their rows and DELETEs are left out,
// and the items and quests their rows name (a reference's item column not counted), for the import
// plan.
func listsImport(db worldDB, plans []listPlan) (out []ListImport, others int, items, quests []int, err error) {
	for _, lp := range plans {
		others += lp.others
		if len(lp.replaced) == 0 {
			continue
		}
		raw, err := runSQL(db, fmt.Sprintf("SELECT `%s`, COUNT(*) FROM `%s` WHERE `%s` IN (%s) GROUP BY `%s`", lp.list.entry, lp.list.table, lp.list.entry, idList(lp.replaced), lp.list.entry))
		if err != nil {
			return nil, 0, nil, nil, err
		}
		had := map[int]int{}
		for _, f := range batchRows(raw, 2) {
			had[f.num(0)] = f.num(1)
		}
		count := map[int]int{}
		for _, r := range lp.rows {
			e, _ := strconv.Atoi(r.values[lp.list.entry])
			count[e]++
			if lp.list.ref != "" {
				if n, err := strconv.Atoi(r.values[lp.list.ref]); err == nil && n < 0 {
					continue
				}
			}
			n, _ := strconv.Atoi(r.values[lp.list.item])
			if lp.list.item == "item" {
				items = append(items, n)
			} else {
				quests = append(quests, n)
			}
		}
		for _, e := range lp.replaced {
			out = append(out, ListImport{Entry: e, Of: lp.list.thing, Table: lp.list.table, What: lp.list.what, Rows: count[e], Had: had[e]})
		}
	}
	return out, others, items, quests, nil
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

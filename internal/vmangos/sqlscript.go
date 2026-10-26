package vmangos

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The editors' Export and Import: template rows written to an SQL script of REPLACE statements that
// name their columns, the form of the server's own sql files, and read back from one (sqlparse.go).
// The item editor (#353) writes item_template this way and the spell editor (#357) spell_template.

// scriptTable is a template table Export and Import work on. Its rows are keyed by entry and a
// second key: item_template's patch, spell_template's build.
type scriptTable struct {
	name     string
	key      string
	entryMax int
	keyMax   int
	// keyDefault is the key of a row the script gives none (the table's default).
	keyDefault int
	// thing names a row's subject in messages ("item"), things in the script's header ("Items").
	thing, things string
	// editor is where the script loads, for its header.
	editor string
}

var itemScript = scriptTable{name: itemTable, key: "patch", entryMax: 1<<24 - 1, keyMax: 255,
	thing: "item", things: "Items", editor: "Meld's item editor (Tools > Items)"}

var spellScript = scriptTable{name: spellTable, key: "build", entryMax: math.MaxUint16, keyMax: math.MaxUint16, keyDefault: spellBuild,
	thing: "spell", things: "Spells", editor: "Meld's spell editor (Tools > Spells)"}

// keyColumns are the table's key columns as TemplateColumns, for writing and checking them.
func (t scriptTable) keyColumns() []TemplateColumn {
	return []TemplateColumn{
		{Name: "entry", Kind: "uint", Min: 0, Max: int64(t.entryMax)},
		{Name: t.key, Kind: "uint", Min: 0, Max: int64(t.keyMax)},
	}
}

// exportScript is an SQL script that puts the rows of entries back as they are now: every row of
// each entry (all its patches or builds), cols being the table's columns but its keys. extra, when
// not nil, gives comment lines to write after the header from the rows (keys first, as cols).
func exportScript(db worldDB, t scriptTable, cols []TemplateColumn, entries []int, extra func([]TemplateColumn, []batchRow) (string, error)) (string, error) {
	if len(entries) == 0 {
		return "", fmt.Errorf("no %s to export", strings.ToLower(t.things))
	}
	all := append(t.keyColumns(), cols...)
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = strconv.Itoa(e)
	}
	names := make([]string, len(all))
	for i, c := range all {
		names[i] = "`" + c.Name + "`"
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT %s FROM `%s` WHERE `entry` IN (%s) ORDER BY `entry`, `%s`",
		strings.Join(names, ", "), t.name, strings.Join(ids, ","), t.key))
	if err != nil {
		return "", err
	}
	rows := batchRows(raw, len(all))
	if len(rows) == 0 {
		return "", fmt.Errorf("the world database has no %s %s", t.thing, strings.Join(ids, ", "))
	}
	more := ""
	if extra != nil {
		if more, err = extra(all, rows); err != nil {
			return "", err
		}
	}
	return templateScript(t, all, rows, more, time.Now()), nil
}

// templateScript writes rows (batchRows' unescaped fields, in the order of cols, the keys first) as an SQL
// script, extra (comment lines) after its header.
func templateScript(t scriptTable, cols []TemplateColumn, rows []batchRow, extra string, now time.Time) string {
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = "`" + c.Name + "`"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "-- %s exported by Meld on %s: %d %s of %s.\n", t.things, now.Format("2006-01-02 15:04"), len(rows), plural(len(rows), "row", "rows"), t.name)
	fmt.Fprintf(&b, "-- Load it with Import in %s, or run it on the world database.\n", t.editor)
	b.WriteString(extra)
	for _, f := range rows {
		vals := make([]string, len(cols))
		name := ""
		for i, c := range cols {
			v := f[i]
			if c.Name == "name" {
				name = v
			}
			if v == "NULL" && c.Nullable {
				vals[i] = "NULL"
				continue
			}
			if c.Kind == "text" {
				vals[i] = sqlQuote(v)
			} else if s, err := sqlValue(c, v); err == nil {
				vals[i] = s
			} else {
				vals[i] = sqlQuote(v)
			}
		}
		fmt.Fprintf(&b, "\n-- %s (entry %s, %s %s)\nREPLACE INTO `%s` (%s) VALUES\n(%s);\n",
			commentSafe(name), f[0], t.key, f[1], t.name, strings.Join(names, ", "), strings.Join(vals, ", "))
	}
	return b.String()
}

// commentSafe is text for a "--" comment line: one line.
func commentSafe(s string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(s)
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// scriptRow is a row of a script as an import plan lists it: its keys and name.
type scriptRow struct {
	entry, key int
	name       string
}

// scriptPlan is what a script would write into a table: its rows (values checked later, by
// importSQL), and what of it is left out.
type scriptPlan struct {
	rows []sqlRow
	keys []scriptRow
	// skipped counts the statements that are not rows of the table (a DELETE, another table).
	skipped int
	// unknown are the columns the script names that the table lacks, left out.
	unknown []string
}

// entries are the plan's entries, each once, in the script's order.
func (p scriptPlan) entries() []int {
	var out []int
	seen := map[int]bool{}
	for _, k := range p.keys {
		if !seen[k.entry] {
			seen[k.entry] = true
			out = append(out, k.entry)
		}
	}
	return out
}

// tableOrder is the world database's columns of the table, in its order.
func tableOrder(db worldDB, t scriptTable) ([]string, error) {
	raw, err := runSQL(db, "SHOW COLUMNS FROM `"+t.name+"`")
	if err != nil {
		return nil, err
	}
	var order []string
	for _, f := range batchRows(raw, 6) {
		order = append(order, f[0])
	}
	if len(order) == 0 {
		return nil, errors.New("the world database has no " + t.name)
	}
	return order, nil
}

// readScript parses a script's rows of the table against the world database's columns.
func readScript(db worldDB, t scriptTable, script string) (scriptPlan, error) {
	order, err := tableOrder(db, t)
	if err != nil {
		return scriptPlan{}, err
	}
	return planScript(t, script, order)
}

// planScript reads a script's rows of the table, the columns of a row without a column list taken in
// the table's order (order), and keeps the columns the table has.
func planScript(t scriptTable, script string, order []string) (scriptPlan, error) {
	stmts, skipped, err := parseInserts(script, t.name)
	if err != nil {
		return scriptPlan{}, err
	}
	have := map[string]bool{}
	for _, c := range order {
		have[c] = true
	}
	unknown := map[string]bool{}
	plan := scriptPlan{skipped: skipped}
	for _, st := range stmts {
		names := st.columns
		if names == nil {
			names = order
		}
		for _, tuple := range st.rows {
			if len(tuple) != len(names) {
				return scriptPlan{}, fmt.Errorf("%s %s row has %d values for %d columns", article(t.thing), t.thing, len(tuple), len(names))
			}
			r := sqlRow{values: map[string]string{}, null: map[string]bool{}}
			for i, n := range names {
				if !have[n] {
					unknown[n] = true
					continue
				}
				r.values[n] = tuple[i].text
				r.null[n] = tuple[i].null
			}
			entry, err1 := strconv.Atoi(r.values["entry"])
			if err1 != nil || entry <= 0 || entry > t.entryMax {
				return scriptPlan{}, fmt.Errorf("%s %s row has no entry from 1 to %d (%q)", article(t.thing), t.thing, t.entryMax, r.values["entry"])
			}
			key := t.keyDefault
			if p, ok := r.values[t.key]; ok {
				n, err := strconv.Atoi(p)
				if err != nil || n < 0 || n > t.keyMax {
					return scriptPlan{}, fmt.Errorf("%s %d has %s %q, not 0 to %d", t.thing, entry, t.key, p, t.keyMax)
				}
				key = n
			}
			r.values[t.key] = strconv.Itoa(key)
			plan.rows = append(plan.rows, r)
			plan.keys = append(plan.keys, scriptRow{entry: entry, key: key, name: r.values["name"]})
		}
	}
	if len(plan.rows) == 0 {
		return scriptPlan{}, fmt.Errorf("the script has no %s rows (INSERT or REPLACE INTO %s)", t.name, t.name)
	}
	plan.unknown = make([]string, 0, len(unknown))
	for n := range unknown {
		plan.unknown = append(plan.unknown, n)
	}
	sort.Strings(plan.unknown)
	return plan, nil
}

func article(word string) string {
	if word != "" && strings.ContainsRune("aeiou", rune(word[0])) {
		return "an"
	}
	return "a"
}

// existingRows says which of a plan's rows the world database has already (by "entry|key"), which
// importing replaces.
func existingRows(db worldDB, t scriptTable, plan scriptPlan) (map[string]bool, error) {
	ids := make([]string, 0, len(plan.keys))
	for _, e := range plan.entries() {
		ids = append(ids, strconv.Itoa(e))
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT `entry`, `%s` FROM `%s` WHERE `entry` IN (%s)", t.key, t.name, strings.Join(ids, ",")))
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	for _, f := range batchRows(raw, 2) {
		have[f[0]+"|"+f[1]] = true
	}
	return have, nil
}

// rowKey is a row's "entry|key", as existingRows names it.
func rowKey(entry, key int) string {
	return strconv.Itoa(entry) + "|" + strconv.Itoa(key)
}

// importScript writes a script's rows of the table into the world database, replacing rows of the
// same keys, and returns the plan it wrote. Every row is checked against the table's columns first
// (cols, its columns but the keys), and nothing is written if one is refused.
func importScript(db worldDB, t scriptTable, cols []TemplateColumn, script string) (scriptPlan, error) {
	plan, err := readScript(db, t, script)
	if err != nil {
		return scriptPlan{}, err
	}
	sql, err := importSQL(t, cols, plan.rows)
	if err != nil {
		return scriptPlan{}, err
	}
	return plan, runScript(db, sql)
}

// importSQL is the REPLACE statements that write imported rows, each value checked against its
// column; a column a row leaves out takes the table's default.
func importSQL(t scriptTable, cols []TemplateColumn, rows []sqlRow) (string, error) {
	var b strings.Builder
	for _, r := range rows {
		entry := r.values["entry"]
		names := []string{"`entry`", "`" + t.key + "`"}
		vals := []string{entry, r.values[t.key]}
		for _, c := range cols {
			v, ok := r.values[c.Name]
			if !ok || c.Name == "entry" || c.Name == t.key {
				continue
			}
			var s string
			switch {
			case r.null[c.Name] && c.Nullable:
				s = "NULL"
			case r.null[c.Name]:
				return "", fmt.Errorf("%s %s: %s can't be NULL", t.thing, entry, c.Name)
			case c.Kind == "text":
				// Kept as written, spaces and all; only the length is checked.
				if c.MaxLen > 0 && len(v) > c.MaxLen {
					return "", fmt.Errorf("%s %s: %s is longer than %d characters", t.thing, entry, c.Name, c.MaxLen)
				}
				s = sqlQuote(v)
			default:
				var err error
				if s, err = sqlValue(c, v); err != nil {
					return "", fmt.Errorf("%s %s: %w", t.thing, entry, err)
				}
			}
			names = append(names, "`"+c.Name+"`")
			vals = append(vals, s)
		}
		fmt.Fprintf(&b, "REPLACE INTO `%s` (%s) VALUES (%s);\n", t.name, strings.Join(names, ", "), strings.Join(vals, ", "))
	}
	return b.String(), nil
}

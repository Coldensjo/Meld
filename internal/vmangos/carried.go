package vmangos

import (
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
)

// What a creature's or game object's template names by ID (#991): a creature's spell list,
// equipment, shared vendor and trainer lists, loot, pickpocket and skinning loot and gossip menu, a
// chest's contents, a readable object's pages (#992: each page_text row a set of its own, naming the
// next page), a quest's start and end scripts (#993: quest_start_scripts and quest_end_scripts by
// the StartScript and CompleteScript the quest names), and what those name in turn (the reference
// loot a loot row names, a menu's texts, the broadcast texts they and a script's talk commands show
// and the menus its options open). Many templates can name one such
// set, so it travels as a set of its own: the export writes each set's rows after the templates,
// keyed by their IDs and cleared first, so the script run on a server alone puts them back by ID as
// they were. Import doesn't write over a set of the destination, which other templates there may
// name (the owner's choice, B in #991): a set the destination holds with the same rows under the same
// ID, naming sets that are the same too, is left as it is; any other gets a fresh ID there (the
// table's largest plus one), and the templates' columns and the other sets' references are rewritten
// to the IDs they came to, as the spell editor's import does for icons and visuals (spelllooks.go).
// The conditions, scripts and points of interest the rows name stay IDs, not in the script, as do
// the creatures, objects, spells and the like a script's commands name (the quest import's plan
// lists those the server lacks, #1045).

// carriedTable is a table of a carried kind's rows, keyed by the set's ID in column id.
type carriedTable struct {
	name, id string
	// order sorts a set's rows as the server's own sql files do.
	order string
	// last, if set, is an SQL expression for the largest ID in use, where IDs the table lacks can be
	// named too (a page an object or item names), so a fresh ID never turns up in something else.
	last string
}

// carriedRef is a column of a kind's rows that names a set of another kind (or its own).
type carriedRef struct {
	table, column, kind string
	// ref: the column names the set negated, a negative value only (a loot row's mincountOrRef);
	// otherwise a positive value names it (a menu option's action_menu_id, -1 closing the window).
	ref bool
	// when, if set, says whether a row's column names the set (a script row's dataint, by its
	// command), from the row's values by column.
	when func(value func(string) string) bool
}

// names says whether the row whose values value gives names a set in the reference's column.
func (r carriedRef) names(value func(string) string) bool {
	return r.when == nil || r.when(value)
}

// carriedKind is a kind of set a template names by ID.
type carriedKind struct {
	key, what string
	tables    []carriedTable
	refs      []carriedRef
	// items are the columns of the first table that name items, for the plan's lookup of what the
	// server lacks; loot: a row whose mincountOrRef is negative names no item.
	items []string
	loot  bool
	// script: the first table's rows are script commands, whose datalong and condition_id name
	// creatures, objects, spells and conditions by command (scriptNames).
	script bool
}

// scriptTalk is the script command that says a broadcast text (SCRIPT_COMMAND_TALK), its dataint to
// dataint4 the texts, one picked at random.
const scriptTalk = "0"

// questScriptKind is a quest's start or end script (#993): the rows of table under the ID the quest
// names in column, its talk commands naming the broadcast texts they say. A fresh ID goes past any a
// quest names too, so it never turns up in another quest's script.
func questScriptKind(key, table, what, column string) carriedKind {
	k := carriedKind{key: key, what: what, script: true, tables: []carriedTable{{name: table, id: "id", order: "`delay`, `priority`, `command`",
		last: fmt.Sprintf("GREATEST((SELECT COALESCE(MAX(`id`), 0) FROM `%s`), (SELECT COALESCE(MAX(`%s`), 0) FROM `%s`))", table, column, questTable)}}}
	talk := func(v func(string) string) bool { return strings.TrimSpace(v("command")) == scriptTalk }
	for _, c := range []string{"dataint", "dataint2", "dataint3", "dataint4"} {
		k.refs = append(k.refs, carriedRef{table: table, column: c, kind: "broadcast", when: talk})
	}
	return k
}

func lootKind(key, table, what string) carriedKind {
	return carriedKind{key: key, what: what, tables: []carriedTable{{name: table, id: "entry", order: "`mincountOrRef` < 0, `groupid`, `item`"}},
		refs: []carriedRef{{table: table, column: "mincountOrRef", kind: "reference", ref: true}}, items: []string{"item"}, loot: true}
}

// carriedKinds are the kinds, in the order the script writes them and the plan lists them.
var carriedKinds = func() []carriedKind {
	text := carriedKind{key: "text", what: "gossip text", tables: []carriedTable{{name: "npc_text", id: "ID", order: "`ID`"}}}
	for i := range 8 {
		text.refs = append(text.refs, carriedRef{table: "npc_text", column: fmt.Sprintf("BroadcastTextID%d", i), kind: "broadcast"})
	}
	return []carriedKind{
		{key: "spells", what: "spell list", tables: []carriedTable{{name: "creature_spells", id: "entry", order: "`entry`"}}},
		{key: "equipment", what: "equipment", tables: []carriedTable{{name: "creature_equip_template", id: "entry", order: "`item1`, `item2`, `item3`"}},
			items: []string{"item1", "item2", "item3"}},
		{key: "vendor", what: "vendor list", tables: []carriedTable{{name: "npc_vendor_template", id: "entry", order: "`slot`, `item`"}}, items: []string{"item"}},
		{key: "trainer", what: "trainer list", tables: []carriedTable{{name: "npc_trainer_template", id: "entry", order: "`spell`"}}},
		lootKind("loot", "creature_loot_template", "loot list"),
		lootKind("pickpocket", "pickpocketing_loot_template", "pickpocket loot list"),
		lootKind("skinning", "skinning_loot_template", "skinning loot list"),
		lootKind("objectloot", lootTable, "loot list"),
		lootKind("reference", "reference_loot_template", "reference loot list"),
		{key: "gossip", what: "gossip menu", tables: []carriedTable{{name: "gossip_menu", id: "entry", order: "`text_id`"}, {name: "gossip_menu_option", id: "menu_id", order: "`id`"}},
			refs: []carriedRef{
				{table: "gossip_menu", column: "text_id", kind: "text"},
				{table: "gossip_menu_option", column: "action_menu_id", kind: "gossip"},
				{table: "gossip_menu_option", column: "option_broadcast_text", kind: "broadcast"},
				{table: "gossip_menu_option", column: "box_broadcast_text", kind: "broadcast"},
			}},
		text,
		questScriptKind("startscript", "quest_start_scripts", "start script", "StartScript"),
		questScriptKind("endscript", "quest_end_scripts", "end script", "CompleteScript"),
		{key: "broadcast", what: "broadcast text", tables: []carriedTable{{name: "broadcast_text", id: "entry", order: "`entry`"}}},
		{key: "page", what: "page", tables: []carriedTable{{name: "page_text", id: "entry", order: "`entry`", last: lastPageSQL}},
			refs: []carriedRef{{table: "page_text", column: "next_page", kind: "page"}}},
	}
}()

// rootRef is a template column that names a set.
type rootRef struct {
	column, kind string
	// when, if set, says whether a row's column names the set (a game object's data1, by its type),
	// from the row's values by column.
	when func(value func(string) string) bool
}

var creatureRoots = []rootRef{
	{column: "spell_list_id", kind: "spells"},
	{column: "equipment_id", kind: "equipment"},
	{column: "vendor_id", kind: "vendor"},
	{column: "trainer_id", kind: "trainer"},
	{column: "loot_id", kind: "loot"},
	{column: "pickpocket_loot_id", kind: "pickpocket"},
	{column: "skinning_loot_id", kind: "skinning"},
	{column: "gossip_menu_id", kind: "gossip"},
}

var questRoots = []rootRef{
	{column: "StartScript", kind: "startscript"},
	{column: "CompleteScript", kind: "endscript"},
}

var objectRoots = []rootRef{
	{column: "data1", kind: "objectloot", when: func(v func(string) string) bool { return objectLoot(v("type"), v("data1")) > 0 }},
	{column: "data0", kind: "page", when: func(v func(string) string) bool { return v("type") == strconv.Itoa(objectTypeText) }},
	{column: "data7", kind: "page", when: func(v func(string) string) bool { return v("type") == strconv.Itoa(objectTypeGoober) }},
}

// refID is the set a column's value names (0 for none).
func refID(v string, ref bool) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return 0
	}
	if ref {
		n = -n
	}
	if n <= 0 || n > 1<<31-1 {
		return 0
	}
	return n
}

// refValue is the value a column takes to name set id.
func refValue(id int, ref bool) string {
	if ref {
		id = -id
	}
	return strconv.Itoa(id)
}

// carriedSource reads a world database's tables for the sets (a fake in the tests).
type carriedSource interface {
	// columns are a table's columns, in its order.
	columns(table string) ([]TemplateColumn, error)
	// rows are the rows of a table whose id column is one of ids, cols' values in order.
	rows(t carriedTable, cols []TemplateColumn, ids []int) ([]batchRow, error)
	// maxID is the largest ID of a table's id column, 0 for an empty table.
	maxID(t carriedTable) (int, error)
}

// dbSource is a carriedSource on a world database.
type dbSource struct {
	db   worldDB
	cols map[string][]TemplateColumn
}

func newDBSource(db worldDB) *dbSource { return &dbSource{db: db, cols: map[string][]TemplateColumn{}} }

func (s *dbSource) columns(table string) ([]TemplateColumn, error) {
	if c, ok := s.cols[table]; ok {
		return c, nil
	}
	raw, err := runSQL(s.db, "SHOW COLUMNS FROM `"+table+"`")
	if err != nil {
		return nil, err
	}
	c := parseAllColumns(raw)
	if len(c) == 0 {
		return nil, fmt.Errorf("the world database has no %s", table)
	}
	s.cols[table] = c
	return c, nil
}

func (s *dbSource) rows(t carriedTable, cols []TemplateColumn, ids []int) ([]batchRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	raw, err := runSQL(s.db, fmt.Sprintf("SELECT %s FROM `%s` WHERE `%s` IN (%s) ORDER BY `%s`, %s", columnNames(cols), t.name, t.id, idList(ids), t.id, t.order))
	if err != nil {
		return nil, err
	}
	return batchRows(raw, len(cols)), nil
}

func (s *dbSource) maxID(t carriedTable) (int, error) {
	q := fmt.Sprintf("SELECT COALESCE(MAX(`%s`), 0) FROM `%s`", t.id, t.name)
	if t.last != "" {
		q = "SELECT " + t.last
	}
	raw, err := runSQL(s.db, q)
	if err != nil {
		return 0, err
	}
	for _, f := range batchRows(raw, 1) {
		return f.num(0), nil
	}
	return 0, nil
}

func columnIndex(cols []TemplateColumn, name string) int {
	for i, c := range cols {
		if c.Name == name {
			return i
		}
	}
	return -1
}

// exportCarried writes the sets the template rows (cols' values in order) name, and what those name
// in turn, each set's rows of each of its tables after a DELETE of that ID's old ones. A set without
// rows is left out.
func exportCarried(src carriedSource, roots []rootRef, cols []TemplateColumn, rows []batchRow) (string, error) {
	seen := map[string]map[int]bool{}
	pending := map[string][]int{}
	add := func(kind string, id int) {
		if id <= 0 {
			return
		}
		if seen[kind] == nil {
			seen[kind] = map[int]bool{}
		}
		if !seen[kind][id] {
			seen[kind][id] = true
			pending[kind] = append(pending[kind], id)
		}
	}
	for _, f := range rows {
		value := func(name string) string {
			if i := columnIndex(cols, name); i >= 0 {
				return f[i]
			}
			return ""
		}
		for _, r := range roots {
			if columnIndex(cols, r.column) < 0 || (r.when != nil && !r.when(value)) {
				continue
			}
			add(r.kind, refID(value(r.column), false))
		}
	}
	type fetched struct {
		cols []TemplateColumn
		rows []batchRow
	}
	got := map[string]*fetched{}
	for {
		progressed := false
		for _, k := range carriedKinds {
			ids := pending[k.key]
			if len(ids) == 0 {
				continue
			}
			pending[k.key] = nil
			progressed = true
			for _, t := range k.tables {
				tc, err := src.columns(t.name)
				if err != nil {
					return "", err
				}
				rs, err := src.rows(t, tc, ids)
				if err != nil {
					return "", err
				}
				if got[t.name] == nil {
					got[t.name] = &fetched{cols: tc}
				}
				got[t.name].rows = append(got[t.name].rows, rs...)
				for _, ref := range k.refs {
					if ref.table != t.name {
						continue
					}
					if ci := columnIndex(tc, ref.column); ci >= 0 {
						for _, f := range rs {
							value := func(name string) string {
								if i := columnIndex(tc, name); i >= 0 {
									return f[i]
								}
								return ""
							}
							if ref.names(value) {
								add(ref.kind, refID(f[ci], ref.ref))
							}
						}
					}
				}
			}
		}
		if !progressed {
			break
		}
	}
	var b strings.Builder
	for _, k := range carriedKinds {
		ids := make([]int, 0, len(seen[k.key]))
		for id := range seen[k.key] {
			ids = append(ids, id)
		}
		sort.Ints(ids)
		// by is each table's rows by ID.
		by := make([]map[int][]batchRow, len(k.tables))
		for ti, t := range k.tables {
			by[ti] = map[int][]batchRow{}
			if g := got[t.name]; g != nil {
				ci := columnIndex(g.cols, t.id)
				for _, f := range g.rows {
					if ci >= 0 {
						n, _ := strconv.Atoi(f[ci])
						by[ti][n] = append(by[ti][n], f)
					}
				}
			}
		}
		for _, id := range ids {
			total := 0
			for ti := range k.tables {
				total += len(by[ti][id])
			}
			if total == 0 {
				continue
			}
			for ti, t := range k.tables {
				mine := by[ti][id]
				thing := strings.ToUpper(k.what[:1]) + k.what[1:]
				fmt.Fprintf(&b, "\n-- %s %d: %s (%d %s)\nDELETE FROM `%s` WHERE `%s` = %d;\n", thing, id, t.name, len(mine), plural(len(mine), "row", "rows"), t.name, t.id, id)
				if len(mine) == 0 {
					continue
				}
				tc := got[t.name].cols
				fmt.Fprintf(&b, "REPLACE INTO `%s` (%s) VALUES\n", t.name, columnNames(tc))
				for i, f := range mine {
					vals := make([]string, len(tc))
					for j, c := range tc {
						vals[j] = scriptValue(c, f[j])
					}
					end := ",\n"
					if i == len(mine)-1 {
						end = ";\n"
					}
					fmt.Fprintf(&b, "(%s)%s", strings.Join(vals, ", "), end)
				}
			}
		}
	}
	return b.String(), nil
}

// importSet is a set a script carries: its rows by table (the kind's tables' order), and the ID it
// comes to on the destination.
type importSet struct {
	kind *carriedKind
	id   int
	rows [][]sqlRow
	// same: the destination holds the same rows under id, naming sets that are the same too, so
	// importing leaves them as they are; to is the ID the set comes to (id when same).
	same bool
	to   int
}

func (s *importSet) count() int {
	n := 0
	for _, r := range s.rows {
		n += len(r)
	}
	return n
}

// carriedPlan is what a script's sets come to on a server.
type carriedPlan struct {
	// sets are those the template rows reach, in the kinds' order, then by ID.
	sets []*importSet
	by   map[string]map[int]*importSet
	// stmts counts the script's statements of the sets' tables, others the rows and DELETEs of sets
	// the template rows don't reach, left out; unknown the columns the tables lack.
	stmts, others int
	unknown       []string
}

// readCarried reads the sets a script carries that the template rows reach (through roots and the
// sets' own references), the columns of a row without a column list taken in its table's order.
func readCarried(src carriedSource, script string, roots []rootRef, template []sqlRow) (carriedPlan, error) {
	p := carriedPlan{by: map[string]map[int]*importSet{}}
	all := map[string]map[int]*importSet{}
	dels := map[string][]int{}
	unknown := map[string]bool{}
	for ki := range carriedKinds {
		k := &carriedKinds[ki]
		for ti, t := range k.tables {
			stmts, _, err := parseInserts(script, t.name)
			if err != nil {
				return carriedPlan{}, err
			}
			d, err := parseDeletes(script, t.name, t.id)
			if err != nil {
				return carriedPlan{}, err
			}
			p.stmts += len(stmts) + len(d)
			dels[t.name] = d
			if len(stmts) == 0 {
				continue
			}
			tc, err := src.columns(t.name)
			if err != nil {
				return carriedPlan{}, err
			}
			var order []string
			have := map[string]bool{}
			for _, c := range tc {
				order = append(order, c.Name)
				have[c.Name] = true
			}
			for _, st := range stmts {
				names := st.columns
				if names == nil {
					names = order
				}
				for _, tuple := range st.rows {
					if len(tuple) != len(names) {
						return carriedPlan{}, fmt.Errorf("a %s row has %d values for %d columns", t.name, len(tuple), len(names))
					}
					r := sqlRow{values: map[string]string{}, null: map[string]bool{}}
					for i, n := range names {
						if !have[n] {
							unknown[t.name+"."+n] = true
							continue
						}
						r.values[n] = tuple[i].text
						r.null[n] = tuple[i].null
					}
					id, err := strconv.Atoi(r.values[t.id])
					if err != nil || id <= 0 {
						return carriedPlan{}, fmt.Errorf("a %s row has no %s in %s (%q)", t.name, k.what, t.id, r.values[t.id])
					}
					if all[k.key] == nil {
						all[k.key] = map[int]*importSet{}
					}
					s := all[k.key][id]
					if s == nil {
						s = &importSet{kind: k, id: id, rows: make([][]sqlRow, len(k.tables))}
						all[k.key][id] = s
					}
					s.rows[ti] = append(s.rows[ti], r)
				}
			}
		}
	}
	for n := range unknown {
		p.unknown = append(p.unknown, n)
	}
	sort.Strings(p.unknown)
	// The sets the templates reach.
	var queue []*importSet
	reach := func(kind string, id int) {
		s := all[kind][id]
		if s == nil || p.by[kind][id] != nil {
			return
		}
		if p.by[kind] == nil {
			p.by[kind] = map[int]*importSet{}
		}
		p.by[kind][id] = s
		queue = append(queue, s)
	}
	for _, r := range template {
		value := func(name string) string { return r.values[name] }
		for _, root := range roots {
			if v, ok := r.values[root.column]; ok && (root.when == nil || root.when(value)) {
				reach(root.kind, refID(v, false))
			}
		}
	}
	for len(queue) > 0 {
		s := queue[0]
		queue = queue[1:]
		s.eachRef(func(ref carriedRef, _ sqlRow, id int) { reach(ref.kind, id) })
	}
	for _, k := range carriedKinds {
		for _, t := range k.tables {
			for _, id := range dels[t.name] {
				if p.by[k.key][id] == nil {
					p.others++
				}
			}
		}
		ids := make([]int, 0, len(all[k.key]))
		for id, s := range all[k.key] {
			if p.by[k.key][id] == nil {
				p.others += s.count()
				continue
			}
			ids = append(ids, id)
		}
		sort.Ints(ids)
		for _, id := range ids {
			p.sets = append(p.sets, all[k.key][id])
		}
	}
	return p, nil
}

// eachRef calls f with each reference of the set's rows to another set (the ID it names).
func (s *importSet) eachRef(f func(ref carriedRef, r sqlRow, id int)) {
	for _, ref := range s.kind.refs {
		for ti, t := range s.kind.tables {
			if t.name != ref.table {
				continue
			}
			for _, r := range s.rows[ti] {
				if v, ok := r.values[ref.column]; ok && ref.names(func(name string) string { return r.values[name] }) {
					if id := refID(v, ref.ref); id > 0 {
						f(ref, r, id)
					}
				}
			}
		}
	}
}

// canonical is a row's values as one text, each checked against its column as the import writes it,
// over the columns named (in cols' order), for comparing a script's rows with a server's.
func canonical(cols []TemplateColumn, named map[string]bool, value func(i int, c TemplateColumn) (string, bool, bool)) string {
	var b strings.Builder
	for i, c := range cols {
		if !named[c.Name] {
			continue
		}
		v, null, ok := value(i, c)
		if !ok {
			b.WriteString(c.Name + "\x00missing\x01")
			continue
		}
		s, err := importValue(c, v, null)
		if err != nil {
			s = "\x00" + v
		}
		b.WriteString(c.Name + "=" + s + "\x01")
	}
	return b.String()
}

// resolve works out the ID each set comes to on the destination: its own where the destination holds
// the same rows there and the sets they name are the same too, else a fresh one past the table's
// largest.
func (p *carriedPlan) resolve(src carriedSource) error {
	for _, k := range carriedKinds {
		var ids []int
		for _, s := range p.sets {
			if s.kind.key == k.key {
				ids = append(ids, s.id)
			}
		}
		if len(ids) == 0 {
			continue
		}
		for _, s := range p.by[k.key] {
			s.same = true
		}
		for ti, t := range k.tables {
			tc, err := src.columns(t.name)
			if err != nil {
				return err
			}
			named := map[string]bool{}
			for _, id := range ids {
				for _, r := range p.by[k.key][id].rows[ti] {
					for n := range r.values {
						named[n] = true
					}
				}
			}
			named[t.id] = true
			rs, err := src.rows(t, tc, ids)
			if err != nil {
				return err
			}
			ci := columnIndex(tc, t.id)
			if ci < 0 {
				return fmt.Errorf("%s has no %s column", t.name, t.id)
			}
			have := map[int][]string{}
			for _, f := range rs {
				n, _ := strconv.Atoi(f[ci])
				have[n] = append(have[n], canonical(tc, named, func(i int, c TemplateColumn) (string, bool, bool) {
					return f[i], f[i] == "NULL" && c.Nullable, true
				}))
			}
			for _, id := range ids {
				s := p.by[k.key][id]
				var mine []string
				for _, r := range s.rows[ti] {
					mine = append(mine, canonical(tc, named, func(_ int, c TemplateColumn) (string, bool, bool) {
						v, ok := r.values[c.Name]
						return v, r.null[c.Name], ok
					}))
				}
				theirs := have[id]
				sort.Strings(mine)
				sort.Strings(theirs)
				if !slices.Equal(mine, theirs) {
					s.same = false
				}
			}
		}
	}
	// A set naming a set that moves holds other values than the destination's, so it moves too.
	for changed := true; changed; {
		changed = false
		for _, s := range p.sets {
			if !s.same {
				continue
			}
			s.eachRef(func(ref carriedRef, _ sqlRow, id int) {
				if t := p.by[ref.kind][id]; t != nil && !t.same && s.same {
					s.same = false
					changed = true
				}
			})
		}
	}
	for _, k := range carriedKinds {
		next, limit := 0, int64(0)
		for _, s := range p.sets {
			if s.kind.key != k.key {
				continue
			}
			if s.same {
				s.to = s.id
				continue
			}
			if next == 0 {
				for _, t := range k.tables {
					n, err := src.maxID(t)
					if err != nil {
						return err
					}
					next = max(next, n+1)
					tc, err := src.columns(t.name)
					if err != nil {
						return err
					}
					if ci := columnIndex(tc, t.id); ci >= 0 && tc[ci].Max > 0 && (limit == 0 || tc[ci].Max < limit) {
						limit = tc[ci].Max
					}
				}
			}
			if limit > 0 && int64(next) > limit {
				return fmt.Errorf("%s %d: this server has no free ID for it (%s holds up to %d)", k.what, s.id, k.tables[0].name, limit)
			}
			s.to = next
			next++
		}
	}
	return nil
}

// rewrite sets the template rows' columns that name a carried set to the IDs the sets come to.
func (p *carriedPlan) rewrite(roots []rootRef, template []sqlRow) {
	for _, r := range template {
		value := func(name string) string { return r.values[name] }
		for _, root := range roots {
			v, ok := r.values[root.column]
			if !ok || (root.when != nil && !root.when(value)) {
				continue
			}
			if s := p.by[root.kind][refID(v, false)]; s != nil {
				r.values[root.column] = strconv.Itoa(s.to)
			}
		}
	}
}

// sql writes the sets that come to a fresh ID, under it, their references rewritten, every value
// checked against its column.
func (p *carriedPlan) sql(src carriedSource) (string, error) {
	var b strings.Builder
	for _, s := range p.sets {
		if s.same {
			continue
		}
		for ti, t := range s.kind.tables {
			tc, err := src.columns(t.name)
			if err != nil {
				return "", err
			}
			for _, r := range s.rows[ti] {
				var names, vals []string
				for _, c := range tc {
					v, ok := r.values[c.Name]
					if !ok {
						continue
					}
					null := r.null[c.Name]
					if c.Name == t.id {
						v, null = strconv.Itoa(s.to), false
					}
					for _, ref := range s.kind.refs {
						if ref.table == t.name && ref.column == c.Name && ref.names(func(name string) string { return r.values[name] }) {
							if n := p.by[ref.kind][refID(v, ref.ref)]; n != nil {
								v = refValue(n.to, ref.ref)
							}
						}
					}
					q, err := importValue(c, v, null)
					if err != nil {
						return "", fmt.Errorf("%s %d (%s): %w", s.kind.what, s.id, t.name, err)
					}
					names = append(names, "`"+c.Name+"`")
					vals = append(vals, q)
				}
				fmt.Fprintf(&b, "REPLACE INTO `%s` (%s) VALUES (%s);\n", t.name, strings.Join(names, ", "), strings.Join(vals, ", "))
			}
		}
	}
	return b.String(), nil
}

// items are the items the sets' rows name (a reference loot row's item column not counted).
func (p *carriedPlan) items() []int {
	var out []int
	for _, s := range p.sets {
		if len(s.kind.items) == 0 {
			continue
		}
		for _, r := range s.rows[0] {
			if s.kind.loot {
				if n, err := strconv.Atoi(r.values["mincountOrRef"]); err == nil && n < 0 {
					continue
				}
			}
			for _, c := range s.kind.items {
				if n, err := strconv.Atoi(r.values[c]); err == nil && n > 0 {
					out = append(out, n)
				}
			}
		}
	}
	return out
}

// What a script command's datalong names, by command (VMaNGOS's ScriptCommands.h): only the
// commands that name a template entry there; those naming a spawn's guid (respawn, open door) or
// other tables stay unsaid.
var scriptDatalong = map[string]string{
	"10": "creature", // SCRIPT_COMMAND_TEMP_SUMMON_CREATURE: creature_entry
	"15": "spell",    // SCRIPT_COMMAND_CAST_SPELL: spell_id
	"74": "spell",    // SCRIPT_COMMAND_ADD_AURA: spell_id
	"76": "object",   // SCRIPT_COMMAND_SUMMON_OBJECT: gameobject_entry
}

// scriptNames are the creatures, objects, spells and conditions the sets' script commands name, by
// kind ("creature", "object", "spell", "condition"; a row's condition_id whatever its command), for
// the plan's lookup of what the server lacks (#1045).
func (p *carriedPlan) scriptNames() map[string][]int {
	out := map[string][]int{}
	add := func(kind, v string) {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n > 0 {
			out[kind] = append(out[kind], n)
		}
	}
	for _, s := range p.sets {
		if !s.kind.script {
			continue
		}
		for _, r := range s.rows[0] {
			if kind := scriptDatalong[strings.TrimSpace(r.values["command"])]; kind != "" {
				add(kind, r.values["datalong"])
			}
			add("condition", r.values["condition_id"])
		}
	}
	return out
}

// CarriedImport is a set an import brings, which a template names by ID: what it is, its first
// table, the ID the script gives it and the one it comes to here, and its rows.
type CarriedImport struct {
	What  string `json:"what"`
	Table string `json:"table"`
	ID    int    `json:"id"`
	To    int    `json:"to"`
	Rows  int    `json:"rows"`
	// Same: this server holds the same rows under ID already, so importing leaves them as they are.
	Same bool `json:"same"`
}

// imports lists the plan's sets for the import plan.
func (p *carriedPlan) imports() []CarriedImport {
	out := make([]CarriedImport, 0, len(p.sets))
	for _, s := range p.sets {
		out = append(out, CarriedImport{What: s.kind.what, Table: s.kind.tables[0].name, ID: s.id, To: s.to, Rows: s.count(), Same: s.same})
	}
	return out
}

// planCarried reads and resolves a script's sets against the destination and rewrites the template
// rows to the IDs they come to.
func planCarried(src carriedSource, script string, roots []rootRef, template []sqlRow) (carriedPlan, error) {
	p, err := readCarried(src, script, roots, template)
	if err != nil {
		return carriedPlan{}, err
	}
	if err := p.resolve(src); err != nil {
		return carriedPlan{}, err
	}
	p.rewrite(roots, template)
	return p, nil
}

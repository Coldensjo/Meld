package vmangos

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Where a script's carried sets come to on the destination (#1043, the owner's choice: the full
// match). A set the destination holds with the same rows, naming sets that come to the same, is left
// as it is: under the script's own ID where it is there, else under any other ID holding a copy (the
// one an earlier import of the same script wrote, or a list another template there shares), so a
// repeated import writes nothing new. The sets are matched bottom up, a set only once those it names
// have their IDs (a broadcast text, then the npc_text naming it, then the menu naming that), and sets
// naming each other in a loop (a menu option opening its parent menu, a page chain back to its start)
// as one unit, which matches only as a whole. A set naming one that comes to a fresh ID gets a fresh
// one too, since no set of the destination names that ID yet.

// carriedFind asks a table for the sets that may hold a set's rows: those of n rows, one of them
// holding vals (the others any). The caller compares the rows themselves, so a source may give more.
type carriedFind struct {
	vals []findValue
	n    int
}

// findValue is a column's value a find asks for: the script's text and the value as SQL
// (importValue's), or in: the values it may hold instead, as SQL (a reference to a set the
// destination holds copies of, any of them).
type findValue struct {
	col       TemplateColumn
	raw, text string
	in        []string
}

// findLimit is the most sets one find gives, lowest IDs first.
const findLimit = 50

// findQueryLen is about the longest query a find runs as one: the query goes on mariadb's command
// line, which Windows holds to 32767 characters.
const findQueryLen = 12000

// findTextLen is the longest text a find asks for as it is; a longer one, or one that isn't ASCII,
// goes as its MD5, which keeps the query short and reaches the server whatever the command line's
// code page.
const findTextLen = 64

// findCond is the condition a find puts on v's column.
func findCond(v findValue) string {
	if v.in != nil {
		return fmt.Sprintf("`%s` IN (%s)", v.col.Name, strings.Join(v.in, ", "))
	}
	if v.col.Kind == "text" && v.text != "NULL" {
		long := len(v.raw) > findTextLen
		for i := 0; i < len(v.raw) && !long; i++ {
			long = v.raw[i] >= 0x80
		}
		if long {
			sum := md5.Sum([]byte(v.raw))
			return fmt.Sprintf("MD5(`%s`) = '%s'", v.col.Name, hex.EncodeToString(sum[:]))
		}
	}
	return fmt.Sprintf("`%s` <=> %s", v.col.Name, v.text)
}

func (s *dbSource) find(t carriedTable, qs []carriedFind) ([][]int, error) {
	out := make([][]int, len(qs))
	var parts []string
	size := 0
	flush := func() error {
		if len(parts) == 0 {
			return nil
		}
		raw, err := runSQL(s.db, strings.Join(parts, " UNION ALL "))
		if err != nil {
			return err
		}
		for _, f := range batchRows(raw, 2) {
			if k := f.num(0); k >= 0 && k < len(out) {
				out[k] = append(out[k], f.num(1))
			}
		}
		parts, size = parts[:0], 0
		return nil
	}
	for k, q := range qs {
		where := []string{"1"}
		for _, v := range q.vals {
			where = append(where, findCond(v))
		}
		part := fmt.Sprintf("(SELECT %d, `%s` FROM `%s` WHERE `%s` IN (SELECT `%s` FROM `%s` WHERE %s) GROUP BY `%s` HAVING COUNT(*) = %d ORDER BY `%s` LIMIT %d)",
			k, t.id, t.name, t.id, t.id, t.name, strings.Join(where, " AND "), t.id, q.n, t.id, findLimit)
		if size > 0 && size+len(part) > findQueryLen {
			if err := flush(); err != nil {
				return nil, err
			}
		}
		parts = append(parts, part)
		size += len(part) + len(" UNION ALL ")
	}
	if err := flush(); err != nil {
		return nil, err
	}
	for _, ids := range out {
		sort.Ints(ids)
	}
	return out, nil
}

// destRows are the destination's rows of the carried tables by ID, read as the matching needs them.
type destRows struct {
	src  carriedSource
	rows map[string]map[int][]batchRow
}

// fetch reads the rows of t under the ids not read yet, in one query.
func (d *destRows) fetch(t carriedTable, ids []int) error {
	m := d.rows[t.name]
	if m == nil {
		m = map[int][]batchRow{}
		d.rows[t.name] = m
	}
	var need []int
	for _, id := range ids {
		if _, ok := m[id]; !ok && id > 0 {
			m[id] = nil
			need = append(need, id)
		}
	}
	if len(need) == 0 {
		return nil
	}
	tc, err := d.src.columns(t.name)
	if err != nil {
		return err
	}
	rs, err := d.src.rows(t, tc, need)
	if err != nil {
		return err
	}
	ci := columnIndex(tc, t.id)
	if ci < 0 {
		return fmt.Errorf("%s has no %s column", t.name, t.id)
	}
	for _, f := range rs {
		n, _ := strconv.Atoi(f[ci])
		if _, ok := m[n]; ok {
			m[n] = append(m[n], f)
		}
	}
	return nil
}

// fetchAll reads the rows under ids of each set's kind's tables, one query a table.
func (d *destRows) fetchAll(sets []*importSet, id func(s *importSet) []int) error {
	type want struct {
		t   carriedTable
		ids []int
	}
	var order []string
	by := map[string]*want{}
	for _, s := range sets {
		for _, t := range s.kind.tables {
			w := by[t.name]
			if w == nil {
				w = &want{t: t}
				by[t.name] = w
				order = append(order, t.name)
			}
			w.ids = append(w.ids, id(s)...)
		}
	}
	for _, name := range order {
		if err := d.fetch(by[name].t, by[name].ids); err != nil {
			return err
		}
	}
	return nil
}

// matcher matches a plan's sets with the destination's.
type matcher struct {
	p    *carriedPlan
	src  carriedSource
	dest destRows
	cols map[string][]TemplateColumn
	// plain are the columns the script's rows of each table give but its id column and the columns
	// naming sets: those compared as the rows' texts. The columns naming sets are compared one by one
	// (fits).
	plain map[string]map[string]bool
	// copies are the IDs of the destination's copies of each set matched so far: a row naming the set
	// matches a row naming any of them, since each holds the same.
	copies map[*importSet]map[int]bool
}

// target is the set of the plan a row's reference names (nil for none).
func (m *matcher) target(ref carriedRef, r sqlRow) *importSet {
	v, ok := r.values[ref.column]
	if !ok || !ref.names(func(name string) string { return r.values[name] }) {
		return nil
	}
	return m.p.by[ref.kind][refID(v, ref.ref)]
}

// mineText and theirText are a script row's and a destination row's plain columns as one text.
func (m *matcher) mineText(t carriedTable, r sqlRow) string {
	return canonical(m.cols[t.name], m.plain[t.name], func(_ int, c TemplateColumn) (string, bool, bool) {
		v, ok := r.values[c.Name]
		return v, r.null[c.Name], ok
	})
}

func (m *matcher) theirText(t carriedTable, f batchRow) string {
	return canonical(m.cols[t.name], m.plain[t.name], func(i int, c TemplateColumn) (string, bool, bool) {
		return f[i], f[i] == "NULL" && c.Nullable, true
	})
}

// fits says whether the destination's row f can stand for the script's row r in the columns naming
// sets: where r names a set of the plan, f names a copy of it (for a set of the unit, the copy assign
// gives it, any while it has none yet); elsewhere f holds the same value.
func (m *matcher) fits(s *importSet, t carriedTable, r sqlRow, f batchRow, in map[*importSet]bool, assign map[*importSet]int) bool {
	tc := m.cols[t.name]
	for _, ref := range s.kind.refs {
		if ref.table != t.name {
			continue
		}
		ci := columnIndex(tc, ref.column)
		v, ok := r.values[ref.column]
		if ci < 0 || !ok {
			continue
		}
		tgt := m.target(ref, r)
		switch {
		case tgt == nil:
			c := tc[ci]
			mine, err := importValue(c, v, r.null[c.Name])
			theirs, err2 := importValue(c, f[ci], f[ci] == "NULL" && c.Nullable)
			if err != nil || err2 != nil || mine != theirs {
				return false
			}
		case in[tgt]:
			id := refID(f[ci], ref.ref)
			if to, ok := assign[tgt]; id <= 0 || (ok && to != id) {
				return false
			}
		default:
			if !m.copies[tgt][refID(f[ci], ref.ref)] {
				return false
			}
		}
	}
	return true
}

// lineUp pairs a set's rows of a table with the destination's rows theirs, the same plain columns
// and fitting rows, a pairing for each group of rows alike (Kuhn's matching, since loot rows can
// differ only in the reference loot they name): pair[i] is the row of theirs for the set's row i.
// ok is false when no pairing pairs them all.
func (m *matcher) lineUp(s *importSet, ti int, theirs []batchRow, in map[*importSet]bool, assign map[*importSet]int) ([]int, bool) {
	t, mine := s.kind.tables[ti], s.rows[ti]
	if len(mine) != len(theirs) {
		return nil, false
	}
	groups := map[string][]int{}
	for j, f := range theirs {
		k := m.theirText(t, f)
		groups[k] = append(groups[k], j)
	}
	pair := make([]int, len(mine))
	owner := make([]int, len(theirs))
	for j := range owner {
		owner[j] = -1
	}
	for i, r := range mine {
		js := groups[m.mineText(t, r)]
		seen := map[int]bool{}
		var try func(i int) bool
		try = func(i int) bool {
			for _, j := range js {
				if seen[j] || !m.fits(s, t, mine[i], theirs[j], in, assign) {
					continue
				}
				seen[j] = true
				if owner[j] < 0 || try(owner[j]) {
					owner[j], pair[i] = i, j
					return true
				}
			}
			return false
		}
		if !try(i) {
			return nil, false
		}
	}
	return pair, true
}

// derive tries the destination's set id as a copy of the unit's first set: lining up each set's rows
// with its copy's, the copy's values in the columns naming the unit's sets give their copies in turn.
// It gives each set's copy, or nil when the rows don't line up or the copies don't agree.
func (m *matcher) derive(u []*importSet, in map[*importSet]bool, id int) (map[*importSet]int, error) {
	assign := map[*importSet]int{u[0]: id}
	frontier := []*importSet{u[0]}
	for len(frontier) > 0 {
		if err := m.dest.fetchAll(frontier, func(s *importSet) []int { return []int{assign[s]} }); err != nil {
			return nil, err
		}
		var next []*importSet
		for _, s := range frontier {
			for ti, t := range s.kind.tables {
				theirs := m.dest.rows[t.name][assign[s]]
				pair, ok := m.lineUp(s, ti, theirs, in, assign)
				if !ok {
					return nil, nil
				}
				tc := m.cols[t.name]
				for i, r := range s.rows[ti] {
					for _, ref := range s.kind.refs {
						if ref.table != t.name {
							continue
						}
						tgt := m.target(ref, r)
						if !in[tgt] {
							continue
						}
						n := refID(theirs[pair[i]][columnIndex(tc, ref.column)], ref.ref)
						if have, ok := assign[tgt]; ok {
							if have != n {
								return nil, nil
							}
							continue
						}
						assign[tgt] = n
						next = append(next, tgt)
					}
				}
			}
		}
		frontier = next
	}
	if len(assign) != len(u) {
		return nil, nil
	}
	return assign, nil
}

// findFor is the find for a unit's first set: its first row of the first table it has rows in, a
// column naming a set outside the unit asked for any of that set's copies, those naming the unit's
// own sets and floats (a FLOAT column never equals a decimal literal such as 0.3) left to the
// comparison in Go. ok is false when a value doesn't fit its column, so no copy can hold it.
func (m *matcher) findFor(u []*importSet, in map[*importSet]bool) (carriedTable, carriedFind, bool) {
	s := u[0]
	for ti, t := range s.kind.tables {
		if len(s.rows[ti]) == 0 {
			continue
		}
		r := s.rows[ti][0]
		q := carriedFind{n: len(s.rows[ti])}
		refs := map[string]carriedRef{}
		for _, ref := range s.kind.refs {
			if ref.table == t.name {
				refs[ref.column] = ref
			}
		}
		for _, c := range m.cols[t.name] {
			v, ok := r.values[c.Name]
			if !ok || c.Name == t.id || c.Kind == "float" {
				continue
			}
			if ref, isRef := refs[c.Name]; isRef {
				if tgt := m.target(ref, r); tgt != nil {
					if in[tgt] {
						continue
					}
					ids := make([]int, 0, len(m.copies[tgt]))
					for id := range m.copies[tgt] {
						ids = append(ids, id)
					}
					sort.Ints(ids)
					fv := findValue{col: c}
					for _, id := range ids {
						fv.in = append(fv.in, refValue(id, ref.ref))
					}
					q.vals = append(q.vals, fv)
					continue
				}
			}
			text, err := importValue(c, v, r.null[c.Name])
			if err != nil {
				return t, q, false
			}
			q.vals = append(q.vals, findValue{col: c, raw: v, text: text})
		}
		return t, q, true
	}
	return carriedTable{}, carriedFind{}, false
}

// units are the plan's sets grouped into the loops they make by naming each other (a set alone where
// it is in none), each after the units it names (Tarjan's strongly connected components), each unit's
// sets in the plan's order.
func (p *carriedPlan) units() [][]*importSet {
	pos := map[*importSet]int{}
	for i, s := range p.sets {
		pos[s] = i
	}
	index, low := map[*importSet]int{}, map[*importSet]int{}
	on := map[*importSet]bool{}
	var stack []*importSet
	var out [][]*importSet
	var visit func(s *importSet)
	visit = func(s *importSet) {
		index[s], low[s] = len(index), len(index)
		stack = append(stack, s)
		on[s] = true
		s.eachRef(func(ref carriedRef, _ sqlRow, id int) {
			t := p.by[ref.kind][id]
			if t == nil {
				return
			}
			if _, seen := index[t]; !seen {
				visit(t)
				low[s] = min(low[s], low[t])
			} else if on[t] {
				low[s] = min(low[s], index[t])
			}
		})
		if low[s] != index[s] {
			return
		}
		var u []*importSet
		for {
			t := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			on[t] = false
			u = append(u, t)
			if t == s {
				break
			}
		}
		sort.Slice(u, func(i, j int) bool { return pos[u[i]] < pos[u[j]] })
		out = append(out, u)
	}
	for _, s := range p.sets {
		if _, seen := index[s]; !seen {
			visit(s)
		}
	}
	return out
}

// resolve works out the ID each set comes to on the destination: a copy holding the same rows (its
// own ID first), else a fresh one past the table's largest.
func (p *carriedPlan) resolve(src carriedSource) error {
	m := &matcher{p: p, src: src, dest: destRows{src: src, rows: map[string]map[int][]batchRow{}},
		cols: map[string][]TemplateColumn{}, plain: map[string]map[string]bool{}, copies: map[*importSet]map[int]bool{}}
	for _, s := range p.sets {
		s.same, s.to = false, 0
		for ti, t := range s.kind.tables {
			if m.cols[t.name] == nil {
				tc, err := src.columns(t.name)
				if err != nil {
					return err
				}
				if columnIndex(tc, t.id) < 0 {
					return fmt.Errorf("%s has no %s column", t.name, t.id)
				}
				m.cols[t.name] = tc
				m.plain[t.name] = map[string]bool{}
			}
			refCol := map[string]bool{}
			for _, ref := range s.kind.refs {
				if ref.table == t.name {
					refCol[ref.column] = true
				}
			}
			for _, r := range s.rows[ti] {
				for n := range r.values {
					if n != t.id && !refCol[n] {
						m.plain[t.name][n] = true
					}
				}
			}
		}
	}
	units := p.units()
	unitOf := map[*importSet]int{}
	for ui, u := range units {
		for _, s := range u {
			unitOf[s] = ui
		}
	}
	// level: a unit's after the units it names.
	level := make([]int, len(units))
	top := 0
	for ui, u := range units {
		for _, s := range u {
			s.eachRef(func(ref carriedRef, _ sqlRow, id int) {
				if t := p.by[ref.kind][id]; t != nil && unitOf[t] != ui {
					level[ui] = max(level[ui], level[unitOf[t]]+1)
				}
			})
		}
		top = max(top, level[ui])
	}
	match := func(u []*importSet, assign map[*importSet]int) {
		for _, s := range u {
			s.same, s.to = true, assign[s]
		}
	}
	for lv := 0; lv <= top; lv++ {
		var here [][]*importSet
		var sets []*importSet
		for ui, u := range units {
			if level[ui] != lv {
				continue
			}
			// A unit naming a set that comes to a fresh ID can't match: no copy names that ID.
			fresh := false
			for _, s := range u {
				s.eachRef(func(ref carriedRef, _ sqlRow, id int) {
					if t := p.by[ref.kind][id]; t != nil && unitOf[t] != ui && !t.same {
						fresh = true
					}
				})
			}
			if !fresh {
				here = append(here, u)
				sets = append(sets, u...)
			}
		}
		if len(here) == 0 {
			continue
		}
		// Under their own IDs first.
		if err := m.dest.fetchAll(sets, func(s *importSet) []int { return []int{s.id} }); err != nil {
			return err
		}
		type ask struct {
			u  []*importSet
			in map[*importSet]bool
		}
		var search []*ask
		for _, u := range here {
			a := &ask{u: u, in: map[*importSet]bool{}}
			for _, s := range u {
				a.in[s] = true
			}
			own, err := m.derive(u, a.in, u[0].id)
			if err != nil {
				return err
			}
			if own != nil {
				match(u, own)
				for _, s := range u {
					m.copies[s] = map[int]bool{own[s]: true}
				}
			} else {
				search = append(search, a)
			}
		}
		// Then under other IDs: one find a table for the units' first sets.
		byTable := map[string][]*ask{}
		finds := map[string][]carriedFind{}
		tables := map[string]carriedTable{}
		var order []string
		for _, a := range search {
			t, q, ok := m.findFor(a.u, a.in)
			if !ok {
				continue
			}
			if _, seen := tables[t.name]; !seen {
				tables[t.name] = t
				order = append(order, t.name)
			}
			byTable[t.name] = append(byTable[t.name], a)
			finds[t.name] = append(finds[t.name], q)
		}
		found := map[*importSet][]int{}
		var first []*importSet
		for _, name := range order {
			got, err := src.find(tables[name], finds[name])
			if err != nil {
				return err
			}
			for i, a := range byTable[name] {
				if i < len(got) {
					found[a.u[0]] = got[i]
					first = append(first, a.u[0])
				}
			}
		}
		if err := m.dest.fetchAll(first, func(s *importSet) []int { return found[s] }); err != nil {
			return err
		}
		for _, a := range search {
			for _, id := range found[a.u[0]] {
				if id == a.u[0].id {
					continue
				}
				assign, err := m.derive(a.u, a.in, id)
				if err != nil {
					return err
				}
				if assign == nil {
					continue
				}
				if !a.u[0].same {
					match(a.u, assign)
				}
				for _, s := range a.u {
					if m.copies[s] == nil {
						m.copies[s] = map[int]bool{}
					}
					m.copies[s][assign[s]] = true
				}
			}
		}
	}
	for _, k := range carriedKinds {
		next, limit := 0, int64(0)
		for _, s := range p.sets {
			if s.kind.key != k.key || s.same {
				continue
			}
			if next == 0 {
				for _, t := range k.tables {
					n, err := src.maxID(t)
					if err != nil {
						return err
					}
					next = max(next, n+1)
					tc := m.cols[t.name]
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

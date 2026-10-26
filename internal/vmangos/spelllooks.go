package vmangos

import (
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"

	"Meld/internal/mpq"
)

// A spell's look in an exported script (#381). A spell_template row names its icon (spellIconId, a
// SpellIcon.dbc row) and its visual (spellVisual1, a SpellVisual.dbc row and the SpellVisualKit.dbc
// rows of its stages) by ID only. An icon Save added or a visual the composer made is a row of Meld's
// patch, which another client lacks or holds other rows under, so the export also writes what those
// rows hold as "-- meld" comment lines, which the server ignores (the script still runs on a server
// alone):
//
//	-- meld icon <id> <texture path>
//	-- meld visual <id> <fields 1 to 15>
//	-- meld kit <id> <fields 1 to 34>
//
// Import finds each in the client's tables (the row of that ID when it holds the same, else any row
// that does) or adds it at the end, and rewrites the rows' spellIconId and spellVisual1 to the IDs it
// came to before the SQL runs. A visual's effect models, sounds and missile paths are IDs of the
// client's stock tables (the composer only picks the client's own), so they are carried as they are.

// scriptLooks are the looks a script carries, by the ID the exporting client gave them.
type scriptLooks struct {
	icons   map[int]string
	visuals map[int][]uint32
	kits    map[int][]uint32
}

// readScriptLooks reads a script's "-- meld" lines. A line it can't read is left out: the import
// then keeps that ID as the row has it, as for a script without the lines.
func readScriptLooks(script string) scriptLooks {
	l := scriptLooks{icons: map[int]string{}, visuals: map[int][]uint32{}, kits: map[int][]uint32{}}
	for _, line := range strings.Split(script, "\n") {
		rest, ok := strings.CutPrefix(strings.TrimSpace(line), "-- meld ")
		if !ok {
			continue
		}
		kind, rest, _ := strings.Cut(rest, " ")
		idText, rest, _ := strings.Cut(rest, " ")
		id, err := strconv.Atoi(idText)
		if err != nil || id <= 0 {
			continue
		}
		rest = strings.TrimSpace(rest)
		switch kind {
		case "icon":
			if rest != "" && !strings.ContainsRune(rest, 0) {
				l.icons[id] = rest
			}
		case "visual":
			if f, ok := lookFields(rest, visualFields); ok {
				l.visuals[id] = f
			}
		case "kit":
			if f, ok := lookFields(rest, kitFields); ok {
				l.kits[id] = f
			}
		}
	}
	return l
}

// lookFields reads a carried record (every field but the ID, space-separated) as a whole record of
// fields with ID 0.
func lookFields(text string, fields int) ([]uint32, bool) {
	parts := strings.Fields(text)
	if len(parts) != fields-1 {
		return nil, false
	}
	rec := make([]uint32, fields)
	for i, p := range parts {
		n, err := strconv.ParseUint(p, 10, 32)
		if err != nil {
			return nil, false
		}
		rec[i+1] = uint32(n)
	}
	return rec, true
}

func lookLine(kind string, id int, rec []uint32) string {
	parts := make([]string, len(rec)-1)
	for i, v := range rec[1:] {
		parts[i] = strconv.FormatUint(uint64(v), 10)
	}
	return fmt.Sprintf("-- meld %s %d %s\n", kind, id, strings.Join(parts, " "))
}

// looksComment is the "-- meld" lines of the icons and visuals the rows name (cols in the rows'
// order), read from the client's tables (icon, visual and kit; an ID a table lacks is left out).
func looksComment(cols []TemplateColumn, rows []batchRow, icon, visual, kit *dbcTable) string {
	iconAt, visualAt := -1, -1
	for i, c := range cols {
		switch c.Name {
		case "spellIconId":
			iconAt = i
		case "spellVisual1":
			visualAt = i
		}
	}
	ids := func(at int) []int {
		var out []int
		if at < 0 {
			return nil
		}
		for _, f := range rows {
			if id, err := strconv.Atoi(strings.TrimSpace(f[at])); err == nil && id > 0 && !slices.Contains(out, id) {
				out = append(out, id)
			}
		}
		sort.Ints(out)
		return out
	}
	var b strings.Builder
	for _, id := range ids(iconAt) {
		if r, ok := icon.row(uint32(id)); ok && icon.fields >= 2 {
			if p := commentSafe(icon.str(r, 1)); p != "" {
				fmt.Fprintf(&b, "-- meld icon %d %s\n", id, p)
			}
		}
	}
	var kits []int
	for _, id := range ids(visualAt) {
		r, ok := visual.row(uint32(id))
		if !ok || visual.fields != visualFields {
			continue
		}
		rec := visual.record(r)
		b.WriteString(lookLine("visual", id, rec))
		for _, k := range rec[visualKitBase : visualKitBase+visualStages] {
			if k != 0 && !slices.Contains(kits, int(k)) {
				kits = append(kits, int(k))
			}
		}
	}
	sort.Ints(kits)
	for _, id := range kits {
		if r, ok := kit.row(uint32(id)); ok && kit.fields == kitFields {
			b.WriteString(lookLine("kit", id, kit.record(r)))
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return "-- The meld lines carry the spells' icons and visuals, so Import on another client finds or adds them.\n" + b.String()
}

// lookPlan is what importing a script's looks comes to in a client: the ID each carried icon and
// visual gets there (a changed one only), and the tables with the rows it adds.
type lookPlan struct {
	icons, visuals map[int]int
	files          []mpq.File
}

// planLooks works out the carried looks l in the client's tables (icon, visual and kit; nil out for
// a table left alone). It only touches the IDs the rows use (used icons and visuals).
func planLooks(l scriptLooks, usedIcons, usedVisuals map[int]bool, iconDBC, visualDBC, kitDBC []byte) (lookPlan, error) {
	p := lookPlan{icons: map[int]int{}, visuals: map[int]int{}}
	var iconOut, visualOut, kitOut []byte
	ids := func(m map[int]bool) []int {
		out := make([]int, 0, len(m))
		for id := range m {
			out = append(out, id)
		}
		sort.Ints(out)
		return out
	}
	for _, id := range ids(usedIcons) {
		path, ok := l.icons[id]
		if !ok {
			continue
		}
		cur := iconDBC
		if iconOut != nil {
			cur = iconOut
		}
		t, err := parseDBC(cur)
		if err != nil {
			return lookPlan{}, fmt.Errorf("SpellIcon.dbc: %w", err)
		}
		if r, ok := t.row(uint32(id)); ok && t.fields >= 2 && strings.EqualFold(t.str(r, 1), path) {
			continue
		}
		nid, out, err := spellIconPathRow(cur, path)
		if err != nil {
			return lookPlan{}, err
		}
		if out != nil {
			iconOut = out
		}
		p.icons[id] = nid
	}
	// findOrAdd is the ID of a row holding rec's fields (but the ID) in table b: id's own, else the
	// first that does, else a new row at the end (the table then returned).
	findOrAdd := func(b []byte, id int, rec []uint32) (int, []byte, error) {
		t, err := parseDBC(b)
		if err != nil {
			return 0, nil, err
		}
		if t.fields != len(rec) || t.recSize != t.fields*4 {
			return 0, nil, fmt.Errorf("a table of %d fields for a record of %d", t.fields, len(rec))
		}
		same := func(r int) bool {
			for f := 1; f < len(rec); f++ {
				if t.u32(r, f) != rec[f] {
					return false
				}
			}
			return true
		}
		if r, ok := t.row(uint32(id)); ok && same(r) {
			return id, nil, nil
		}
		top := uint32(0)
		for r := 0; r < t.records; r++ {
			if same(r) {
				return int(t.u32(r, 0)), nil, nil
			}
			top = max(top, t.u32(r, 0))
		}
		rec = append([]uint32(nil), rec...)
		rec[0] = top + 1
		out, err := putRecord(b, rec, nil)
		return int(rec[0]), out, err
	}
	kitIDs := map[int]int{}
	for _, id := range ids(usedVisuals) {
		carried, ok := l.visuals[id]
		if !ok {
			continue
		}
		rec := append([]uint32(nil), carried...)
		for s := visualKitBase; s < visualKitBase+visualStages; s++ {
			k := int(rec[s])
			kr, ok := l.kits[k]
			if k == 0 || !ok {
				continue
			}
			nk, done := kitIDs[k]
			if !done {
				cur := kitDBC
				if kitOut != nil {
					cur = kitOut
				}
				var out []byte
				var err error
				if nk, out, err = findOrAdd(cur, k, kr); err != nil {
					return lookPlan{}, fmt.Errorf("SpellVisualKit.dbc: %w", err)
				}
				if out != nil {
					kitOut = out
				}
				kitIDs[k] = nk
			}
			rec[s] = uint32(nk)
		}
		cur := visualDBC
		if visualOut != nil {
			cur = visualOut
		}
		nid, out, err := findOrAdd(cur, id, rec)
		if err != nil {
			return lookPlan{}, fmt.Errorf("SpellVisual.dbc: %w", err)
		}
		if out != nil {
			visualOut = out
		}
		if nid != id {
			p.visuals[id] = nid
		}
	}
	if iconOut != nil {
		p.files = append(p.files, mpq.File{Name: SpellIconPath, Data: iconOut})
	}
	if kitOut != nil {
		p.files = append(p.files, mpq.File{Name: SpellVisualKitPath, Data: kitOut})
	}
	if visualOut != nil {
		p.files = append(p.files, mpq.File{Name: SpellVisualPath, Data: visualOut})
	}
	return p, nil
}

// lookID is a row's ID value as a number (0 for none or not a number).
func lookID(v string) int {
	id, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || id < 0 {
		return 0
	}
	return id
}

// planScriptLooks plans the looks a script carries for its rows in the client of dataDir (its
// tables as the game will have them) and rewrites the rows' spellIconId and spellVisual1 to the IDs
// they come to.
func planScriptLooks(set *mpq.Set, dataDir, script string, rows []sqlRow) (lookPlan, error) {
	l := readScriptLooks(script)
	usedIcons, usedVisuals := map[int]bool{}, map[int]bool{}
	for _, r := range rows {
		if id := lookID(r.values["spellIconId"]); id > 0 {
			usedIcons[id] = true
		}
		if id := lookID(r.values["spellVisual1"]); id > 0 {
			usedVisuals[id] = true
		}
	}
	p := lookPlan{icons: map[int]int{}, visuals: map[int]int{}}
	if len(l.icons) == 0 && len(l.visuals) == 0 {
		return p, nil
	}
	tables := map[string][]byte{}
	for _, name := range []string{SpellIconPath, SpellVisualPath, SpellVisualKitPath} {
		b, err := readOverlay(set, dataDir, name)
		if err != nil {
			return lookPlan{}, err
		}
		tables[name] = b
	}
	p, err := planLooks(l, usedIcons, usedVisuals, tables[SpellIconPath], tables[SpellVisualPath], tables[SpellVisualKitPath])
	if err != nil {
		return lookPlan{}, err
	}
	p.rewrite(rows)
	return p, nil
}

// rewrite sets the rows' spellIconId and spellVisual1 to the IDs the plan gives them.
func (p lookPlan) rewrite(rows []sqlRow) {
	for _, r := range rows {
		if n, ok := p.icons[lookID(r.values["spellIconId"])]; ok {
			r.values["spellIconId"] = strconv.Itoa(n)
		}
		if n, ok := p.visuals[lookID(r.values["spellVisual1"])]; ok {
			r.values["spellVisual1"] = strconv.Itoa(n)
		}
	}
}

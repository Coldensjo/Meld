package vmangos

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// File › Check Map's World data group (#951): the id columns of the creature and game object
// templates the open map's spawns use, checked against the rows they name. The editor says which
// columns name which kind of row (its field lists, frontend/src/lib/check/worldData.ts, which reuse
// the editors' pickers); this side reads the templates' newest rows, their quest relations and the
// rows of their own that a role needs (a vendor's npc_vendor, a trainer's npc_trainer, an EventAI
// creature's events), and asks each named table for the ids it has: one query a table over the
// whole set, not a query a spawn. Which missing row is an error is the editor's call.

// RefColumn is a template column that names a row of Kind (a picker's kind, such as "gossip" or
// "creature loot"); for a game object, only in templates of object type Type.
type RefColumn struct {
	Type int    `json:"type"`
	Col  string `json:"col"`
	Kind string `json:"kind"`
}

// WorldDataQuery is the templates to check and their id columns.
type WorldDataQuery struct {
	CreatureEntries []int       `json:"creatureEntries"`
	ObjectEntries   []int       `json:"objectEntries"`
	CreatureRefs    []RefColumn `json:"creatureRefs"`
	ObjectRefs      []RefColumn `json:"objectRefs"`
}

// WorldTemplate is a checked template's newest row as the check needs it.
type WorldTemplate struct {
	Entry int    `json:"entry"`
	Name  string `json:"name"`
	// NpcFlags and AIName are a creature's; Type is a game object's.
	NpcFlags int    `json:"npcFlags"`
	AIName   string `json:"aiName"`
	Type     int    `json:"type"`
	// Values holds the asked id columns that are set (not 0), by column.
	Values map[string]int `json:"values"`
	// Starts and Ends are the quests its quest relations name.
	Starts []int `json:"starts"`
	Ends   []int `json:"ends"`
	// OwnVendor and OwnTrainer say whether a creature has npc_vendor or npc_trainer rows of its own,
	// AIEvents how many creature_ai_events rows it has.
	OwnVendor  bool `json:"ownVendor"`
	OwnTrainer bool `json:"ownTrainer"`
	AIEvents   int  `json:"aiEvents"`
}

// WorldDataReport is what the database has of a WorldDataQuery.
type WorldDataReport struct {
	Creatures []WorldTemplate `json:"creatures"`
	Objects   []WorldTemplate `json:"objects"`
	// Missing lists, by kind, the set ids that no row of the kind's table has.
	Missing map[string][]int `json:"missing"`
	// Tables names each checked kind's table, for the findings' messages.
	Tables map[string]string `json:"tables"`
	// Unchecked lists the asked kinds that could not be checked (a lock without the client's Lock.dbc,
	// a kind this side has no table for).
	Unchecked []string `json:"unchecked"`
}

// refTargets are the tables (as `table`.`column`) that hold each kind's ids. An event is either a
// script in event_scripts or a C++ one named in scripted_event_id. The kinds the pickers name
// through worldRowsSQL read the same tables (TestRefTargetsMatchThePickers).
var refTargets = map[string][]string{
	"gossip":          {"gossip_menu.entry"},
	"vendor":          {"npc_vendor_template.entry"},
	"trainer":         {"npc_trainer_template.entry"},
	"equipment":       {"creature_equip_template.entry"},
	"creature loot":   {"creature_loot_template.entry"},
	"pickpocket loot": {"pickpocketing_loot_template.entry"},
	"skinning loot":   {"skinning_loot_template.entry"},
	"spell list":      {"creature_spells.entry"},
	"loot":            {"gameobject_loot_template.entry"},
	"page":            {"page_text.entry"},
	"text":            {"broadcast_text.entry"},
	"event":           {"event_scripts.id", "scripted_event_id.id"},
	"creature":        {"creature_template.entry"},
	"object":          {"gameobject_template.entry"},
	"quest":           {"quest_template.entry"},
	"spell":           {"spell_template.entry"},
}

// lockKind is the kind checked against the client's Lock.dbc rather than a table.
const lockKind = "lock"

// columnName is what an asked column may be: it goes into the SQL as is.
var columnName = regexp.MustCompile(`^[A-Za-z0-9_]+$`)

// knownRefs is refs whose column the table has (by its SHOW COLUMNS) and whose kind is checked.
func knownRefs(refs []RefColumn, cols []TemplateColumn) []RefColumn {
	have := map[string]bool{}
	for _, c := range cols {
		have[c.Name] = true
	}
	var out []RefColumn
	for _, r := range refs {
		if !columnName.MatchString(r.Col) || !have[r.Col] {
			continue
		}
		if _, ok := refTargets[r.Kind]; ok || r.Kind == lockKind {
			out = append(out, r)
		}
	}
	return out
}

// refColumns is the distinct columns of refs, in order.
func refColumns(refs []RefColumn) []string {
	seen := map[string]bool{}
	var out []string
	for _, r := range refs {
		if !seen[r.Col] {
			seen[r.Col] = true
			out = append(out, r.Col)
		}
	}
	return out
}

// newestRow is the WHERE that keeps a template table's newest patch row of each entry, as `t`.
func newestRow(table string) string {
	return "t.patch = (SELECT MAX(patch) FROM " + table + " WHERE entry = t.entry)"
}

// creatureRowsSQL selects the creatures' entry, name, npc_flags, ai_name, whether they have npc_vendor
// and npc_trainer rows, their EventAI event count and then cols.
func creatureRowsSQL(entries []int, cols []string) string {
	list := idList(entries)
	if list == "" {
		return ""
	}
	sel := "t.entry, t.name, t.npc_flags, t.ai_name, EXISTS(SELECT 1 FROM npc_vendor v WHERE v.entry = t.entry), EXISTS(SELECT 1 FROM npc_trainer r WHERE r.entry = t.entry), " +
		"(SELECT COUNT(*) FROM creature_ai_events e WHERE e.creature_id = t.entry)"
	for _, c := range cols {
		sel += ", t.`" + c + "`"
	}
	return "SELECT " + sel + " FROM creature_template t WHERE t.entry IN (" + list + ") AND " + newestRow("creature_template") + " ORDER BY t.entry"
}

// objectRowsSQL selects the game objects' entry, name, type and then cols.
func objectRowsSQL(entries []int, cols []string) string {
	list := idList(entries)
	if list == "" {
		return ""
	}
	sel := "t.entry, t.name, t.type"
	for _, c := range cols {
		sel += ", t.`" + c + "`"
	}
	return "SELECT " + sel + " FROM gameobject_template t WHERE t.entry IN (" + list + ") AND " + newestRow("gameobject_template") + " ORDER BY t.entry"
}

// setIDs is the set id columns of a row (fields from `from` on, in cols' order) that refs name for
// an object of type typ (any type when typ < 0).
func setIDs(f batchRow, from int, cols []string, refs []RefColumn, typ int) map[string]int {
	at := map[string]int{}
	for i, c := range cols {
		at[c] = from + i
	}
	out := map[string]int{}
	for _, r := range refs {
		if typ >= 0 && r.Type != typ {
			continue
		}
		if v := f.num(at[r.Col]); v > 0 {
			out[r.Col] = v
		}
	}
	return out
}

// parseCreatureRows reads creatureRowsSQL's output.
func parseCreatureRows(raw []byte, cols []string, refs []RefColumn) []WorldTemplate {
	var out []WorldTemplate
	for _, f := range batchRows(raw, 7+len(cols)) {
		out = append(out, WorldTemplate{
			Entry: f.num(0), Name: f[1], NpcFlags: f.num(2), AIName: nullText(f[3]), Type: -1,
			OwnVendor: f.num(4) != 0, OwnTrainer: f.num(5) != 0, AIEvents: f.num(6),
			Values: setIDs(f, 7, cols, refs, -1), Starts: []int{}, Ends: []int{},
		})
	}
	return out
}

// parseObjectRows reads objectRowsSQL's output.
func parseObjectRows(raw []byte, cols []string, refs []RefColumn) []WorldTemplate {
	var out []WorldTemplate
	for _, f := range batchRows(raw, 3+len(cols)) {
		typ := f.num(2)
		out = append(out, WorldTemplate{Entry: f.num(0), Name: f[1], Type: typ, Values: setIDs(f, 3, cols, refs, typ), Starts: []int{}, Ends: []int{}})
	}
	return out
}

// nullText is a text field, "" for NULL.
func nullText(s string) string {
	if s == "NULL" {
		return ""
	}
	return s
}

// relationRowsSQL selects a quest relation table's (id, quest) rows of the entries.
func relationRowsSQL(table string, entries []int) string {
	list := idList(entries)
	if list == "" {
		return ""
	}
	return "SELECT DISTINCT id, quest FROM " + table + " WHERE id IN (" + list + ") ORDER BY id, quest"
}

// existingSQL selects the ids among ids that kind's tables hold.
func existingSQL(kind string, ids []int) string {
	list := idList(ids)
	if list == "" {
		return ""
	}
	var parts []string
	for _, tc := range refTargets[kind] {
		table, col, _ := strings.Cut(tc, ".")
		parts = append(parts, "SELECT DISTINCT `"+col+"` FROM `"+table+"` WHERE `"+col+"` IN ("+list+")")
	}
	return strings.Join(parts, " UNION ")
}

// CheckWorldData reads the query's templates and tells which of the rows their id columns name are
// missing. dataDir is the client's Data folder, for the locks ("" leaves them unchecked).
func CheckWorldData(serverRoot, dataDir string, q WorldDataQuery) (WorldDataReport, error) {
	r := WorldDataReport{Creatures: []WorldTemplate{}, Objects: []WorldTemplate{}, Missing: map[string][]int{}, Tables: map[string]string{}, Unchecked: []string{}}
	db, err := openWorld(serverRoot)
	if err != nil {
		return r, err
	}
	read := func(table, sql string) ([]byte, error) {
		if sql == "" {
			return nil, nil
		}
		raw, err := runSQL(db, sql)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", table, err)
		}
		return raw, nil
	}
	refsOf := func(table string, entries []int, refs []RefColumn) ([]RefColumn, error) {
		if len(entries) == 0 {
			return nil, nil
		}
		cols, err := templateColumns(db, table)
		if err != nil {
			return nil, err
		}
		return knownRefs(refs, cols), nil
	}
	cRefs, err := refsOf("creature_template", q.CreatureEntries, q.CreatureRefs)
	if err != nil {
		return r, err
	}
	oRefs, err := refsOf("gameobject_template", q.ObjectEntries, q.ObjectRefs)
	if err != nil {
		return r, err
	}
	cCols, oCols := refColumns(cRefs), refColumns(oRefs)
	raw, err := read("creature_template", creatureRowsSQL(q.CreatureEntries, cCols))
	if err != nil {
		return r, err
	}
	if rows := parseCreatureRows(raw, cCols, cRefs); rows != nil {
		r.Creatures = rows
	}
	if raw, err = read("gameobject_template", objectRowsSQL(q.ObjectEntries, oCols)); err != nil {
		return r, err
	}
	if rows := parseObjectRows(raw, oCols, oRefs); rows != nil {
		r.Objects = rows
	}

	// The quests each template starts and ends.
	for _, kind := range []string{"creature", "object"} {
		list := r.Creatures
		if kind == "object" {
			list = r.Objects
		}
		if len(list) == 0 {
			continue
		}
		by := map[int]*WorldTemplate{}
		entries := make([]int, len(list))
		for i := range list {
			by[list[i].Entry] = &list[i]
			entries[i] = list[i].Entry
		}
		starts, ends := relationTables(kind)
		for _, rel := range []struct {
			table string
			ends  bool
		}{{starts, false}, {ends, true}} {
			raw, err := read(rel.table, relationRowsSQL(rel.table, entries))
			if err != nil {
				return r, err
			}
			for _, f := range batchRows(raw, 2) {
				t := by[f.num(0)]
				if t == nil || f.num(1) <= 0 {
					continue
				}
				if rel.ends {
					t.Ends = append(t.Ends, f.num(1))
				} else {
					t.Starts = append(t.Starts, f.num(1))
				}
			}
		}
	}

	// The set ids by kind, then one query a kind for those its tables have.
	asked := map[string][]int{}
	note := func(kind string, id int) { asked[kind] = append(asked[kind], id) }
	for _, set := range []struct {
		list []WorldTemplate
		refs []RefColumn
	}{{r.Creatures, cRefs}, {r.Objects, oRefs}} {
		for _, t := range set.list {
			for _, ref := range set.refs {
				if v, ok := t.Values[ref.Col]; ok && (t.Type < 0 || ref.Type == t.Type) {
					note(ref.Kind, v)
				}
			}
			for _, quest := range append(append([]int{}, t.Starts...), t.Ends...) {
				note("quest", quest)
			}
		}
	}
	kinds := make([]string, 0, len(asked))
	for k := range asked {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	for _, kind := range kinds {
		ids := asked[kind]
		if kind == lockKind {
			if dataDir == "" {
				r.Unchecked = append(r.Unchecked, kind)
				continue
			}
			t, err := LoadObjectTables(dataDir)
			if err != nil {
				r.Unchecked = append(r.Unchecked, kind)
				continue
			}
			have := make([]string, len(t.Locks))
			for i, l := range t.Locks {
				have[i] = fmt.Sprint(l.ID)
			}
			r.Tables[kind] = "Lock.dbc"
			r.Missing[kind] = missingEntries(ids, []byte(strings.Join(have, "\n")))
			continue
		}
		targets := refTargets[kind]
		if len(targets) == 0 {
			r.Unchecked = append(r.Unchecked, kind)
			continue
		}
		names := make([]string, len(targets))
		for i, tc := range targets {
			names[i], _, _ = strings.Cut(tc, ".")
		}
		r.Tables[kind] = strings.Join(names, " or ")
		raw, err := read(r.Tables[kind], existingSQL(kind, ids))
		if err != nil {
			return r, err
		}
		r.Missing[kind] = missingEntries(ids, raw)
	}
	for k, v := range r.Missing {
		if v == nil {
			r.Missing[k] = []int{}
		}
	}
	return r, nil
}

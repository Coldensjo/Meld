package vmangos

import (
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// The game object editor's pickers (#702): the client tables a gameobject_template data column
// names (locks, languages, page materials, spell focuses, cinematics, flight paths, auction houses),
// read once per data folder, and the world database rows the rest name (gossip menus, pages,
// texts, event scripts, loot), named by their first line and searched by text or number.

// LockPart is one way to open a lock (a slot of Lock.dbc): with an item (Type 1, Index its entry)
// or a lock type (Type 2, Index its LockType.dbc row, such as Pick Lock or Herbalism) at skill Skill.
type LockPart struct {
	Type  int `json:"type"`
	Index int `json:"index"`
	Skill int `json:"skill"`
}

// LockInfo is a Lock.dbc row: the ways to open it.
type LockInfo struct {
	ID    int        `json:"id"`
	Parts []LockPart `json:"parts"`
}

// ObjectTables are the client's tables the game object editor names data columns from.
type ObjectTables struct {
	Locks         []LockInfo `json:"locks"`
	LockTypes     []NamedID  `json:"lockTypes"`
	Languages     []NamedID  `json:"languages"`
	PageMaterials []NamedID  `json:"pageMaterials"`
	SpellFocus    []NamedID  `json:"spellFocus"`
	Cinematics    []NamedID  `json:"cinematics"`
	TaxiPaths     []NamedID  `json:"taxiPaths"`
	AuctionHouses []NamedID  `json:"auctionHouses"`
}

var objectTables = struct {
	sync.Mutex
	by map[string]*ObjectTables
}{by: map[string]*ObjectTables{}}

// lockInfos reads Lock.dbc (1.12: ID, Type[8], Index[8], Skill[8], Action[8]), leaving out the
// empty slots.
func lockInfos(t *dbcTable) ([]LockInfo, error) {
	if t.fields < 25 {
		return nil, fmt.Errorf("Lock.dbc has %d fields, fewer than 1.12's 33", t.fields)
	}
	out := make([]LockInfo, 0, t.records)
	for r := 0; r < t.records; r++ {
		l := LockInfo{ID: int(t.u32(r, 0)), Parts: []LockPart{}}
		for s := 0; s < 8; s++ {
			typ := int(t.u32(r, 1+s))
			if typ == 0 {
				continue
			}
			l.Parts = append(l.Parts, LockPart{Type: typ, Index: int(t.u32(r, 9+s)), Skill: int(t.u32(r, 17+s))})
		}
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// byIDNamed lists a table's rows by ID with name(t, r), leaving out unnamed ones.
func byIDNamed(t *dbcTable, name func(r int) string) []NamedID {
	out := make([]NamedID, 0, t.records)
	for r := 0; r < t.records; r++ {
		if n := name(r); n != "" {
			out = append(out, NamedID{ID: int(t.u32(r, 0)), Name: n})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// taxiPathNames names TaxiPath.dbc's rows (ID, from node, to node, cost) by their nodes' names in
// TaxiNodes.dbc (ID, map, x, y, z, name).
func taxiPathNames(paths, nodes *dbcTable) []NamedID {
	node := func(id uint32) string {
		if r, ok := nodes.row(id); ok && nodes.fields > 5 {
			if n := nodes.str(r, 5); n != "" {
				return n
			}
		}
		return "node " + strconv.Itoa(int(id))
	}
	return byIDNamed(paths, func(r int) string { return node(paths.u32(r, 1)) + " to " + node(paths.u32(r, 2)) })
}

// cinematicNames names CinematicSequences.dbc's rows (ID, sound, camera[8]) by their first camera's
// model in CinematicCamera.dbc (ID, model path, ...), such as "FlybyUndead".
func cinematicNames(seqs, cams *dbcTable) []NamedID {
	return byIDNamed(seqs, func(r int) string {
		if seqs.fields < 3 {
			return ""
		}
		c, ok := cams.row(seqs.u32(r, 2))
		if !ok || cams.fields < 2 {
			return "Cinematic " + strconv.Itoa(int(seqs.u32(r, 0)))
		}
		m := strings.ReplaceAll(cams.str(c, 1), `\`, "/")
		return strings.TrimSuffix(path.Base(m), path.Ext(m))
	})
}

// LoadObjectTables reads the tables, once per client data folder.
func LoadObjectTables(dataDir string) (ObjectTables, error) {
	objectTables.Lock()
	defer objectTables.Unlock()
	if t, ok := objectTables.by[dataDir]; ok {
		return *t, nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return ObjectTables{}, err
	}
	defer set.Close()
	tables := map[string]*dbcTable{}
	for _, name := range []string{"Lock", "LockType", "Languages", "PageTextMaterial", "SpellFocusObject", "CinematicSequences", "CinematicCamera", "TaxiPath", "TaxiNodes", "AuctionHouse"} {
		b, err := set.ReadFile(`DBFilesClient\` + name + `.dbc`)
		if err != nil {
			return ObjectTables{}, fmt.Errorf("%s.dbc: %w", name, err)
		}
		if tables[name], err = parseDBC(b); err != nil {
			return ObjectTables{}, fmt.Errorf("%s.dbc: %w", name, err)
		}
	}
	// The 1.12 layouts: the name is field 1 of LockType, Languages, PageTextMaterial and
	// SpellFocusObject, and field 4 of AuctionHouse (ID, faction, deposit, cut, name).
	field := func(name string, f int) []NamedID {
		t := tables[name]
		if t.fields <= f {
			return []NamedID{}
		}
		return byIDNamed(t, func(r int) string { return t.str(r, f) })
	}
	out := ObjectTables{
		LockTypes:     field("LockType", 1),
		Languages:     field("Languages", 1),
		PageMaterials: field("PageTextMaterial", 1),
		SpellFocus:    field("SpellFocusObject", 1),
		AuctionHouses: field("AuctionHouse", 4),
		Cinematics:    cinematicNames(tables["CinematicSequences"], tables["CinematicCamera"]),
		TaxiPaths:     taxiPathNames(tables["TaxiPath"], tables["TaxiNodes"]),
	}
	if out.Locks, err = lockInfos(tables["Lock"]); err != nil {
		return ObjectTables{}, err
	}
	objectTables.by[dataDir] = &out
	return out, nil
}

// worldRefSQL is the query that names world database rows of kind: "gossip" (a gossip menu by its
// first text), "page" (page_text), "text" (broadcast_text), "event" (event_scripts, by its
// command count), "loot" (gameobject_loot_template, by its row count) or "disenchant"
// (disenchant_loot_template, by its items). where picks the rows
// (with `id` the row's number). Each row is the number and its name.
func worldRefSQL(kind, where string) (string, error) {
	switch kind {
	case "gossip":
		return "SELECT id, name FROM (SELECT g.entry AS id, COALESCE(NULLIF(b.male_text, ''), b.female_text, '') AS name, g.text_id AS t " +
			"FROM gossip_menu g LEFT JOIN npc_text n ON n.ID = g.text_id LEFT JOIN broadcast_text b ON b.entry = n.BroadcastTextID0) r WHERE " + where + " ORDER BY id, t", nil
	case "page":
		return "SELECT id, name FROM (SELECT entry AS id, text AS name FROM page_text) r WHERE " + where + " ORDER BY id", nil
	case "text":
		return "SELECT id, name FROM (SELECT entry AS id, COALESCE(NULLIF(male_text, ''), female_text, '') AS name FROM broadcast_text) r WHERE " + where + " ORDER BY id", nil
	case "event":
		return "SELECT id, name FROM (SELECT id, CONCAT(COUNT(*), IF(COUNT(*) = 1, ' script command', ' script commands')) AS name FROM event_scripts GROUP BY id) r WHERE " + where + " ORDER BY id", nil
	case "loot":
		return "SELECT id, name FROM (SELECT entry AS id, CONCAT(COUNT(*), IF(COUNT(*) = 1, ' loot row', ' loot rows')) AS name FROM gameobject_loot_template GROUP BY entry) r WHERE " + where + " ORDER BY id", nil
	case "disenchant":
		// An item's disenchant_id (#701), by the items it gives, likeliest first.
		return "SELECT id, name FROM (SELECT d.entry AS id, GROUP_CONCAT(DISTINCT COALESCE(i.name, CONCAT('item ', d.item)) ORDER BY d.ChanceOrQuestChance DESC SEPARATOR ', ') AS name " +
			"FROM disenchant_loot_template d LEFT JOIN item_template i ON i.entry = d.item AND i.patch = (SELECT MAX(patch) FROM item_template WHERE entry = d.item) GROUP BY d.entry) r WHERE " + where + " ORDER BY id", nil
	}
	return "", fmt.Errorf("no world rows of kind %q", kind)
}

// htmlTag matches a tag of a page's HTML (<HTML>, <BODY>, <P align="center">).
var htmlTag = regexp.MustCompile(`<[^<>]*>`)

// firstLine is a text's first line that has words, without HTML tags, cut to 80 characters, as a
// picker names a row by it.
func firstLine(s string) string {
	lines := strings.FieldsFunc(htmlTag.ReplaceAllString(s, "\n"), func(r rune) bool { return r == '\r' || r == '\n' })
	s = ""
	for i, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			s = l
			if i < len(lines)-1 {
				s += " …"
			}
			break
		}
	}
	if r := []rune(s); len(r) > 80 {
		s = string(r[:79]) + "…"
	}
	return s
}

// worldRefs runs a worldRefSQL query, keeping each number's first row.
func worldRefs(serverRoot, kind, where string, limit int) ([]NamedID, error) {
	q, err := worldRefSQL(kind, where)
	if err != nil {
		return nil, err
	}
	if limit > 0 {
		q += " LIMIT " + strconv.Itoa(limit)
	}
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, q)
	if err != nil {
		return nil, err
	}
	out := []NamedID{}
	seen := map[int]bool{}
	for _, f := range tsvRows(raw, 2) {
		id, err := strconv.Atoi(f[0])
		if err != nil || seen[id] {
			continue
		}
		seen[id] = true
		name := firstLine(unescapeBatch(f[1]))
		if name == "" {
			name = "(no text)"
		}
		out = append(out, NamedID{ID: id, Name: name})
	}
	return out, nil
}

// WorldRefNames names the world database rows of kind (see worldRefSQL) numbered ids, leaving out
// those it doesn't have.
func WorldRefNames(serverRoot, kind string, ids []int) (map[int]string, error) {
	out := map[int]string{}
	if len(ids) == 0 {
		return out, nil
	}
	list := make([]string, len(ids))
	for i, id := range ids {
		list[i] = strconv.Itoa(id)
	}
	rows, err := worldRefs(serverRoot, kind, "id IN ("+strings.Join(list, ",")+")", 0)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ID] = r.Name
	}
	return out, nil
}

// worldRefMatch is the WHERE of a search for text: the rows numbered text, and for the kinds named
// by a text, the rows whose text has it.
func worldRefMatch(kind, text string) string {
	var parts []string
	if n, err := strconv.Atoi(text); err == nil {
		parts = append(parts, "id = "+strconv.Itoa(n))
	}
	if kind == "gossip" || kind == "page" || kind == "text" || kind == "disenchant" {
		parts = append(parts, "name LIKE "+likePattern(text))
	}
	if len(parts) == 0 {
		return "FALSE"
	}
	return strings.Join(parts, " OR ")
}

// SearchWorldRefs lists the rows of kind (see worldRefSQL) numbered text or whose text has it, at
// most limit of them.
func SearchWorldRefs(serverRoot, kind, text string, limit int) ([]NamedID, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return []NamedID{}, nil
	}
	return worldRefs(serverRoot, kind, worldRefMatch(kind, text), max(limit, 1))
}

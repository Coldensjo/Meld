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

// itemNameSQL is an item's name by its entry (an SQL expression), from its newest patch's row, or
// "item <entry>" when the server has no such item.
func itemNameSQL(entry string) string {
	return "COALESCE((SELECT name FROM item_template WHERE entry = " + entry + " ORDER BY patch DESC LIMIT 1), CONCAT('item ', " + entry + "))"
}

// spellNameSQL is a spell's name and rank by its ID (an SQL expression), from spell_template's
// newest build, or "spell <id>" when the server has no such spell.
func spellNameSQL(id string) string {
	return "COALESCE((SELECT CONCAT(name, IF(nameSubtext <> '', CONCAT(' (', nameSubtext, ')'), '')) FROM spell_template WHERE entry = " + id +
		" ORDER BY build DESC LIMIT 1), CONCAT('spell ', " + id + "))"
}

// countSQL is "<n> <thing>s" for COUNT(expr), with the singular for one.
func countSQL(expr, thing string) string {
	return "CONCAT(COUNT(" + expr + "), IF(COUNT(" + expr + ") = 1, ' " + thing + "', ' " + thing + "s'))"
}

// lootListSQL names each entry of a loot table by its row count and its likeliest drops (an item, or
// a reference_loot_template entry for a negative mincountOrRef).
func lootListSQL(table string) string {
	return "SELECT entry AS id, CONCAT(" + countSQL("*", "item") + ", ': ', GROUP_CONCAT(IF(mincountOrRef < 0, CONCAT('reference loot ', -mincountOrRef), " + itemNameSQL("item") +
		") ORDER BY ABS(ChanceOrQuestChance) DESC SEPARATOR ', ' LIMIT 6)) AS name, 0 AS ord FROM " + table + " GROUP BY entry"
}

// scriptListSQL names each id of a script table (gossip_scripts, quest_start_scripts…) by its
// command count and its first commands' comments.
func scriptListSQL(table string) string {
	return "SELECT id, CONCAT_WS(': ', " + countSQL("*", "command") + ", GROUP_CONCAT(DISTINCT NULLIF(comments, '') ORDER BY delay SEPARATOR '; ' LIMIT 3)) AS name, 0 AS ord " +
		"FROM " + table + " GROUP BY id"
}

// worldRowsSQL selects the rows of kind as `id`, `name` and `ord` (the order of an id's rows; the
// first names it): "gossip" (a gossip menu by its first text), "page" (page_text), "text"
// (broadcast_text), "event" (event_scripts, by its command count), "loot"
// (gameobject_loot_template, by its row count), "disenchant" (disenchant_loot_template, by its
// items), and the creature editor's lists (#700): "vendor" and "trainer" (npc_vendor_template and
// npc_trainer_template, by their items and spells), "equipment" (creature_equip_template, by its
// weapons), "creature loot", "pickpocket loot" and "skinning loot" (by their drops), "spell list"
// (creature_spells, by its name and spells), "gossip script" (gossip_scripts, by its command count
// and comments) and "map point" (points_of_interest, by its name); and the quest editor's (#704)
// "quest start script" and "quest end script" (quest_start_scripts and quest_end_scripts, as
// gossip scripts) and "exclusive group" (the quests sharing an ExclusiveGroup, by their titles).
func worldRowsSQL(kind string) (string, error) {
	switch kind {
	case "gossip":
		return "SELECT g.entry AS id, COALESCE(NULLIF(b.male_text, ''), b.female_text, '') AS name, g.text_id AS ord " +
			"FROM gossip_menu g LEFT JOIN npc_text n ON n.ID = g.text_id LEFT JOIN broadcast_text b ON b.entry = n.BroadcastTextID0", nil
	case "page":
		return "SELECT entry AS id, text AS name, 0 AS ord FROM page_text", nil
	case "text":
		return "SELECT entry AS id, COALESCE(NULLIF(male_text, ''), female_text, '') AS name, 0 AS ord FROM broadcast_text", nil
	case "event":
		return "SELECT id, " + countSQL("*", "script command") + " AS name, 0 AS ord FROM event_scripts GROUP BY id", nil
	case "loot":
		return "SELECT entry AS id, " + countSQL("*", "loot row") + " AS name, 0 AS ord FROM gameobject_loot_template GROUP BY entry", nil
	case "disenchant":
		// An item's disenchant_id (#701), by the items it gives, likeliest first.
		return "SELECT d.entry AS id, GROUP_CONCAT(DISTINCT COALESCE(i.name, CONCAT('item ', d.item)) ORDER BY d.ChanceOrQuestChance DESC SEPARATOR ', ') AS name, 0 AS ord " +
			"FROM disenchant_loot_template d LEFT JOIN item_template i ON i.entry = d.item AND i.patch = (SELECT MAX(patch) FROM item_template WHERE entry = d.item) GROUP BY d.entry", nil
	case "vendor":
		return "SELECT entry AS id, CONCAT(" + countSQL("*", "item") + ", ': ', GROUP_CONCAT(" + itemNameSQL("item") + " ORDER BY slot, item SEPARATOR ', ' LIMIT 6)) AS name, 0 AS ord " +
			"FROM npc_vendor_template GROUP BY entry", nil
	case "trainer":
		return "SELECT entry AS id, CONCAT(" + countSQL("DISTINCT spell", "spell") + ", ': ', GROUP_CONCAT(DISTINCT " + spellNameSQL("spell") + " ORDER BY reqlevel, spell SEPARATOR ', ' LIMIT 6)) AS name, 0 AS ord " +
			"FROM npc_trainer_template GROUP BY entry", nil
	case "equipment":
		// Each row's weapons, the likeliest row first (an entry has a row per patch or chance).
		weapon := func(c string) string { return "IF(" + c + " > 0, " + itemNameSQL(c) + ", NULL)" }
		return "SELECT entry AS id, COALESCE(NULLIF(GROUP_CONCAT(DISTINCT NULLIF(CONCAT_WS(', ', " + weapon("item1") + ", " + weapon("item2") + ", " + weapon("item3") + "), '') " +
			"ORDER BY probability DESC SEPARATOR ' or '), ''), 'no weapons') AS name, 0 AS ord FROM creature_equip_template GROUP BY entry", nil
	case "creature loot":
		return lootListSQL("creature_loot_template"), nil
	case "pickpocket loot":
		return lootListSQL("pickpocketing_loot_template"), nil
	case "skinning loot":
		return lootListSQL("skinning_loot_template"), nil
	case "spell list":
		spells := make([]string, 8)
		for i := range spells {
			c := fmt.Sprintf("spellId_%d", i+1)
			spells[i] = "IF(" + c + " > 0, " + spellNameSQL(c) + ", NULL)"
		}
		return "SELECT entry AS id, CONCAT_WS(': ', NULLIF(name, ''), NULLIF(CONCAT_WS(', ', " + strings.Join(spells, ", ") + "), '')) AS name, 0 AS ord FROM creature_spells", nil
	case "gossip script":
		return scriptListSQL("gossip_scripts"), nil
	case "map point":
		return "SELECT entry AS id, icon_name AS name, 0 AS ord FROM points_of_interest", nil
	case "quest start script":
		return scriptListSQL("quest_start_scripts"), nil
	case "quest end script":
		return scriptListSQL("quest_end_scripts"), nil
	case "exclusive group":
		return "SELECT ExclusiveGroup AS id, CONCAT(" + countSQL("DISTINCT entry", "quest") + ", ': ', GROUP_CONCAT(DISTINCT CONCAT(Title, ' (', entry, ')') ORDER BY entry SEPARATOR ', ' LIMIT 6)) AS name, 0 AS ord " +
			"FROM quest_template WHERE ExclusiveGroup <> 0 GROUP BY ExclusiveGroup", nil
	}
	return "", fmt.Errorf("no world rows of kind %q", kind)
}

// worldRefUses counts the creature templates that point at each row of kind, by the
// creature_template column (or columns) that holds it, so a picker tells how many creatures share a
// list (#700). A kind without one has no count.
var worldRefUses = map[string][]string{
	"gossip":          {"gossip_menu_id"},
	"vendor":          {"vendor_id"},
	"trainer":         {"trainer_id"},
	"equipment":       {"equipment_id"},
	"creature loot":   {"loot_id"},
	"pickpocket loot": {"pickpocket_loot_id"},
	"skinning loot":   {"skinning_loot_id"},
	"spell list":      {"spell_list_id", "pet_spell_list_id"},
}

// worldRefSQL is the query that names world database rows of kind (see worldRowsSQL). where picks
// the rows (with `id` the row's number and `name` its text). Each row is the number, its name and
// how many creature templates use it (NULL for a kind no creature column names).
func worldRefSQL(kind, where string) (string, error) {
	rows, err := worldRowsSQL(kind)
	if err != nil {
		return "", err
	}
	cols := worldRefUses[kind]
	if len(cols) == 0 {
		return "SELECT id, name, NULL FROM (" + rows + ") r WHERE " + where + " ORDER BY id, ord", nil
	}
	pointers := make([]string, len(cols))
	for i, c := range cols {
		pointers[i] = "SELECT entry, " + c + " AS id FROM creature_template"
	}
	uses := "SELECT id, COUNT(DISTINCT entry) AS n FROM (" + strings.Join(pointers, " UNION ALL ") + ") p WHERE id > 0 GROUP BY id"
	return "SELECT id, name, uses FROM (SELECT g.id, g.name, g.ord, COALESCE(u.n, 0) AS uses FROM (" + rows + ") g LEFT JOIN (" + uses + ") u ON u.id = g.id) r WHERE " +
		where + " ORDER BY id, ord", nil
}

// usesText is what a picker adds to a row's name for the creatures that use it: " · used by 3
// creatures", nothing for none or a kind without a count.
func usesText(uses string) string {
	n, err := strconv.Atoi(uses)
	if err != nil || n <= 0 {
		return ""
	}
	if n == 1 {
		return " · used by 1 creature"
	}
	return fmt.Sprintf(" · used by %d creatures", n)
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
	for _, f := range batchRows(raw, 3) {
		id, err := strconv.Atoi(f[0])
		if err != nil || seen[id] {
			continue
		}
		seen[id] = true
		name := firstLine(f[1])
		if name == "" {
			name = "(no text)"
		}
		out = append(out, NamedID{ID: id, Name: name + usesText(f[2])})
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

// worldRefByText are the kinds whose names a search looks in; the rest (named by a count) are found
// by number only.
var worldRefByText = map[string]bool{
	"gossip": true, "page": true, "text": true, "disenchant": true, "vendor": true, "trainer": true, "equipment": true,
	"creature loot": true, "pickpocket loot": true, "skinning loot": true, "spell list": true, "gossip script": true, "map point": true,
	"quest start script": true, "quest end script": true, "exclusive group": true,
}

// worldRefMatch is the WHERE of a search for text: the rows numbered text, and for the kinds named
// by a text, the rows whose text has it.
func worldRefMatch(kind, text string) string {
	var parts []string
	if n, err := strconv.Atoi(text); err == nil {
		parts = append(parts, "id = "+strconv.Itoa(n))
	}
	if worldRefByText[kind] {
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

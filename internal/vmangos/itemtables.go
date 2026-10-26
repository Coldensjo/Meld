package vmangos

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// The item editor's pickers (#701): the client tables an item_template column names (item sets,
// spell cooldown categories, maps), read once per data folder, and the world database rows
// random_property and disenchant_id name (item_enchantment_template entries by their enchantments'
// names, disenchant_loot_template entries by their items).

// ItemTables are the client's tables the item editor names columns from.
type ItemTables struct {
	Sets []NamedID `json:"sets"`
	// SpellCategories are the cooldown categories Spell.dbc's spells use (1.12 has no table of
	// them), each named by its spells.
	SpellCategories []NamedID `json:"spellCategories"`
	Maps            []NamedID `json:"maps"`
}

var itemTables = struct {
	sync.Mutex
	by map[string]*ItemTables
	// props are ItemRandomProperties.dbc's suffixes by ID ("of the Bear"), per data folder.
	props map[string]map[int]string
}{by: map[string]*ItemTables{}, props: map[string]map[int]string{}}

// namedList joins up to three names and says how many more there are: "A, B, C and 4 more".
func namedList(names []string) string {
	if len(names) <= 3 {
		return strings.Join(names, ", ")
	}
	return strings.Join(names[:3], ", ") + " and " + strconv.Itoa(len(names)-3) + " more"
}

// Spell.dbc's cooldown category fields: Category, and StartRecoveryCategory (the global cooldown's).
const (
	spellFCategory      = 2
	spellFStartCategory = 157
)

// spellCategoryNames names each cooldown category in Spell.dbc's field (spellFCategory or
// spellFStartCategory) by the distinct names of the spells in it, those used most first.
func spellCategoryNames(t *dbcTable, field int) []NamedID {
	byCat := map[int]map[string]int{}
	for r := 0; r < t.records; r++ {
		c := int(t.u32(r, field))
		name := strings.TrimSpace(t.str(r, spellFName))
		if c == 0 || name == "" {
			continue
		}
		if byCat[c] == nil {
			byCat[c] = map[string]int{}
		}
		byCat[c][name]++
	}
	out := make([]NamedID, 0, len(byCat))
	for c, names := range byCat {
		list := make([]string, 0, len(names))
		for n := range names {
			list = append(list, n)
		}
		sort.Slice(list, func(i, j int) bool {
			if names[list[i]] != names[list[j]] {
				return names[list[i]] > names[list[j]]
			}
			return list[i] < list[j]
		})
		out = append(out, NamedID{ID: c, Name: namedList(list)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// randomPropertyNames reads ItemRandomProperties.dbc (1.12: ID, internal name, 3 enchantments, 2
// unused, the suffix in 8 locales), naming a row by its suffix or else its internal name.
func randomPropertyNames(t *dbcTable) map[int]string {
	out := make(map[int]string, t.records)
	for r := 0; r < t.records; r++ {
		name := ""
		if t.fields > 7 {
			name = t.str(r, 7)
		}
		if name == "" && t.fields > 1 {
			name = t.str(r, 1)
		}
		out[int(t.u32(r, 0))] = name
	}
	return out
}

// LoadItemTables reads the tables, once per client data folder.
func LoadItemTables(dataDir string) (ItemTables, error) {
	itemTables.Lock()
	defer itemTables.Unlock()
	if t, ok := itemTables.by[dataDir]; ok {
		return *t, nil
	}
	if err := loadItemDBCs(dataDir); err != nil {
		return ItemTables{}, err
	}
	return *itemTables.by[dataDir], nil
}

// loadItemDBCs fills itemTables for dataDir; itemTables must be locked.
func loadItemDBCs(dataDir string) error {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return err
	}
	tables := map[string]*dbcTable{}
	for _, name := range []string{"ItemSet", "ItemRandomProperties"} {
		b, err := set.ReadFile(`DBFilesClient\` + name + `.dbc`)
		if err == nil {
			tables[name], err = parseDBC(b)
		}
		if err != nil {
			set.Close()
			return fmt.Errorf("%s.dbc: %w", name, err)
		}
	}
	set.Close()
	sets := tables["ItemSet"]
	out := ItemTables{Sets: byIDNamed(sets, func(r int) string { return sets.str(r, itemSetFName) })}
	maps, err := LoadMapEntries(dataDir)
	if err != nil {
		return err
	}
	out.Maps = make([]NamedID, 0, len(maps))
	for _, m := range maps {
		out.Maps = append(out.Maps, NamedID{ID: int(m.ID), Name: m.Name})
	}
	spellData.Lock()
	err = loadSpellData(dataDir)
	if err == nil {
		out.SpellCategories = spellCategoryNames(spellData.spells, spellFCategory)
	}
	spellData.Unlock()
	if err != nil {
		return err
	}
	itemTables.by[dataDir] = &out
	itemTables.props[dataDir] = randomPropertyNames(tables["ItemRandomProperties"])
	return nil
}

// randomProperties gives ItemRandomProperties.dbc's names for dataDir.
func randomProperties(dataDir string) (map[int]string, error) {
	itemTables.Lock()
	defer itemTables.Unlock()
	if _, ok := itemTables.by[dataDir]; !ok {
		if err := loadItemDBCs(dataDir); err != nil {
			return nil, err
		}
	}
	return itemTables.props[dataDir], nil
}

// enchantmentNames are the distinct names of an item_enchantment_template entry's enchantments
// (ench, a list of ItemRandomProperties IDs by chance, comma-separated).
func enchantmentNames(list string, props map[int]string) []string {
	var names []string
	seen := map[string]bool{}
	for _, s := range strings.Split(list, ",") {
		id, err := strconv.Atoi(strings.TrimSpace(s))
		if err != nil {
			continue
		}
		n := props[id]
		if n == "" {
			n = "property " + strconv.Itoa(id)
		}
		if !seen[n] {
			seen[n] = true
			names = append(names, n)
		}
	}
	return names
}

// enchantmentText names an entry by its enchantments: "of the Bear, of the Eagle, … and 9 more".
func enchantmentText(names []string) string {
	if len(names) == 0 {
		return "(no enchantments)"
	}
	return namedList(names)
}

// enchantmentSQL lists item_enchantment_template's entries (with `id` the entry, where picks them),
// each with its enchantments by chance.
func enchantmentSQL(where string) string {
	return "SELECT id, name FROM (SELECT entry AS id, GROUP_CONCAT(DISTINCT ench ORDER BY chance DESC SEPARATOR ',') AS name FROM item_enchantment_template GROUP BY entry) r WHERE " + where + " ORDER BY id"
}

// enchantmentRow is an item_enchantment_template entry with its enchantments' names.
type enchantmentRow struct {
	id    int
	names []string
}

// itemEnchantments runs enchantmentSQL and names the entries' enchantments.
func itemEnchantments(serverRoot, dataDir, where string) ([]enchantmentRow, error) {
	props, err := randomProperties(dataDir)
	if err != nil {
		return nil, err
	}
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, enchantmentSQL(where))
	if err != nil {
		return nil, err
	}
	out := []enchantmentRow{}
	for _, f := range batchRows(raw, 2) {
		if id, err := strconv.Atoi(f[0]); err == nil {
			out = append(out, enchantmentRow{id, enchantmentNames(f[1], props)})
		}
	}
	return out, nil
}

// ItemEnchantmentNames names the item_enchantment_template entries ids (an item's random_property)
// by their enchantments, leaving out those the world database doesn't have.
func ItemEnchantmentNames(serverRoot, dataDir string, ids []int) (map[int]string, error) {
	out := map[int]string{}
	if len(ids) == 0 {
		return out, nil
	}
	list := make([]string, len(ids))
	for i, id := range ids {
		list[i] = strconv.Itoa(id)
	}
	rows, err := itemEnchantments(serverRoot, dataDir, "id IN ("+strings.Join(list, ",")+")")
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.id] = enchantmentText(r.names)
	}
	return out, nil
}

// SearchItemEnchantments lists the item_enchantment_template entries numbered text or with an
// enchantment whose name has it, at most limit of them. The table is small (a few hundred entries),
// so it is read whole and matched here, where the names are.
func SearchItemEnchantments(serverRoot, dataDir, text string, limit int) ([]NamedID, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return []NamedID{}, nil
	}
	rows, err := itemEnchantments(serverRoot, dataDir, "TRUE")
	if err != nil {
		return nil, err
	}
	return matchEnchantments(rows, text, limit), nil
}

// matchEnchantments keeps the entries numbered text or with an enchantment whose name has it (any
// case), at most limit, named.
func matchEnchantments(rows []enchantmentRow, text string, limit int) []NamedID {
	want := strings.ToLower(text)
	out := []NamedID{}
	for _, r := range rows {
		hit := strconv.Itoa(r.id) == text
		for _, n := range r.names {
			hit = hit || strings.Contains(strings.ToLower(n), want)
		}
		if hit {
			out = append(out, NamedID{ID: r.id, Name: enchantmentText(r.names)})
			if len(out) >= max(limit, 1) {
				break
			}
		}
	}
	return out
}

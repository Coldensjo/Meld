package vmangos

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"Meld/internal/wow"
)

// The item editor (#353) edits item_template: every column of an item's newest patch row, a new
// item from scratch or as a copy, and items written to and read from an SQL script of REPLACE
// statements, the form of the server's own sql files. What an item looks like comes from the
// client's ItemDisplayInfo.dbc, which the editor only picks from: a new display would be client
// table writing.

const itemTable = "item_template"

// ReadItemTemplate reads item template entry: its newest patch's row, for the item editor.
func ReadItemTemplate(serverRoot string, entry int) (TemplateRecord, error) {
	return readTemplate(serverRoot, itemTable, "item", entry)
}

// SaveItem writes changed values (by column) into item template entry's row of patch patch, and
// returns the SQL it ran.
func SaveItem(serverRoot string, entry, patch int, values map[string]string) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := templateColumns(db, itemTable)
	if err != nil {
		return "", err
	}
	if v, ok := values["name"]; ok && strings.TrimSpace(v) == "" {
		return "", errors.New("an item needs a name")
	}
	sql, err := templateUpdateSQL(itemTable, cols, entry, patch, values)
	if err != nil || sql == "" {
		return sql, err
	}
	if err := runScript(db, sql); err != nil {
		return "", err
	}
	forgetWeapons()
	return sql, nil
}

// CreateItem adds an item named name under the first free entry and returns the entry. It copies
// item base (its newest patch) when base is not 0, else it starts as a common junk item that
// stacks to one and has no display.
func CreateItem(serverRoot string, base int, name string) (int, error) {
	entry, err := createTemplate(serverRoot, itemTable, "item", name, func(cols []TemplateColumn, entry int, name string) (string, error) {
		return createItemSQL(cols, entry, base, name)
	})
	if err == nil {
		forgetWeapons()
	}
	return entry, err
}

// createItemSQL is the INSERT that makes item entry named name, a copy of base's newest patch row
// or (base 0) a common junk item.
func createItemSQL(cols []TemplateColumn, entry, base int, name string) (string, error) {
	nameCol := TemplateColumn{Name: "name", Kind: "text", MaxLen: 255}
	for _, c := range cols {
		if c.Name == "name" {
			nameCol = c
		}
	}
	nameSQL, err := sqlValue(nameCol, name)
	if err != nil {
		return "", err
	}
	if base == 0 {
		return fmt.Sprintf("INSERT INTO `item_template` (`entry`, `patch`, `class`, `subclass`, `name`, `quality`, `stackable`, `buy_count`) "+
			"VALUES (%d, 0, 15, 0, %s, 1, 1, 1);", entry, nameSQL), nil
	}
	return copyTemplateSQL(itemTable, cols, entry, base, "name", nameSQL), nil
}

// forgetWeapons drops the cached lists of held items, after an item was saved, made or imported.
func forgetWeapons() {
	weaponsMu.Lock()
	defer weaponsMu.Unlock()
	clear(weaponsCache)
}

// keyColumns are item_template's key columns as TemplateColumns, for checking an imported row.
var keyColumns = []TemplateColumn{
	{Name: "entry", Kind: "uint", Min: 0, Max: 1<<24 - 1},
	{Name: "patch", Kind: "uint", Min: 0, Max: 255},
}

// ExportItems is an SQL script that puts items back as they are now: every patch row of each
// entry, as REPLACE statements that name their columns, so the script loads on a server whose
// table has its columns in another order.
func ExportItems(serverRoot string, entries []int) (string, error) {
	if len(entries) == 0 {
		return "", errors.New("no items to export")
	}
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := templateColumns(db, itemTable)
	if err != nil {
		return "", err
	}
	all := append(append([]TemplateColumn{}, keyColumns...), cols...)
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = strconv.Itoa(e)
	}
	names := make([]string, len(all))
	for i, c := range all {
		names[i] = "`" + c.Name + "`"
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT %s FROM `item_template` WHERE `entry` IN (%s) ORDER BY `entry`, `patch`",
		strings.Join(names, ", "), strings.Join(ids, ",")))
	if err != nil {
		return "", err
	}
	rows := tsvRows(raw, len(all))
	if len(rows) == 0 {
		return "", fmt.Errorf("the world database has no item %s", strings.Join(ids, ", "))
	}
	return itemsScript(all, rows, time.Now()), nil
}

// itemsScript writes item rows (mariadb's batch fields, in the order of cols) as an SQL script.
func itemsScript(cols []TemplateColumn, rows [][]string, now time.Time) string {
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = "`" + c.Name + "`"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "-- Items exported by Meld on %s: %d %s of item_template.\n", now.Format("2006-01-02 15:04"), len(rows), plural(len(rows), "row", "rows"))
	b.WriteString("-- Load it with Import in Meld's item editor (Tools > Items), or run it on the world database.\n")
	for _, f := range rows {
		vals := make([]string, len(cols))
		for i, c := range cols {
			v := f[i]
			if v == "NULL" && c.Nullable {
				vals[i] = "NULL"
				continue
			}
			v = unescapeBatch(v)
			if c.Kind == "text" {
				vals[i] = sqlQuote(v)
			} else if s, err := sqlValue(c, v); err == nil {
				vals[i] = s
			} else {
				vals[i] = sqlQuote(v)
			}
		}
		name := ""
		for i, c := range cols {
			if c.Name == "name" {
				name = unescapeBatch(f[i])
			}
		}
		fmt.Fprintf(&b, "\n-- %s (entry %s, patch %s)\nREPLACE INTO `item_template` (%s) VALUES\n(%s);\n",
			commentSafe(name), f[0], f[1], strings.Join(names, ", "), strings.Join(vals, ", "))
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

// ItemImport is what an SQL script of items would write: its item rows, and what of it is left
// out.
type ItemImport struct {
	Items []ItemImportRow `json:"items"`
	// Skipped is how many statements are not item_template rows (a DELETE, another table), which
	// importing leaves out.
	Skipped int `json:"skipped"`
	// Unknown are columns the script names that this server's item_template lacks, left out.
	Unknown []string `json:"unknown"`
}

// ItemImportRow is one item row of a script: its entry, patch and name, and whether the world
// database has that row already, which importing replaces.
type ItemImportRow struct {
	Entry  int    `json:"entry"`
	Patch  int    `json:"patch"`
	Name   string `json:"name"`
	Exists bool   `json:"exists"`
}

// PlanItemImport reads an SQL script of items and says what importing it would write, without
// writing anything.
func PlanItemImport(serverRoot, script string) (ItemImport, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return ItemImport{}, err
	}
	rows, plan, err := importRows(db, script)
	if err != nil {
		return ItemImport{}, err
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.values["entry"]
	}
	have := map[string]bool{}
	raw, err := runSQL(db, "SELECT `entry`, `patch` FROM `item_template` WHERE `entry` IN ("+strings.Join(ids, ",")+")")
	if err != nil {
		return ItemImport{}, err
	}
	for _, f := range tsvRows(raw, 2) {
		have[f[0]+"|"+f[1]] = true
	}
	for i := range plan.Items {
		it := &plan.Items[i]
		it.Exists = have[strconv.Itoa(it.Entry)+"|"+strconv.Itoa(it.Patch)]
	}
	return plan, nil
}

// ImportItems writes the item rows of an SQL script into the world database, replacing rows of the
// same entry and patch, and returns the entries it wrote. Every row is checked against the table's
// columns first, and nothing is written if one is refused.
func ImportItems(serverRoot, script string) ([]int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	rows, plan, err := importRows(db, script)
	if err != nil {
		return nil, err
	}
	cols, err := templateColumns(db, itemTable)
	if err != nil {
		return nil, err
	}
	sql, err := importSQL(cols, rows)
	if err != nil {
		return nil, err
	}
	if err := runScript(db, sql); err != nil {
		return nil, err
	}
	forgetWeapons()
	var out []int
	seen := map[int]bool{}
	for _, it := range plan.Items {
		if !seen[it.Entry] {
			seen[it.Entry] = true
			out = append(out, it.Entry)
		}
	}
	return out, nil
}

// importRows parses a script's item rows against the database's item_template columns.
func importRows(db worldDB, script string) ([]sqlRow, ItemImport, error) {
	raw, err := runSQL(db, "SHOW COLUMNS FROM `item_template`")
	if err != nil {
		return nil, ItemImport{}, err
	}
	var order []string
	for _, f := range tsvRows(raw, 6) {
		order = append(order, f[0])
	}
	if len(order) == 0 {
		return nil, ItemImport{}, errors.New("the world database has no item_template")
	}
	return planImport(script, order)
}

// planImport reads a script's item_template rows, the columns of a row without a column list taken
// in the table's order (order), and keeps the columns the table has.
func planImport(script string, order []string) ([]sqlRow, ItemImport, error) {
	stmts, skipped, err := parseInserts(script, itemTable)
	if err != nil {
		return nil, ItemImport{}, err
	}
	have := map[string]bool{}
	for _, c := range order {
		have[c] = true
	}
	unknown := map[string]bool{}
	var rows []sqlRow
	plan := ItemImport{Skipped: skipped}
	for _, st := range stmts {
		names := st.columns
		if names == nil {
			names = order
		}
		for _, tuple := range st.rows {
			if len(tuple) != len(names) {
				return nil, ItemImport{}, fmt.Errorf("an item row has %d values for %d columns", len(tuple), len(names))
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
			if err1 != nil || entry <= 0 {
				return nil, ItemImport{}, fmt.Errorf("an item row has no entry (%q)", r.values["entry"])
			}
			patch := 0
			if p, ok := r.values["patch"]; ok {
				n, err := strconv.Atoi(p)
				if err != nil || n < 0 || n > 255 {
					return nil, ItemImport{}, fmt.Errorf("item %d has patch %q, not 0 to 255", entry, p)
				}
				patch = n
			}
			r.values["patch"] = strconv.Itoa(patch)
			rows = append(rows, r)
			plan.Items = append(plan.Items, ItemImportRow{Entry: entry, Patch: patch, Name: r.values["name"]})
		}
	}
	if len(rows) == 0 {
		return nil, ItemImport{}, errors.New("the script has no item_template rows (INSERT or REPLACE INTO item_template)")
	}
	plan.Unknown = make([]string, 0, len(unknown))
	for n := range unknown {
		plan.Unknown = append(plan.Unknown, n)
	}
	sort.Strings(plan.Unknown)
	return rows, plan, nil
}

// importSQL is the REPLACE statements that write imported rows, each value checked against its
// column; a column a row leaves out takes the table's default.
func importSQL(cols []TemplateColumn, rows []sqlRow) (string, error) {
	var b strings.Builder
	for _, r := range rows {
		entry := r.values["entry"]
		names := []string{"`entry`", "`patch`"}
		vals := []string{entry, r.values["patch"]}
		for _, c := range cols {
			v, ok := r.values[c.Name]
			if !ok {
				continue
			}
			var s string
			switch {
			case r.null[c.Name] && c.Nullable:
				s = "NULL"
			case r.null[c.Name]:
				return "", fmt.Errorf("item %s: %s can't be NULL", entry, c.Name)
			case c.Kind == "text":
				// Kept as written, spaces and all; only the length is checked.
				if c.MaxLen > 0 && len(v) > c.MaxLen {
					return "", fmt.Errorf("item %s: %s is longer than %d characters", entry, c.Name, c.MaxLen)
				}
				s = sqlQuote(v)
			default:
				var err error
				if s, err = sqlValue(c, v); err != nil {
					return "", fmt.Errorf("item %s: %w", entry, err)
				}
			}
			names = append(names, "`"+c.Name+"`")
			vals = append(vals, s)
		}
		fmt.Fprintf(&b, "REPLACE INTO `item_template` (%s) VALUES (%s);\n", strings.Join(names, ", "), strings.Join(vals, ", "))
	}
	return b.String(), nil
}

// ItemLook is how the item editor shows an item: a character of the chosen race and sex holding or
// wearing it, and the item's own model alone. A model is "" when there is none to show.
type ItemLook struct {
	// Model and Look are the character, dressed (wow.Look's query).
	Model string  `json:"model"`
	Look  string  `json:"look"`
	Scale float32 `json:"scale"`
	// Shown says the character shows the item: held in a hand or on the shield arm, or worn on the
	// head or shoulders. Armour for the rest of the body is painted onto the character's skin by
	// the game, which Meld doesn't do.
	Shown bool `json:"shown"`
	// Item and ItemLook are the item's own model and the look that skins it.
	Item     string `json:"item"`
	ItemLook string `json:"itemLook"`
}

// Inventory types (INVTYPE_*) the character shows.
const (
	invHead      = 1
	invShoulder  = 3
	invWeapon    = 13
	inv2HWeapon  = 17
	invMainHand  = 21
	invOffHand   = 22
	invHoldable  = 23
	invRangedRgt = 26
)

// ItemModelLook is an item display shown as inventory type invType has it: on a character of race
// and sex (0 male, 1 female), and alone.
func ItemModelLook(dataDir string, display, invType, race, sex int) (ItemLook, error) {
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return ItemLook{}, err
	}
	return tables.itemModelLook(uint32(max(display, 0)), invType, race, sex), nil
}

func (m *modelTables) itemModelLook(display uint32, invType, race, sex int) ItemLook {
	var out ItemLook
	stand := m.standIn(race, sex)
	it := heldItem{display: display, invType: invType}
	g := gear{sheath: sheathMelee}
	switch invType {
	case invWeapon, inv2HWeapon, invMainHand:
		g.weapons[0] = it
	case invShield, invOffHand, invHoldable:
		g.weapons[1] = it
	case invRanged, invThrown, invRangedRgt:
		g.weapons[2] = it
		g.sheath = sheathRanged
	}
	look := m.creatureLook(stand, g)
	out.Model, out.Scale = look.model, look.scale
	row, ok := m.item(display)
	if ok && row >= 0 {
		switch invType {
		case invHead:
			if name, prefix := m.itemDisplay.str(row, 1), m.racePrefix(race); name != "" && prefix != "" {
				gender := "M"
				if sex == 1 {
					gender = "F"
				}
				look.dropAttached(wow.AttachHelm)
				look.attach(wow.AttachHelm, headItems+trimModelExt(name)+"_"+prefix+gender+".mdx", headItems, m.itemDisplay.str(row, 3))
			}
		case invShoulder:
			look.dropAttached(wow.AttachShoulderLeft)
			look.dropAttached(wow.AttachShoulderRight)
			look.attach(wow.AttachShoulderLeft, m.itemDisplay.str(row, 1), shoulderItems, m.itemDisplay.str(row, 3))
			look.attach(wow.AttachShoulderRight, m.itemDisplay.str(row, 2), shoulderItems, m.itemDisplay.str(row, 4))
		}
		// The item alone: the model the character holds or wears.
		for _, a := range look.look.Attach {
			if a.Model == "" || !m.itemAttachment(a, row) {
				continue
			}
			out.Shown = true
			if out.Item == "" {
				out.Item = a.Model
				if a.Texture != "" {
					out.ItemLook = wow.Look{Textures: map[int]string{wow.TexItem: a.Texture}}.Query()
				}
			}
		}
	}
	out.Look = look.look.Query()
	return out
}

// itemAttachment says an attachment is display row's model (by its file name), not one the
// stand-in wears of its own.
func (m *modelTables) itemAttachment(a wow.Attachment, row int) bool {
	base := strings.ToLower(trimModelExt(a.Model[strings.LastIndex(a.Model, `\`)+1:]))
	for _, f := range []int{1, 2} {
		n := strings.ToLower(trimModelExt(m.itemDisplay.str(row, f)))
		n = n[strings.LastIndex(n, `\`)+1:]
		if n != "" && strings.HasPrefix(base, n) {
			return true
		}
	}
	return false
}

// dropAttached removes what the look holds at point.
func (d *creatureDisplay) dropAttached(point int) {
	kept := d.look.Attach[:0]
	for _, a := range d.look.Attach {
		if a.Point != point {
			kept = append(kept, a)
		}
	}
	d.look.Attach = kept
}

// standIn is a creature display of a plain character of race and sex for the item editor to dress:
// the humanoid display (CreatureDisplayInfoExtra: 1 race, 2 sex, 8-17 worn items, 18 the baked
// skin) that wears the fewest items, one with a baked skin first, the lowest ID of those. 0 when
// the client has none.
func (m *modelTables) standIn(race, sex int) uint32 {
	if m == nil || m.creatureExtra == nil || m.creatureExtra.fields <= 18 {
		return 0
	}
	x := m.creatureExtra
	best, bestScore := uint32(0), 1<<30
	t := m.creatureDisplay
	for r := 0; r < t.records; r++ {
		er, ok := x.row(t.u32(r, 3))
		if !ok || int(x.u32(er, 1)) != race || int(x.u32(er, 2)) != sex {
			continue
		}
		score := 0
		for i := 0; i < wearSlots; i++ {
			if x.u32(er, 8+i) != 0 {
				score += 2
			}
		}
		if x.str(er, 18) == "" {
			score++
		}
		id := t.u32(r, 0)
		if score < bestScore || (score == bestScore && id < best) {
			best, bestScore = id, score
		}
	}
	return best
}

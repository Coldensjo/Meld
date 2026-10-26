package vmangos

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"Meld/internal/mpq"
)

// The spell editor (#294) edits a spell in both places that hold it. The server reads spells from
// the world database's spell_template (VMaNGOS keeps no Spell.dbc of its own): a row per spell and
// client build, the newest build up to the client's (1.12.1, 5875) used. The client draws a spell
// (its name, icon, tooltip, cast bar and visual) from Spell.dbc, so Save writes the saved row into
// Spell.dbc in Meld's patch too, keeping the two in step, and a picked icon not yet in SpellIcon.dbc
// is added there.

const spellTable = "spell_template"

// spellBuild is the client build whose spells the server uses (VMaNGOS' SUPPORTED_CLIENT_BUILD).
const spellBuild = 5875

// The client tables the spell editor writes.
const (
	SpellPath     = `DBFilesClient\Spell.dbc`
	SpellIconPath = `DBFilesClient\SpellIcon.dbc`
)

// spellLocales is how many locales each of Spell.dbc's strings has (a flags field follows them).
const spellLocales = 8

// spellDBCColumns names the spell_template column each of Spell.dbc's 173 fields holds, in the
// client's order (MaNGOS' SpellEntry for 1.12): a string column takes its 8 locale fields (each
// "name#1" past the first) and a locale mask that stays the client's (""), and spellFamilyFlags,
// 64 bits, two ("#hi" the high half). The server's own columns (effectBonusCoefficient1-3,
// minTargetLevel, customFlags, script_name) and its locale masks (nameFlags...) have no field.
// TestSpellColumnsMatchClient checks it against the client's rows and the server's.
var spellDBCColumns = func() []string {
	out := []string{"entry"}
	add := func(names ...string) { out = append(out, names...) }
	three := func(name string) { add(name+"1", name+"2", name+"3") }
	text := func(name string) {
		add(name)
		for l := 1; l < spellLocales; l++ {
			add(name + "#" + strconv.Itoa(l))
		}
		// The locale mask after the 8: the server's (nameFlags...) are older builds', so the client keeps its own.
		add("")
	}
	add("school", "category", "castUI", "dispel", "mechanic", "attributes", "attributesEx", "attributesEx2", "attributesEx3",
		"attributesEx4", "stances", "stancesNot", "targets", "targetCreatureType", "requiresSpellFocus", "casterAuraState",
		"targetAuraState", "castingTimeIndex", "recoveryTime", "categoryRecoveryTime", "interruptFlags", "auraInterruptFlags",
		"channelInterruptFlags", "procFlags", "procChance", "procCharges", "maxLevel", "baseLevel", "spellLevel", "durationIndex",
		"powerType", "manaCost", "manCostPerLevel", "manaPerSecond", "manaPerSecondPerLevel", "rangeIndex", "speed",
		"modelNextSpell", "stackAmount", "totem1", "totem2")
	for i := 1; i <= 8; i++ {
		add("reagent" + strconv.Itoa(i))
	}
	for i := 1; i <= 8; i++ {
		add("reagentCount" + strconv.Itoa(i))
	}
	add("equippedItemClass", "equippedItemSubClassMask", "equippedItemInventoryTypeMask")
	for _, n := range []string{"effect", "effectDieSides", "effectBaseDice", "effectDicePerLevel", "effectRealPointsPerLevel",
		"effectBasePoints", "effectMechanic", "effectImplicitTargetA", "effectImplicitTargetB", "effectRadiusIndex",
		"effectApplyAuraName", "effectAmplitude", "effectMultipleValue", "effectChainTarget", "effectItemType",
		"effectMiscValue", "effectTriggerSpell", "effectPointsPerComboPoint"} {
		three(n)
	}
	add("spellVisual1", "spellVisual2", "spellIconId", "activeIconId", "spellPriority")
	text("name")
	text("nameSubtext")
	text("description")
	text("auraDescription")
	add("manaCostPercentage", "startRecoveryCategory", "startRecoveryTime", "maxTargetLevel", "spellFamilyName",
		"spellFamilyFlags", "spellFamilyFlags#hi", "maxAffectedTargets", "dmgClass", "preventionType", "stanceBarOrder")
	three("dmgMultiplier")
	add("minFactionId", "minReputation", "requiredAuraVision")
	return out
}()

// spellTextColumns are spell_template's text columns that Spell.dbc holds.
var spellTextColumns = map[string]bool{"name": true, "nameSubtext": true, "description": true, "auraDescription": true}

// spellColumns reads spell_template's columns, all but its keys (entry, build).
func spellColumns(db worldDB) ([]TemplateColumn, error) {
	cols, err := templateColumns(db, spellTable)
	if err != nil {
		return nil, err
	}
	out := cols[:0]
	for _, c := range cols {
		if c.Name != "build" {
			out = append(out, c)
		}
	}
	return out, nil
}

// SpellRecord is a spell's spell_template row as the spell editor reads it: the build of the row
// the server uses, every other column as text, and its icon's texture (from SpellIcon.dbc, "" for
// none). InClient says whether the client's Spell.dbc has the spell.
type SpellRecord struct {
	Entry    int               `json:"entry"`
	Build    int               `json:"build"`
	Columns  []TemplateColumn  `json:"columns"`
	Values   map[string]string `json:"values"`
	Icon     string            `json:"icon"`
	InClient bool              `json:"inClient"`
}

// readSpellRow reads the row of spell entry the server uses.
func readSpellRow(db worldDB, cols []TemplateColumn, entry int) (int, map[string]string, error) {
	return readKeyedRow(db, "spell_template", "build", fmt.Sprintf("`build` <= %d", spellBuild), cols, "spell", entry)
}

// ReadSpell reads spell entry: the spell_template row the server uses.
func ReadSpell(serverRoot, dataDir string, entry int) (SpellRecord, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return SpellRecord{}, err
	}
	cols, err := spellColumns(db)
	if err != nil {
		return SpellRecord{}, err
	}
	build, values, err := readSpellRow(db, cols, entry)
	if err != nil {
		return SpellRecord{}, err
	}
	rec := SpellRecord{Entry: entry, Build: build, Columns: cols, Values: values}
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return SpellRecord{}, err
	}
	_, rec.InClient = spellData.spells.row(uint32(entry))
	if id, err := strconv.Atoi(values["spellIconId"]); err == nil {
		rec.Icon = spellData.icons[uint32(id)]
	}
	return rec, nil
}

// spellField is a spell_template value as a Spell.dbc field: a whole number as its 32 bits (a
// negative one as two's complement, a 64-bit one's low or high half), a float column's as a float.
func spellField(c TemplateColumn, v string, high bool) (uint32, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0, nil
	}
	if c.Kind == "float" {
		f, err := strconv.ParseFloat(v, 32)
		if err != nil {
			return 0, refuse(c.Name, "%s must be a number, not %q", c.Name, v)
		}
		return math.Float32bits(float32(f)), nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, refuse(c.Name, "%s must be a whole number, not %q", c.Name, v)
	}
	if high {
		return uint32(uint64(n) >> 32), nil
	}
	return uint32(n), nil
}

// spellClientRow makes spell entry's Spell.dbc record from its spell_template values, over base (a
// record of the table's fields to start from, nil for zeros). It returns the record and the string
// fields with their text: every locale of a text column gets the text, as the client of any locale
// then shows it. Fields no column holds keep base's value.
func spellClientRow(entry int, cols []TemplateColumn, values map[string]string, base []uint32, fields int) ([]uint32, map[int]string, error) {
	if fields != len(spellDBCColumns) {
		return nil, nil, fmt.Errorf("Spell.dbc has %d fields, not 1.12's %d", fields, len(spellDBCColumns))
	}
	rec := make([]uint32, fields)
	copy(rec, base)
	rec[0] = uint32(entry)
	byName := make(map[string]TemplateColumn, len(cols))
	for _, c := range cols {
		byName[c.Name] = c
	}
	strs := map[int]string{}
	for f, name := range spellDBCColumns {
		if f == 0 || name == "" {
			continue
		}
		col, locale, _ := strings.Cut(name, "#")
		c, ok := byName[col]
		if !ok {
			continue
		}
		v, ok := values[col]
		if !ok {
			continue
		}
		if spellTextColumns[col] {
			strs[f] = v
			continue
		}
		if locale != "" && locale != "hi" {
			continue
		}
		n, err := spellField(c, v, locale == "hi")
		if err != nil {
			return nil, nil, err
		}
		rec[f] = n
	}
	return rec, strs, nil
}

// spellClientFile is Spell.dbc (dbc, as the client has it now) with spell entry's record made from
// values. It starts from the client's own record of the spell, else of from (the spell a new one
// copies), else from zeros.
func spellClientFile(dbc []byte, entry, from int, cols []TemplateColumn, values map[string]string) ([]byte, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, err
	}
	var base []uint32
	if r, ok := t.row(uint32(entry)); ok {
		base = t.record(r)
	} else if r, ok := t.row(uint32(from)); ok && from > 0 {
		base = t.record(r)
	} else {
		base = commonSpellFields(t)
	}
	rec, strs, err := spellClientRow(entry, cols, values, base, t.fields)
	if err != nil {
		return nil, err
	}
	return putRecord(dbc, rec, strs)
}

// commonSpellFields is a record of zeros but for the fields no column holds (the locale masks), which
// get the value most of the client's spells have there.
func commonSpellFields(t *dbcTable) []uint32 {
	rec := make([]uint32, t.fields)
	for f, name := range spellDBCColumns {
		if name != "" || f >= t.fields {
			continue
		}
		count := map[uint32]int{}
		for r := 0; r < t.records; r++ {
			v := t.u32(r, f)
			count[v]++
			if count[v] > count[rec[f]] {
				rec[f] = v
			}
		}
	}
	return rec
}

// spellIconRow is the SpellIcon.dbc ID of an icon (a name under Interface\Icons): the client's row
// for its texture, else a new row, returning the table with it added (nil when nothing changed).
func spellIconRow(dbc []byte, icon string) (int, []byte, error) {
	return spellIconPathRow(dbc, `Interface\Icons\`+icon)
}

// spellIconPathRow is spellIconRow for an icon's whole texture path.
func spellIconPathRow(dbc []byte, path string) (int, []byte, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return 0, nil, err
	}
	if t.fields < 2 {
		return 0, nil, errors.New("SpellIcon.dbc has no texture field")
	}
	maxID := uint32(0)
	for r := 0; r < t.records; r++ {
		if strings.EqualFold(t.str(r, 1), path) {
			return int(t.u32(r, 0)), nil, nil
		}
		maxID = max(maxID, t.u32(r, 0))
	}
	rec := make([]uint32, t.fields)
	rec[0] = maxID + 1
	out, err := putRecord(dbc, rec, map[int]string{1: path})
	return int(maxID + 1), out, err
}

// SpellSave is what saving a spell writes: the SQL for the world database and the client tables for
// Meld's patch (Spell.dbc, and SpellIcon.dbc when an icon was added). IconAdded names the icon added.
type SpellSave struct {
	SQL       string
	Files     []mpq.File
	IconAdded string
	// VisualAdded says the composer's visual was new rows, not one the client had.
	VisualAdded bool
	// Visual is the spell's visual as saved.
	Visual int
}

// checkIconName refuses what can't be a name under Interface\Icons.
func checkIconName(icon string) error {
	if icon == "" || strings.ContainsAny(icon, "\x00\\/") {
		return fmt.Errorf("%q is not an icon name", icon)
	}
	return nil
}

// PlanSpellSave works out saving changed values (by column) into spell entry's row of build build,
// icon (a name under Interface\Icons, "" to keep the spell's) and visual (a design from the composer,
// #361; nil to keep spellVisual1 as values have it), without writing anything.
func PlanSpellSave(serverRoot, dataDir string, entry, build int, values map[string]string, icon string, visual *VisualDesign) (SpellSave, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return SpellSave{}, err
	}
	cols, err := spellColumns(db)
	if err != nil {
		return SpellSave{}, err
	}
	if v, ok := values["name"]; ok && strings.TrimSpace(v) == "" {
		return SpellSave{}, refuse("name", "a spell needs a name")
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return SpellSave{}, err
	}
	defer set.Close()
	var save SpellSave
	changes := make(map[string]string, len(values)+1)
	for k, v := range values {
		changes[k] = v
	}
	if icon = strings.TrimSpace(icon); icon != "" {
		if err := checkIconName(icon); err != nil {
			return SpellSave{}, err
		}
		ib, err := readOverlay(set, dataDir, SpellIconPath)
		if err != nil {
			return SpellSave{}, err
		}
		id, out, err := spellIconRow(ib, icon)
		if err != nil {
			return SpellSave{}, err
		}
		if out != nil {
			save.Files = append(save.Files, mpq.File{Name: SpellIconPath, Data: out})
			save.IconAdded = icon
		}
		changes["spellIconId"] = strconv.Itoa(id)
	}
	if visual != nil {
		id, files, err := planSpellVisualFiles(set, dataDir, *visual)
		if err != nil {
			return SpellSave{}, err
		}
		save.Files = append(save.Files, files...)
		save.VisualAdded = len(files) > 0
		changes["spellVisual1"] = strconv.Itoa(id)
	}
	if save.SQL, err = keyedUpdateSQL(spellTable, "build", cols, entry, build, changes); err != nil {
		return SpellSave{}, err
	}
	// The client gets the whole row as it will be, so a spell the two disagreed on agrees again.
	_, row, err := readSpellRow(db, cols, entry)
	if err != nil {
		return SpellSave{}, err
	}
	for k, v := range changes {
		row[k] = strings.TrimSpace(v)
	}
	sb, err := readOverlay(set, dataDir, SpellPath)
	if err != nil {
		return SpellSave{}, err
	}
	out, err := spellClientFile(sb, entry, 0, cols, row)
	if err != nil {
		return SpellSave{}, err
	}
	save.Files = append(save.Files, mpq.File{Name: SpellPath, Data: out})
	save.Visual, _ = strconv.Atoi(row["spellVisual1"])
	return save, nil
}

// SaveSpellSQL runs a planned save's SQL on the world database.
func SaveSpellSQL(serverRoot, sql string) error {
	if sql == "" {
		return nil
	}
	db, err := openWorld(serverRoot)
	if err != nil {
		return err
	}
	return runScript(db, sql)
}

// SpellCreate is what making a spell writes: its entry, the SQL that adds its row and the Spell.dbc
// that holds it.
type SpellCreate struct {
	Entry int
	SQL   string
	File  mpq.File
}

// PlanCreateSpell works out a spell named name under the first entry neither the world database nor
// the client uses, without writing anything: a copy of spell base (the row the server uses) when base
// is not 0, else made from the starter of that ID (#360). A copy loses its script_name: a server
// script written for base would run for it.
func PlanCreateSpell(serverRoot, dataDir string, base int, starter, name string) (SpellCreate, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return SpellCreate{}, errors.New("a new spell needs a name")
	}
	if base <= 0 && starter == "" {
		return SpellCreate{}, errors.New("a new spell starts from a starter or as a copy of another")
	}
	db, err := openWorld(serverRoot)
	if err != nil {
		return SpellCreate{}, err
	}
	cols, err := spellColumns(db)
	if err != nil {
		return SpellCreate{}, err
	}
	nameCol := TemplateColumn{Name: "name", Kind: "text", MaxLen: 256}
	for _, c := range cols {
		if c.Name == "name" {
			nameCol = c
		}
	}
	nameSQL, err := sqlValue(nameCol, name)
	if err != nil {
		return SpellCreate{}, err
	}
	build, row := spellBuild, map[string]string(nil)
	if base > 0 {
		if build, row, err = readSpellRow(db, cols, base); err != nil {
			return SpellCreate{}, err
		}
	} else {
		tables, err := ReadSpellTables(dataDir)
		if err != nil {
			return SpellCreate{}, err
		}
		like := ""
		for _, s := range spellStarters {
			if s.ID == starter {
				like = s.Like
			}
		}
		visual, icon, err := spellLook(dataDir, like)
		if err != nil {
			return SpellCreate{}, err
		}
		if row, err = starterValues(cols, starter, tables, visual, icon); err != nil {
			return SpellCreate{}, err
		}
	}
	raw, err := runSQL(db, "SELECT COALESCE(MAX(`entry`), 0) FROM `spell_template`")
	if err != nil {
		return SpellCreate{}, err
	}
	top, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		return SpellCreate{}, err
	}
	sb, err := readClientFile(dataDir, SpellPath)
	if err != nil {
		return SpellCreate{}, err
	}
	t, err := parseDBC(sb)
	if err != nil {
		return SpellCreate{}, err
	}
	for r := 0; r < t.records; r++ {
		top = max(top, int(t.u32(r, 0)))
	}
	entry := top + 1
	if entry > math.MaxUint16 {
		return SpellCreate{}, fmt.Errorf("no spell entry is free below %d", math.MaxUint16+1)
	}
	row["name"] = name
	if base <= 0 {
		sql, err := insertSpellSQL(cols, entry, build, row)
		if err != nil {
			return SpellCreate{}, err
		}
		out, err := spellClientFile(sb, entry, 0, cols, row)
		if err != nil {
			return SpellCreate{}, err
		}
		return SpellCreate{Entry: entry, SQL: sql, File: mpq.File{Name: SpellPath, Data: out}}, nil
	}
	names := []string{"`entry`", "`build`"}
	sel := []string{strconv.Itoa(entry), strconv.Itoa(build)}
	for _, c := range cols {
		names = append(names, "`"+c.Name+"`")
		switch c.Name {
		case "name":
			sel = append(sel, nameSQL)
		case "script_name":
			sel = append(sel, "''")
			row[c.Name] = ""
		default:
			sel = append(sel, "t.`"+c.Name+"`")
		}
	}
	sql := fmt.Sprintf("INSERT INTO `spell_template` (%s) SELECT %s FROM `spell_template` t WHERE t.`entry` = %d AND t.`build` = %d;",
		strings.Join(names, ", "), strings.Join(sel, ", "), base, build)
	out, err := spellClientFile(sb, entry, base, cols, row)
	if err != nil {
		return SpellCreate{}, err
	}
	return SpellCreate{Entry: entry, SQL: sql, File: mpq.File{Name: SpellPath, Data: out}}, nil
}

// insertSpellSQL is the INSERT of spell entry's row of build with every column's value from values
// (each checked by sqlValue; a column values lacks gets the table's default).
func insertSpellSQL(cols []TemplateColumn, entry, build int, values map[string]string) (string, error) {
	names := []string{"`entry`", "`build`"}
	vals := []string{strconv.Itoa(entry), strconv.Itoa(build)}
	for _, c := range cols {
		v, ok := values[c.Name]
		if !ok {
			continue
		}
		q, err := sqlValue(c, v)
		if err != nil {
			return "", err
		}
		names = append(names, "`"+c.Name+"`")
		vals = append(vals, q)
	}
	return fmt.Sprintf("INSERT INTO `spell_template` (%s) VALUES (%s);", strings.Join(names, ", "), strings.Join(vals, ", ")), nil
}

// ForgetSpells drops what was read of the client's spell tables, after Meld's patch changed them.
func ForgetSpells() {
	spellData.Lock()
	spellData.spells, spellData.dir = nil, ""
	spellData.Unlock()
	spellTables.Lock()
	clear(spellTables.byDir)
	spellTables.Unlock()
}

// SpellsWithVisual lists up to limit of the client's spells whose visual (spellVisual1) is visual,
// by name, so the editor can say whose look a visual is.
func SpellsWithVisual(dataDir string, visual, limit int) ([]SpellRef, error) {
	if visual <= 0 {
		return nil, nil
	}
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return nil, err
	}
	t := spellData.spells
	seen := map[string]bool{}
	var out []SpellRef
	for r := 0; r < t.records && len(out) < max(limit, 1); r++ {
		if int(t.u32(r, spellFVisual)) != visual {
			continue
		}
		name := t.str(r, spellFName)
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, spellRef(r))
	}
	return out, nil
}

// IconSpells is how spells use an icon (a name under Interface\Icons), for the Icons tool (#683): its
// SpellIcon.dbc ID (0 when no row has it yet; the spell editor adds one when a spell first takes it),
// how many of the client's spells show it, and up to a limit of them, one per name.
type IconSpells struct {
	SpellIconID int        `json:"spellIconId"`
	Count       int        `json:"count"`
	Spells      []SpellRef `json:"spells"`
}

// SpellsWithIcon lists how the client's spells use icon, at most limit of them by name.
func SpellsWithIcon(dataDir, icon string, limit int) (IconSpells, error) {
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return IconSpells{}, err
	}
	id, rows, count := spellsWithIcon(spellData.icons, spellData.spells, icon, limit)
	out := IconSpells{SpellIconID: id, Count: count, Spells: make([]SpellRef, len(rows))}
	for i, r := range rows {
		out.Spells[i] = spellRef(r)
	}
	return out, nil
}

// spellsWithIcon finds icon's SpellIcon.dbc rows in icons (ID -> texture path), giving the lowest ID,
// the Spell.dbc rows of up to limit spells (one per name) whose icon is any of them, and how many
// spells show it in all.
func spellsWithIcon(icons map[uint32]string, t *dbcTable, icon string, limit int) (int, []int, int) {
	path := `Interface\Icons\` + icon
	ids := map[uint32]bool{}
	first := uint32(0)
	for id, p := range icons {
		if strings.EqualFold(p, path) {
			ids[id] = true
			if first == 0 || id < first {
				first = id
			}
		}
	}
	if len(ids) == 0 {
		return 0, nil, 0
	}
	seen := map[string]bool{}
	var rows []int
	count := 0
	for r := 0; r < t.records; r++ {
		if !ids[t.u32(r, spellFIcon)] {
			continue
		}
		count++
		if name := t.str(r, spellFName); !seen[name] && len(rows) < max(limit, 1) {
			seen[name] = true
			rows = append(rows, r)
		}
	}
	return int(first), rows, count
}

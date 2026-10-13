package vmangos

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"

	"WorldEditor/internal/mpq"
	"WorldEditor/internal/wow"
)

// TemplateColumn is a column of creature_template: its name, and the kind of value it holds
// ("int", "uint", "float" or "text"), whether it may be NULL, and for text its length (0 for TEXT).
type TemplateColumn struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Nullable bool   `json:"nullable"`
	MaxLen   int    `json:"maxLen"`
}

// CreatureRecord is a creature template's row: every column but entry and patch, as text the way
// mariadb prints them ("" for NULL in a nullable column).
type CreatureRecord struct {
	Entry   int               `json:"entry"`
	Patch   int               `json:"patch"`
	Columns []TemplateColumn  `json:"columns"`
	Values  map[string]string `json:"values"`
}

// parseColumns reads SHOW COLUMNS rows (field, type, null, key, default, extra) into the template
// columns the editor may change: all but the key (entry, patch).
func parseColumns(raw []byte) []TemplateColumn {
	var out []TemplateColumn
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		f := strings.Split(strings.TrimRight(line, "\r"), "\t")
		if len(f) < 3 || f[0] == "entry" || f[0] == "patch" {
			continue
		}
		t := strings.ToLower(f[1])
		c := TemplateColumn{Name: f[0], Nullable: f[2] == "YES"}
		switch {
		case strings.Contains(t, "int"):
			c.Kind = "int"
			if strings.Contains(t, "unsigned") {
				c.Kind = "uint"
			}
		case strings.HasPrefix(t, "float"), strings.HasPrefix(t, "double"), strings.HasPrefix(t, "decimal"):
			c.Kind = "float"
		default:
			c.Kind = "text"
			if i := strings.Index(t, "("); i >= 0 {
				c.MaxLen, _ = strconv.Atoi(strings.TrimSuffix(t[i+1:], ")"))
			}
		}
		out = append(out, c)
	}
	return out
}

// templateColumns reads creature_template's columns from the database.
func templateColumns(db worldDB) ([]TemplateColumn, error) {
	raw, err := runSQL(db, "SHOW COLUMNS FROM creature_template")
	if err != nil {
		return nil, err
	}
	cols := parseColumns(raw)
	if len(cols) == 0 {
		return nil, errors.New("creature_template has no columns")
	}
	return cols, nil
}

// unescapeBatch undoes mariadb's batch output escapes (\t, \n, \\, \0) in a field.
func unescapeBatch(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' || i+1 == len(s) {
			b.WriteByte(s[i])
			continue
		}
		i++
		switch s[i] {
		case 't':
			b.WriteByte('\t')
		case 'n':
			b.WriteByte('\n')
		case '0':
			b.WriteByte(0)
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

// sqlQuote makes text an SQL string literal.
func sqlQuote(s string) string {
	return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`, "\x00", `\0`, "\n", `\n`, "\r", `\r`).Replace(s) + "'"
}

// sqlValue checks a value typed into the editor against its column and returns it as SQL.
func sqlValue(c TemplateColumn, v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" && c.Nullable {
		return "NULL", nil
	}
	switch c.Kind {
	case "int", "uint":
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return "", fmt.Errorf("%s must be a whole number, not %q", c.Name, v)
		}
		if c.Kind == "uint" && n < 0 {
			return "", fmt.Errorf("%s can't be negative", c.Name)
		}
		return strconv.FormatInt(n, 10), nil
	case "float":
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return "", fmt.Errorf("%s must be a number, not %q", c.Name, v)
		}
		return num(f), nil
	}
	if c.MaxLen > 0 && len(v) > c.MaxLen {
		return "", fmt.Errorf("%s is longer than %d characters", c.Name, c.MaxLen)
	}
	return sqlQuote(v), nil
}

// ReadCreature reads creature template entry: its newest patch's row.
func ReadCreature(serverRoot string, entry int) (CreatureRecord, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return CreatureRecord{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return CreatureRecord{}, err
	}
	cols, err := templateColumns(db)
	if err != nil {
		return CreatureRecord{}, err
	}
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = "`" + c.Name + "`"
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT `patch`, %s FROM creature_template WHERE entry = %d ORDER BY patch DESC LIMIT 1",
		strings.Join(names, ", "), entry))
	if err != nil {
		return CreatureRecord{}, err
	}
	// Only the line end: empty last columns leave trailing tabs that are fields.
	line := strings.TrimRight(string(raw), "\r\n")
	f := strings.Split(line, "\t")
	if line == "" || len(f) != len(cols)+1 {
		return CreatureRecord{}, fmt.Errorf("the world database has no creature %d", entry)
	}
	rec := CreatureRecord{Entry: entry, Columns: cols, Values: make(map[string]string, len(cols))}
	rec.Patch, _ = strconv.Atoi(f[0])
	for i, c := range cols {
		v := f[i+1]
		if v == "NULL" && c.Nullable {
			v = ""
		}
		rec.Values[c.Name] = unescapeBatch(v)
	}
	return rec, nil
}

// creatureUpdateSQL is the UPDATE that writes values (by column) into template entry's patch row.
func creatureUpdateSQL(cols []TemplateColumn, entry, patch int, values map[string]string) (string, error) {
	byName := make(map[string]TemplateColumn, len(cols))
	for _, c := range cols {
		byName[c.Name] = c
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sets []string
	for _, k := range keys {
		c, ok := byName[k]
		if !ok {
			return "", fmt.Errorf("creature_template has no column %q", k)
		}
		v, err := sqlValue(c, values[k])
		if err != nil {
			return "", err
		}
		sets = append(sets, fmt.Sprintf("`%s` = %s", k, v))
	}
	if len(sets) == 0 {
		return "", nil
	}
	return fmt.Sprintf("UPDATE `creature_template` SET %s WHERE `entry` = %d AND `patch` = %d;", strings.Join(sets, ", "), entry, patch), nil
}

// SaveCreature writes changed template values (by column) into creature template entry's row of
// patch patch, and returns the SQL it ran.
func SaveCreature(serverRoot string, entry, patch int, values map[string]string) (string, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return "", err
	}
	cols, err := templateColumns(db)
	if err != nil {
		return "", err
	}
	sql, err := creatureUpdateSQL(cols, entry, patch, values)
	if err != nil || sql == "" {
		return sql, err
	}
	return sql, runScript(db, sql)
}

// CreateCreature adds a creature template named name under the first free entry and returns the
// entry. It copies template base (its newest patch) when base is not 0, else it starts from the
// table's defaults: level 1, hostile to everyone (faction 14), no display.
func CreateCreature(serverRoot string, base int, name string) (int, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, errors.New("a new creature needs a name")
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return 0, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return 0, err
	}
	raw, err := runSQL(db, "SELECT COALESCE(MAX(entry), 0) + 1 FROM creature_template")
	if err != nil {
		return 0, err
	}
	entry, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		return 0, err
	}
	cols, err := templateColumns(db)
	if err != nil {
		return 0, err
	}
	sql, err := createCreatureSQL(cols, entry, base, name)
	if err != nil {
		return 0, err
	}
	return entry, runScript(db, sql)
}

// createCreatureSQL is the INSERT that makes creature template entry named name, a copy of base's
// newest patch row or (base 0) the table's defaults.
func createCreatureSQL(cols []TemplateColumn, entry, base int, name string) (string, error) {
	nameCol, _ := sqlValue(TemplateColumn{Name: "name", Kind: "text", MaxLen: 100}, name)
	if len(name) > 100 {
		return "", errors.New("the name is longer than 100 characters")
	}
	if base == 0 {
		return fmt.Sprintf("INSERT INTO `creature_template` (`entry`, `patch`, `name`, `level_min`, `level_max`, `faction`, `display_scale1`, "+
			"`display_probability1`, `display_total_probability`) VALUES (%d, 0, %s, 1, 1, 14, 1, 100, 100);", entry, nameCol), nil
	}
	names := []string{"`entry`", "`patch`"}
	sel := []string{strconv.Itoa(entry), "0"}
	for _, c := range cols {
		names = append(names, "`"+c.Name+"`")
		if c.Name == "name" {
			sel = append(sel, nameCol)
		} else {
			sel = append(sel, "t.`"+c.Name+"`")
		}
	}
	return fmt.Sprintf("INSERT INTO `creature_template` (%s) SELECT %s FROM `creature_template` t WHERE t.`entry` = %d "+
		"ORDER BY t.`patch` DESC LIMIT 1;", strings.Join(names, ", "), strings.Join(sel, ", "), base), nil
}

// DisplayEntry is a creature display as the creature editor's display picker shows it: the model,
// the look it dresses the model in (wow.Look's query), its scale, and the creatures of the world
// database that use it.
type DisplayEntry struct {
	ID    int     `json:"id"`
	Model string  `json:"model"`
	Look  string  `json:"look"`
	Scale float32 `json:"scale"`
	// Skin is the display's first creature skin name ("" for none or a dressed humanoid).
	Skin string `json:"skin"`
	// Humanoid says the display dresses a character model (CreatureDisplayInfoExtra).
	Humanoid bool `json:"humanoid"`
	// Type is the creature type most creatures using the display have (0 when none uses it).
	Type int `json:"type"`
	// Names are a few creatures that use the display, the most used first.
	Names []string `json:"names"`
	// Uses is how many creature templates use the display.
	Uses int `json:"uses"`
}

var (
	displaysMu    sync.Mutex
	displaysCache = map[string][]DisplayEntry{}
)

// ListDisplays lists every creature display with a model, dressed as a spawn of it would be (no
// equipment, standing), with the creature templates that use it when the world database can be
// read (serverRoot "" or a database that is down leaves them out). The list is made once per client
// and server.
func ListDisplays(serverRoot, dataDir string) ([]DisplayEntry, error) {
	key := dataDir + "|" + serverRoot
	displaysMu.Lock()
	defer displaysMu.Unlock()
	if d, ok := displaysCache[key]; ok {
		return d, nil
	}
	tables, err := cachedModelTables(dataDir)
	if err != nil {
		return nil, err
	}
	uses := map[int]*displayUse{}
	if serverRoot != "" {
		if db, err := worldDatabase(serverRoot); err == nil && ensureDatabase(db, serverRoot) == nil {
			if raw, err := runSQL(db, displayUsesSQL); err == nil {
				uses = parseDisplayUses(raw)
			}
		}
	}
	out := listDisplays(tables, uses)
	displaysCache[key] = out
	return out, nil
}

// displayUsesSQL lists each creature template's displays with its type and name, newest patch.
const displayUsesSQL = `SELECT d, t.type, t.name FROM (
	SELECT entry, display_id1 AS d FROM creature_template UNION ALL SELECT entry, display_id2 FROM creature_template
	UNION ALL SELECT entry, display_id3 FROM creature_template UNION ALL SELECT entry, display_id4 FROM creature_template) u
	JOIN creature_template t ON t.entry = u.entry AND t.patch = (SELECT MAX(patch) FROM creature_template WHERE entry = u.entry)
	WHERE d <> 0 GROUP BY d, t.entry`

// displayUse is what the creature templates using a display have in common: the count of each type,
// and their names.
type displayUse struct {
	types map[int]int
	names []string
}

// parseDisplayUses reads displayUsesSQL's rows (display, type, name).
func parseDisplayUses(raw []byte) map[int]*displayUse {
	out := map[int]*displayUse{}
	for _, f := range tsvRows(raw, 3) {
		d, err1 := strconv.Atoi(f[0])
		t, err2 := strconv.Atoi(f[1])
		if err1 != nil || err2 != nil {
			continue
		}
		u := out[d]
		if u == nil {
			u = &displayUse{types: map[int]int{}}
			out[d] = u
		}
		u.types[t]++
		u.names = append(u.names, f[2])
	}
	return out
}

// listDisplays makes the display list from the client's tables and the templates' uses, by ID.
func listDisplays(tables *modelTables, uses map[int]*displayUse) []DisplayEntry {
	t := tables.creatureDisplay
	out := make([]DisplayEntry, 0, t.records)
	for r := 0; r < t.records; r++ {
		id := int(t.u32(r, 0))
		look := tables.creatureLook(uint32(id), gear{sheath: sheathMelee})
		if look.model == "" {
			continue
		}
		e := DisplayEntry{ID: id, Model: look.model, Look: look.look.Query(), Scale: look.scale, Skin: t.str(r, 6), Humanoid: t.u32(r, 3) != 0}
		if e.Humanoid {
			e.Skin = ""
		}
		if u := uses[id]; u != nil {
			e.Uses = len(u.names)
			best := -1
			for typ, n := range u.types {
				if n > best || (n == best && typ < e.Type) {
					e.Type, best = typ, n
				}
			}
			sort.Strings(u.names)
			e.Names = u.names
			if len(e.Names) > 3 {
				e.Names = e.Names[:3]
			}
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// AnimInfo is an animation a model has: its AnimationData ID and name.
type AnimInfo struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

var (
	animNamesMu sync.Mutex
	animNames   = map[string]map[int]string{}
)

// ModelAnimations lists the animations an M2 model has (each ID once, in ID order), named by the
// client's AnimationData.dbc.
func ModelAnimations(dataDir, model string) ([]AnimInfo, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	b, err := set.ReadFile(model)
	if err != nil && strings.HasSuffix(strings.ToLower(model), ".mdx") {
		b, err = set.ReadFile(model[:len(model)-len(".mdx")] + ".m2")
	}
	if err != nil {
		return nil, err
	}
	ids, err := wow.M2Animations(b)
	if err != nil {
		return nil, err
	}
	names, err := animationNames(set, dataDir)
	if err != nil {
		return nil, err
	}
	out := make([]AnimInfo, len(ids))
	for i, id := range ids {
		n := names[id]
		if n == "" {
			n = fmt.Sprintf("Animation %d", id)
		}
		out[i] = AnimInfo{ID: id, Name: n}
	}
	return out, nil
}

// animationNames reads AnimationData.dbc's names by ID once per data folder.
func animationNames(set *mpq.Set, dataDir string) (map[int]string, error) {
	animNamesMu.Lock()
	defer animNamesMu.Unlock()
	if n, ok := animNames[dataDir]; ok {
		return n, nil
	}
	b, err := set.ReadFile(`DBFilesClient\AnimationData.dbc`)
	if err != nil {
		return nil, err
	}
	t, err := parseDBC(b)
	if err != nil {
		return nil, err
	}
	n := make(map[int]string, t.records)
	for r := 0; r < t.records; r++ {
		n[int(t.u32(r, 0))] = t.str(r, 1)
	}
	animNames[dataDir] = n
	return n, nil
}

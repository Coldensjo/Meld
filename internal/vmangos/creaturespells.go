package vmangos

import (
	"fmt"
	"strconv"
	"strings"
)

// creatureSpellSlots is how many spells a creature_spells row holds (CREATURE_SPELLS_MAX_SPELLS).
const creatureSpellSlots = 8

// creatureSpellColumns are a creature_spells slot's columns, in the table's order; each is named
// <column>_<slot>, slot 1 to 8.
var creatureSpellColumns = []string{"spellId", "probability", "castTarget", "targetParam1", "targetParam2", "castFlags",
	"delayInitialMin", "delayInitialMax", "delayRepeatMin", "delayRepeatMax", "scriptId"}

// CreatureSpell is one slot of a creature's spell list (creature_spells): the spell, its chance to be
// cast when its timer is up (1-100), whom it is cast at (a ScriptTarget: 0 the creature itself, 1 its
// current target, ...) with that target's two parameters, the cast flags (CastFlags), the seconds
// before its first cast and between casts (each a random time from min to max) and a script run on
// the cast (creature_spells_scripts).
type CreatureSpell struct {
	Spell        int `json:"spell"`
	Probability  int `json:"probability"`
	CastTarget   int `json:"castTarget"`
	TargetParam1 int `json:"targetParam1"`
	TargetParam2 int `json:"targetParam2"`
	CastFlags    int `json:"castFlags"`
	InitialMin   int `json:"initialMin"`
	InitialMax   int `json:"initialMax"`
	RepeatMin    int `json:"repeatMin"`
	RepeatMax    int `json:"repeatMax"`
	ScriptID     int `json:"scriptId"`
}

func (s CreatureSpell) values() []int {
	return []int{s.Spell, s.Probability, s.CastTarget, s.TargetParam1, s.TargetParam2, s.CastFlags,
		s.InitialMin, s.InitialMax, s.RepeatMin, s.RepeatMax, s.ScriptID}
}

// CreatureSpells is a creature template's spell list: creature_template.spell_list_id (0 for none),
// the list row's name, how many creature templates use the list (Shared, this one included) and
// its spells in slot order, empty slots left out.
type CreatureSpells struct {
	ListID int             `json:"listId"`
	Name   string          `json:"name"`
	Shared int             `json:"shared"`
	Spells []CreatureSpell `json:"spells"`
}

// CreatureSpellsSaved is what SaveCreatureSpells did: the creature's spell list now (0 when it has
// none left) and the SQL it ran.
type CreatureSpellsSaved struct {
	ListID int    `json:"listId"`
	SQL    string `json:"sql"`
}

// creatureSpellsSelect selects list's row: its name, then every slot's columns.
func creatureSpellsSelect(list int) string {
	cols := []string{"`name`"}
	for i := 1; i <= creatureSpellSlots; i++ {
		for _, c := range creatureSpellColumns {
			cols = append(cols, fmt.Sprintf("`%s_%d`", c, i))
		}
	}
	return fmt.Sprintf("SELECT %s FROM `creature_spells` WHERE `entry` = %d", strings.Join(cols, ", "), list)
}

// parseCreatureSpells reads creatureSpellsSelect's row into its name and its spells, empty slots
// left out; ok is false when there is no row.
func parseCreatureSpells(raw []byte) (name string, spells []CreatureSpell, ok bool) {
	rows := batchRows(raw, 1+creatureSpellSlots*len(creatureSpellColumns))
	if len(rows) == 0 {
		return "", nil, false
	}
	f := rows[0]
	for i := 0; i < creatureSpellSlots; i++ {
		v := make([]int, len(creatureSpellColumns))
		for k := range v {
			v[k], _ = strconv.Atoi(f[1+i*len(creatureSpellColumns)+k])
		}
		if v[0] == 0 {
			continue
		}
		spells = append(spells, CreatureSpell{Spell: v[0], Probability: v[1], CastTarget: v[2], TargetParam1: v[3], TargetParam2: v[4], CastFlags: v[5],
			InitialMin: v[6], InitialMax: v[7], RepeatMin: v[8], RepeatMax: v[9], ScriptID: v[10]})
	}
	return f[0], spells, true
}

// ReadCreatureSpells reads creature template entry's spell list.
func ReadCreatureSpells(serverRoot string, entry int) (CreatureSpells, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return CreatureSpells{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return CreatureSpells{}, err
	}
	return readCreatureSpells(db, entry)
}

// readCreatureSpells reads entry's spell list.
func readCreatureSpells(db worldDB, entry int) (CreatureSpells, error) {
	var c CreatureSpells
	raw, err := runSQL(db, fmt.Sprintf("SELECT `spell_list_id` FROM `creature_template` WHERE `entry` = %d ORDER BY `patch` DESC LIMIT 1", entry))
	if err != nil {
		return c, err
	}
	c.ListID, _ = strconv.Atoi(strings.TrimSpace(string(raw)))
	if c.ListID <= 0 {
		return c, nil
	}
	raw, err = runSQL(db, fmt.Sprintf("SELECT COUNT(DISTINCT `entry`) FROM `creature_template` WHERE `spell_list_id` = %d", c.ListID))
	if err != nil {
		return c, err
	}
	c.Shared, _ = strconv.Atoi(strings.TrimSpace(string(raw)))
	raw, err = runSQL(db, creatureSpellsSelect(c.ListID))
	if err != nil {
		return c, err
	}
	c.Name, c.Spells, _ = parseCreatureSpells(raw)
	return c, nil
}

// checkCreatureSpells checks spells typed into the editor against creature_spells' columns and the
// rules the server loads them by (ObjectMgr::LoadCreatureSpells).
func checkCreatureSpells(spells []CreatureSpell) error {
	if len(spells) > creatureSpellSlots {
		return fmt.Errorf("a creature can have at most %d spells in its list", creatureSpellSlots)
	}
	for _, s := range spells {
		switch {
		case s.Spell <= 0 || s.Spell > 65535:
			return fmt.Errorf("spell %d is out of range (1 to 65535)", s.Spell)
		case s.Probability < 1 || s.Probability > 100:
			return fmt.Errorf("spell %d: the chance must be 1 to 100%%", s.Spell)
		case s.CastTarget < 0 || s.CastTarget > 99:
			return fmt.Errorf("spell %d: target %d is out of range", s.Spell, s.CastTarget)
		case s.TargetParam1 < 0 || s.TargetParam1 > 65535 || s.TargetParam2 < 0 || s.TargetParam2 > 65535 || s.CastFlags < 0 || s.CastFlags > 65535:
			return fmt.Errorf("spell %d: a target parameter or the flags are out of range (0 to 65535)", s.Spell)
		case s.InitialMin < 0 || s.InitialMax > 65535 || s.RepeatMin < 0 || s.RepeatMax > 65535:
			return fmt.Errorf("spell %d: a delay is out of range (0 to 65535 seconds)", s.Spell)
		case s.InitialMin > s.InitialMax || s.RepeatMin > s.RepeatMax:
			return fmt.Errorf("spell %d: a delay's least is more than its most, which the server skips", s.Spell)
		case s.ScriptID < 0 || s.ScriptID > 16777215:
			return fmt.Errorf("spell %d: script %d is out of range", s.Spell, s.ScriptID)
		}
	}
	return nil
}

// creatureSpellsSQL sets creature entry's spell list to spells, in slot order. c is its list as
// readCreatureSpells read it. A list other creature templates use too is never edited: the creature
// gets a new list, newList, as one with no list does; an empty list leaves the creature with none
// (spell_list_id 0) and deletes its own row. name names a new list's row.
func creatureSpellsSQL(entry int, c CreatureSpells, spells []CreatureSpell, newList int, name string) (string, int) {
	own := c.ListID > 0 && c.Shared <= 1
	var b strings.Builder
	if len(spells) == 0 {
		if c.ListID <= 0 {
			return "", 0
		}
		if own {
			fmt.Fprintf(&b, "DELETE FROM `creature_spells` WHERE `entry` = %d;\n", c.ListID)
		}
		fmt.Fprintf(&b, "UPDATE `creature_template` SET `spell_list_id` = 0 WHERE `entry` = %d;", entry)
		return b.String(), 0
	}
	list := newList
	if own {
		list = c.ListID
		if c.Name != "" {
			name = c.Name
		}
	}
	cols := []string{"`entry`", "`name`"}
	vals := []string{strconv.Itoa(list), sqlQuote(name)}
	for i := 1; i <= creatureSpellSlots; i++ {
		var v []int
		if i <= len(spells) {
			v = spells[i-1].values()
		} else {
			v = make([]int, len(creatureSpellColumns))
		}
		for k, col := range creatureSpellColumns {
			cols = append(cols, fmt.Sprintf("`%s_%d`", col, i))
			vals = append(vals, strconv.Itoa(v[k]))
		}
	}
	fmt.Fprintf(&b, "REPLACE INTO `creature_spells` (%s) VALUES (%s);", strings.Join(cols, ", "), strings.Join(vals, ", "))
	if list != c.ListID {
		fmt.Fprintf(&b, "\nUPDATE `creature_template` SET `spell_list_id` = %d WHERE `entry` = %d;", list, entry)
	}
	return b.String(), list
}

// freeSpellList picks a creature_spells entry for creature entry's new list: the first of entry*10
// to entry*10+9 (VMaNGOS's own numbering: Mograine, 3976, has 39760) that no row and no creature
// template uses, else one past the highest in use.
func freeSpellList(db worldDB, entry int) (int, error) {
	lo := entry * 10
	raw, err := runSQL(db, fmt.Sprintf("SELECT `entry` FROM `creature_spells` WHERE `entry` BETWEEN %d AND %d "+
		"UNION SELECT `spell_list_id` FROM `creature_template` WHERE `spell_list_id` BETWEEN %d AND %d", lo, lo+9, lo, lo+9))
	if err != nil {
		return 0, err
	}
	used := map[int]bool{}
	for _, l := range strings.Fields(string(raw)) {
		n, _ := strconv.Atoi(l)
		used[n] = true
	}
	for id := lo; id <= lo+9; id++ {
		if !used[id] {
			return id, nil
		}
	}
	raw, err = runSQL(db, "SELECT GREATEST((SELECT COALESCE(MAX(`entry`), 0) FROM `creature_spells`), (SELECT COALESCE(MAX(`spell_list_id`), 0) FROM `creature_template`))")
	if err != nil {
		return 0, err
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	return n + 1, nil
}

// SaveCreatureSpells sets creature template entry's spell list to spells (creatureSpellsSQL). Every
// spell must be one the server has (spell_template).
func SaveCreatureSpells(serverRoot string, entry int, spells []CreatureSpell) (CreatureSpellsSaved, error) {
	if err := checkCreatureSpells(spells); err != nil {
		return CreatureSpellsSaved{}, err
	}
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return CreatureSpellsSaved{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return CreatureSpellsSaved{}, err
	}
	if len(spells) > 0 {
		ids := make([]string, len(spells))
		for i, s := range spells {
			ids[i] = strconv.Itoa(s.Spell)
		}
		raw, err := runSQL(db, "SELECT DISTINCT `entry` FROM `spell_template` WHERE `entry` IN ("+strings.Join(ids, ",")+")")
		if err != nil {
			return CreatureSpellsSaved{}, err
		}
		known := map[int]bool{}
		for _, l := range strings.Fields(string(raw)) {
			n, _ := strconv.Atoi(l)
			known[n] = true
		}
		for _, s := range spells {
			if !known[s.Spell] {
				return CreatureSpellsSaved{}, fmt.Errorf("the server has no spell %d (spell_template), so it would skip it", s.Spell)
			}
		}
	}
	// A template naming a list with no row gets that row, unless other templates name it too.
	c, err := readCreatureSpells(db, entry)
	if err != nil {
		return CreatureSpellsSaved{}, err
	}
	newList := 0
	if len(spells) > 0 && (c.ListID <= 0 || c.Shared > 1) {
		if newList, err = freeSpellList(db, entry); err != nil {
			return CreatureSpellsSaved{}, err
		}
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT `name` FROM `creature_template` WHERE `entry` = %d ORDER BY `patch` DESC LIMIT 1", entry))
	if err != nil {
		return CreatureSpellsSaved{}, err
	}
	name := unescapeBatch(strings.TrimRight(string(raw), "\r\n"))
	if name == "" {
		name = fmt.Sprintf("Creature %d", entry)
	}
	sql, list := creatureSpellsSQL(entry, c, spells, newList, name)
	if sql == "" {
		return CreatureSpellsSaved{ListID: list}, nil
	}
	if err := runScript(db, sql); err != nil {
		return CreatureSpellsSaved{}, err
	}
	return CreatureSpellsSaved{ListID: list, SQL: sql}, nil
}

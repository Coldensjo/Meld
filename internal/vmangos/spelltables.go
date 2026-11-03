package vmangos

import (
	"fmt"
	"sort"
	"strconv"
	"sync"

	"Meld/internal/mpq"
)

// SpellOption is a row of one of the client's spell tables that spell_template points into by
// index (cast times, durations, ranges, radii), as the spell editor's selects show it: its ID, a
// label and the number the tooltip uses (milliseconds for a time, yards for a distance; -1 for a
// duration until cancelled).
type SpellOption struct {
	ID    int     `json:"id"`
	Label string  `json:"label"`
	Value float64 `json:"value"`
	// Scaled says the time grows with the caster's level.
	Scaled bool `json:"scaled"`
}

// SpellTables are the client's tables a spell's index columns name: castingTimeIndex
// (SpellCastTimes.dbc), durationIndex (SpellDuration.dbc), rangeIndex (SpellRange.dbc) and
// effectRadiusIndex1-3 (SpellRadius.dbc), each by ID; and for the spell editor's pickers (#703) the
// global cooldown categories startRecoveryCategory names (Spell.dbc's, each named by its spells, as
// 1.12 has no table of them) and the icons activeIconId names (SpellIcon.dbc's texture paths).
type SpellTables struct {
	CastTimes        []SpellOption `json:"castTimes"`
	Durations        []SpellOption `json:"durations"`
	Ranges           []SpellOption `json:"ranges"`
	Radii            []SpellOption `json:"radii"`
	GlobalCategories []NamedID     `json:"globalCategories"`
	Icons            []NamedID     `json:"icons"`
	// Enchantments are SpellItemEnchantment.dbc's rows, which an Enchant item effect's misc value
	// names (#709), each by its name ("+5 Agility", "Fiery Weapon").
	Enchantments []NamedID `json:"enchantments"`
}

// spellEnchantmentNames reads SpellItemEnchantment.dbc (1.12: ID, 3 effect types, 3 least and
// 3 most amounts, 3 spell or stat ids, then the name in 8 locales and a mask), naming each row by its
// English name, or "Unnamed" when it has none.
func spellEnchantmentNames(t *dbcTable) []NamedID {
	fName := t.col("Name")
	out := make([]NamedID, 0, t.records)
	for r := 0; r < t.records; r++ {
		name := t.str(r, fName)
		if name == "" {
			name = "Unnamed"
		}
		out = append(out, NamedID{ID: int(t.u32(r, 0)), Name: name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

var spellTables struct {
	sync.Mutex
	byDir map[string]*SpellTables
}

// yards writes a distance without a needless fraction.
func yards(v float32) string {
	return strconv.FormatFloat(float64(v), 'f', -1, 32) + " yd"
}

// ReadSpellTables reads the tables, once per client data folder.
func ReadSpellTables(dataDir string) (SpellTables, error) {
	spellTables.Lock()
	defer spellTables.Unlock()
	if t, ok := spellTables.byDir[dataDir]; ok {
		return *t, nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return SpellTables{}, err
	}
	defer set.Close()
	// read reads a table of at least last's columns; rows gives the reader of its rows, its columns
	// resolved once.
	read := func(s *dbcSchema, last string, rows func(t *dbcTable) func(r int) SpellOption) ([]SpellOption, error) {
		b, err := set.ReadFile(s.file())
		if err != nil {
			return nil, err
		}
		t, err := parseTable(b, s)
		if err != nil {
			return nil, err
		}
		if t.fields <= t.col(last) {
			return nil, fmt.Errorf("%s.dbc has %d fields, fewer than 1.12's %d", s.name, t.fields, t.col(last)+1)
		}
		row := rows(t)
		out := make([]SpellOption, 0, t.records)
		for r := 0; r < t.records; r++ {
			o := row(r)
			o.ID = int(t.u32(r, 0))
			out = append(out, o)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		return out, nil
	}
	var out SpellTables
	// SpellCastTimes: ID, base ms, per level, least.
	if out.CastTimes, err = read(dbcSpellCastTimes, "Min", func(t *dbcTable) func(r int) SpellOption {
		base, per := t.col("Base"), t.col("PerLevel")
		return func(r int) SpellOption {
			ms := int(int32(t.u32(r, base)))
			label := "Instant"
			if ms > 0 {
				label = fmt.Sprintf("%g sec", float64(ms)/1000)
			}
			return SpellOption{Label: label, Value: float64(ms), Scaled: t.u32(r, per) != 0}
		}
	}); err != nil {
		return SpellTables{}, err
	}
	// SpellDuration: ID, base ms (-1 until cancelled), per level, most.
	if out.Durations, err = read(dbcSpellDuration, "Max", func(t *dbcTable) func(r int) SpellOption {
		base, perCol, most := t.col("Duration"), t.col("PerLevel"), t.col("Max")
		return func(r int) SpellOption {
			ms := int(int32(t.u32(r, base)))
			label := spellDuration(ms)
			if ms == 0 {
				label = "None"
			}
			if per := int(int32(t.u32(r, perCol))); per != 0 {
				label += fmt.Sprintf(" (+%g sec a level, up to %s)", float64(per)/1000, spellDuration(int(int32(t.u32(r, most)))))
			}
			return SpellOption{Label: label, Value: float64(ms), Scaled: t.u32(r, perCol) != 0}
		}
	}); err != nil {
		return SpellTables{}, err
	}
	// SpellRange: ID, least and most yards, flags, the name in 8 locales.
	if out.Ranges, err = read(dbcSpellRange, "Name", func(t *dbcTable) func(r int) SpellOption {
		least, most, nameCol := t.col("Min"), t.col("Max"), t.col("Name")
		return func(r int) SpellOption {
			lo, hi := t.f32(r, least), t.f32(r, most)
			label := yards(hi)
			if lo > 0 {
				label = yards(lo) + " to " + label
			}
			if name := t.str(r, nameCol); name != "" {
				label += " · " + name
			}
			return SpellOption{Label: label, Value: float64(hi)}
		}
	}); err != nil {
		return SpellTables{}, err
	}
	// SpellRadius: ID, yards, per level, most.
	if out.Radii, err = read(dbcSpellRadius, "Max", func(t *dbcTable) func(r int) SpellOption {
		radius := t.col("Radius")
		return func(r int) SpellOption {
			return SpellOption{Label: yards(t.f32(r, radius)), Value: float64(t.f32(r, radius))}
		}
	}); err != nil {
		return SpellTables{}, err
	}
	if b, err := set.ReadFile(dbcSpellEnchant.file()); err == nil {
		if t, err := parseTable(b, dbcSpellEnchant); err == nil && t.fields > t.col("Name") {
			out.Enchantments = spellEnchantmentNames(t)
		}
	}
	spellData.Lock()
	err = loadSpellData(dataDir)
	if err == nil {
		if spellData.spells.fields > spellColsOf(spellData.spells).startCategory {
			out.GlobalCategories = spellCategoryNames(spellData.spells, spellColsOf(spellData.spells).startCategory)
		}
		out.Icons = make([]NamedID, 0, len(spellData.icons))
		for id, path := range spellData.icons {
			out.Icons = append(out.Icons, NamedID{ID: int(id), Name: path})
		}
		sort.Slice(out.Icons, func(i, j int) bool { return out.Icons[i].ID < out.Icons[j].ID })
	}
	spellData.Unlock()
	if err != nil {
		return SpellTables{}, err
	}
	if spellTables.byDir == nil {
		spellTables.byDir = map[string]*SpellTables{}
	}
	spellTables.byDir[dataDir] = &out
	return out, nil
}

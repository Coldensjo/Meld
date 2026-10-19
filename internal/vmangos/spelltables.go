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
}

// SpellTables are the client's tables a spell's index columns name: castingTimeIndex
// (SpellCastTimes.dbc), durationIndex (SpellDuration.dbc), rangeIndex (SpellRange.dbc) and
// effectRadiusIndex1-3 (SpellRadius.dbc), each by ID.
type SpellTables struct {
	CastTimes []SpellOption `json:"castTimes"`
	Durations []SpellOption `json:"durations"`
	Ranges    []SpellOption `json:"ranges"`
	Radii     []SpellOption `json:"radii"`
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
	read := func(name string, fields int, row func(t *dbcTable, r int) SpellOption) ([]SpellOption, error) {
		b, err := set.ReadFile(`DBFilesClient\` + name + `.dbc`)
		if err != nil {
			return nil, err
		}
		t, err := parseDBC(b)
		if err != nil {
			return nil, err
		}
		if t.fields < fields {
			return nil, fmt.Errorf("%s.dbc has %d fields, fewer than 1.12's %d", name, t.fields, fields)
		}
		out := make([]SpellOption, 0, t.records)
		for r := 0; r < t.records; r++ {
			o := row(t, r)
			o.ID = int(t.u32(r, 0))
			out = append(out, o)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		return out, nil
	}
	var out SpellTables
	// SpellCastTimes: ID, base ms, per level, least.
	if out.CastTimes, err = read("SpellCastTimes", 4, func(t *dbcTable, r int) SpellOption {
		ms := int(int32(t.u32(r, 1)))
		label := "Instant"
		if ms > 0 {
			label = fmt.Sprintf("%g sec", float64(ms)/1000)
		}
		return SpellOption{Label: label, Value: float64(ms)}
	}); err != nil {
		return SpellTables{}, err
	}
	// SpellDuration: ID, base ms (-1 until cancelled), per level, most.
	if out.Durations, err = read("SpellDuration", 4, func(t *dbcTable, r int) SpellOption {
		ms := int(int32(t.u32(r, 1)))
		label := spellDuration(ms)
		if ms == 0 {
			label = "None"
		}
		if per := int(int32(t.u32(r, 2))); per != 0 {
			label += fmt.Sprintf(" (+%g sec a level, up to %s)", float64(per)/1000, spellDuration(int(int32(t.u32(r, 3)))))
		}
		return SpellOption{Label: label, Value: float64(ms)}
	}); err != nil {
		return SpellTables{}, err
	}
	// SpellRange: ID, least and most yards, flags, the name in 8 locales.
	if out.Ranges, err = read("SpellRange", 5, func(t *dbcTable, r int) SpellOption {
		lo, hi := t.f32(r, 1), t.f32(r, 2)
		label := yards(hi)
		if lo > 0 {
			label = yards(lo) + " to " + label
		}
		if name := t.str(r, 4); name != "" {
			label += " · " + name
		}
		return SpellOption{Label: label, Value: float64(hi)}
	}); err != nil {
		return SpellTables{}, err
	}
	// SpellRadius: ID, yards, per level, most.
	if out.Radii, err = read("SpellRadius", 4, func(t *dbcTable, r int) SpellOption {
		return SpellOption{Label: yards(t.f32(r, 1)), Value: float64(t.f32(r, 1))}
	}); err != nil {
		return SpellTables{}, err
	}
	if spellTables.byDir == nil {
		spellTables.byDir = map[string]*SpellTables{}
	}
	spellTables.byDir[dataDir] = &out
	return out, nil
}

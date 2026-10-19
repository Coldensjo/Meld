package vmangos

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// Spell.dbc field indexes of 1.12.1 (173 fields): the indexes are those of MaNGOS's SpellEntry, and
// TestSpellTextsFromClient checks them against the client's own rows.
const (
	spellFProcChance  = 25
	spellFProcCharges = 26
	spellFDuration    = 30
	spellFEffectDie   = 64 // three fields: EffectDieSides
	spellFEffectDice  = 67 // EffectBaseDice
	spellFEffectBase  = 76 // EffectBasePoints
	spellFAmplitude   = 94 // EffectAuraPeriod
	spellFChain       = 100
	spellFDescription = 138 // enUS; the other locales and a flags field follow
	spellFStack       = 39
	spellFIcon        = 117 // SpellIconID
	spellFVisual      = 115 // SpellVisual
	spellFRadius      = 88  // EffectRadiusIndex
	spellFName        = 120 // enUS
	spellFRank        = 129 // enUS
)

// spellData is what spell descriptions are filled in from, read once per client data folder.
var spellData struct {
	sync.Mutex
	dir       string
	spells    *dbcTable
	durations map[uint32]int     // SpellDuration.dbc: ID -> milliseconds, -1 for until cancelled
	icons     map[uint32]string  // SpellIcon.dbc: ID -> texture path, without .blp
	radii     map[uint32]float32 // SpellRadius.dbc: ID -> yards
}

func loadSpellData(dataDir string) error {
	if spellData.spells != nil && spellData.dir == dataDir {
		return nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return err
	}
	defer set.Close()
	sb, err := set.ReadFile(`DBFilesClient\Spell.dbc`)
	if err != nil {
		return err
	}
	spells, err := parseDBC(sb)
	if err != nil {
		return err
	}
	if spells.fields <= spellFDescription {
		return fmt.Errorf("Spell.dbc has %d fields, not the 1.12 layout", spells.fields)
	}
	durations := map[uint32]int{}
	if db, err := set.ReadFile(`DBFilesClient\SpellDuration.dbc`); err == nil {
		if dt, err := parseDBC(db); err == nil && dt.fields > 1 {
			for r := 0; r < dt.records; r++ {
				durations[dt.u32(r, 0)] = int(int32(dt.u32(r, 1)))
			}
		}
	}
	icons := map[uint32]string{}
	if ib, err := set.ReadFile(`DBFilesClient\SpellIcon.dbc`); err == nil {
		if it, err := parseDBC(ib); err == nil && it.fields > 1 {
			for r := 0; r < it.records; r++ {
				if p := it.str(r, 1); p != "" {
					icons[it.u32(r, 0)] = p
				}
			}
		}
	}
	radii := map[uint32]float32{}
	if rb, err := set.ReadFile(`DBFilesClient\SpellRadius.dbc`); err == nil {
		if rt, err := parseDBC(rb); err == nil && rt.fields > 1 {
			for r := 0; r < rt.records; r++ {
				radii[rt.u32(r, 0)] = rt.f32(r, 1)
			}
		}
	}
	spellData.dir, spellData.spells, spellData.durations, spellData.icons, spellData.radii = dataDir, spells, durations, icons, radii
	return nil
}

// SpellTexts gives the description of each spell as the tooltip shows it, its tokens filled in from
// the spell's own values, leaving out spells the client doesn't have or that have no description.
func SpellTexts(dataDir string, ids []int) (map[int]string, error) {
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return nil, err
	}
	out := make(map[int]string, len(ids))
	for _, id := range ids {
		r, ok := spellData.spells.row(uint32(id))
		if !ok {
			continue
		}
		if d := spellData.spells.str(r, spellFDescription); d != "" {
			out[id] = expandSpellText(d, spellData.spells, r, spellData.durations)
		}
	}
	return out, nil
}

func spellDuration(ms int) string {
	switch {
	case ms < 0:
		return "until cancelled"
	case ms < 60000:
		return fmt.Sprintf("%g sec", float64(ms)/1000)
	case ms < 3600000:
		return fmt.Sprintf("%g min", float64(ms)/60000)
	}
	return fmt.Sprintf("%g hour", float64(ms)/3600000)
}

// expandSpellText fills in a description's $ tokens: $s/$m/$M (effect values), $o (the total over
// a periodic effect), $t (its period), $d (duration), $h (proc chance), $n (charges), $u (stack),
// $x (chain targets), $a (radius, when spellData's radii are read) and $l singular:plural; tokens it
// doesn't know stay as written.
func expandSpellText(desc string, t *dbcTable, r int, durations map[uint32]int) string {
	i32 := func(base, k int) int { return int(int32(t.u32(r, base+k))) }
	lo := func(k int) int { return i32(spellFEffectBase, k) + max(i32(spellFEffectDice, k), 1) }
	hi := func(k int) int { return i32(spellFEffectBase, k) + i32(spellFEffectDie, k) }
	duration := durations[t.u32(r, spellFDuration)]
	abs := func(v int) int {
		if v < 0 {
			return -v
		}
		return v
	}
	var b strings.Builder
	last := 0 // the last number written, for $l
	for i := 0; i < len(desc); i++ {
		c := desc[i]
		if c != '$' || i+1 >= len(desc) {
			b.WriteByte(c)
			continue
		}
		j := i + 1
		if desc[j] == 'l' {
			// $lsingular:plural;
			end := strings.IndexByte(desc[j:], ';')
			parts := strings.SplitN(desc[j+1:max(j+1, j+end)], ":", 2)
			if end > 0 && len(parts) == 2 {
				if last == 1 {
					b.WriteString(parts[0])
				} else {
					b.WriteString(parts[1])
				}
				i = j + end
				continue
			}
		}
		tok := desc[j]
		if !strings.ContainsRune("sSmMoOtTdDhHnNuUxXaA", rune(tok)) {
			b.WriteByte(c)
			continue
		}
		k := j + 1
		num := 0
		for k < len(desc) && desc[k] >= '0' && desc[k] <= '9' && k < j+2 {
			num = int(desc[k] - '0')
			k++
		}
		e := num - 1
		if e < 0 || e > 2 {
			e = 0
		}
		var text string
		var n int
		isNum := true
		switch tok {
		case 's', 'S', 'm':
			n = abs(lo(e))
			text = strconv.Itoa(n)
			if hi(e) > lo(e) && tok != 'm' {
				text = fmt.Sprintf("%d to %d", abs(lo(e)), abs(hi(e)))
			}
		case 'M':
			n = abs(hi(e))
			text = strconv.Itoa(n)
		case 'o', 'O':
			// An aura with no period of its own (the food and drink regeneration) counts
			// every 5 seconds: spell 433's 17 over 18 sec shows as 61, as the game says.
			period := i32(spellFAmplitude, e)
			if period <= 0 {
				period = 5000
			}
			n = abs(lo(e))
			if duration > 0 {
				n = n * duration / period
			}
			text = strconv.Itoa(n)
		case 't', 'T':
			n = i32(spellFAmplitude, e) / 1000
			text = strconv.Itoa(n)
		case 'd', 'D':
			text, isNum = spellDuration(duration), false
		case 'h', 'H':
			n = int(t.u32(r, spellFProcChance))
			text = strconv.Itoa(n)
		case 'n', 'N':
			n = int(t.u32(r, spellFProcCharges))
			text = strconv.Itoa(n)
		case 'u', 'U':
			n = int(t.u32(r, spellFStack))
			text = strconv.Itoa(n)
		case 'a', 'A':
			yd, ok := spellData.radii[t.u32(r, spellFRadius+e)]
			if !ok {
				b.WriteString(desc[i:k])
				i = k - 1
				continue
			}
			n = int(yd)
			text = strconv.FormatFloat(float64(yd), 'f', -1, 32)
		case 'x', 'X':
			n = i32(spellFChain, e)
			text = strconv.Itoa(n)
		}
		if isNum {
			last = n
		}
		b.WriteString(text)
		i = k - 1
	}
	return b.String()
}

// SpellRef is a client spell as the creature editor's Spells tab lists it: its name and rank, its
// icon (a texture path without .blp, "" when it has none), its description, tokens filled in, and
// its visual (SpellVisual.dbc ID, for the spell editor's Take the visual of).
type SpellRef struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Rank   string `json:"rank"`
	Icon   string `json:"icon"`
	Text   string `json:"text"`
	Visual int    `json:"visual"`
}

// spellRef reads row r of Spell.dbc; spellData must be loaded and locked.
func spellRef(r int) SpellRef {
	t := spellData.spells
	ref := SpellRef{ID: int(t.u32(r, 0)), Name: t.str(r, spellFName), Rank: t.str(r, spellFRank), Icon: spellData.icons[t.u32(r, spellFIcon)], Visual: int(t.u32(r, spellFVisual))}
	if d := t.str(r, spellFDescription); d != "" {
		ref.Text = expandSpellText(d, t, r, spellData.durations)
	}
	return ref
}

// SpellRefs gives each spell the client has, by ID.
func SpellRefs(dataDir string, ids []int) (map[int]SpellRef, error) {
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return nil, err
	}
	out := make(map[int]SpellRef, len(ids))
	for _, id := range ids {
		if r, ok := spellData.spells.row(uint32(id)); ok {
			out[id] = spellRef(r)
		}
	}
	return out, nil
}

// SearchSpells lists the client's spells whose name has text in it (any case), or whose ID is text,
// at most limit of them: the ID first, then names equal to text, then names starting with it, then
// the rest, each by name, rank and ID.
func SearchSpells(dataDir, text string, limit int) ([]SpellRef, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return nil, err
	}
	t := spellData.spells
	want := strings.ToLower(text)
	type hit struct {
		r, kind int
		name    string
	}
	var hits []hit
	id, idErr := strconv.Atoi(text)
	for r := 0; r < t.records; r++ {
		name := t.str(r, spellFName)
		if idErr == nil && int(t.u32(r, 0)) == id {
			hits = append(hits, hit{r, 0, name})
			continue
		}
		if name == "" {
			continue
		}
		low := strings.ToLower(name)
		switch {
		case low == want:
			hits = append(hits, hit{r, 1, name})
		case strings.HasPrefix(low, want):
			hits = append(hits, hit{r, 2, name})
		case strings.Contains(low, want):
			hits = append(hits, hit{r, 3, name})
		}
	}
	sort.Slice(hits, func(i, j int) bool {
		a, b := hits[i], hits[j]
		if a.kind != b.kind {
			return a.kind < b.kind
		}
		if a.name != b.name {
			return a.name < b.name
		}
		// Rank 2 before Rank 10.
		if ra, rb := t.str(a.r, spellFRank), t.str(b.r, spellFRank); ra != rb {
			if len(ra) != len(rb) {
				return len(ra) < len(rb)
			}
			return ra < rb
		}
		return t.u32(a.r, 0) < t.u32(b.r, 0)
	})
	if len(hits) > max(limit, 1) {
		hits = hits[:max(limit, 1)]
	}
	out := make([]SpellRef, len(hits))
	for i, h := range hits {
		out[i] = spellRef(h.r)
	}
	return out, nil
}

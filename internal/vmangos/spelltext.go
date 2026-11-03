package vmangos

import (
	"fmt"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// spellData is what spell descriptions are filled in from, read once per client data folder, and
// again when the waiting files changed on disk (another process saved a spell while the game ran,
// #1080).
var spellData struct {
	sync.Mutex
	dir       string
	gen       uint64 // pendingGeneration at the read
	spells    *dbcTable
	durations map[uint32]int     // SpellDuration.dbc: ID -> milliseconds, -1 for until cancelled
	icons     map[uint32]string  // SpellIcon.dbc: ID -> texture path, without .blp
	radii     map[uint32]float32 // SpellRadius.dbc: ID -> yards
}

func loadSpellData(dataDir string) error {
	gen := pendingGeneration(dataDir)
	if spellData.spells != nil && spellData.dir == dataDir && spellData.gen == gen {
		return nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return err
	}
	defer set.Close()
	sb, err := readOverlay(set, dataDir, SpellPath)
	if err != nil {
		return err
	}
	spells, err := parseTable(sb, dbcSpell)
	if err != nil {
		return err
	}
	if spells.fields <= spellColsOf(spells).description {
		return fmt.Errorf("Spell.dbc has %d fields, not the 1.12 layout", spells.fields)
	}
	durations := map[uint32]int{}
	if db, err := set.ReadFile(dbcSpellDuration.file()); err == nil {
		if dt, err := parseTable(db, dbcSpellDuration); err == nil && dt.fields > dt.col("Duration") {
			c := dt.col("Duration")
			for r := 0; r < dt.records; r++ {
				durations[dt.u32(r, 0)] = int(int32(dt.u32(r, c)))
			}
		}
	}
	icons := map[uint32]string{}
	if ib, err := readOverlay(set, dataDir, SpellIconPath); err == nil {
		if it, err := parseTable(ib, dbcSpellIcon); err == nil && it.fields > it.col("Texture") {
			c := it.col("Texture")
			for r := 0; r < it.records; r++ {
				if p := it.str(r, c); p != "" {
					icons[it.u32(r, 0)] = p
				}
			}
		}
	}
	radii := map[uint32]float32{}
	if rb, err := set.ReadFile(dbcSpellRadius.file()); err == nil {
		if rt, err := parseTable(rb, dbcSpellRadius); err == nil && rt.fields > rt.col("Radius") {
			c := rt.col("Radius")
			for r := 0; r < rt.records; r++ {
				radii[rt.u32(r, 0)] = rt.f32(r, c)
			}
		}
	}
	spellData.dir, spellData.gen, spellData.spells, spellData.durations, spellData.icons, spellData.radii = dataDir, gen, spells, durations, icons, radii
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
		if d := spellData.spells.str(r, spellColsOf(spellData.spells).description); d != "" {
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
	sc := spellColsOf(t)
	i32 := func(base, k int) int { return int(int32(t.u32(r, base+k))) }
	lo := func(k int) int { return i32(sc.effectBase, k) + max(i32(sc.effectDice, k), 1) }
	hi := func(k int) int { return i32(sc.effectBase, k) + i32(sc.effectDie, k) }
	duration := durations[t.u32(r, sc.duration)]
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
			period := i32(sc.amplitude, e)
			if period <= 0 {
				period = 5000
			}
			n = abs(lo(e))
			if duration > 0 {
				n = n * duration / period
			}
			text = strconv.Itoa(n)
		case 't', 'T':
			n = i32(sc.amplitude, e) / 1000
			text = strconv.Itoa(n)
		case 'd', 'D':
			text, isNum = spellDuration(duration), false
		case 'h', 'H':
			n = int(t.u32(r, sc.procChance))
			text = strconv.Itoa(n)
		case 'n', 'N':
			n = int(t.u32(r, sc.procCharges))
			text = strconv.Itoa(n)
		case 'u', 'U':
			n = int(t.u32(r, sc.stack))
			text = strconv.Itoa(n)
		case 'a', 'A':
			yd, ok := spellData.radii[t.u32(r, sc.radius+e)]
			if !ok {
				b.WriteString(desc[i:k])
				i = k - 1
				continue
			}
			n = int(yd)
			text = strconv.FormatFloat(float64(yd), 'f', -1, 32)
		case 'x', 'X':
			n = i32(sc.chain, e)
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
	sc := spellColsOf(t)
	ref := SpellRef{ID: int(t.u32(r, 0)), Name: t.str(r, sc.name), Rank: t.str(r, sc.rank), Icon: spellData.icons[t.u32(r, sc.icon)], Visual: int(t.u32(r, sc.visual))}
	if d := t.str(r, sc.description); d != "" {
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
	hits := matchSpells(spellData.spells, text, func(int, bool) bool { return true })
	if len(hits) > max(limit, 1) {
		hits = hits[:max(limit, 1)]
	}
	out := make([]SpellRef, len(hits))
	for i, r := range hits {
		out[i] = spellRef(r)
	}
	return out, nil
}

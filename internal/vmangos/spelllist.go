package vmangos

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// The creature editor's spell list (#340): the client's spells browsed by category (a class's,
// a profession's or another skill line's spells, read from SkillLineAbility.dbc, or the creature
// abilities, the spells in no skill line) and by school, narrowed by a search.

// SpellCategory is one entry of the Spells tab's category list: Key is what ListSpells takes
// ("npc", "all" or "skill:<SkillLine ID>"), Group the heading it is listed under and Count how many
// spells it holds (noise left out).
type SpellCategory struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Group string `json:"group"`
	Count int    `json:"count"`
}

// SpellList is a page of ListSpells: the spells shown and how many matched in all.
type SpellList struct {
	Spells []SpellRef `json:"spells"`
	Total  int        `json:"total"`
}

// The SkillLineCategory IDs of 1.12.1 and the headings the category list gives them; the others
// (weapon and armor proficiencies, languages, attributes, "Not Displayed") hold a passive spell or
// two a creature would not cast.
var skillGroups = map[int]string{7: "Class skills", 11: "Professions", 9: "Secondary skills"}

// skillGroupOrder is the order the groups are listed in.
var skillGroupOrder = []string{"Class skills", "Pets", "Professions", "Secondary skills"}

// classNames are ChrClasses' names by their ClassMask bit (1.12.1).
var classNames = map[uint32]string{1: "Warrior", 2: "Paladin", 4: "Hunter", 8: "Rogue", 16: "Priest", 64: "Shaman", 128: "Mage", 256: "Warlock", 1024: "Druid"}

type skillLine struct {
	id          int
	name, group string
}

// spellSkills is the client's skill lines and the spells in each, read once per data folder (Meld
// never writes those tables).
var spellSkills struct {
	sync.Mutex
	dir     string
	lines   []skillLine
	byLine  map[int]map[uint32]bool // SkillLine ID -> spell IDs
	inSkill map[uint32]bool         // every spell some skill line teaches
}

// loadSpellSkills reads SkillLine.dbc (1.12: the category in field 1, the enUS name in 3),
// SkillLineAbility.dbc (the skill line in field 1, the spell in 2) and SkillRaceClassInfo.dbc (the
// skill line in field 1, the class mask in 3, which names a class skill's class).
func loadSpellSkills(dataDir string) error {
	if spellSkills.byLine != nil && spellSkills.dir == dataDir {
		return nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return err
	}
	defer set.Close()
	read := func(name string, fields int) (*dbcTable, error) {
		b, err := set.ReadFile(`DBFilesClient\` + name + `.dbc`)
		if err != nil {
			return nil, err
		}
		t, err := parseDBC(b)
		if err != nil {
			return nil, fmt.Errorf("%s.dbc: %w", name, err)
		}
		if t.fields < fields {
			return nil, fmt.Errorf("%s.dbc has %d fields, not the 1.12 layout", name, t.fields)
		}
		return t, nil
	}
	lt, err := read("SkillLine", 4)
	if err != nil {
		return err
	}
	at, err := read("SkillLineAbility", 3)
	if err != nil {
		return err
	}
	classOf := map[int]uint32{}
	if ct, err := read("SkillRaceClassInfo", 4); err == nil {
		for r := 0; r < ct.records; r++ {
			classOf[int(ct.u32(r, 1))] |= ct.u32(r, 3)
		}
	}
	byLine := map[int]map[uint32]bool{}
	inSkill := map[uint32]bool{}
	for r := 0; r < at.records; r++ {
		line, spell := int(at.u32(r, 1)), at.u32(r, 2)
		if byLine[line] == nil {
			byLine[line] = map[uint32]bool{}
		}
		byLine[line][spell] = true
		inSkill[spell] = true
	}
	var lines []skillLine
	for r := 0; r < lt.records; r++ {
		id, name := int(lt.u32(r, 0)), lt.str(r, 3)
		group, ok := skillGroups[int(int32(lt.u32(r, 1)))]
		if name == "" || strings.Contains(name, "DND") || len(byLine[id]) == 0 {
			continue
		}
		switch {
		case strings.HasPrefix(name, "Pet - "):
			group, name = "Pets", strings.TrimPrefix(name, "Pet - ")
		case !ok:
			continue
		case group == "Class skills":
			// A class's skill line ("Fire") names its class ("Mage: Fire"), as Holy is both
			// the priest's and the paladin's.
			if c, ok := classNames[classOf[id]]; ok {
				name = c + ": " + name
			}
		}
		lines = append(lines, skillLine{id, name, group})
	}
	spellSkills.dir, spellSkills.lines, spellSkills.byLine, spellSkills.inSkill = dataDir, lines, byLine, inSkill
	return nil
}

// noiseName matches the names of the client's leftover spells: tests, "(DND)" (do not display),
// "OLD" and "zzOLD" ones.
var noiseName = regexp.MustCompile(`(?i:\btest\b|^zz|\(old\))|^OLD\b|\bDND\b`)

// spellNoise says whether a spell is left out of browsing: no name, or a leftover's name.
func spellNoise(name string) bool {
	return name == "" || noiseName.MatchString(name)
}

// spellInCategory says whether spell id is in category key; spellSkills must be loaded and locked.
func spellInCategory(key string, id uint32) bool {
	switch key {
	case "", "all":
		return true
	case "npc":
		return !spellSkills.inSkill[id]
	}
	if line, err := strconv.Atoi(strings.TrimPrefix(key, "skill:")); err == nil && strings.HasPrefix(key, "skill:") {
		return spellSkills.byLine[line][id]
	}
	return false
}

// SpellCategories lists the categories ListSpells browses: the creature abilities first, then all
// spells, then each skill line with spells by group (class skills, pets, professions...), each
// group by name.
func SpellCategories(dataDir string) ([]SpellCategory, error) {
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return nil, err
	}
	spellSkills.Lock()
	defer spellSkills.Unlock()
	if err := loadSpellSkills(dataDir); err != nil {
		return nil, err
	}
	t := spellData.spells
	all, npc := 0, 0
	for r := 0; r < t.records; r++ {
		if spellNoise(t.str(r, spellFName)) {
			continue
		}
		all++
		if !spellSkills.inSkill[t.u32(r, 0)] {
			npc++
		}
	}
	out := []SpellCategory{{Key: "npc", Name: "Creature abilities", Count: npc}, {Key: "all", Name: "All spells", Count: all}}
	rank := map[string]int{}
	for i, g := range skillGroupOrder {
		rank[g] = i
	}
	var lines []SpellCategory
	for _, l := range spellSkills.lines {
		n := 0
		for id := range spellSkills.byLine[l.id] {
			if r, ok := t.row(id); ok && !spellNoise(t.str(r, spellFName)) {
				n++
			}
		}
		if n > 0 {
			lines = append(lines, SpellCategory{Key: "skill:" + strconv.Itoa(l.id), Name: l.name, Group: l.group, Count: n})
		}
	}
	sort.SliceStable(lines, func(i, j int) bool {
		a, b := lines[i], lines[j]
		if a.Group != b.Group {
			return rank[a.Group] < rank[b.Group]
		}
		return a.Name < b.Name
	})
	return append(out, lines...), nil
}

// ListSpells lists the client's spells in category (a SpellCategory key) and of school (Spell.dbc's
// field 1: 0 physical, 1 holy, 2 fire, 3 nature, 4 frost, 5 shadow, 6 arcane; -1 any) whose name has
// text in it, or whose ID is text, sorted as SearchSpells sorts, at most limit of them, with the
// count of all that matched. Spells with no name or a leftover's name (spellNoise) are left out,
// unless their ID is the text.
func ListSpells(dataDir, category string, school int, text string, limit int) (SpellList, error) {
	spellData.Lock()
	defer spellData.Unlock()
	if err := loadSpellData(dataDir); err != nil {
		return SpellList{}, err
	}
	spellSkills.Lock()
	defer spellSkills.Unlock()
	if err := loadSpellSkills(dataDir); err != nil {
		return SpellList{}, err
	}
	t := spellData.spells
	hits := matchSpells(t, strings.TrimSpace(text), func(r int, byID bool) bool {
		if byID {
			return true
		}
		id := t.u32(r, 0)
		return !spellNoise(t.str(r, spellFName)) && (school < 0 || int(t.u32(r, 1)) == school) && spellInCategory(category, id)
	})
	total := len(hits)
	if len(hits) > max(limit, 1) {
		hits = hits[:max(limit, 1)]
	}
	out := SpellList{Spells: make([]SpellRef, len(hits)), Total: total}
	for i, r := range hits {
		out.Spells[i] = spellRef(r)
	}
	return out, nil
}

// matchSpells gives the rows of t whose name has text in it (any case, every named row when text is
// empty) or whose ID is text, that keep allows (byID for the ID's own row): the ID first, then names
// equal to text, then names starting with it, then the rest, each by name, rank and ID.
// spellData must be locked.
func matchSpells(t *dbcTable, text string, keep func(r int, byID bool) bool) []int {
	want := strings.ToLower(text)
	type hit struct {
		r, kind int
		name    string
	}
	var hits []hit
	id, idErr := strconv.Atoi(text)
	for r := 0; r < t.records; r++ {
		// Some names start with a space or a dot (" Valentine", ".Winter Reveler"), which
		// would sort them first.
		name := strings.TrimLeft(t.str(r, spellFName), " .")
		if idErr == nil && int(t.u32(r, 0)) == id {
			if keep(r, true) {
				hits = append(hits, hit{r, 0, name})
			}
			continue
		}
		if name == "" {
			continue
		}
		kind := 3
		if want != "" {
			low := strings.ToLower(name)
			switch {
			case low == want:
				kind = 1
			case strings.HasPrefix(low, want):
				kind = 2
			case !strings.Contains(low, want):
				continue
			}
		}
		if keep(r, false) {
			hits = append(hits, hit{r, kind, name})
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
	rows := make([]int, len(hits))
	for i, h := range hits {
		rows[i] = h.r
	}
	return rows
}

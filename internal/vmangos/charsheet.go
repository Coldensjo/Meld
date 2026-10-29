package vmangos

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// The Characters and Accounts tool's look, skills, spells and reputation (#875): a character's skin,
// face and hair (checked as the server's Player::ValidateAppearance checks a new character's), its
// character_skills, character_spell and character_reputation rows, and its home (character_homebind).
// Each is changed only while the character is out of the world, as SaveCharacter does, and each list
// is written whole, as the server writes it at logout. The checks follow what the server does when it
// loads the rows: a skill the race and class can't have is skipped, a spell spell_template lacks (or
// one that makes an item item_template lacks) is deleted from every character, and a home in an
// instance is put back at the race's start.

// charTables are the client tables the character's look and skills are checked against, read once
// per data folder (Meld never writes them).
type charTables struct {
	// sections are CharSections' rows that are offered (the flag 1, unavailable, clear).
	sections []charSection
	// facial are CharacterFacialHairStyles' rows: race, gender and variation.
	facial map[[3]int]bool
	// skills are SkillLine's rows by ID.
	skills map[int]skillLineRow
	// raceClass are SkillRaceClassInfo's rows.
	raceClass []skillRaceClass
	// tiers are SkillTiers' highest values by ID.
	tiers map[int]int
}

type charSection struct{ race, gender, section, variation, color int }

type skillLineRow struct {
	category int
	name     string
}

type skillRaceClass struct{ skill, raceMask, classMask, tier int }

// The CharSections sections (DBCStructure.h CharSectionType).
const (
	sectionSkin       = 0
	sectionFace       = 1
	sectionFacialHair = 2
	sectionHair       = 3
)

var charTableCache = struct {
	sync.Mutex
	by map[string]*charTables
}{by: map[string]*charTables{}}

// loadCharTables reads the tables from the client (1.12 layouts: CharSections' race, gender,
// section, variation and colour in fields 1-5 and its flags in 9; CharacterFacialHairStyles, which
// has no ID, its race, gender and variation in 0-2; SkillLine's category in 1 and name in 3;
// SkillRaceClassInfo's skill, race mask, class mask and tier in 1, 2, 3 and 6; SkillTiers' highest
// values in 17-32).
func loadCharTables(dataDir string) (*charTables, error) {
	charTableCache.Lock()
	defer charTableCache.Unlock()
	if c, ok := charTableCache.by[dataDir]; ok {
		return c, nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
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
	c := &charTables{facial: map[[3]int]bool{}, skills: map[int]skillLineRow{}, tiers: map[int]int{}}
	t, err := read("CharSections", 10)
	if err != nil {
		return nil, err
	}
	for r := 0; r < t.records; r++ {
		if t.u32(r, 9)&1 == 0 {
			c.sections = append(c.sections, charSection{int(t.u32(r, 1)), int(t.u32(r, 2)), int(t.u32(r, 3)), int(t.u32(r, 4)), int(t.u32(r, 5))})
		}
	}
	if t, err = read("CharacterFacialHairStyles", 3); err != nil {
		return nil, err
	}
	for r := 0; r < t.records; r++ {
		c.facial[[3]int{int(t.u32(r, 0)), int(t.u32(r, 1)), int(t.u32(r, 2))}] = true
	}
	if t, err = read("SkillLine", 4); err != nil {
		return nil, err
	}
	for r := 0; r < t.records; r++ {
		c.skills[int(t.u32(r, 0))] = skillLineRow{int(int32(t.u32(r, 1))), t.str(r, 3)}
	}
	if t, err = read("SkillRaceClassInfo", 7); err != nil {
		return nil, err
	}
	for r := 0; r < t.records; r++ {
		c.raceClass = append(c.raceClass, skillRaceClass{int(t.u32(r, 1)), int(t.u32(r, 2)), int(t.u32(r, 3)), int(t.u32(r, 6))})
	}
	if t, err = read("SkillTiers", 33); err != nil {
		return nil, err
	}
	for r := 0; r < t.records; r++ {
		top := 0
		for f := 17; f < 33; f++ {
			top = max(top, int(t.u32(r, f)))
		}
		c.tiers[int(t.u32(r, 0))] = top
	}
	charTableCache.by[dataDir] = c
	return c, nil
}

// CharLooks are the skins, faces and hair a race and gender may have, as the character creation
// screen offers them: each face goes with a skin colour, each hair style with its colours, and
// (where CheckFacial) each facial hair with a hair colour.
type CharLooks struct {
	Skins []int `json:"skins"`
	// Faces are face and skin pairs.
	Faces [][2]int `json:"faces"`
	// Hair are style and colour pairs.
	Hair [][2]int `json:"hair"`
	// FacialHair are CharacterFacialHairStyles' variations.
	FacialHair []int `json:"facialHair"`
	// FacialColors are facial hair and hair colour pairs, checked only where CheckFacial.
	FacialColors [][2]int `json:"facialColors"`
	CheckFacial  bool     `json:"checkFacial"`
}

// looks are the looks race and gender have.
func (c *charTables) looks(race, gender int) CharLooks {
	l := CharLooks{Skins: []int{}, Faces: [][2]int{}, Hair: [][2]int{}, FacialHair: []int{}, FacialColors: [][2]int{}}
	// Tauren and the women of every race but night elves and undead have no facial hair sections
	// (the server's ValidateAppearance leaves them out of that check).
	l.CheckFacial = !(race == 6 || gender == 1 && race != 4 && race != 5)
	for _, s := range c.sections {
		if s.race != race || s.gender != gender {
			continue
		}
		switch s.section {
		case sectionSkin:
			if s.variation == 0 {
				l.Skins = append(l.Skins, s.color)
			}
		case sectionFace:
			l.Faces = append(l.Faces, [2]int{s.variation, s.color})
		case sectionHair:
			l.Hair = append(l.Hair, [2]int{s.variation, s.color})
		case sectionFacialHair:
			if l.CheckFacial {
				l.FacialColors = append(l.FacialColors, [2]int{s.variation, s.color})
			}
		}
	}
	for k := range c.facial {
		if k[0] == race && k[1] == gender {
			l.FacialHair = append(l.FacialHair, k[2])
		}
	}
	sort.Ints(l.Skins)
	sort.Ints(l.FacialHair)
	for _, p := range [][][2]int{l.Faces, l.Hair, l.FacialColors} {
		sort.Slice(p, func(i, j int) bool { return p[i][0] < p[j][0] || p[i][0] == p[j][0] && p[i][1] < p[j][1] })
	}
	return l
}

// CharacterLooks reads the looks race and gender have from the client.
func CharacterLooks(dataDir string, race, gender int) (CharLooks, error) {
	c, err := loadCharTables(dataDir)
	if err != nil {
		return CharLooks{}, err
	}
	return c.looks(race, gender), nil
}

func hasPair(list [][2]int, a, b int) bool {
	for _, p := range list {
		if p[0] == a && p[1] == b {
			return true
		}
	}
	return false
}

// check refuses a look the race and gender can't have, as the server's ValidateAppearance does.
func (l CharLooks) check(skin, face, style, color, facial int) error {
	switch {
	case !containsInt(l.Skins, skin):
		return refuse("skin", "This race and gender have no skin color %d", skin)
	case !hasPair(l.Faces, face, skin):
		return refuse("face", "This race and gender have no face %d with skin color %d", face, skin)
	case !hasPair(l.Hair, style, color):
		col := "hair_style"
		for _, p := range l.Hair {
			if p[0] == style {
				col = "hair_color"
			}
		}
		return refuse(col, "This race and gender have no hair style %d in color %d", style, color)
	case l.CheckFacial && !hasPair(l.FacialColors, facial, color) || !containsInt(l.FacialHair, facial):
		return refuse("facial_hair", "This race and gender have no facial hair %d in hair color %d", facial, color)
	}
	return nil
}

// lookColumns are the characters columns of the look.
var lookColumns = []string{"skin", "face", "hair_style", "hair_color", "facial_hair"}

// homeColumns are the editor's names for character_homebind's columns.
var homeColumns = [][2]string{{"home_map", "map"}, {"home_zone", "zone"}, {"home_x", "position_x"}, {"home_y", "position_y"}, {"home_z", "position_z"}}

// mapCoordLimit is how far from a map's middle a spot may be (MapManager::IsValidMapCoord: 32 grids
// of 533.33 yards each way).
const mapCoordLimit = 17066.666

// readHome puts the character's home into r's values ("" each when it has none yet: the server
// gives it the race's start at its next login).
func readHome(db worldDB, r *CharacterRecord) error {
	raw, err := runSQL(db, fmt.Sprintf("SELECT map, zone, position_x, position_y, position_z FROM character_homebind WHERE guid = %d", r.Guid))
	if err != nil {
		return err
	}
	rows := batchRows(raw, len(homeColumns))
	for i, c := range homeColumns {
		r.Values[c[0]] = ""
		if len(rows) > 0 {
			r.Values[c[0]] = rows[0][i]
		}
	}
	return nil
}

// homeSQL checks a new home (map, zone, x, y, z by homeColumns) and gives the statement that writes
// it, or "" when values change none of it. The server moves a home in an instance, or off its map's
// grid, back to the race's start.
func homeSQL(serverRoot string, guid int, cur, values map[string]string) (string, error) {
	changed := false
	vals := make([]string, len(homeColumns))
	for i, c := range homeColumns {
		v := strings.TrimSpace(pick(values, cur, c[0]))
		vals[i] = v
		changed = changed || v != cur[c[0]]
	}
	if !changed {
		return "", nil
	}
	m, err := intIn("home_map", vals[0], 0, 1<<16-1)
	if err != nil {
		return "", err
	}
	if _, err := intIn("home_zone", vals[1], 0, 1<<31-1); err != nil {
		return "", err
	}
	for i := 2; i < 5; i++ {
		f, err := strconv.ParseFloat(vals[i], 64)
		if err != nil || math.IsNaN(f) || math.Abs(f) >= mapCoordLimit {
			return "", refuse(homeColumns[i][0], "%s is not a spot on a map (a number within %.0f of the middle)", vals[i], mapCoordLimit)
		}
		vals[i] = num(f)
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	out, err := runSQL(world, fmt.Sprintf("SELECT map_type FROM map_template WHERE entry = %d ORDER BY patch DESC LIMIT 1", m))
	if err != nil {
		return "", err
	}
	switch strings.TrimSpace(string(out)) {
	case "":
		return "", refuse("home_map", "The server has no map %d (its map_template)", m)
	case "0":
	default:
		return "", refuse("home_map", "Map %d is an instance, raid or battleground: the server puts a home there back at the race's start", m)
	}
	return fmt.Sprintf("REPLACE INTO character_homebind (guid, map, zone, position_x, position_y, position_z) VALUES (%d, %s)", guid, strings.Join(vals, ", ")), nil
}

// offlineCharacter reads character guid's row and refuses one that is in the world while the world
// server runs (worldRunning), which writes it over its rows when it logs out; what names the rows.
func offlineCharacter(db worldDB, guid int, worldRunning func() bool, what string) (CharacterRecord, error) {
	ch, err := readCharacter(db, guid)
	if err != nil {
		return ch, err
	}
	if ch.Online && worldRunning() {
		return ch, fmt.Errorf("%s is in the world: log out of the game first (the world server writes the character's %s over their rows when it logs out)", ch.Values["name"], what)
	}
	return ch, nil
}

// Skills.

// CharacterSkill is a row of character_skills: a skill line, the character's value in it and the
// most it can reach.
type CharacterSkill struct {
	Skill int `json:"skill"`
	Value int `json:"value"`
	Max   int `json:"max"`
}

// SkillChoice is a skill line the character's race and class may have, with its SkillLine category
// and how the server sets its range: "language" (300 of 300), "mono" (1 of 1, armour), "level" (the
// most is 5 a level) or "rank" (a profession's, raised by its trainer up to Top).
type SkillChoice struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Category int    `json:"category"`
	Range    string `json:"range"`
	Top      int    `json:"top"`
}

// CharacterSkills are a character's skills with the skill lines its race and class may have, and
// the level and race and class they were read for.
type CharacterSkills struct {
	Skills  []CharacterSkill `json:"skills"`
	Choices []SkillChoice    `json:"choices"`
	Level   int              `json:"level"`
}

// The SkillLine categories the server gives a fixed range (SharedDefines.h SkillCategory).
const (
	skillCategoryArmor     = 8
	skillCategoryLanguages = 10
)

// playerMaxSkills is how many skills the client shows a player (Player.h PLAYER_MAX_SKILLS).
const playerMaxSkills = 127

// skillChoice is skill line id as race and class have it (GetSkillRaceClassInfo and
// GetSkillRangeType), or false when they can't.
func (c *charTables) skillChoice(id, race, class int) (SkillChoice, bool) {
	line, ok := c.skills[id]
	if !ok {
		return SkillChoice{}, false
	}
	for _, rc := range c.raceClass {
		if rc.skill != id || rc.raceMask != 0 && rc.raceMask&(1<<(race-1)) == 0 || rc.classMask != 0 && rc.classMask&(1<<(class-1)) == 0 {
			continue
		}
		ch := SkillChoice{ID: id, Name: line.name, Category: line.category, Range: "level"}
		if top, ok := c.tiers[rc.tier]; ok && rc.tier != 0 {
			ch.Range, ch.Top = "rank", top
		} else if line.category == skillCategoryArmor {
			ch.Range = "mono"
		} else if line.category == skillCategoryLanguages {
			ch.Range = "language"
		}
		return ch, true
	}
	return SkillChoice{}, false
}

// skillChoices are the skill lines race and class may have, by name.
func (c *charTables) skillChoices(race, class int) []SkillChoice {
	out := []SkillChoice{}
	for id := range c.skills {
		if ch, ok := c.skillChoice(id, race, class); ok && ch.Name != "" {
			out = append(out, ch)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name || out[i].Name == out[j].Name && out[i].ID < out[j].ID
	})
	return out
}

// ReadCharacterSkills reads character guid's skills, with the skill lines it may have.
func ReadCharacterSkills(serverRoot, dataDir string, guid int) (CharacterSkills, error) {
	c, err := loadCharTables(dataDir)
	if err != nil {
		return CharacterSkills{}, err
	}
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return CharacterSkills{}, err
	}
	ch, err := readCharacter(db, guid)
	if err != nil {
		return CharacterSkills{}, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT skill, value, max FROM character_skills WHERE guid = %d ORDER BY skill", guid))
	if err != nil {
		return CharacterSkills{}, err
	}
	out := CharacterSkills{Skills: []CharacterSkill{}, Level: atoi(ch.Values["level"])}
	for _, f := range batchRows(raw, 3) {
		out.Skills = append(out.Skills, CharacterSkill{Skill: f.num(0), Value: f.num(1), Max: f.num(2)})
	}
	out.Choices = c.skillChoices(atoi(ch.Values["race"]), atoi(ch.Values["class"]))
	return out, nil
}

func atoi(s string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}

// checkSkills checks skills against what the server keeps when it loads them, and sets the ranges it
// fixes: a language 300 of 300, armour 1 of 1, a skill raised by level at most 5 a level. A skill
// already stored (stored) that the race and class can't have is kept, as the server leaves it.
func (c *charTables) checkSkills(skills []CharacterSkill, stored map[int]CharacterSkill, race, class, level int) ([]CharacterSkill, error) {
	if len(skills) > playerMaxSkills {
		return nil, fmt.Errorf("a character has at most %d skills", playerMaxSkills)
	}
	seen := map[int]bool{}
	out := make([]CharacterSkill, 0, len(skills))
	for _, s := range skills {
		col := strconv.Itoa(s.Skill)
		if seen[s.Skill] {
			return nil, refuse(col, "Skill %d is in the list twice", s.Skill)
		}
		seen[s.Skill] = true
		ch, ok := c.skillChoice(s.Skill, race, class)
		if !ok {
			if old, was := stored[s.Skill]; was && old == s {
				out = append(out, s)
				continue
			}
			if _, known := c.skills[s.Skill]; !known {
				return nil, refuse(col, "The client has no skill %d", s.Skill)
			}
			return nil, refuse(col, "This race and class can't have %s: the server skips it", c.skills[s.Skill].name)
		}
		switch ch.Range {
		case "language":
			s.Value, s.Max = 300, 300
		case "mono":
			s.Value, s.Max = 1, 1
		case "level":
			s.Max = max(1, level*5)
		case "rank":
			if s.Max < 1 || s.Max > ch.Top {
				return nil, refuse(col, "%s's most is 1 to %d", ch.Name, ch.Top)
			}
		}
		if s.Value < 1 || s.Value > s.Max {
			return nil, refuse(col, "%s's value is 1 to %d (the server deletes a skill at 0)", ch.Name, s.Max)
		}
		out = append(out, s)
	}
	return out, nil
}

// skillsScript writes skills as character guid's whole list.
func skillsScript(guid int, skills []CharacterSkill) string {
	var b strings.Builder
	fmt.Fprintf(&b, "DELETE FROM character_skills WHERE guid = %d;", guid)
	if len(skills) > 0 {
		rows := make([]string, len(skills))
		for i, s := range skills {
			rows[i] = fmt.Sprintf("(%d, %d, %d, %d)", guid, s.Skill, s.Value, s.Max)
		}
		fmt.Fprintf(&b, "\nINSERT INTO character_skills (guid, skill, value, max) VALUES %s;", strings.Join(rows, ", "))
	}
	return b.String()
}

// SaveCharacterSkills makes skills character guid's skills while it is out of the world, and returns
// the SQL it ran, or the skill (its ID as the column) it refused.
func SaveCharacterSkills(serverRoot, dataDir string, guid int, skills []CharacterSkill, worldRunning func() bool) (string, error) {
	c, err := loadCharTables(dataDir)
	if err != nil {
		return "", err
	}
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	ch, err := offlineCharacter(db, guid, worldRunning, "skills")
	if err != nil {
		return "", err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT skill, value, max FROM character_skills WHERE guid = %d", guid))
	if err != nil {
		return "", err
	}
	stored := map[int]CharacterSkill{}
	for _, f := range batchRows(raw, 3) {
		stored[f.num(0)] = CharacterSkill{Skill: f.num(0), Value: f.num(1), Max: f.num(2)}
	}
	checked, err := c.checkSkills(skills, stored, atoi(ch.Values["race"]), atoi(ch.Values["class"]), atoi(ch.Values["level"]))
	if err != nil {
		return "", err
	}
	script := skillsScript(guid, checked)
	return script, runScript(db, script)
}

// Spells.

// CharacterSpell is a row of character_spell: a spell the character knows, whether it shows in the
// spell book (a lower rank of a spell it knows a higher one of doesn't), and whether it is turned off.
type CharacterSpell struct {
	Spell    int  `json:"spell"`
	Active   bool `json:"active"`
	Disabled bool `json:"disabled"`
}

// ReadCharacterSpells reads the spells character guid knows.
func ReadCharacterSpells(serverRoot string, guid int) ([]CharacterSpell, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT spell, active, disabled FROM character_spell WHERE guid = %d ORDER BY spell", guid))
	if err != nil {
		return nil, err
	}
	out := []CharacterSpell{}
	for _, f := range batchRows(raw, 3) {
		out = append(out, CharacterSpell{Spell: f.num(0), Active: f[1] != "0", Disabled: f[2] != "0"})
	}
	return out, nil
}

// StartingSpells are the spells the server gives a new character of race and class
// (playercreateinfo_spell, its rows for 1.12.1).
func StartingSpells(serverRoot string, race, class int) ([]int, error) {
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(world, fmt.Sprintf("SELECT spell FROM playercreateinfo_spell WHERE race = %d AND class = %d AND build_min <= %d AND build_max >= %d ORDER BY spell", race, class, spellBuild, spellBuild))
	if err != nil {
		return nil, err
	}
	out := []int{}
	for _, f := range batchRows(raw, 1) {
		out = append(out, f.num(0))
	}
	return out, nil
}

// The spell effects the server checks a learnt spell's items for (SharedDefines.h).
const (
	effectCreateItem = 24
	effectLearnSpell = 36
)

// spellCheck is what the server checks of a spell it loads for a character (SpellMgr::IsSpellValid).
type spellCheck struct {
	effects, items, learns [3]int
	reagents               [8]int
}

// readSpellChecks reads spellCheck for ids from spell_template (the newest row up to 1.12.1's build);
// a spell it lacks is missing from the map.
func readSpellChecks(world worldDB, ids []int) (map[int]spellCheck, error) {
	out := map[int]spellCheck{}
	if len(ids) == 0 {
		return out, nil
	}
	in := make([]string, len(ids))
	for i, id := range ids {
		in[i] = strconv.Itoa(id)
	}
	cols := "s.entry, s.effect1, s.effect2, s.effect3, s.effectItemType1, s.effectItemType2, s.effectItemType3, s.effectTriggerSpell1, s.effectTriggerSpell2, s.effectTriggerSpell3, " +
		"s.reagent1, s.reagent2, s.reagent3, s.reagent4, s.reagent5, s.reagent6, s.reagent7, s.reagent8"
	raw, err := runSQL(world, fmt.Sprintf("SELECT %s FROM spell_template s JOIN (SELECT entry, MAX(build) AS build FROM spell_template WHERE build <= %d AND entry IN (%s) GROUP BY entry) n ON n.entry = s.entry AND n.build = s.build", cols, spellBuild, strings.Join(in, ", ")))
	if err != nil {
		return nil, err
	}
	for _, f := range batchRows(raw, 18) {
		var c spellCheck
		for i := 0; i < 3; i++ {
			c.effects[i], c.items[i], c.learns[i] = f.num(1+i), f.num(4+i), f.num(7+i)
		}
		for i := 0; i < 8; i++ {
			c.reagents[i] = f.num(10 + i)
		}
		out[f.num(0)] = c
	}
	return out, nil
}

// spellProblem says why the server would delete spell id from every character that knows it, or "":
// spell_template lacks it, it makes an item (or takes a reagent) item_template lacks, or it teaches
// such a spell.
func spellProblem(id int, checks map[int]spellCheck, items map[int]bool, depth int) string {
	c, ok := checks[id]
	if !ok {
		return fmt.Sprintf("The server has no spell %d (its spell_template)", id)
	}
	crafts := false
	for i, e := range c.effects {
		switch e {
		case effectCreateItem:
			if !items[c.items[i]] {
				return fmt.Sprintf("Spell %d makes item %d, which the server lacks", id, c.items[i])
			}
			crafts = true
		case effectLearnSpell:
			if depth < 4 {
				if p := spellProblem(c.learns[i], checks, items, depth+1); p != "" {
					return fmt.Sprintf("Spell %d teaches spell %d: %s", id, c.learns[i], lowerFirst(p))
				}
			}
		}
	}
	if crafts {
		for _, r := range c.reagents {
			if r > 0 && !items[r] {
				return fmt.Sprintf("Spell %d takes item %d, which the server lacks", id, r)
			}
		}
	}
	return ""
}

func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

// checkSpells refuses a spell twice in the list or one the server would delete (spellProblem); the
// ones already stored are taken as they are.
func checkSpells(world worldDB, spells []CharacterSpell, stored map[int]bool) error {
	seen := map[int]bool{}
	var added []int
	for _, s := range spells {
		if seen[s.Spell] {
			return refuse(strconv.Itoa(s.Spell), "Spell %d is in the list twice", s.Spell)
		}
		seen[s.Spell] = true
		if !stored[s.Spell] {
			added = append(added, s.Spell)
		}
	}
	if len(added) == 0 {
		return nil
	}
	checks, err := readSpellChecks(world, added)
	if err != nil {
		return err
	}
	// The spells they teach, and the items they make and take.
	var more []int
	for _, c := range checks {
		for i, e := range c.effects {
			if e == effectLearnSpell && c.learns[i] > 0 {
				more = append(more, c.learns[i])
			}
		}
	}
	if len(more) > 0 {
		taught, err := readSpellChecks(world, more)
		if err != nil {
			return err
		}
		for id, c := range taught {
			if _, ok := checks[id]; !ok {
				checks[id] = c
			}
		}
	}
	var entries []string
	for _, c := range checks {
		for i, e := range c.effects {
			if e == effectCreateItem {
				entries = append(entries, strconv.Itoa(c.items[i]))
				for _, r := range c.reagents {
					if r > 0 {
						entries = append(entries, strconv.Itoa(r))
					}
				}
			}
		}
	}
	items := map[int]bool{}
	if len(entries) > 0 {
		raw, err := runSQL(world, fmt.Sprintf("SELECT DISTINCT entry FROM item_template WHERE entry IN (%s)", strings.Join(entries, ", ")))
		if err != nil {
			return err
		}
		for _, f := range batchRows(raw, 1) {
			items[f.num(0)] = true
		}
	}
	for _, id := range added {
		if p := spellProblem(id, checks, items, 0); p != "" {
			return refuse(strconv.Itoa(id), "%s: it would delete the spell from every character", p)
		}
	}
	return nil
}

// spellsScript writes spells as character guid's whole list.
func spellsScript(guid int, spells []CharacterSpell) string {
	var b strings.Builder
	fmt.Fprintf(&b, "DELETE FROM character_spell WHERE guid = %d;", guid)
	if len(spells) > 0 {
		rows := make([]string, len(spells))
		for i, s := range spells {
			rows[i] = fmt.Sprintf("(%d, %d, %d, %d)", guid, s.Spell, b2i(s.Active), b2i(s.Disabled))
		}
		fmt.Fprintf(&b, "\nINSERT INTO character_spell (guid, spell, active, disabled) VALUES %s;", strings.Join(rows, ", "))
	}
	return b.String()
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// SaveCharacterSpells makes spells the spells character guid knows while it is out of the world, and
// returns the SQL it ran, or the spell (its ID as the column) it refused.
func SaveCharacterSpells(serverRoot string, guid int, spells []CharacterSpell, worldRunning func() bool) (string, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	if _, err := offlineCharacter(db, guid, worldRunning, "spells"); err != nil {
		return "", err
	}
	cur, err := ReadCharacterSpells(serverRoot, guid)
	if err != nil {
		return "", err
	}
	stored := map[int]bool{}
	for _, s := range cur {
		stored[s.Spell] = true
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	if err := checkSpells(world, spells, stored); err != nil {
		return "", err
	}
	script := spellsScript(guid, spells)
	return script, runScript(db, script)
}

// Reputation.

// The reputation limits and the flags a character's standing with a faction has (ReputationMgr.h).
const (
	reputationBottom = -42000
	factionVisible   = 0x01
	factionAtWar     = 0x02
	factionInactive  = 0x20
	// factionPlayerFlags are the flags a player sets; the rest come from Faction.dbc.
	factionPlayerFlags = factionVisible | factionAtWar | factionInactive
)

// CharacterReputation is a character's standing with a faction it can have reputation with: Standing
// as the game shows it (Base, the race and class's start, plus what character_reputation stores),
// and Flags (Faction.dbc's for the race and class, DefaultFlags, until it stores its own).
type CharacterReputation struct {
	Faction      int    `json:"faction"`
	Name         string `json:"name"`
	Group        string `json:"group"`
	Base         int    `json:"base"`
	Standing     int    `json:"standing"`
	Flags        int    `json:"flags"`
	DefaultFlags int    `json:"defaultFlags"`
	Stored       bool   `json:"stored"`
}

// factionRow is a faction with reputation as the server reads it (the world database's faction
// table, its row for 1.12.1).
type factionRow struct {
	id, team                        int
	name                            string
	raceMask, classMask, base, flag [4]int
}

// fit is the faction's index for race and class (FactionEntry::GetIndexFitTo), or -1.
func (f factionRow) fit(race, class int) int {
	for i := 0; i < 4; i++ {
		if (f.raceMask[i] == 0 || f.raceMask[i]&(1<<(race-1)) != 0) && (f.classMask[i] == 0 || f.classMask[i]&(1<<(class-1)) != 0) {
			return i
		}
	}
	return -1
}

func (f factionRow) baseFor(race, class int) (base, flags int) {
	if i := f.fit(race, class); i >= 0 {
		return f.base[i], f.flag[i]
	}
	return 0, 0
}

// readFactions reads the factions a player can have reputation with, and every faction's name.
func readFactions(world worldDB) ([]factionRow, map[int]string, error) {
	cols := []string{"f.id", "f.reputation_list_id", "f.team", "f.name"}
	for _, c := range []string{"base_rep_race_mask", "base_rep_class_mask", "base_rep_value", "reputation_flags"} {
		for i := 1; i <= 4; i++ {
			cols = append(cols, fmt.Sprintf("f.%s%d", c, i))
		}
	}
	raw, err := runSQL(world, fmt.Sprintf("SELECT %s FROM faction f JOIN (SELECT id, MAX(build) AS build FROM faction WHERE build <= %d GROUP BY id) n ON n.id = f.id AND n.build = f.build ORDER BY f.id", strings.Join(cols, ", "), spellBuild))
	if err != nil {
		return nil, nil, err
	}
	var out []factionRow
	names := map[int]string{}
	for _, f := range batchRows(raw, len(cols)) {
		// Some names start with a space (" Blacksmithing - Armorsmithing").
		name := strings.TrimSpace(f[3])
		names[f.num(0)] = name
		if f.num(1) < 0 {
			continue
		}
		r := factionRow{id: f.num(0), team: f.num(2), name: name}
		for i := 0; i < 4; i++ {
			r.raceMask[i], r.classMask[i], r.base[i], r.flag[i] = f.num(4+i), f.num(8+i), f.num(12+i), f.num(16+i)
		}
		out = append(out, r)
	}
	return out, names, nil
}

// storedReputation reads character guid's character_reputation rows: faction to standing and flags.
func storedReputation(db worldDB, guid int) (map[int][2]int, error) {
	raw, err := runSQL(db, fmt.Sprintf("SELECT faction, standing, flags FROM character_reputation WHERE guid = %d", guid))
	if err != nil {
		return nil, err
	}
	out := map[int][2]int{}
	for _, f := range batchRows(raw, 3) {
		// The server reads standing as unsigned and casts it back to a signed one.
		s, _ := strconv.ParseInt(f[1], 10, 64)
		out[f.num(0)] = [2]int{int(int32(s)), f.num(2)}
	}
	return out, nil
}

// reputationList is the character's standing with every faction, by group and name.
func reputationList(factions []factionRow, names map[int]string, stored map[int][2]int, race, class int) []CharacterReputation {
	out := make([]CharacterReputation, 0, len(factions))
	for _, f := range factions {
		base, flags := f.baseFor(race, class)
		r := CharacterReputation{Faction: f.id, Name: f.name, Group: names[f.team], Base: base, Standing: base, Flags: flags, DefaultFlags: flags}
		if s, ok := stored[f.id]; ok {
			r.Standing, r.Flags, r.Stored = base+s[0], s[1], true
		}
		out = append(out, r)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Group < out[j].Group || out[i].Group == out[j].Group && out[i].Name < out[j].Name
	})
	return out
}

// ReadCharacterReputation reads character guid's standing with every faction.
func ReadCharacterReputation(serverRoot string, guid int) ([]CharacterReputation, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	ch, err := readCharacter(db, guid)
	if err != nil {
		return nil, err
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return nil, err
	}
	factions, names, err := readFactions(world)
	if err != nil {
		return nil, err
	}
	stored, err := storedReputation(db, guid)
	if err != nil {
		return nil, err
	}
	return reputationList(factions, names, stored, atoi(ch.Values["race"]), atoi(ch.Values["class"])), nil
}

// reputationScript writes reps over the stored rows as character guid's whole list: a faction keeps
// its row when it has one, and gets one when its standing or the flags a player sets differ from the
// race and class's start. The standing stored is what it differs from that start by.
func reputationScript(guid int, reps []CharacterReputation, factions []factionRow, stored map[int][2]int, race, class int) (string, error) {
	byID := map[int]factionRow{}
	for _, f := range factions {
		byID[f.id] = f
	}
	rows := map[int][2]int{}
	for id, s := range stored {
		rows[id] = s
	}
	for _, r := range reps {
		f, ok := byID[r.Faction]
		col := strconv.Itoa(r.Faction)
		if !ok {
			return "", refuse(col, "The server has no reputation with faction %d", r.Faction)
		}
		if r.Standing < reputationBottom || r.Standing > reputationCap {
			return "", refuse(col, "A standing is %d to %d", reputationBottom, reputationCap)
		}
		base, def := f.baseFor(race, class)
		flags := def&^factionPlayerFlags | r.Flags&factionPlayerFlags
		_, was := stored[r.Faction]
		if was || r.Standing != base || flags != def {
			rows[r.Faction] = [2]int{r.Standing - base, flags}
		}
	}
	ids := make([]int, 0, len(rows))
	for id := range rows {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	var b strings.Builder
	fmt.Fprintf(&b, "DELETE FROM character_reputation WHERE guid = %d;", guid)
	if len(ids) > 0 {
		vals := make([]string, len(ids))
		for i, id := range ids {
			vals[i] = fmt.Sprintf("(%d, %d, %d, %d)", guid, id, rows[id][0], rows[id][1])
		}
		fmt.Fprintf(&b, "\nINSERT INTO character_reputation (guid, faction, standing, flags) VALUES %s;", strings.Join(vals, ", "))
	}
	return b.String(), nil
}

// SaveCharacterReputation writes the standings and flags in reps as character guid's while it is out
// of the world, and returns the SQL it ran, or the faction (its ID as the column) it refused.
func SaveCharacterReputation(serverRoot string, guid int, reps []CharacterReputation, worldRunning func() bool) (string, error) {
	db, err := characterDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	ch, err := offlineCharacter(db, guid, worldRunning, "reputation")
	if err != nil {
		return "", err
	}
	world, err := worldDatabase(serverRoot)
	if err != nil {
		return "", err
	}
	factions, _, err := readFactions(world)
	if err != nil {
		return "", err
	}
	if len(factions) == 0 {
		return "", errors.New("the world database lists no factions to have reputation with")
	}
	stored, err := storedReputation(db, guid)
	if err != nil {
		return "", err
	}
	script, err := reputationScript(guid, reps, factions, stored, atoi(ch.Values["race"]), atoi(ch.Values["class"]))
	if err != nil {
		return "", err
	}
	return script, runScript(db, script)
}

package vmangos

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// The quest editor (#259): quest_template read and written through the template path the creature
// and game object editors use (readTemplate, templateUpdateSQL), held to the rules the server's
// ObjectMgr::LoadQuests checks, and the creatures and game objects that start and end a quest, seen
// from the quest's side.

const questTable = "quest_template"

// ReadQuest reads quest entry: its newest patch's row.
func ReadQuest(serverRoot string, entry int) (TemplateRecord, error) {
	return readTemplate(serverRoot, questTable, "quest", entry)
}

// numbered is prefix1 to prefixN.
func numbered(prefix string, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = prefix + strconv.Itoa(i+1)
	}
	return out
}

// questLinks is what each of quest_template's reference columns points at: "item", "creature or
// object" (positive a creature, negative a game object), "spell", "quest" (negative PrevQuestId and
// NextQuestId still name a quest), "faction" (Faction.dbc), "zone or sort" (positive an AreaTable
// zone, negative a QuestSort), "skill" (SkillLine.dbc) or "emote" (Emotes.dbc).
var questLinks = func() map[string]string {
	m := map[string]string{
		"SrcItemId": "item", "SrcSpell": "spell", "RewSpell": "spell", "RewSpellCast": "spell",
		"PrevQuestId": "quest", "NextQuestId": "quest", "NextQuestInChain": "quest", "BreadcrumbForQuestId": "quest",
		"RepObjectiveFaction": "faction", "RequiredMinRepFaction": "faction", "RequiredMaxRepFaction": "faction",
		"ZoneOrSort": "zone or sort", "RequiredSkill": "skill", "IncompleteEmote": "emote", "CompleteEmote": "emote",
	}
	set := func(kind string, cols []string) {
		for _, c := range cols {
			m[c] = kind
		}
	}
	set("item", numbered("ReqItemId", 4))
	set("item", numbered("ReqSourceId", 4))
	set("item", numbered("RewItemId", 4))
	set("item", numbered("RewChoiceItemId", 6))
	set("creature or object", numbered("ReqCreatureOrGOId", 4))
	set("spell", numbered("ReqSpellCast", 4))
	set("faction", numbered("RewRepFaction", 5))
	set("emote", numbered("DetailsEmote", 4))
	set("emote", numbered("OfferRewardEmote", 4))
	return m
}()

// questRule is one of the checks a quest's Save is held to: it runs when any of its columns
// changes, on the row as it would be saved (v gives a column's value as a number).
type questRule struct {
	cols  []string
	check func(v func(string) int64) error
}

// countRule: a thing (an item, a creature) needs an amount, and an amount needs a thing.
func countRule(id, count, what string) questRule {
	return questRule{[]string{id, count}, func(v func(string) int64) error {
		switch {
		case v(id) != 0 && v(count) <= 0:
			return refuse(id, "%s names %s %d but %s is %d: give it a count", id, what, v(id), count, v(count))
		case v(id) == 0 && v(count) != 0:
			return refuse(count, "%s is %d but %s names no %s", count, v(count), id, what)
		}
		return nil
	}}
}

// repValueRule: a reputation amount means nothing without its faction; for a reward (needValue),
// a faction without an amount gives nothing either.
func repValueRule(faction, value string, needValue bool) questRule {
	return questRule{[]string{faction, value}, func(v func(string) int64) error {
		switch {
		case v(faction) == 0 && v(value) != 0:
			return refuse(value, "%s is %d but %s names no faction", value, v(value), faction)
		case needValue && v(faction) != 0 && v(value) == 0:
			return refuse(faction, "%s names faction %d but %s is 0: give it an amount", faction, v(faction), value)
		}
		return nil
	}}
}

const (
	// questSpecialFlagsDB is QUEST_SPECIAL_FLAG_DB_ALLOWED: repeatable, exploration or event.
	questSpecialFlagsDB = 0x1 | 0x2
	// classMaskPlayable and raceMaskPlayable are 1.12's playable classes and races.
	classMaskPlayable = 1 | 2 | 4 | 8 | 16 | 64 | 128 | 256 | 1024
	raceMaskPlayable  = 0xff
	// reputationCap is ReputationMgr::Reputation_Cap, the most reputation a player can have.
	reputationCap = 42999
)

var questRules = func() []questRule {
	rules := []questRule{
		{[]string{"Method"}, func(v func(string) int64) error {
			if m := v("Method"); m > 2 {
				return refuse("Method", "Method is %d: it must be 0 (completes itself), 1 (disabled) or 2 (normal)", m)
			}
			return nil
		}},
		{[]string{"SpecialFlags"}, func(v func(string) int64) error {
			if f := v("SpecialFlags"); f&^questSpecialFlagsDB != 0 {
				return refuse("SpecialFlags", "SpecialFlags is %d: the database may only set 1 (repeatable) and 2 (exploration or event)", f)
			}
			return nil
		}},
		{[]string{"RequiredClasses"}, func(v func(string) int64) error {
			if c := v("RequiredClasses"); c != 0 && c&classMaskPlayable == 0 {
				return refuse("RequiredClasses", "RequiredClasses is %d, which has no playable class: the server would allow every class", c)
			}
			return nil
		}},
		{[]string{"RequiredRaces"}, func(v func(string) int64) error {
			if r := v("RequiredRaces"); r != 0 && r&raceMaskPlayable == 0 {
				return refuse("RequiredRaces", "RequiredRaces is %d, which has no playable race: the server would allow every race", r)
			}
			return nil
		}},
		{[]string{"MinLevel", "MaxLevel"}, func(v func(string) int64) error {
			if hi := v("MaxLevel"); hi != 0 && hi < v("MinLevel") {
				return refuse("MaxLevel", "MaxLevel %d is below MinLevel %d: no one could take the quest", hi, v("MinLevel"))
			}
			return nil
		}},
		{[]string{"RequiredMinRepValue", "RequiredMaxRepValue"}, func(v func(string) int64) error {
			lo, hi := v("RequiredMinRepValue"), v("RequiredMaxRepValue")
			if lo > reputationCap {
				return refuse("RequiredMinRepValue", "RequiredMinRepValue is %d, more than the most reputation a player can have (%d)", lo, reputationCap)
			}
			if lo != 0 && hi != 0 && hi <= lo {
				return refuse("RequiredMaxRepValue", "RequiredMaxRepValue %d is not above RequiredMinRepValue %d: no one could take the quest", hi, lo)
			}
			return nil
		}},
		{numbered("RewChoiceItemId", 6), func(v func(string) int64) error {
			// The 1.12.1 client crashes on a gap in the reward choices.
			gap := ""
			for _, c := range numbered("RewChoiceItemId", 6) {
				switch {
				case v(c) == 0 && gap == "":
					gap = c
				case v(c) != 0 && gap != "":
					return refuse(gap, "%s is empty but %s isn't: the choices must have no gap (the 1.12.1 client crashes on one)", gap, c)
				}
			}
			return nil
		}},
		countRule("SrcItemId", "SrcItemCount", "item"),
		repValueRule("RepObjectiveFaction", "RepObjectiveValue", false),
		repValueRule("RequiredMinRepFaction", "RequiredMinRepValue", false),
		repValueRule("RequiredMaxRepFaction", "RequiredMaxRepValue", false),
	}
	for i := 1; i <= 4; i++ {
		n := strconv.Itoa(i)
		rules = append(rules,
			countRule("ReqItemId"+n, "ReqItemCount"+n, "item"),
			countRule("ReqSourceId"+n, "ReqSourceCount"+n, "item"),
			countRule("ReqCreatureOrGOId"+n, "ReqCreatureOrGOCount"+n, "creature or object"),
			countRule("RewItemId"+n, "RewItemCount"+n, "item"))
	}
	for i := 1; i <= 6; i++ {
		n := strconv.Itoa(i)
		rules = append(rules, countRule("RewChoiceItemId"+n, "RewChoiceItemCount"+n, "item"))
	}
	for i := 1; i <= 5; i++ {
		n := strconv.Itoa(i)
		rules = append(rules, repValueRule("RewRepFaction"+n, "RewRepValue"+n, true))
	}
	return rules
}()

// questKnown says which of ids exist as kind ("item", "creature", "object", "quest", "spell",
// "zone", "sort", "skill", "faction", "emote").
type questKnown func(kind string, ids []int) (map[int]bool, error)

// questLinkTarget is the kind and ID a reference column's value v points at (kind "" for none).
func questLinkTarget(link string, v int64) (string, int) {
	if v == 0 {
		return "", 0
	}
	abs := int(v)
	if v < 0 {
		abs = int(-v)
	}
	switch link {
	case "creature or object":
		if v < 0 {
			return "object", abs
		}
		return "creature", abs
	case "zone or sort":
		if v < 0 {
			return "sort", abs
		}
		return "zone", abs
	case "quest":
		return "quest", abs
	}
	return link, int(v)
}

// checkQuest holds the quest row it would save (row: every column, changed already applied) to the
// rules whose columns changed, and checks that what each changed reference column names exists.
// It gives every problem, a line each.
func checkQuest(row, changed map[string]string, known questKnown) error {
	v := func(c string) int64 {
		n, _ := strconv.ParseInt(strings.TrimSpace(row[c]), 10, 64)
		return n
	}
	var problems []error
	if _, ok := changed["Title"]; ok && strings.TrimSpace(row["Title"]) == "" {
		problems = append(problems, refuse("Title", "the quest needs a title"))
	}
	for _, r := range questRules {
		for _, c := range r.cols {
			if _, ok := changed[c]; ok {
				if err := r.check(v); err != nil {
					problems = append(problems, err)
				}
				break
			}
		}
	}
	// The references: what each changed column names, by kind.
	type use struct {
		col string
		id  int
	}
	uses := map[string][]use{}
	cols := make([]string, 0, len(changed))
	for c := range changed {
		cols = append(cols, c)
	}
	sort.Strings(cols)
	for _, c := range cols {
		link, ok := questLinks[c]
		if !ok {
			continue
		}
		if kind, id := questLinkTarget(link, v(c)); kind != "" {
			uses[kind] = append(uses[kind], use{c, id})
		}
	}
	kinds := make([]string, 0, len(uses))
	for k := range uses {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	for _, kind := range kinds {
		ids := make([]int, 0, len(uses[kind]))
		for _, u := range uses[kind] {
			ids = append(ids, u.id)
		}
		have, err := known(kind, ids)
		if err != nil {
			return err
		}
		for _, u := range uses[kind] {
			if !have[u.id] {
				problems = append(problems, refuse(u.col, "%s names %s %d, which %s", u.col, kind, u.id, missingWhere(kind)))
			}
		}
	}
	return errors.Join(problems...)
}

// missingWhere says where a kind of thing is looked for, for a reference to one that isn't there.
func missingWhere(kind string) string {
	switch kind {
	case "zone", "sort", "skill", "faction", "emote":
		return "the client doesn't have"
	}
	return "the world database doesn't have"
}

// knownEntries is which of ids table has rows for (by its entry column).
func knownEntries(db worldDB, table string, ids []int) (map[int]bool, error) {
	out := map[int]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	list := make([]string, len(ids))
	for i, id := range ids {
		list[i] = strconv.Itoa(id)
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT DISTINCT `entry` FROM `%s` WHERE `entry` IN (%s)", table, strings.Join(list, ",")))
	if err != nil {
		return nil, err
	}
	for _, f := range strings.Fields(string(raw)) {
		if n, err := strconv.Atoi(f); err == nil {
			out[n] = true
		}
	}
	return out, nil
}

// worldKnown looks references up in the world database and the client's tables.
func worldKnown(db worldDB, dataDir string) questKnown {
	return func(kind string, ids []int) (map[int]bool, error) {
		switch kind {
		case "item":
			return knownEntries(db, "item_template", ids)
		case "creature":
			return knownEntries(db, creatureTable, ids)
		case "object":
			return knownEntries(db, objectTable, ids)
		case "quest":
			return knownEntries(db, questTable, ids)
		case "spell":
			// The server reads its spells from spell_template, not the client's Spell.dbc.
			return knownEntries(db, "spell_template", ids)
		}
		names, err := questDBCNames(dataDir, kind)
		if err != nil {
			return nil, err
		}
		out := map[int]bool{}
		for _, id := range ids {
			if _, ok := names[id]; ok {
				out[id] = true
			}
		}
		return out, nil
	}
}

// SaveQuest writes changed values (by column) into quest entry's row of patch patch, once they pass
// the server's rules and every thing they name exists (dataDir is the client's, for the zones,
// sorts, skills, factions and emotes), and returns the SQL it ran.
func SaveQuest(serverRoot, dataDir string, entry, patch int, values map[string]string) (string, error) {
	rec, err := ReadQuest(serverRoot, entry)
	if err != nil {
		return "", err
	}
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	sql, err := templateUpdateSQL(questTable, rec.Columns, entry, patch, values)
	if err != nil || sql == "" {
		return sql, err
	}
	row := make(map[string]string, len(rec.Values))
	for k, v := range rec.Values {
		row[k] = v
	}
	for k, v := range values {
		row[k] = v
	}
	if err := checkQuest(row, values, worldKnown(db, dataDir)); err != nil {
		return "", err
	}
	return sql, runScript(db, sql)
}

// freeQuestSQL finds the first quest entry no quest and no quest relation uses: a relation row left
// from a deleted quest would make a creature offer the new one.
const freeQuestSQL = "SELECT GREATEST((SELECT COALESCE(MAX(entry), 0) FROM quest_template), " +
	"(SELECT COALESCE(MAX(quest), 0) FROM creature_questrelation), (SELECT COALESCE(MAX(quest), 0) FROM creature_involvedrelation), " +
	"(SELECT COALESCE(MAX(quest), 0) FROM gameobject_questrelation), (SELECT COALESCE(MAX(quest), 0) FROM gameobject_involvedrelation)) + 1"

// createQuestSQL is the INSERT that makes quest entry titled title: a copy of base's newest patch row,
// or (base 0) a level 1 quest anyone of level 1 may take, which ends when it is handed in.
func createQuestSQL(cols []TemplateColumn, entry, base int, title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", errors.New("a new quest needs a title")
	}
	t := sqlQuote(title)
	if base == 0 {
		return fmt.Sprintf("INSERT INTO `quest_template` (`entry`, `patch`, `Method`, `MinLevel`, `QuestLevel`, `Title`) VALUES (%d, 0, 2, 1, 1, %s);", entry, t), nil
	}
	return copyTemplateSQL(questTable, cols, entry, base, "Title", t), nil
}

// CreateQuest adds a quest titled title under the first free entry and returns the entry: a copy of
// quest base (its newest patch) when base is not 0, without its givers, else a level 1 quest with no
// objectives or rewards. Patch 0 loads on every patch the server runs.
func CreateQuest(serverRoot string, base int, title string) (int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return 0, err
	}
	raw, err := runSQL(db, freeQuestSQL)
	if err != nil {
		return 0, err
	}
	entry, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		return 0, err
	}
	cols, err := templateColumns(db, questTable)
	if err != nil {
		return 0, err
	}
	sql, err := createQuestSQL(cols, entry, base, title)
	if err != nil {
		return 0, err
	}
	return entry, runScript(db, sql)
}

// QuestGiver is a creature or game object that starts or ends a quest: its kind ("creature" or
// "object"), template entry and name, the content patches the relation row loads in, whether it
// can (a creature with the Quest giver npc flag, a game object of the quest giver type) and how
// many spawns of it the world has.
type QuestGiver struct {
	Kind     string `json:"kind"`
	ID       int    `json:"id"`
	Name     string `json:"name"`
	PatchMin int    `json:"patchMin"`
	PatchMax int    `json:"patchMax"`
	Ready    bool   `json:"ready"`
	Spawns   int    `json:"spawns"`
}

// QuestGivers is who starts a quest (the *_questrelation tables) and who ends it (*_involvedrelation).
type QuestGivers struct {
	Starts []QuestGiver `json:"starts"`
	Ends   []QuestGiver `json:"ends"`
}

// objectTypeQuestGiver is GAMEOBJECT_TYPE_QUESTGIVER, the game object type that offers quests.
const objectTypeQuestGiver = 2

// questGiverTables are the relation tables: who starts and who ends a quest, of each kind.
var questGiverTables = []struct {
	table, kind string
	starts      bool
}{
	{"creature_questrelation", "creature", true},
	{"gameobject_questrelation", "object", true},
	{"creature_involvedrelation", "creature", false},
	{"gameobject_involvedrelation", "object", false},
}

// questGiversSQL selects a relation table's givers of quest, with their names, readiness and spawns.
func questGiversSQL(table, kind string, quest int) string {
	tmpl, ready, spawns := creatureTable, fmt.Sprintf("t.npc_flags & %d", NpcFlagQuestGiver), "creature"
	if kind == "object" {
		tmpl, ready, spawns = objectTable, fmt.Sprintf("t.type = %d", objectTypeQuestGiver), "gameobject"
	}
	return fmt.Sprintf("SELECT r.id, COALESCE(t.name, ''), r.patch_min, r.patch_max, COALESCE(%s, 0) <> 0, "+
		"(SELECT COUNT(*) FROM `%s` s WHERE s.id = r.id) FROM `%s` r LEFT JOIN `%s` t ON t.entry = r.id AND "+
		"t.patch = (SELECT MAX(patch) FROM `%s` WHERE entry = r.id) WHERE r.quest = %d ORDER BY t.name, r.id",
		ready, spawns, table, tmpl, tmpl, quest)
}

// parseQuestGivers reads questGiversSQL's rows.
func parseQuestGivers(raw []byte, kind string) []QuestGiver {
	var out []QuestGiver
	for _, f := range batchRows(raw, 6) {
		out = append(out, QuestGiver{Kind: kind, ID: f.num(0), Name: f[1], PatchMin: f.num(2), PatchMax: f.num(3), Ready: f[4] == "1", Spawns: f.num(5)})
	}
	return out
}

// ReadQuestGivers reads the creatures and game objects that start and end quest entry.
func ReadQuestGivers(serverRoot string, entry int) (QuestGivers, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return QuestGivers{}, err
	}
	g := QuestGivers{Starts: []QuestGiver{}, Ends: []QuestGiver{}}
	for _, t := range questGiverTables {
		raw, err := runSQL(db, questGiversSQL(t.table, t.kind, entry))
		if err != nil {
			return g, err
		}
		if t.starts {
			g.Starts = append(g.Starts, parseQuestGivers(raw, t.kind)...)
		} else {
			g.Ends = append(g.Ends, parseQuestGivers(raw, t.kind)...)
		}
	}
	return g, nil
}

// questGiversSaveSQL replaces quest's rows in the four relation tables with g's, and gives the
// creatures in flag (those of g's) the Quest giver npc flag in every patch row. A giver listed twice
// in one list is refused, as each table's key is (id, quest).
func questGiversSaveSQL(quest int, g QuestGivers, flag []int) (string, error) {
	var b strings.Builder
	creatures := map[int]bool{}
	for _, t := range questGiverTables {
		fmt.Fprintf(&b, "DELETE FROM `%s` WHERE `quest` = %d;\n", t.table, quest)
		list := g.Ends
		if t.starts {
			list = g.Starts
		}
		seen := map[int]bool{}
		for _, r := range list {
			if r.Kind != "creature" && r.Kind != "object" {
				return "", fmt.Errorf("a quest giver of kind %q: it must be a creature or an object", r.Kind)
			}
			if r.Kind != t.kind {
				continue
			}
			if r.ID <= 0 {
				return "", fmt.Errorf("a quest giver with no entry")
			}
			if seen[r.ID] {
				return "", fmt.Errorf("%s %d is listed twice", r.Kind, r.ID)
			}
			seen[r.ID] = true
			if r.PatchMin < 0 || r.PatchMax > 10 || r.PatchMin > r.PatchMax {
				return "", fmt.Errorf("%s %d: the patches must run from 0 to 10, the first no later than the last", r.Kind, r.ID)
			}
			if r.Kind == "creature" {
				creatures[r.ID] = true
			}
			fmt.Fprintf(&b, "INSERT INTO `%s` (`id`, `quest`, `patch_min`, `patch_max`) VALUES (%d, %d, %d, %d);\n", t.table, r.ID, quest, r.PatchMin, r.PatchMax)
		}
	}
	var ids []string
	for _, id := range flag {
		if !creatures[id] {
			return "", fmt.Errorf("creature %d gets the Quest giver flag but neither starts nor ends the quest", id)
		}
		ids = append(ids, strconv.Itoa(id))
	}
	if len(ids) > 0 {
		fmt.Fprintf(&b, "UPDATE `creature_template` SET `npc_flags` = `npc_flags` | %d WHERE `entry` IN (%s);\n", NpcFlagQuestGiver, strings.Join(ids, ", "))
	}
	return strings.TrimSuffix(b.String(), "\n"), nil
}

// SaveQuestGivers replaces the creatures and game objects that start and end quest entry with g's,
// gives the creatures in flag the Quest giver npc flag, and returns the SQL it ran. The quest and
// every giver must exist.
func SaveQuestGivers(serverRoot string, entry int, g QuestGivers, flag []int) (string, error) {
	sql, err := questGiversSaveSQL(entry, g, flag)
	if err != nil {
		return "", err
	}
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	if have, err := knownEntries(db, questTable, []int{entry}); err != nil {
		return "", err
	} else if !have[entry] {
		return "", fmt.Errorf("the world database has no quest %d", entry)
	}
	ids := map[string][]int{}
	for _, r := range append(append([]QuestGiver{}, g.Starts...), g.Ends...) {
		ids[r.Kind] = append(ids[r.Kind], r.ID)
	}
	for _, kind := range []string{"creature", "object"} {
		table := creatureTable
		if kind == "object" {
			table = objectTable
		}
		have, err := knownEntries(db, table, ids[kind])
		if err != nil {
			return "", err
		}
		for _, id := range ids[kind] {
			if !have[id] {
				return "", fmt.Errorf("the world database has no %s %d", kind, id)
			}
		}
	}
	if len(ids["object"]) > 0 {
		types, err := objectTypes(db, ids["object"])
		if err != nil {
			return "", err
		}
		had, err := ReadQuestGivers(serverRoot, entry)
		if err != nil {
			return "", err
		}
		if err := checkGiverObjects(had, g, types); err != nil {
			return "", err
		}
	}
	return sql, runScript(db, sql)
}

// checkGiverObjects refuses g when it adds a game object whose type (in types) is not quest giver to
// a list that had does not already hold it in (#293: the server ignores such rows, and Meld never
// changes the object's type for the author). Rows the quest already has may stay or go.
func checkGiverObjects(had, g QuestGivers, types map[int]int) error {
	for _, l := range []struct{ had, now []QuestGiver }{{had.Starts, g.Starts}, {had.Ends, g.Ends}} {
		old := map[int]bool{}
		for _, r := range l.had {
			if r.Kind == "object" {
				old[r.ID] = true
			}
		}
		for _, r := range l.now {
			if t := types[r.ID]; r.Kind == "object" && t != objectTypeQuestGiver && !old[r.ID] {
				return notQuestGiver(r.ID, t)
			}
		}
	}
	return nil
}

// NamedRef is a template a quest names, as the quest editor shows it: its name, and for an item its
// quality and display (for the icon), for a creature its lowest level, for a quest its level.
type NamedRef struct {
	Name      string `json:"name"`
	Quality   int    `json:"quality"`
	DisplayID int    `json:"displayId"`
	Level     int    `json:"level"`
}

// templateNamesSQL selects kind's templates of ids (entry, name, quality, display, level), each its
// newest patch row.
func templateNamesSQL(kind string, ids []int) (string, error) {
	var table, cols string
	switch kind {
	case "item":
		table, cols = "item_template", "t.name, t.quality, t.display_id, 0"
	case "creature":
		table, cols = creatureTable, "t.name, 0, 0, t.level_min"
	case "object":
		table, cols = objectTable, "t.name, 0, 0, 0"
	case "quest":
		table, cols = questTable, "COALESCE(t.Title, ''), 0, 0, t.QuestLevel"
	default:
		return "", fmt.Errorf("no templates of kind %q", kind)
	}
	list := make([]string, len(ids))
	for i, id := range ids {
		list[i] = strconv.Itoa(id)
	}
	return fmt.Sprintf("SELECT t.entry, %s FROM `%s` t WHERE t.entry IN (%s) AND t.patch = (SELECT MAX(patch) FROM `%s` WHERE entry = t.entry)",
		cols, table, strings.Join(list, ","), table), nil
}

// TemplateNames names the item, creature, object or quest templates (kind) of ids, leaving out
// those the world database doesn't have.
func TemplateNames(serverRoot, kind string, ids []int) (map[int]NamedRef, error) {
	out := map[int]NamedRef{}
	if len(ids) == 0 {
		return out, nil
	}
	sql, err := templateNamesSQL(kind, ids)
	if err != nil {
		return nil, err
	}
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	raw, err := runSQL(db, sql)
	if err != nil {
		return nil, err
	}
	for _, f := range batchRows(raw, 5) {
		out[f.num(0)] = NamedRef{Name: f[1], Quality: f.num(2), DisplayID: f.num(3), Level: f.num(4)}
	}
	return out, nil
}

// NamedID is a row of a client table by ID and English name.
type NamedID struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// QuestTables are the client's tables the quest editor names numbers from: the quest sorts (a
// quest log heading that isn't a zone, such as Warlock or Seasonal), the skills, and the factions
// a player has reputation with.
type QuestTables struct {
	Sorts    []NamedID `json:"sorts"`
	Skills   []NamedID `json:"skills"`
	Factions []NamedID `json:"factions"`
	// MailTemplates are MailTemplate.dbc's letters (#704), by their body's first line (1.12's
	// table has no subject).
	MailTemplates []NamedID `json:"mailTemplates"`
}

// questDBC is what the quest editor reads from the client's QuestSort, SkillLine and Faction
// tables, once per data folder (Meld never changes them).
type questDBC struct {
	tables QuestTables
	// names are each table's names by ID, every faction included.
	names map[string]map[int]string
}

var questDBCs = struct {
	sync.Mutex
	by map[string]*questDBC
}{by: map[string]*questDBC{}}

// readNamed lists a DBC's rows by ID with the name in field nameField, skipping unnamed rows, and
// keep says which to list (nil for all; every row is named in the map).
func readNamed(b []byte, nameField int, keep func(t *dbcTable, r int) bool) ([]NamedID, map[int]string, error) {
	t, err := parseDBC(b)
	if err != nil {
		return nil, nil, err
	}
	if t.fields <= nameField {
		return nil, nil, fmt.Errorf("the table has %d fields, too few for a name in field %d", t.fields, nameField)
	}
	var list []NamedID
	names := make(map[int]string, t.records)
	for r := 0; r < t.records; r++ {
		id, name := int(t.u32(r, 0)), t.str(r, nameField)
		names[id] = name
		if name != "" && (keep == nil || keep(t, r)) {
			list = append(list, NamedID{ID: id, Name: name})
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].Name < list[j].Name || (list[i].Name == list[j].Name && list[i].ID < list[j].ID)
	})
	return list, names, nil
}

// loadQuestDBC reads the quest editor's client tables (1.12 layouts: QuestSort's name is field 1,
// SkillLine's field 3, Faction's field 19 with its reputation index, -1 for none, in field 1,
// MailTemplate's body field 1, named by its first line).
func loadQuestDBC(dataDir string) (*questDBC, error) {
	questDBCs.Lock()
	defer questDBCs.Unlock()
	if d, ok := questDBCs.by[dataDir]; ok {
		return d, nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	d := &questDBC{names: map[string]map[int]string{}}
	for _, t := range []struct {
		kind, file string
		field      int
		list       *[]NamedID
		keep       func(t *dbcTable, r int) bool
	}{
		{"sort", "QuestSort", 1, &d.tables.Sorts, nil},
		{"skill", "SkillLine", 3, &d.tables.Skills, nil},
		{"faction", "Faction", 19, &d.tables.Factions, func(t *dbcTable, r int) bool { return int32(t.u32(r, 1)) >= 0 }},
		{"mail template", "MailTemplate", 1, &d.tables.MailTemplates, nil},
	} {
		b, err := set.ReadFile(`DBFilesClient\` + t.file + `.dbc`)
		if err != nil {
			return nil, err
		}
		list, names, err := readNamed(b, t.field, t.keep)
		if err != nil {
			return nil, fmt.Errorf("%s.dbc: %w", t.file, err)
		}
		if t.kind == "mail template" {
			list, names = firstLines(list, names)
		}
		*t.list, d.names[t.kind] = list, names
	}
	questDBCs.by[dataDir] = d
	return d, nil
}

// firstLines names a table's rows of long text (a letter's body) by their first line, as a picker
// shows them.
func firstLines(list []NamedID, names map[int]string) ([]NamedID, map[int]string) {
	for i := range list {
		list[i].Name = firstLine(list[i].Name)
	}
	for id, n := range names {
		names[id] = firstLine(n)
	}
	return list, names
}

// LoadQuestTables reads the client's quest sorts, skills and reputation factions.
func LoadQuestTables(dataDir string) (QuestTables, error) {
	d, err := loadQuestDBC(dataDir)
	if err != nil {
		return QuestTables{}, err
	}
	return d.tables, nil
}

// questDBCNames is a client table's names by ID for kind: "sort", "skill", "faction", "zone"
// (AreaTable, read each time, since the Zones dialog adds areas) or "emote".
func questDBCNames(dataDir, kind string) (map[int]string, error) {
	switch kind {
	case "zone":
		areas, err := LoadAreas(dataDir)
		if err != nil {
			return nil, err
		}
		out := make(map[int]string, len(areas))
		for _, a := range areas {
			out[int(a.ID)] = a.Name
		}
		return out, nil
	case "emote":
		emotes, err := Emotes(dataDir)
		if err != nil {
			return nil, err
		}
		out := make(map[int]string, len(emotes))
		for _, e := range emotes {
			out[e.ID] = e.Name
		}
		return out, nil
	}
	d, err := loadQuestDBC(dataDir)
	if err != nil {
		return nil, err
	}
	names, ok := d.names[kind]
	if !ok {
		return nil, fmt.Errorf("no client table of kind %q", kind)
	}
	return names, nil
}

// questLinkColumns are the quest_template columns that name another quest: a positive value is that
// quest's entry, a negative one (in PrevQuestId) the same quest "must be active".
var questLinkColumns = []string{"PrevQuestId", "NextQuestId", "NextQuestInChain", "BreadcrumbForQuestId"}

// questDeleteRows are the rows a quest owns, by table and the WHERE that finds them. A script chain
// goes only when no other quest uses its id.
func questDeleteRows(quest int) []struct{ table, where string } {
	script := func(col string) string {
		return fmt.Sprintf("`id` <> 0 AND `id` IN (SELECT `%[1]s` FROM `quest_template` WHERE `entry` = %[2]d) AND `id` NOT IN (SELECT `%[1]s` FROM `quest_template` WHERE `entry` <> %[2]d)", col, quest)
	}
	rows := []struct{ table, where string }{
		{"quest_start_scripts", script("StartScript")},
		{"quest_end_scripts", script("CompleteScript")},
	}
	for _, t := range questGiverTables {
		rows = append(rows, struct{ table, where string }{t.table, fmt.Sprintf("`quest` = %d", quest)})
	}
	return append(rows,
		struct{ table, where string }{"game_event_quest", fmt.Sprintf("`quest` = %d", quest)},
		struct{ table, where string }{"locales_quest", fmt.Sprintf("`entry` = %d", quest)},
		struct{ table, where string }{"quest_template", fmt.Sprintf("`entry` = %d", quest)})
}

// deleteQuestSQL deletes quest's rows (questDeleteRows, scripts first, as they are found through the
// template) and clears the links other quests have to it.
func deleteQuestSQL(quest int) string {
	var b strings.Builder
	for _, r := range questDeleteRows(quest) {
		fmt.Fprintf(&b, "DELETE FROM `%s` WHERE %s;\n", r.table, r.where)
	}
	for _, c := range questLinkColumns {
		fmt.Fprintf(&b, "UPDATE `quest_template` SET `%[1]s` = 0 WHERE `%[1]s` IN (%[2]d, -%[2]d) AND `entry` <> %[2]d;\n", c, quest)
	}
	return strings.TrimSuffix(b.String(), "\n")
}

// QuestDeleteCount is how many rows of a table deleting a quest removes.
type QuestDeleteCount struct {
	Table string `json:"table"`
	Count int    `json:"count"`
}

// QuestLink is a quest that names the quest being deleted, and the columns it names it in.
type QuestLink struct {
	Quest   int      `json:"quest"`
	Title   string   `json:"title"`
	Columns []string `json:"columns"`
}

// QuestDeletePlan is what deleting a quest removes and leaves dangling, for the confirmation.
type QuestDeletePlan struct {
	Title string `json:"title"`
	// Rows has the tables that hold rows of the quest (empty ones left out).
	Rows []QuestDeleteCount `json:"rows"`
	// Links are the other quests that name it; deleting clears those columns to 0.
	Links []QuestLink `json:"links"`
	// Characters is how many characters have it in their log or done; -1 when the characters
	// database could not be read.
	Characters int `json:"characters"`
}

// PlanQuestDelete reads what DeleteQuest would remove, changing nothing.
func PlanQuestDelete(serverRoot string, entry int) (QuestDeletePlan, error) {
	plan := QuestDeletePlan{Rows: []QuestDeleteCount{}, Links: []QuestLink{}, Characters: -1}
	db, err := openWorld(serverRoot)
	if err != nil {
		return plan, err
	}
	rec, err := ReadQuest(serverRoot, entry)
	if err != nil {
		return plan, err
	}
	plan.Title = rec.Values["Title"]
	for _, r := range questDeleteRows(entry) {
		raw, err := runSQL(db, fmt.Sprintf("SELECT COUNT(*) FROM `%s` WHERE %s", r.table, r.where))
		if err != nil {
			return plan, err
		}
		if n, _ := strconv.Atoi(strings.TrimSpace(string(raw))); n > 0 {
			plan.Rows = append(plan.Rows, QuestDeleteCount{r.table, n})
		}
	}
	var parts []string
	for _, c := range questLinkColumns {
		parts = append(parts, fmt.Sprintf("SELECT q.`entry`, '%[1]s', COALESCE((SELECT t.`Title` FROM `quest_template` t WHERE t.`entry` = q.`entry` ORDER BY t.`patch` DESC LIMIT 1), '') "+
			"FROM `quest_template` q WHERE q.`%[1]s` IN (%[2]d, -%[2]d) AND q.`entry` <> %[2]d", c, entry))
	}
	raw, err := runSQL(db, strings.Join(parts, " UNION ")+" ORDER BY 1")
	if err != nil {
		return plan, err
	}
	for _, f := range batchRows(raw, 3) {
		q, _ := strconv.Atoi(f[0])
		if n := len(plan.Links); n > 0 && plan.Links[n-1].Quest == q {
			plan.Links[n-1].Columns = append(plan.Links[n-1].Columns, f[1])
			continue
		}
		plan.Links = append(plan.Links, QuestLink{Quest: q, Title: f[2], Columns: []string{f[1]}})
	}
	if cdb, err := confDatabase(serverRoot, "CharacterDatabase.Info"); err == nil {
		if raw, err := runSQL(cdb, fmt.Sprintf("SELECT COUNT(DISTINCT guid) FROM character_queststatus WHERE quest = %d", entry)); err == nil {
			if n, err := strconv.Atoi(strings.TrimSpace(string(raw))); err == nil {
				plan.Characters = n
			}
		}
	}
	return plan, nil
}

// DeleteQuest removes quest entry from the world database (every patch row, its givers, scripts,
// event links and translations) and clears the links other quests have to it, and returns the SQL.
func DeleteQuest(serverRoot string, entry int) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	if have, err := knownEntries(db, questTable, []int{entry}); err != nil {
		return "", err
	} else if !have[entry] {
		return "", fmt.Errorf("the world database has no quest %d", entry)
	}
	sql := deleteQuestSQL(entry)
	return sql, runScript(db, sql)
}

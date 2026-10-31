package vmangos

import (
	"sort"
	"strconv"
	"strings"
)

// File › Check Map's quest checks (#952), part of the World data group (#951): the quests the open
// map's creatures and game objects start or end, with what the editor needs to tell which of them a
// player cannot finish. This side reads the rows (the quests, their givers and enders from the four
// relation tables, the items and area triggers that start or complete them, the quests their chain
// links name), counts the spawns of every giver, ender and kill objective, and asks the loot, vendor,
// quest and spell tables which of the item objectives anything gives. Which of that is a problem, and
// how bad, is the editor's call (frontend/src/lib/check/quests.ts, with the chain rules in
// lib/world/questChain.ts). One query a kind of row over the whole set, never one a quest.

// QuestHolder is a creature or game object template (Kind "creature" or "object") that starts or
// ends a quest.
type QuestHolder struct {
	Kind string `json:"kind"`
	ID   int    `json:"id"`
}

// CheckedQuest is one quest of the map as the checks need it: its newest row's title, level and
// special flags, its set chain links (by column, signed as stored), its kill objectives (positive a
// creature, negative a game object) and item objectives, the item it gives at the start, who starts
// and ends it, the items whose start_quest it is and the area triggers that complete it.
type CheckedQuest struct {
	Entry        int            `json:"entry"`
	Title        string         `json:"title"`
	Level        int            `json:"level"`
	SpecialFlags int            `json:"specialFlags"`
	Links        map[string]int `json:"links"`
	Kills        []int          `json:"kills"`
	Items        []int          `json:"items"`
	SrcItem      int            `json:"srcItem"`
	Givers       []QuestHolder  `json:"givers"`
	Enders       []QuestHolder  `json:"enders"`
	ItemStarts   []int          `json:"itemStarts"`
	Triggers     []int          `json:"triggers"`
}

// QuestBrief is a quest a chain link names: its entry, title and level.
type QuestBrief struct {
	Entry int    `json:"entry"`
	Title string `json:"title"`
	Level int    `json:"level"`
}

// SpawnTally is a creature or game object template the quests name (a giver, an ender, a kill
// objective): its name, whether its template exists, how many spawns the world has of it, and how
// many of those spawn only during a game event.
type SpawnTally struct {
	Kind   string `json:"kind"`
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Exists bool   `json:"exists"`
	World  int    `json:"world"`
	Events int    `json:"events"`
}

// ItemTally is an item objective: its name, whether its template exists, and whether anything gives
// it (a loot row, directly or through a reference loot group something uses; a vendor; a quest's
// start item or reward; a spell that creates it).
type ItemTally struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Exists  bool   `json:"exists"`
	Sourced bool   `json:"sourced"`
}

// QuestReport is what the world database has of the map's quests.
type QuestReport struct {
	Quests []CheckedQuest `json:"quests"`
	// Linked holds the quests the chain links name that exist, the map's own included.
	Linked []QuestBrief `json:"linked"`
	Spawns []SpawnTally `json:"spawns"`
	// Summoned lists the unspawned kill objective creatures a script summons or gives kill credit
	// for (SCRIPT_COMMAND_TEMP_SUMMON_CREATURE, SCRIPT_COMMAND_KILL_CREDIT), or a spell summons.
	Summoned []int       `json:"summoned"`
	Items    []ItemTally `json:"items"`
	// MissingTriggers lists the area triggers that complete a quest but have no areatrigger_template row.
	MissingTriggers []int `json:"missingTriggers"`
	// Error says why the quests weren't checked ("" when they were).
	Error string `json:"error"`
}

// questLootTables are the loot tables an item can drop from directly; reference_loot_template is
// asked apart, as its rows count only where a loot row refers to their group.
var questLootTables = []string{
	"creature_loot_template", "gameobject_loot_template", "item_loot_template", "pickpocketing_loot_template",
	"skinning_loot_template", "fishing_loot_template", "disenchant_loot_template", "mail_loot_template",
}

// questScriptTables are the script tables a summon or kill credit command may sit in.
var questScriptTables = []string{
	"event_scripts", "generic_scripts", "quest_start_scripts", "quest_end_scripts", "gossip_scripts", "spell_scripts",
	"gameobject_scripts", "creature_ai_scripts", "creature_movement_scripts", "creature_spells_scripts", "areatrigger_scripts",
}

// questSummonEffects are the spell effects that summon a creature named by the effect's misc value
// (SpellDefines.h: SUMMON, SUMMON_WILD, SUMMON_GUARDIAN, SUMMON_PET, SUMMON_POSSESSED, SUMMON_TOTEM,
// SUMMON_TOTEM_SLOT1 to 4, SUMMON_CRITTER).
const questSummonEffects = "28,41,42,56,73,74,87,88,89,90,97"

// questRowsSQL selects the quests' entry, title, level, special flags, start item, chain links, kill
// objectives and item objectives, from their newest rows.
func questRowsSQL(quests []int) string {
	cols := []string{"t.entry", "t.Title", "t.QuestLevel", "t.SpecialFlags", "t.SrcItemId"}
	for _, c := range questLinkColumns {
		cols = append(cols, "t.`"+c+"`")
	}
	for _, c := range numbered("ReqCreatureOrGOId", 4) {
		cols = append(cols, "t.`"+c+"`")
	}
	for _, c := range numbered("ReqItemId", 4) {
		cols = append(cols, "t.`"+c+"`")
	}
	return "SELECT " + strings.Join(cols, ", ") + " FROM quest_template t WHERE t.entry IN (" + idList(quests) + ") AND " + newestRow("quest_template") + " ORDER BY t.entry"
}

// questRowWidth is the fields of a questRowsSQL row.
var questRowWidth = 5 + len(questLinkColumns) + 8

// parseQuestRows reads questRowsSQL's output.
func parseQuestRows(raw []byte) []CheckedQuest {
	var out []CheckedQuest
	for _, f := range batchRows(raw, questRowWidth) {
		q := CheckedQuest{
			Entry: f.num(0), Title: nullText(f[1]), Level: f.num(2), SpecialFlags: f.num(3), SrcItem: f.num(4),
			Links: map[string]int{}, Kills: []int{}, Items: []int{}, Givers: []QuestHolder{}, Enders: []QuestHolder{}, ItemStarts: []int{}, Triggers: []int{},
		}
		at := 5
		for _, c := range questLinkColumns {
			if v := f.num(at); v != 0 {
				q.Links[c] = v
			}
			at++
		}
		for i := 0; i < 4; i++ {
			if v := f.num(at + i); v != 0 {
				q.Kills = append(q.Kills, v)
			}
		}
		at += 4
		for i := 0; i < 4; i++ {
			if v := f.num(at + i); v > 0 {
				q.Items = append(q.Items, v)
			}
		}
		out = append(out, q)
	}
	return out
}

// questHoldersSQL selects, for the quests, (role, id, quest) rows: who starts them ("cs", "os"), who
// ends them ("ce", "oe"), the area triggers that complete them ("at") and the items that start them ("it").
func questHoldersSQL(quests []int) string {
	list := idList(quests)
	parts := []string{}
	for _, t := range []struct{ role, table string }{
		{"cs", "creature_questrelation"}, {"os", "gameobject_questrelation"}, {"ce", "creature_involvedrelation"},
		{"oe", "gameobject_involvedrelation"}, {"at", "areatrigger_involvedrelation"},
	} {
		parts = append(parts, "SELECT DISTINCT '"+t.role+"', id, quest FROM "+t.table+" WHERE quest IN ("+list+")")
	}
	parts = append(parts, "SELECT DISTINCT 'it', entry, start_quest FROM item_template WHERE start_quest IN ("+list+")")
	return strings.Join(parts, " UNION ALL ")
}

// questBriefsSQL selects the quests' entry, title and level, from their newest rows.
func questBriefsSQL(quests []int) string {
	return "SELECT t.entry, t.Title, t.QuestLevel FROM quest_template t WHERE t.entry IN (" + idList(quests) + ") AND " + newestRow("quest_template") + " ORDER BY t.entry"
}

// spawnTallySQL selects (kind, id, spawns, event spawns) for the creature and game object templates:
// a creature spawn counts for each of its five entries, and a spawn is an event's when a game event
// (event > 0) spawns it.
func spawnTallySQL(creatures, objects []int) string {
	var parts []string
	if list := idList(creatures); list != "" {
		var ids []string
		for _, c := range []string{"id", "id2", "id3", "id4", "id5"} {
			ids = append(ids, "SELECT "+c+" AS e, guid FROM creature WHERE "+c+" IN ("+list+")")
		}
		parts = append(parts, "SELECT 'creature', x.e, COUNT(*), COUNT(g.guid) FROM ("+strings.Join(ids, " UNION ALL ")+") x "+
			"LEFT JOIN (SELECT DISTINCT guid FROM game_event_creature WHERE event > 0) g ON g.guid = x.guid GROUP BY x.e")
	}
	if list := idList(objects); list != "" {
		parts = append(parts, "SELECT 'object', s.id, COUNT(*), COUNT(g.guid) FROM gameobject s "+
			"LEFT JOIN (SELECT DISTINCT guid FROM game_event_gameobject WHERE event > 0) g ON g.guid = s.guid WHERE s.id IN ("+list+") GROUP BY s.id")
	}
	return strings.Join(parts, " UNION ALL ")
}

// questNamesSQL selects (kind, entry, name) of the creature, game object and item templates, from
// their newest rows: a template left out has no row.
func questNamesSQL(creatures, objects, items []int) string {
	var parts []string
	for _, t := range []struct {
		kind, table string
		ids         []int
	}{{"creature", "creature_template", creatures}, {"object", "gameobject_template", objects}, {"item", "item_template", items}} {
		if list := idList(t.ids); list != "" {
			parts = append(parts, "SELECT '"+t.kind+"', t.entry, t.name FROM "+t.table+" t WHERE t.entry IN ("+list+") AND "+newestRow(t.table))
		}
	}
	return strings.Join(parts, " UNION ALL ")
}

// summonedSQL selects the creatures among ids a script summons or gives kill credit for, or a spell summons.
func summonedSQL(ids []int) string {
	list := idList(ids)
	if list == "" {
		return ""
	}
	var parts []string
	for _, t := range questScriptTables {
		parts = append(parts, "SELECT datalong FROM "+t+" WHERE command IN (8,10) AND datalong IN ("+list+")")
	}
	for i := 1; i <= 3; i++ {
		n := strconv.Itoa(i)
		parts = append(parts, "SELECT effectMiscValue"+n+" FROM spell_template WHERE effect"+n+" IN ("+questSummonEffects+") AND effectMiscValue"+n+" IN ("+list+")")
	}
	return strings.Join(parts, " UNION ")
}

// itemSourcesSQL selects the items among ids that something gives: a loot row (a reference group's
// only where a loot row refers to the group), a vendor, a quest's start item or reward, or a spell
// that creates it.
func itemSourcesSQL(ids []int) string {
	list := idList(ids)
	if list == "" {
		return ""
	}
	var parts, refs []string
	for _, t := range questLootTables {
		parts = append(parts, "SELECT item FROM "+t+" WHERE item IN ("+list+") AND mincountOrRef > 0")
	}
	for _, t := range append(append([]string{}, questLootTables...), "reference_loot_template") {
		refs = append(refs, "SELECT -mincountOrRef FROM "+t+" WHERE mincountOrRef < 0")
	}
	parts = append(parts, "SELECT r.item FROM reference_loot_template r WHERE r.item IN ("+list+") AND r.mincountOrRef > 0 AND r.entry IN ("+strings.Join(refs, " UNION ")+")")
	parts = append(parts, "SELECT item FROM npc_vendor WHERE item IN ("+list+")", "SELECT item FROM npc_vendor_template WHERE item IN ("+list+")")
	for _, c := range append(append([]string{"SrcItemId"}, numbered("RewItemId", 4)...), numbered("RewChoiceItemId", 6)...) {
		parts = append(parts, "SELECT "+c+" FROM quest_template WHERE "+c+" IN ("+list+")")
	}
	for i := 1; i <= 3; i++ {
		c := "effectItemType" + strconv.Itoa(i)
		parts = append(parts, "SELECT "+c+" FROM spell_template WHERE "+c+" IN ("+list+")")
	}
	return strings.Join(parts, " UNION ")
}

// idSet is the ids in raw, one a line (the first field).
func idSet(raw []byte) map[int]bool {
	out := map[int]bool{}
	for _, f := range batchLines(raw) {
		if v := f.num(0); v != 0 {
			out[v] = true
		}
	}
	return out
}

// sortedKeys is m's keys, in order.
func sortedKeys(m map[int]bool) []int {
	out := make([]int, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Ints(out)
	return out
}

// emptyQuestReport is a QuestReport with its lists empty rather than null.
func emptyQuestReport() QuestReport {
	return QuestReport{Quests: []CheckedQuest{}, Linked: []QuestBrief{}, Spawns: []SpawnTally{}, Summoned: []int{}, Items: []ItemTally{}, MissingTriggers: []int{}}
}

// checkQuests reads what QuestReport holds for the quests (existing ones: the caller drops those
// without a row).
func checkQuests(db worldDB, quests []int) (QuestReport, error) {
	r := emptyQuestReport()
	set := map[int]bool{}
	for _, q := range quests {
		if q > 0 {
			set[q] = true
		}
	}
	if quests = sortedKeys(set); len(quests) == 0 {
		return r, nil
	}
	raw, err := runSQL(db, questRowsSQL(quests))
	if err != nil {
		return r, err
	}
	if rows := parseQuestRows(raw); rows != nil {
		r.Quests = rows
	}
	by := map[int]*CheckedQuest{}
	for i := range r.Quests {
		by[r.Quests[i].Entry] = &r.Quests[i]
	}
	if raw, err = runSQL(db, questHoldersSQL(quests)); err != nil {
		return r, err
	}
	creatures, objects, items, triggers, linked := map[int]bool{}, map[int]bool{}, map[int]bool{}, map[int]bool{}, map[int]bool{}
	for _, f := range batchRows(raw, 3) {
		q := by[f.num(2)]
		id := f.num(1)
		if q == nil || id <= 0 {
			continue
		}
		switch f[0] {
		case "cs", "os", "ce", "oe":
			h := QuestHolder{Kind: "creature", ID: id}
			if f[0][0] == 'o' {
				h.Kind = "object"
				objects[id] = true
			} else {
				creatures[id] = true
			}
			if f[0][1] == 's' {
				q.Givers = append(q.Givers, h)
			} else {
				q.Enders = append(q.Enders, h)
			}
		case "at":
			q.Triggers = append(q.Triggers, id)
			triggers[id] = true
		case "it":
			q.ItemStarts = append(q.ItemStarts, id)
		}
	}
	for _, q := range r.Quests {
		for _, v := range q.Links {
			if v < 0 {
				v = -v
			}
			linked[v] = true
		}
		for _, k := range q.Kills {
			if k > 0 {
				creatures[k] = true
			} else {
				objects[-k] = true
			}
		}
		for _, it := range q.Items {
			items[it] = true
		}
	}

	if len(linked) > 0 {
		if raw, err = runSQL(db, questBriefsSQL(sortedKeys(linked))); err != nil {
			return r, err
		}
		for _, f := range batchRows(raw, 3) {
			r.Linked = append(r.Linked, QuestBrief{Entry: f.num(0), Title: nullText(f[1]), Level: f.num(2)})
		}
	}

	cs, ob, is := sortedKeys(creatures), sortedKeys(objects), sortedKeys(items)
	names := map[string]map[int]string{"creature": {}, "object": {}, "item": {}}
	if sql := questNamesSQL(cs, ob, is); sql != "" {
		if raw, err = runSQL(db, sql); err != nil {
			return r, err
		}
		for _, f := range batchRows(raw, 3) {
			if m := names[f[0]]; m != nil {
				m[f.num(1)] = nullText(f[2])
			}
		}
	}
	type count struct{ world, events int }
	counts := map[string]map[int]count{"creature": {}, "object": {}}
	if sql := spawnTallySQL(cs, ob); sql != "" {
		if raw, err = runSQL(db, sql); err != nil {
			return r, err
		}
		for _, f := range batchRows(raw, 4) {
			if m := counts[f[0]]; m != nil {
				c := m[f.num(1)]
				m[f.num(1)] = count{c.world + f.num(2), c.events + f.num(3)}
			}
		}
	}
	for _, set := range []struct {
		kind string
		ids  []int
	}{{"creature", cs}, {"object", ob}} {
		for _, id := range set.ids {
			name, ok := names[set.kind][id]
			c := counts[set.kind][id]
			r.Spawns = append(r.Spawns, SpawnTally{Kind: set.kind, ID: id, Name: name, Exists: ok, World: c.world, Events: c.events})
		}
	}

	// The unspawned kill objectives: does a script or spell bring them?
	var unspawned []int
	for _, q := range r.Quests {
		for _, k := range q.Kills {
			if _, ok := names["creature"][k]; k > 0 && ok && counts["creature"][k].world == 0 {
				unspawned = append(unspawned, k)
			}
		}
	}
	if sql := summonedSQL(unspawned); sql != "" {
		if raw, err = runSQL(db, sql); err != nil {
			return r, err
		}
		r.Summoned = sortedKeys(idSet(raw))
	}

	if sql := itemSourcesSQL(is); sql != "" {
		if raw, err = runSQL(db, sql); err != nil {
			return r, err
		}
		sourced := idSet(raw)
		for _, id := range is {
			name, ok := names["item"][id]
			r.Items = append(r.Items, ItemTally{ID: id, Name: name, Exists: ok, Sourced: sourced[id]})
		}
	}

	if ts := sortedKeys(triggers); len(ts) > 0 {
		if raw, err = runSQL(db, "SELECT DISTINCT id FROM areatrigger_template WHERE id IN ("+idList(ts)+")"); err != nil {
			return r, err
		}
		r.MissingTriggers = missingEntries(ts, raw)
		if r.MissingTriggers == nil {
			r.MissingTriggers = []int{}
		}
	}
	return r, nil
}

package vmangos

import (
	"sort"
	"strings"
)

// The quest editor's Chain view (#948): a quest and every quest linked to it, through the four link
// columns (questLinkColumns, either sign) and a shared ExclusiveGroup, each with what a box of the
// graph shows. The walk runs in memory over one read of every quest's links, so the whole chain
// costs four queries whatever its length. Which link is a step and which step is a problem is the
// editor's call (frontend/src/lib/world/questChain.ts, questGraph.ts).

// maxChainQuests caps the walk: a hub quest (a breadcrumb target, a class quest many lead to) can
// link a chain to a great part of the world.
const maxChainQuests = 80

// ChainHolder is a creature, game object or item ("item": an item that starts the quest) that starts
// or ends a quest of a chain, with its name ("" when its template has no row).
type ChainHolder struct {
	Kind string `json:"kind"`
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// ChainQuest is one quest of a chain, from its newest row: title, level, minimum level, zone or sort
// (ZoneOrSort, as stored), exclusive group, set links (by column, signed as stored), and who starts
// and ends it.
type ChainQuest struct {
	Entry    int            `json:"entry"`
	Title    string         `json:"title"`
	Level    int            `json:"level"`
	MinLevel int            `json:"minLevel"`
	Zone     int            `json:"zone"`
	Group    int            `json:"group"`
	Links    map[string]int `json:"links"`
	Givers   []ChainHolder  `json:"givers"`
	Enders   []ChainHolder  `json:"enders"`
}

// QuestChain is the chain around quest Root: its quests (in entry order), the entries its links name
// that have no quest_template row, and whether the walk stopped at maxChainQuests.
type QuestChain struct {
	Root    int          `json:"root"`
	Quests  []ChainQuest `json:"quests"`
	Missing []int        `json:"missing"`
	Capped  bool         `json:"capped"`
}

// chainLinksSQL selects every quest's entry, links and exclusive group, from the newest rows that have any.
func chainLinksSQL() string {
	cols := []string{"t.entry"}
	var set []string
	for _, c := range append(append([]string{}, questLinkColumns...), "ExclusiveGroup") {
		cols = append(cols, "t.`"+c+"`")
		set = append(set, "t.`"+c+"` <> 0")
	}
	return "SELECT " + strings.Join(cols, ", ") + " FROM quest_template t WHERE (" + strings.Join(set, " OR ") + ") AND " + newestRow("quest_template")
}

// chainRowsSQL selects the quests' entry, title, level, minimum level, zone or sort, links and
// exclusive group, from their newest rows.
func chainRowsSQL(quests []int) string {
	cols := []string{"t.entry", "t.Title", "t.QuestLevel", "t.MinLevel", "t.ZoneOrSort"}
	for _, c := range append(append([]string{}, questLinkColumns...), "ExclusiveGroup") {
		cols = append(cols, "t.`"+c+"`")
	}
	return "SELECT " + strings.Join(cols, ", ") + " FROM quest_template t WHERE t.entry IN (" + idList(quests) + ") AND " + newestRow("quest_template") + " ORDER BY t.entry"
}

// chainWalk is the quests linked to root, root first and then outwards, through links (entry → the
// entries its row names) in either direction and shared exclusive groups (entry → group), stopping
// at limit; capped says whether it stopped with quests left.
func chainWalk(root int, links map[int][]int, groups map[int]int, limit int) (reached []int, capped bool) {
	near := map[int][]int{}
	for from, tos := range links {
		for _, to := range tos {
			if to != from {
				near[from] = append(near[from], to)
				near[to] = append(near[to], from)
			}
		}
	}
	members := map[int][]int{}
	for q, g := range groups {
		members[g] = append(members[g], q)
	}
	for _, m := range members {
		sort.Ints(m)
	}
	seen := map[int]bool{root: true}
	queue := []int{root}
	for len(queue) > 0 {
		q := queue[0]
		queue = queue[1:]
		reached = append(reached, q)
		next := append([]int{}, near[q]...)
		if g, ok := groups[q]; ok {
			next = append(next, members[g]...)
		}
		sort.Ints(next)
		for _, n := range next {
			if seen[n] {
				continue
			}
			if len(seen) >= limit {
				return append(reached, queue...), true
			}
			seen[n] = true
			queue = append(queue, n)
		}
	}
	return reached, false
}

// readQuestChain reads the chain around quest root (four queries: every quest's links, the chain's
// rows, their givers and enders, and those's names).
func readQuestChain(db worldDB, root int) (QuestChain, error) {
	c := QuestChain{Root: root, Quests: []ChainQuest{}, Missing: []int{}}
	if root <= 0 {
		return c, nil
	}
	raw, err := runSQL(db, chainLinksSQL())
	if err != nil {
		return c, err
	}
	width := 2 + len(questLinkColumns)
	links, groups := map[int][]int{}, map[int]int{}
	for _, f := range batchRows(raw, width) {
		e := f.num(0)
		for i := range questLinkColumns {
			if v := f.num(1 + i); v != 0 {
				if v < 0 {
					v = -v
				}
				links[e] = append(links[e], v)
			}
		}
		if g := f.num(width - 1); g != 0 {
			groups[e] = g
		}
	}
	reached, capped := chainWalk(root, links, groups, maxChainQuests)
	c.Capped = capped

	if raw, err = runSQL(db, chainRowsSQL(reached)); err != nil {
		return c, err
	}
	by := map[int]int{}
	for _, f := range batchRows(raw, 5+len(questLinkColumns)+1) {
		q := ChainQuest{
			Entry: f.num(0), Title: nullText(f[1]), Level: f.num(2), MinLevel: f.num(3), Zone: f.num(4),
			Links: map[string]int{}, Givers: []ChainHolder{}, Enders: []ChainHolder{},
		}
		for i, col := range questLinkColumns {
			if v := f.num(5 + i); v != 0 {
				q.Links[col] = v
			}
		}
		q.Group = f.num(5 + len(questLinkColumns))
		by[q.Entry] = len(c.Quests)
		c.Quests = append(c.Quests, q)
	}
	for _, e := range reached {
		if _, ok := by[e]; !ok {
			c.Missing = append(c.Missing, e)
		}
	}
	sort.Ints(c.Missing)
	if len(c.Quests) == 0 {
		return c, nil
	}

	entries := make([]int, len(c.Quests))
	for i, q := range c.Quests {
		entries[i] = q.Entry
	}
	if raw, err = runSQL(db, questHoldersSQL(entries)); err != nil {
		return c, err
	}
	kinds := map[string]map[int]bool{"creature": {}, "object": {}, "item": {}}
	for _, f := range batchRows(raw, 3) {
		i, ok := by[f.num(2)]
		id := f.num(1)
		if !ok || id <= 0 {
			continue
		}
		q := &c.Quests[i]
		switch f[0] {
		case "cs", "os", "ce", "oe":
			h := ChainHolder{Kind: "creature", ID: id}
			if f[0][0] == 'o' {
				h.Kind = "object"
			}
			kinds[h.Kind][id] = true
			if f[0][1] == 's' {
				q.Givers = append(q.Givers, h)
			} else {
				q.Enders = append(q.Enders, h)
			}
		case "it":
			q.Givers = append(q.Givers, ChainHolder{Kind: "item", ID: id})
			kinds["item"][id] = true
		}
	}
	names := map[string]map[int]string{"creature": {}, "object": {}, "item": {}}
	if sql := questNamesSQL(sortedKeys(kinds["creature"]), sortedKeys(kinds["object"]), sortedKeys(kinds["item"])); sql != "" {
		if raw, err = runSQL(db, sql); err != nil {
			return c, err
		}
		for _, f := range batchRows(raw, 3) {
			if m := names[f[0]]; m != nil {
				m[f.num(1)] = nullText(f[2])
			}
		}
	}
	for i := range c.Quests {
		q := &c.Quests[i]
		for _, hs := range [][]ChainHolder{q.Givers, q.Enders} {
			for j := range hs {
				hs[j].Name = names[hs[j].Kind][hs[j].ID]
			}
			sort.Slice(hs, func(a, b int) bool {
				if hs[a].Kind != hs[b].Kind {
					return hs[a].Kind < hs[b].Kind
				}
				return hs[a].ID < hs[b].ID
			})
		}
	}
	return c, nil
}

// ReadQuestChain reads the chain around quest entry for the quest editor's Chain view (#948).
func ReadQuestChain(serverRoot string, entry int) (QuestChain, error) {
	db, err := worldDatabase(serverRoot)
	if err != nil {
		return QuestChain{}, err
	}
	if err := ensureDatabase(db, serverRoot); err != nil {
		return QuestChain{}, err
	}
	return readQuestChain(db, entry)
}

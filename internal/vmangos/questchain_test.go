package vmangos

import (
	"reflect"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

// The walk goes both ways along links and through exclusive groups, and stops at the cap.
func TestChainWalk(t *testing.T) {
	// 1 → 2 → 3, 4 names 2 as its previous quest, 5 and 6 share group 9 with 3, 7 is apart.
	links := map[int][]int{1: {2}, 2: {3}, 4: {2}, 8: {7}}
	groups := map[int]int{3: 9, 5: 9, 6: 9}
	got, capped := chainWalk(2, links, groups, 80)
	if capped || !reflect.DeepEqual(got, []int{2, 1, 3, 4, 5, 6}) {
		t.Errorf("walk %v capped %v", got, capped)
	}
	got, capped = chainWalk(2, links, groups, 3)
	if !capped || len(got) != 3 {
		t.Errorf("capped walk %v capped %v", got, capped)
	}
	// A loop ends.
	if got, _ := chainWalk(1, map[int][]int{1: {2}, 2: {1}}, nil, 80); !reflect.DeepEqual(got, []int{1, 2}) {
		t.Errorf("loop walk %v", got)
	}
}

// readQuestChain on stand-in rows: the links read once, the chain's rows, givers and enders with names, and the missing link.
func TestReadQuestChain(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		switch {
		case strings.HasPrefix(sql, "SELECT t.entry, t.`PrevQuestId`"):
			if !strings.Contains(sql, "t.`ExclusiveGroup` <> 0") {
				t.Errorf("links asked %q", sql)
			}
			// 10 → 11 (next in chain), 11 after 10, 12 after 11, 12 leads to 99 (gone); 13 shares 12's group.
			return []byte("10\t0\t0\t11\t0\t0\n11\t10\t0\t0\t0\t0\n12\t11\t0\t0\t99\t-5\n13\t0\t0\t0\t0\t-5\n20\t21\t0\t0\t0\t0\n"), nil
		case strings.HasPrefix(sql, "SELECT t.entry, t.Title, t.QuestLevel, t.MinLevel"):
			if !strings.Contains(sql, "t.entry IN (11,10,12,13,99)") {
				t.Errorf("rows asked %q", sql)
			}
			return []byte("10\tFirst\t5\t3\t40\t0\t0\t11\t0\t0\n11\tSecond\t6\t4\t40\t10\t0\t0\t0\t0\n12\tThird\t14\t10\t-61\t11\t0\t0\t99\t-5\n13\tFourth\t14\t10\t40\t0\t0\t0\t0\t-5\n"), nil
		case strings.HasPrefix(sql, "SELECT DISTINCT 'cs'"):
			return []byte("cs\t100\t10\nce\t101\t10\nos\t200\t11\nit\t300\t12\nce\t100\t11\n"), nil
		case strings.HasPrefix(sql, "SELECT 'creature', t.entry"):
			if !strings.Contains(sql, "IN (100,101)") || !strings.Contains(sql, "IN (200)") || !strings.Contains(sql, "IN (300)") {
				t.Errorf("names asked %q", sql)
			}
			return []byte("creature\t100\tGiver\ncreature\t101\tEnder\nobject\t200\tBoard\n"), nil
		}
		t.Fatalf("unexpected query %s", sql)
		return nil, nil
	}
	c, err := readQuestChain(worldDB{}, 11)
	if err != nil {
		t.Fatal(err)
	}
	if c.Root != 11 || c.Capped || !reflect.DeepEqual(c.Missing, []int{99}) || len(c.Quests) != 4 {
		t.Fatalf("chain %+v", c)
	}
	a, b, d := c.Quests[0], c.Quests[1], c.Quests[2]
	if a.Title != "First" || a.MinLevel != 3 || a.Zone != 40 || !reflect.DeepEqual(a.Links, map[string]int{"NextQuestInChain": 11}) ||
		!reflect.DeepEqual(a.Givers, []ChainHolder{{"creature", 100, "Giver"}}) || !reflect.DeepEqual(a.Enders, []ChainHolder{{"creature", 101, "Ender"}}) {
		t.Errorf("quest 10 %+v", a)
	}
	if !reflect.DeepEqual(b.Givers, []ChainHolder{{"object", 200, "Board"}}) || !reflect.DeepEqual(b.Enders, []ChainHolder{{"creature", 100, "Giver"}}) {
		t.Errorf("quest 11 %+v", b)
	}
	if d.Group != -5 || d.Zone != -61 || !reflect.DeepEqual(d.Givers, []ChainHolder{{"item", 300, ""}}) || len(d.Enders) != 0 {
		t.Errorf("quest 12 %+v", d)
	}
}

// No quest asks nothing.
func TestReadQuestChainNone(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		t.Fatalf("asked %s", sql)
		return nil, nil
	}
	if c, err := readQuestChain(worldDB{}, 0); err != nil || c.Quests == nil || c.Missing == nil {
		t.Errorf("%+v, %v", c, err)
	}
}

// Against the server's world database (read only): Westfall's Defias Brotherhood chain, from its
// last quest (166) back to its first (65), with Gryan Stoutmantle giving and ending them.
func TestReadQuestChainLive(t *testing.T) {
	db, err := openWorld(testclient.ServerDir(t))
	if err != nil {
		t.Skip("no world database: " + err.Error())
	}
	c, err := readQuestChain(db, 166)
	if err != nil {
		t.Fatal(err)
	}
	has := map[int]bool{}
	for _, q := range c.Quests {
		has[q.Entry] = true
	}
	for _, e := range []int{65, 132, 135, 141, 142, 155, 166} {
		if !has[e] {
			t.Errorf("chain from 166 lacks quest %d: %v", e, has)
		}
	}
	for _, q := range c.Quests {
		if q.Entry == 166 && (len(q.Givers) == 0 || q.Givers[0].Name == "") {
			t.Errorf("quest 166 givers %+v", q.Givers)
		}
	}
}

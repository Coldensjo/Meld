package vmangos

import (
	"slices"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestParseItemSetSkipsEmptySlots(t *testing.T) {
	row := make([]any, 45)
	for i := range row {
		row[i] = 0
	}
	row[0] = 7
	row[1] = "Test Set"
	row[10], row[11], row[13] = 100, 101, 102
	row[27], row[35] = 900, 3
	row[29], row[37] = 901, 2
	row[43], row[44] = 197, 210
	d := testDBC(t, 45, row)
	s := parseItemSet(d, 0)
	if s.ID != 7 || s.Name != "Test Set" || !slices.Equal(s.Items, []int{100, 101, 102}) {
		t.Fatalf("set %+v", s)
	}
	if !slices.Equal(s.Bonuses, []ItemSetBonus{{Spell: 900, Threshold: 3}, {Spell: 901, Threshold: 2}}) {
		t.Fatalf("bonuses %+v", s.Bonuses)
	}
	if s.RequiredSkill != 197 || s.RequiredSkillRank != 210 {
		t.Fatalf("skill %+v", s)
	}
}

// TestItemSetsFromClient checks the field layout against the client's own ItemSet.dbc: Defias
// Leather (161) has five pieces and a bonus for each count from 2 to 5. It needs WOW_DIR set.
func TestItemSetsFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	sets, err := ItemSets(dataDir, []int{161, 99999999})
	if err != nil {
		t.Fatal(err)
	}
	if len(sets) != 1 {
		t.Fatalf("sets %+v", sets)
	}
	s := sets[0]
	t.Logf("161: %+v", s)
	if s.ID != 161 || s.Name != "Defias Leather" || len(s.Items) != 5 || len(s.Bonuses) == 0 {
		t.Fatalf("sets %+v", sets)
	}
	for _, b := range s.Bonuses {
		if b.Threshold < 2 || b.Threshold > 5 {
			t.Fatalf("bonus %+v", b)
		}
	}
}

package vmangos

import (
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestReaction(t *testing.T) {
	human := factionTemplate{id: 1, faction: 1, ours: 3, friendGroup: 2, enemyGroup: 12}
	orc := factionTemplate{id: 2, faction: 2, ours: 5, friendGroup: 4, enemyGroup: 10}
	monster := factionTemplate{id: 14, faction: 16, ours: 8, enemyGroup: 7}
	guard := factionTemplate{id: 11, faction: 72, ours: 3, friendGroup: 2, enemyGroup: 12}
	critter := factionTemplate{id: 31, faction: 28}
	named := factionTemplate{id: 99, faction: 99, friendGroup: 2, enemies: [4]uint32{1}}
	for _, c := range []struct {
		a, b factionTemplate
		want string
	}{
		{monster, human, "hostile"}, {monster, orc, "hostile"},
		{guard, human, "friendly"}, {guard, orc, "hostile"},
		{critter, human, "neutral"},
		{named, human, "hostile"}, // a named enemy wins over the friend group
		{factionTemplate{id: 25, faction: 25, ours: 8, friends: [4]uint32{25}}, human, "hostile"}, // the player's side is hostile to monsters
		{factionTemplate{id: 32, faction: 29, enemies: [4]uint32{28}}, human, "neutral"},
	} {
		if got := reaction(c.a, c.b); got != c.want {
			t.Errorf("template %d to %d: %s, want %s", c.a.id, c.b.id, got, c.want)
		}
	}
}

// TestClientFactions reads the client's tables: template 14 attacks both sides, 35 is friendly to
// both, 12 (Stormwind) is friendly to the Alliance and hostile to the Horde. It needs WOW_DIR.
func TestClientFactions(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	list, err := Factions(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	by := map[uint32]FactionInfo{}
	for _, f := range list {
		by[f.ID] = f
	}
	for id, want := range map[uint32][2]string{14: {"hostile", "hostile"}, 35: {"friendly", "friendly"}, 12: {"friendly", "hostile"}, 25: {"hostile", "hostile"}, 31: {"neutral", "neutral"}} {
		f := by[id]
		if f.Alliance != want[0] || f.Horde != want[1] {
			t.Errorf("template %d (%s): %s/%s, want %s/%s", id, f.Name, f.Alliance, f.Horde, want[0], want[1])
		}
	}
	t.Logf("%d templates; 12 is %q", len(list), by[12].Name)
}

func TestParseClassLevelStats(t *testing.T) {
	got := parseClassLevelStats([]byte("1\t42\t0\t1.57945\t0\n60\t3052\t0\t120.906\t3466\n"))
	if len(got) != 2 || got[1].Health != 3052 || got[1].Armor != 3466 || got[0].MeleeDamage != 1.57945 {
		t.Fatalf("got %+v", got)
	}
}

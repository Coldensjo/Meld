package vmangos

import (
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestParseCreatureSpellsSkipsEmptySlots(t *testing.T) {
	// Mograine's list 39760: two spells, then six empty slots.
	f := []string{"Scarlet Monastery - Scarlet Commander Mograine",
		"14518", "100", "1", "0", "0", "0", "6", "12", "6", "18", "0",
		"5589", "100", "1", "0", "0", "0", "7", "16", "60", "80", "0"}
	for i := 0; i < 6*len(creatureSpellColumns); i++ {
		f = append(f, "0")
	}
	name, spells, ok := parseCreatureSpells([]byte(strings.Join(f, "\t") + "\n"))
	if !ok || name != "Scarlet Monastery - Scarlet Commander Mograine" || len(spells) != 2 {
		t.Fatalf("got %q %+v %v", name, spells, ok)
	}
	if s := spells[1]; s.Spell != 5589 || s.InitialMin != 7 || s.InitialMax != 16 || s.RepeatMin != 60 || s.RepeatMax != 80 || s.CastTarget != 1 {
		t.Fatalf("spell 2 %+v", s)
	}
	if _, _, ok := parseCreatureSpells(nil); ok {
		t.Fatal("no row should not be ok")
	}
}

func TestCreatureSpellsSQL(t *testing.T) {
	fire := []CreatureSpell{{Spell: 133, Probability: 100, CastTarget: 1, InitialMin: 2, InitialMax: 4, RepeatMin: 8, RepeatMax: 12}}

	// Its own list is replaced in place and keeps its name.
	sql, list := creatureSpellsSQL(3976, CreatureSpells{ListID: 39760, Name: "Mograine", Shared: 1}, fire, 0, "Scarlet Commander Mograine")
	if list != 39760 || !strings.HasPrefix(sql, "REPLACE INTO `creature_spells` (`entry`, `name`, `spellId_1`, `probability_1`") ||
		!strings.Contains(sql, "VALUES (39760, 'Mograine', 133, 100, 1, 0, 0, 0, 2, 4, 8, 12, 0, 0,") || strings.Contains(sql, "UPDATE") {
		t.Fatalf("own list: %d\n%s", list, sql)
	}
	if n := strings.Count(sql, "`scriptId_"); n != creatureSpellSlots {
		t.Fatalf("%d slots written, want all %d", n, creatureSpellSlots)
	}

	// A shared list is left alone: the creature gets the new one.
	sql, list = creatureSpellsSQL(3976, CreatureSpells{ListID: 35020, Name: "Shared", Shared: 4}, fire, 39761, "Scarlet Commander Mograine")
	if list != 39761 || !strings.Contains(sql, "VALUES (39761, 'Scarlet Commander Mograine', 133,") ||
		!strings.HasSuffix(sql, "UPDATE `creature_template` SET `spell_list_id` = 39761 WHERE `entry` = 3976;") || strings.Contains(sql, "35020") {
		t.Fatalf("shared list: %d\n%s", list, sql)
	}

	// No list yet: a new one.
	sql, list = creatureSpellsSQL(66, CreatureSpells{}, fire, 660, "Tharynn")
	if list != 660 || !strings.Contains(sql, "SET `spell_list_id` = 660 WHERE `entry` = 66;") {
		t.Fatalf("new list: %d\n%s", list, sql)
	}

	// Emptied: its own row goes, a shared one stays, and the creature has none.
	sql, list = creatureSpellsSQL(3976, CreatureSpells{ListID: 39760, Shared: 1}, nil, 0, "x")
	if list != 0 || sql != "DELETE FROM `creature_spells` WHERE `entry` = 39760;\nUPDATE `creature_template` SET `spell_list_id` = 0 WHERE `entry` = 3976;" {
		t.Fatalf("emptied own: %d\n%s", list, sql)
	}
	sql, _ = creatureSpellsSQL(3976, CreatureSpells{ListID: 35020, Shared: 4}, nil, 0, "x")
	if sql != "UPDATE `creature_template` SET `spell_list_id` = 0 WHERE `entry` = 3976;" {
		t.Fatalf("emptied shared:\n%s", sql)
	}
	if sql, _ = creatureSpellsSQL(66, CreatureSpells{}, nil, 0, "x"); sql != "" {
		t.Fatalf("nothing to do should write nothing: %q", sql)
	}
}

func TestCheckCreatureSpells(t *testing.T) {
	ok := CreatureSpell{Spell: 133, Probability: 100, CastTarget: 1, InitialMax: 5, RepeatMax: 10}
	if err := checkCreatureSpells([]CreatureSpell{ok}); err != nil {
		t.Fatal(err)
	}
	bad := []CreatureSpell{
		{Spell: 0, Probability: 100},
		{Spell: 133, Probability: 0},
		{Spell: 133, Probability: 100, InitialMin: 9, InitialMax: 3},
		{Spell: 133, Probability: 100, RepeatMax: 70000},
	}
	for _, s := range bad {
		if checkCreatureSpells([]CreatureSpell{s}) == nil {
			t.Errorf("%+v was accepted", s)
		}
	}
	if checkCreatureSpells(make([]CreatureSpell, 9)) == nil {
		t.Error("nine spells were accepted")
	}
}

func TestFreeSpellList(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		if strings.Contains(sql, "BETWEEN 39760 AND 39769") {
			return []byte("39760\n39761\n"), nil
		}
		return []byte("200070\n"), nil
	}
	if id, err := freeSpellList(worldDB{}, 3976); err != nil || id != 39762 {
		t.Fatalf("got %d, %v", id, err)
	}
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		if strings.Contains(sql, "BETWEEN") {
			return []byte("10\n11\n12\n13\n14\n15\n16\n17\n18\n19\n"), nil
		}
		return []byte("200070\n"), nil
	}
	if id, err := freeSpellList(worldDB{}, 1); err != nil || id != 200071 {
		t.Fatalf("all ten taken: got %d, %v", id, err)
	}
}

// TestSpellRefsFromClient checks Spell.dbc's name, rank and icon fields and SpellIcon.dbc against
// the client: spell 133 is Fireball, Rank 1, with the flame bolt icon. It needs WOW_DIR set.
func TestSpellRefsFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	refs, err := SpellRefs(dataDir, []int{133, 99999999})
	if err != nil {
		t.Fatal(err)
	}
	r := refs[133]
	t.Logf("133: %+v", r)
	if len(refs) != 1 || r.Name != "Fireball" || r.Rank != "Rank 1" || !strings.Contains(strings.ToLower(r.Icon), `interface\icons\spell_fire_flamebolt`) || r.Text == "" || strings.Contains(r.Text, "$") {
		t.Fatalf("refs %+v", refs)
	}
	found, err := SearchSpells(dataDir, "fireball", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) == 0 || found[0].Name != "Fireball" {
		t.Fatalf("search: %+v", found)
	}
	byID, err := SearchSpells(dataDir, "133", 5)
	if err != nil || len(byID) == 0 || byID[0].ID != 133 {
		t.Fatalf("search by ID: %+v %v", byID, err)
	}
}

package vmangos

import (
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestSpellNoise(t *testing.T) {
	for name, want := range map[string]bool{
		"":                          true,
		"Test Fire Bolt":            true,
		"zzOLD Frost Nova":          true,
		"OLD Shadow Bolt":           true,
		"(Old) Magic Focus":         true,
		"Summon Imp (DND)":          true,
		"Fireball":                  false,
		"Old Tongue":                false,
		"Contest of Strength":       false,
		"Language: Old Tongue":      false,
		"Hammer of Justice":         false,
		"Attestation of the Shrine": false,
	} {
		if got := spellNoise(name); got != want {
			t.Errorf("spellNoise(%q) = %v, want %v", name, got, want)
		}
	}
}

// TestListSpellsFromClient checks the skill tables' layouts against the client: Fire is the mage's
// skill line 8 with Fire Blast in it, the creature abilities are most of the client's spells and
// hold no class spell, and a school narrows a list. It needs WOW_DIR set.
func TestListSpellsFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	cats, err := SpellCategories(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]SpellCategory{}
	for _, c := range cats {
		by[c.Key] = c
	}
	t.Logf("%d categories; npc %+v, all %+v, fire %+v", len(cats), by["npc"], by["all"], by["skill:8"])
	if cats[0].Key != "npc" || by["npc"].Count < 10000 || by["all"].Count <= by["npc"].Count {
		t.Fatalf("npc/all: %+v %+v", by["npc"], by["all"])
	}
	if f := by["skill:8"]; f.Name != "Mage: Fire" || f.Group != "Class skills" || f.Count < 50 {
		t.Fatalf("fire: %+v", f)
	}
	if b := by["skill:164"]; b.Name != "Blacksmithing" || b.Group != "Professions" {
		t.Fatalf("blacksmithing: %+v", b)
	}
	if p := by["skill:188"]; p.Name != "Imp" || p.Group != "Pets" {
		t.Fatalf("imp: %+v", p)
	}
	fire, err := ListSpells(dataDir, "skill:8", -1, "fire blast", 50)
	if err != nil || len(fire.Spells) == 0 || fire.Spells[0].ID != 2136 || fire.Total != len(fire.Spells) {
		t.Fatalf("fire blast: %+v %v", fire, err)
	}
	page, err := ListSpells(dataDir, "npc", -1, "", 100)
	if err != nil || len(page.Spells) != 100 || page.Total != by["npc"].Count {
		t.Fatalf("npc page: %d of %d, %v", len(page.Spells), page.Total, err)
	}
	for i, s := range page.Spells {
		if spellNoise(s.Name) {
			t.Fatalf("noise in the list: %+v", s)
		}
		if i > 0 && s.Name < page.Spells[i-1].Name && s.Name[0] != ' ' && s.Name[0] != '.' {
			t.Fatalf("not by name: %q after %q", s.Name, page.Spells[i-1].Name)
		}
	}
	if fb, _ := ListSpells(dataDir, "npc", -1, "133", 5); len(fb.Spells) != 1 || fb.Spells[0].ID != 133 {
		t.Fatalf("an ID is found in any category: %+v", fb)
	}
	if fb, _ := ListSpells(dataDir, "npc", -1, "fireball", 500); len(fb.Spells) == 0 || hasSpell(fb, 133) {
		t.Fatalf("the creature abilities hold the mage's Fireball: %+v", fb)
	}
	anySchool, _ := ListSpells(dataDir, "npc", -1, "bolt", 5000)
	frost, _ := ListSpells(dataDir, "npc", 4, "bolt", 5000)
	if frost.Total == 0 || frost.Total >= anySchool.Total {
		t.Fatalf("frost bolts %d of %d", frost.Total, anySchool.Total)
	}
	if !hasSpellNamed(frost, "Frostbolt") || hasSpellNamed(frost, "Shadow Bolt") {
		t.Fatalf("frost bolts: %+v", frost.Spells[:min(10, len(frost.Spells))])
	}
	// "every" keeps the leftovers "all" leaves out (#367).
	all, _ := ListSpells(dataDir, "all", -1, "test", 5000)
	every, _ := ListSpells(dataDir, "every", -1, "test", 5000)
	if every.Total <= all.Total {
		t.Fatalf("every %d, all %d", every.Total, all.Total)
	}
	if search, _ := SearchSpells(dataDir, "test", 5000); len(search) != every.Total {
		t.Fatalf("every %d, SearchSpells %d", every.Total, len(search))
	}
}

func hasSpell(l SpellList, id int) bool {
	for _, s := range l.Spells {
		if s.ID == id {
			return true
		}
	}
	return false
}

func hasSpellNamed(l SpellList, name string) bool {
	for _, s := range l.Spells {
		if s.Name == name {
			return true
		}
	}
	return false
}

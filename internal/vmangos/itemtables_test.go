package vmangos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSpellCategoryNames(t *testing.T) {
	// Every spell but Hearthstone has the global cooldown's category 133.
	spell := func(id, cat int, name string) []any {
		row := make([]any, spellFStartCategory+1)
		for i := range row {
			row[i] = 0
		}
		row[0], row[spellFCategory], row[spellFName] = id, cat, name
		if name != "Hearthstone" {
			row[spellFStartCategory] = 133
		}
		return row
	}
	tbl := testDBC(t, spellFStartCategory+1,
		spell(1, 4, "Healing Potion"), spell(2, 4, "Mana Potion"), spell(3, 4, "Healing Potion"),
		spell(4, 4, "Rage Potion"), spell(5, 4, "Swiftness Potion"), spell(6, 9, "Hearthstone"), spell(7, 0, "Fireball"))
	got := spellCategoryNames(tbl, spellFCategory)
	if len(got) != 2 || got[0].ID != 4 || got[1].ID != 9 {
		t.Fatalf("categories = %+v", got)
	}
	if got[0].Name != "Healing Potion, Mana Potion, Rage Potion and 1 more" || got[1].Name != "Hearthstone" {
		t.Fatalf("names = %q, %q", got[0].Name, got[1].Name)
	}
	start := spellCategoryNames(tbl, spellFStartCategory)
	if len(start) != 1 || start[0].ID != 133 || start[0].Name != "Healing Potion, Fireball, Mana Potion and 2 more" {
		t.Fatalf("global cooldown categories = %+v", start)
	}
}

func TestRandomPropertyNames(t *testing.T) {
	tbl := testDBC(t, 16, []any{5, "Bear", 1, 2, 0, 0, 0, "of the Bear"}, []any{6, "Internal"})
	got := randomPropertyNames(tbl)
	if got[5] != "of the Bear" || got[6] != "Internal" {
		t.Fatalf("got %+v", got)
	}
}

func TestEnchantments(t *testing.T) {
	props := map[int]string{1: "of the Bear", 2: "of the Eagle", 3: "of the Bear", 4: "of Power", 5: "of the Owl"}
	names := enchantmentNames("1, 2,3,99", props)
	if strings.Join(names, "|") != "of the Bear|of the Eagle|property 99" {
		t.Fatalf("names = %q", names)
	}
	if enchantmentText(nil) != "(no enchantments)" {
		t.Fatal("empty entry")
	}
	rows := []enchantmentRow{{10, enchantmentNames("1,2,4,5", props)}, {11, []string{"of Power"}}}
	got := matchEnchantments(rows, "owl", 60)
	if len(got) != 1 || got[0].ID != 10 || got[0].Name != "of the Bear, of the Eagle, of Power and 1 more" {
		t.Fatalf("owl = %+v", got)
	}
	if got := matchEnchantments(rows, "11", 60); len(got) != 1 || got[0].ID != 11 {
		t.Fatalf("11 = %+v", got)
	}
	if got := matchEnchantments(rows, "of", 1); len(got) != 1 {
		t.Fatalf("limit = %+v", got)
	}
	if q := enchantmentSQL("id = 3"); !strings.Contains(q, "item_enchantment_template") || !strings.Contains(q, "WHERE id = 3") {
		t.Fatalf("sql = %q", q)
	}
}

func TestDisenchantSQL(t *testing.T) {
	q, err := worldRefSQL("disenchant", worldRefMatch("disenchant", "dust"))
	if err != nil || !strings.Contains(q, "disenchant_loot_template") || !strings.Contains(q, "LIKE '%dust%'") {
		t.Fatalf("%q, %v", q, err)
	}
}

// TestLoadItemTablesClient reads the real client's tables (WOW_DIR, as the other client tests).
func TestLoadItemTablesClient(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	data := filepath.Join(dir, "Data")
	tt, err := LoadItemTables(data)
	if err != nil {
		t.Fatal(err)
	}
	props, err := randomProperties(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(tt.Sets) < 50 || len(tt.SpellCategories) < 50 || len(tt.Maps) < 10 || len(props) < 100 {
		t.Fatalf("too few rows: %d sets, %d categories, %d maps, %d properties", len(tt.Sets), len(tt.SpellCategories), len(tt.Maps), len(props))
	}
	t.Logf("set %+v, category %+v, map %+v", tt.Sets[0], tt.SpellCategories[0], tt.Maps[0])
}

func TestSpellEnchantmentNames(t *testing.T) {
	row := func(id int, name string) []any {
		r := make([]any, 14)
		for i := range r {
			r[i] = 0
		}
		r[0], r[13] = id, name
		return r
	}
	tbl := testDBC(t, 14, row(7, "+5 Agility"), row(2, ""), row(3, "Fiery Weapon"))
	got := spellEnchantmentNames(tbl)
	if len(got) != 3 || got[0].ID != 2 || got[0].Name != "Unnamed" || got[1].ID != 3 || got[2].Name != "+5 Agility" {
		t.Fatalf("enchantments = %+v", got)
	}
}

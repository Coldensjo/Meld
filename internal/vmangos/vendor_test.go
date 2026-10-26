package vmangos

import (
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestVendorSQLNumbersSlotsAndRefusesDuplicates(t *testing.T) {
	sql, err := vendorSQL(66, []VendorItem{{Item: 2512, MaxCount: 0}, {Item: 159, MaxCount: 5, IncrTime: 900}})
	if err != nil {
		t.Fatal(err)
	}
	want := "DELETE FROM `npc_vendor` WHERE `entry` = 66;\n" +
		"INSERT INTO `npc_vendor` (`entry`, `slot`, `item`, `maxcount`, `incrtime`, `itemflags`, `condition_id`) VALUES (66, 0, 2512, 0, 0, 0, 0);\n" +
		"INSERT INTO `npc_vendor` (`entry`, `slot`, `item`, `maxcount`, `incrtime`, `itemflags`, `condition_id`) VALUES (66, 1, 159, 5, 900, 0, 0);"
	if sql != want {
		t.Fatalf("got\n%s\nwant\n%s", sql, want)
	}
	if _, err := vendorSQL(66, []VendorItem{{Item: 159}, {Item: 159}}); err == nil {
		t.Fatal("an item listed twice was accepted")
	}
	if _, err := vendorSQL(66, []VendorItem{{Item: 159, MaxCount: 300}}); err == nil {
		t.Fatal("a stock over 255 was accepted")
	}
	sql, err = vendorSQL(66, nil)
	if err != nil || strings.Contains(sql, "INSERT") {
		t.Fatalf("an empty shop should only delete: %q %v", sql, err)
	}
}

func TestParseVendorItems(t *testing.T) {
	got := parseVendorItems([]byte("159\tRefreshing Spring Water\t1\t18084\t0\t0\t0\t0\n2512\tRough Arrow\t1\t5996\t5\t900\t0\t0\n"))
	if len(got) != 2 || got[0].Name != "Refreshing Spring Water" || got[0].DisplayID != 18084 || got[1].MaxCount != 5 || got[1].IncrTime != 900 {
		t.Fatalf("got %+v", got)
	}
}

func TestReadKeyedRow(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	var query string
	reply := "3\tBattleworn Hammer\t\tNULL\tNULL\n"
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		query = sql
		return []byte(reply), nil
	}
	cols := []TemplateColumn{{Name: "name"}, {Name: "description"}, {Name: "armor"}, {Name: "spellid_1", Nullable: true}}
	key, got, err := readKeyedRow(worldDB{}, itemTable, "patch", "", cols, "item", 2361)
	if err != nil || key != 3 || got["name"] != "Battleworn Hammer" || got["description"] != "" || got["armor"] != "NULL" || got["spellid_1"] != "" {
		t.Fatalf("got %d %v, %v", key, got, err)
	}
	if query != "SELECT `patch`, `name`, `description`, `armor`, `spellid_1` FROM `item_template` WHERE `entry` = 2361 ORDER BY `patch` DESC LIMIT 1" {
		t.Fatalf("query %q", query)
	}
	if _, _, err := readKeyedRow(worldDB{}, "spell_template", "build", "`build` <= 5875", cols, "spell", 133); err != nil ||
		query != "SELECT `build`, `name`, `description`, `armor`, `spellid_1` FROM `spell_template` WHERE `entry` = 133 AND `build` <= 5875 ORDER BY `build` DESC LIMIT 1" {
		t.Fatalf("spell query %q, %v", query, err)
	}
	reply = ""
	if _, _, err := readKeyedRow(worldDB{}, itemTable, "patch", "", cols, "item", 9); err == nil || err.Error() != "the world database has no item 9" {
		t.Fatalf("no row: %v", err)
	}
}

// TestItemIconsFromClient checks the field layout against the client's own ItemDisplayInfo.dbc:
// the Battleworn Hammer's display (8690) names an icon, and a display the client lacks is left out.
// It needs WOW_DIR set.
func TestItemIconsFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	icons, err := ItemIcons(dataDir, []int{8690, 99999999})
	if err != nil {
		t.Fatal(err)
	}
	if len(icons) != 1 || !strings.HasPrefix(strings.ToLower(icons[8690]), "inv_") {
		t.Fatalf("icons %v", icons)
	}
	t.Logf("display 8690: %s", icons[8690])
}

// TestSpellTextsFromClient checks Spell.dbc's field layout against the client's own text: spell 433
// (the Tough Hunk of Bread's) restores health over its duration. It needs WOW_DIR set.
func TestSpellTextsFromClient(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	texts, err := SpellTexts(dataDir, []int{433, 7597, 99999999})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("433: %q  7597: %q", texts[433], texts[7597])
	if len(texts) < 1 || strings.Contains(texts[433], "$") || !strings.Contains(texts[433], "Restores 61 health over 18 sec") {
		t.Fatalf("texts %v", texts)
	}
}

// TestItemOrder checks the Item Editor's sort keys: each maps to its column, descending adds
// DESC to the key only, ties break by name and entry, and an unknown key falls back to the name.
func TestItemOrder(t *testing.T) {
	for _, c := range []struct {
		sort string
		desc bool
		want string
	}{
		{"name", false, "i.name, i.entry"},
		{"name", true, "i.name DESC, i.entry"},
		{"entry", true, "i.entry DESC"},
		{"quality", true, "i.quality DESC, i.name, i.entry"},
		{"itemLevel", false, "i.item_level, i.name, i.entry"},
		{"requiredLevel", true, "i.required_level DESC, i.name, i.entry"},
		{"1; DROP TABLE item_template", false, "i.name, i.entry"},
	} {
		if got := itemOrder(c.sort, c.desc); got != c.want {
			t.Errorf("itemOrder(%q, %v) = %q, want %q", c.sort, c.desc, got, c.want)
		}
	}
}

// TestSearchItemsSortedFromDatabase checks the order of a broad search in the world database: by
// item level descending the levels never rise, and the first is at least the name order's highest.
func TestSearchItemsSortedFromDatabase(t *testing.T) {
	server := testclient.ServerDir(t)
	byLevel, err := SearchItemsSorted(server, "sword", "itemLevel", true, 100)
	if err != nil {
		t.Fatal(err)
	}
	byName, err := SearchItems(server, "sword", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(byLevel) < 10 || len(byName) < 10 {
		t.Fatalf("%d and %d swords", len(byLevel), len(byName))
	}
	for i := 1; i < len(byLevel); i++ {
		if byLevel[i].ItemLevel > byLevel[i-1].ItemLevel {
			t.Fatalf("item %d (level %d) after %d (level %d)", byLevel[i].Entry, byLevel[i].ItemLevel, byLevel[i-1].Entry, byLevel[i-1].ItemLevel)
		}
	}
	for _, r := range byName {
		if r.ItemLevel > byLevel[0].ItemLevel {
			t.Fatalf("%s (level %d) is above the first by level, %s (%d)", r.Name, r.ItemLevel, byLevel[0].Name, byLevel[0].ItemLevel)
		}
	}
	t.Logf("highest sword: %s, level %d", byLevel[0].Name, byLevel[0].ItemLevel)
}

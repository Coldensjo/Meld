package vmangos

import (
	"fmt"
	"strings"
	"testing"

	"Meld/internal/testclient"
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
		{"dps", true, itemDPS + " DESC, i.name, i.entry"},
		{"1; DROP TABLE item_template", false, "i.name, i.entry"},
	} {
		if got := itemOrder(c.sort, c.desc); got != c.want {
			t.Errorf("itemOrder(%q, %v) = %q, want %q", c.sort, c.desc, got, c.want)
		}
	}
}

// TestSearchItemsSQL checks the Item Editor's query (#966): the text matches the name (and the
// entry when it is a number), a patch narrows it to the items whose first row is that patch, an
// empty text with a patch matches every item of it, and the DPS is a weapon's only.
func TestSearchItemsSQL(t *testing.T) {
	q := searchItemsSQL("sword", "dps", true, AnyPatch, 100)
	if !strings.Contains(q, "WHERE i.name LIKE '%sword%' ORDER BY "+itemDPS+" DESC") || strings.Contains(q, "n.first =") || !strings.HasSuffix(q, "LIMIT 100") {
		t.Errorf("any patch: %s", q)
	}
	if !strings.Contains(q, "MIN(patch) AS first") || !strings.Contains(q, "i.class = 2 AND i.delay > 0") {
		t.Errorf("first patch or DPS: %s", q)
	}
	if q := searchItemsSQL("25", "name", false, 3, 100); !strings.Contains(q, "WHERE (i.name LIKE '%25%' OR i.entry = 25) AND n.first = 3 ORDER BY") {
		t.Errorf("patch 3: %s", q)
	}
	if q := searchItemsSQL("", "name", false, 0, 100); !strings.Contains(q, "WHERE n.first = 0 ORDER BY") {
		t.Errorf("patch alone: %s", q)
	}
}

// TestSearchItemsSortedFromDatabase checks the order of a broad search in the world database: by
// item level descending the levels never rise, and the first is at least the name order's highest.
func TestSearchItemsSortedFromDatabase(t *testing.T) {
	server := testclient.ServerDir(t)
	byLevel, err := SearchItemsSorted(server, "sword", "itemLevel", true, AnyPatch, 100)
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

// TestSearchItemsByPatchAndDPSFromDatabase checks the patch filter and the DPS order (#966): swords
// by DPS high to low never rise, the first is a weapon with a DPS, and a patch's items (with no
// text) all have that patch as their first row.
func TestSearchItemsByPatchAndDPSFromDatabase(t *testing.T) {
	server := testclient.ServerDir(t)
	byDPS, err := SearchItemsSorted(server, "sword", "dps", true, AnyPatch, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(byDPS) < 10 || byDPS[0].DPS <= 0 {
		t.Fatalf("%d swords, the first %+v", len(byDPS), byDPS)
	}
	for i := 1; i < len(byDPS); i++ {
		if byDPS[i].DPS > byDPS[i-1].DPS {
			t.Fatalf("item %d (%.1f DPS) after %d (%.1f DPS)", byDPS[i].Entry, byDPS[i].DPS, byDPS[i-1].Entry, byDPS[i-1].DPS)
		}
	}
	patches, err := ItemPatches(server)
	if err != nil {
		t.Fatal(err)
	}
	if len(patches) < 2 {
		t.Fatalf("patches %v", patches)
	}
	last := patches[len(patches)-1]
	items, err := SearchItemsSorted(server, "", "name", false, last, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) == 0 {
		t.Fatalf("no item of patch %d", last)
	}
	db, err := worldDatabase(server)
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range items[:min(len(items), 5)] {
		raw, err := runSQL(db, fmt.Sprintf("SELECT MIN(patch) FROM item_template WHERE entry = %d", it.Entry))
		if err != nil {
			t.Fatal(err)
		}
		if rows := batchRows(raw, 1); len(rows) != 1 || rows[0].num(0) != last {
			t.Fatalf("item %d (%s) is not first in patch %d: %q", it.Entry, it.Name, last, raw)
		}
	}
	t.Logf("best sword: %s, %.1f DPS; patches %v; %d items new in patch %d", byDPS[0].Name, byDPS[0].DPS, patches, len(items), last)
}

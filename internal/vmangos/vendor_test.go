package vmangos

import (
	"os"
	"strings"
	"testing"

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

func TestParseItemRow(t *testing.T) {
	names := []string{"entry", "name", "description", "armor"}
	got, err := parseItemRow(names, []byte("2361\tBattleworn Hammer\t\t0\n"), 2361)
	if err != nil || got["name"] != "Battleworn Hammer" || got["description"] != "" || got["armor"] != "0" {
		t.Fatalf("got %v, %v", got, err)
	}
	if _, err := parseItemRow(names, []byte(""), 9); err == nil {
		t.Fatal("no row should be an error")
	}
}

// TestItemIconsFromClient checks the field layout against the client's own ItemDisplayInfo.dbc:
// the Battleworn Hammer's display (8690) names an icon, and a display the client lacks is left out.
// It needs WOW_DIR set.
func TestItemIconsFromClient(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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

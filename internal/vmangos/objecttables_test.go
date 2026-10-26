package vmangos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLockInfos(t *testing.T) {
	// Lock 5: picked at skill 25 (lock type 1) or opened with item 1234; lock 7: no slots.
	row := make([]any, 33)
	for i := range row {
		row[i] = 0
	}
	row[0], row[1], row[2], row[9], row[10], row[17] = 5, 2, 1, 1, 1234, 25
	empty := []any{7}
	got, err := lockInfos(testDBC(t, 33, empty, row))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != 5 || got[1].ID != 7 || len(got[1].Parts) != 0 {
		t.Fatalf("locks = %+v", got)
	}
	want := []LockPart{{Type: 2, Index: 1, Skill: 25}, {Type: 1, Index: 1234}}
	if len(got[0].Parts) != 2 || got[0].Parts[0] != want[0] || got[0].Parts[1] != want[1] {
		t.Fatalf("lock 5 parts = %+v, want %+v", got[0].Parts, want)
	}
	if _, err := lockInfos(testDBC(t, 10, empty)); err == nil {
		t.Fatal("a short Lock.dbc should fail")
	}
}

func TestTaxiAndCinematicNames(t *testing.T) {
	nodes := testDBC(t, 6, []any{2, 0, 0, 0, 0, "Stormwind"}, []any{4, 0, 0, 0, 0, "Ironforge"})
	paths := testDBC(t, 4, []any{6, 2, 4, 110}, []any{9, 2, 99, 0})
	got := taxiPathNames(paths, nodes)
	if len(got) != 2 || got[0].Name != "Stormwind to Ironforge" || got[1].Name != "Stormwind to node 99" {
		t.Fatalf("taxi paths = %+v", got)
	}
	cams := testDBC(t, 2, []any{29, `Cameras\FlybyUndead.mdx`})
	seqs := testDBC(t, 10, []any{2, 0, 29}, []any{3, 0, 77})
	c := cinematicNames(seqs, cams)
	if len(c) != 2 || c[0].Name != "FlybyUndead" || c[1].Name != "Cinematic 3" {
		t.Fatalf("cinematics = %+v", c)
	}
}

func TestWorldRefSQL(t *testing.T) {
	for _, k := range []string{"gossip", "page", "text", "event", "loot", "vendor", "trainer", "equipment", "creature loot", "pickpocket loot", "skinning loot", "spell list", "gossip script", "map point", "quest start script", "quest end script", "exclusive group"} {
		q, err := worldRefSQL(k, worldRefMatch(k, "12"))
		if err != nil || !strings.Contains(q, "id = 12") {
			t.Fatalf("%s: %q, %v", k, q, err)
		}
	}
	// A creature list counts the creatures that point at it (#700); a page has no count.
	if q, _ := worldRefSQL("spell list", "TRUE"); !strings.Contains(q, "pet_spell_list_id") || !strings.Contains(q, "COUNT(DISTINCT entry)") {
		t.Fatalf("spell list uses = %q", q)
	}
	if q, _ := worldRefSQL("page", "TRUE"); !strings.HasPrefix(q, "SELECT id, name, NULL") {
		t.Fatalf("page = %q", q)
	}
	if usesText("NULL") != "" || usesText("0") != "" || usesText("1") != " · used by 1 creature" || usesText("3") != " · used by 3 creatures" {
		t.Fatal("usesText")
	}
	if _, err := worldRefSQL("spell", "TRUE"); err == nil {
		t.Fatal("an unknown kind should fail")
	}
	if m := worldRefMatch("event", "door"); m != "FALSE" {
		t.Fatalf("an event can't be searched by text: %q", m)
	}
	if m := worldRefMatch("page", "it's"); !strings.Contains(m, `LIKE '%it\'s%'`) || strings.Contains(m, "id =") {
		t.Fatalf("page match = %q", m)
	}
}

func TestFirstLine(t *testing.T) {
	if got := firstLine("  Hello there.\r\nMore"); got != "Hello there. …" {
		t.Fatalf("got %q", got)
	}
	if got := firstLine("<HTML>\n<BODY>\n<H1 align=\"center\">Eliza</H1><P>Rest here.</P></BODY></HTML>"); got != "Eliza …" {
		t.Fatalf("page got %q", got)
	}
	if got := firstLine("Just one line."); got != "Just one line." {
		t.Fatalf("got %q", got)
	}
	if got := []rune(firstLine(strings.Repeat("a", 200))); len(got) != 80 {
		t.Fatalf("long text cut to %d runes", len(got))
	}
}

// TestLoadObjectTablesClient reads the real client's tables (WOW_DIR, as the other client tests).
func TestLoadObjectTablesClient(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	tt, err := LoadObjectTables(filepath.Join(dir, "Data"))
	if err != nil {
		t.Fatal(err)
	}
	if len(tt.Locks) < 100 || len(tt.LockTypes) < 10 || len(tt.Languages) < 5 || len(tt.SpellFocus) < 50 || len(tt.TaxiPaths) < 100 || len(tt.AuctionHouses) < 3 || len(tt.Cinematics) < 3 || len(tt.PageMaterials) < 3 {
		t.Fatalf("too few rows: %d locks, %d lock types, %d languages, %d focuses, %d paths, %d houses, %d cinematics, %d materials",
			len(tt.Locks), len(tt.LockTypes), len(tt.Languages), len(tt.SpellFocus), len(tt.TaxiPaths), len(tt.AuctionHouses), len(tt.Cinematics), len(tt.PageMaterials))
	}
	t.Logf("lock 1 %+v, path %s, cinematic %s, house %s", tt.Locks[0], tt.TaxiPaths[0].Name, tt.Cinematics[0].Name, tt.AuctionHouses[0].Name)
}

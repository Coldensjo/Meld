package vmangos

import (
	"os"
	"strings"
	"testing"

	"WorldEditor/internal/wow"
)

// Rows as SHOW COLUMNS prints them: field, type, null, key, default, extra.
const showColumns = "entry\tmediumint(8) unsigned\tNO\tPRI\t0\t\n" +
	"patch\ttinyint(3) unsigned\tNO\tPRI\t0\t\n" +
	"name\tchar(100)\tNO\t\t0\t\n" +
	"subname\tchar(100)\tYES\t\tNULL\t\n" +
	"faction\tsmallint(5) unsigned\tNO\t\t0\t\n" +
	"holy_res\tsmallint(5)\tNO\t\t0\t\n" +
	"speed_walk\tfloat\tNO\t\t1\t\n" +
	"auras\ttext\tYES\t\tNULL\t\n"

func TestParseColumns(t *testing.T) {
	cols := parseColumns([]byte(showColumns))
	want := []TemplateColumn{
		{Name: "name", Kind: "text", MaxLen: 100},
		{Name: "subname", Kind: "text", Nullable: true, MaxLen: 100},
		{Name: "faction", Kind: "uint"},
		{Name: "holy_res", Kind: "int"},
		{Name: "speed_walk", Kind: "float"},
		{Name: "auras", Kind: "text", Nullable: true},
	}
	if len(cols) != len(want) {
		t.Fatalf("columns %+v", cols)
	}
	for i := range want {
		if cols[i] != want[i] {
			t.Errorf("column %d: %+v, want %+v", i, cols[i], want[i])
		}
	}
}

func TestCreatureUpdateSQL(t *testing.T) {
	cols := parseColumns([]byte(showColumns))
	sql, err := creatureUpdateSQL(cols, 42, 3, map[string]string{"name": `Bob's \ Wolf`, "subname": "", "faction": "14", "speed_walk": "1.25", "holy_res": "-5"})
	if err != nil {
		t.Fatal(err)
	}
	want := "UPDATE `creature_template` SET `faction` = 14, `holy_res` = -5, `name` = 'Bob\\'s \\\\ Wolf', `speed_walk` = 1.25, `subname` = NULL " +
		"WHERE `entry` = 42 AND `patch` = 3;"
	if sql != want {
		t.Fatalf("sql\n%s\nwant\n%s", sql, want)
	}
	for _, bad := range []map[string]string{
		{"faction": "-1"},
		{"faction": "1.5"},
		{"speed_walk": "fast"},
		{"name": strings.Repeat("x", 101)},
		{"entry": "1"},
		{"no_such": "1"},
	} {
		if _, err := creatureUpdateSQL(cols, 42, 0, bad); err == nil {
			t.Errorf("%v must be refused", bad)
		}
	}
	if sql, err := creatureUpdateSQL(cols, 42, 0, nil); err != nil || sql != "" {
		t.Fatalf("no change, no SQL: %q %v", sql, err)
	}
}

func TestCreateCreatureSQL(t *testing.T) {
	cols := parseColumns([]byte(showColumns))
	sql, err := createCreatureSQL(cols, 18200, 0, "Grub")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "VALUES (18200, 0, 'Grub', 1, 1, 14, 1, 100, 100);") {
		t.Fatalf("from scratch: %s", sql)
	}
	sql, err = createCreatureSQL(cols, 18200, 68, "Guard copy")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"INSERT INTO `creature_template` (`entry`, `patch`, `name`, `subname`, `faction`, `holy_res`, `speed_walk`, `auras`)",
		"SELECT 18200, 0, 'Guard copy', t.`subname`, t.`faction`",
		"WHERE t.`entry` = 68 ORDER BY t.`patch` DESC LIMIT 1;",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("copy lacks %q:\n%s", want, sql)
		}
	}
	if _, err := createCreatureSQL(cols, 1, 0, strings.Repeat("x", 101)); err == nil {
		t.Fatal("a name over 100 characters must be refused")
	}
}

func TestUnescapeBatch(t *testing.T) {
	in := `a\tb\nc\\d\0e`
	if got := unescapeBatch(in); got != "a\tb\nc\\d\x00e" {
		t.Fatalf("%q", got)
	}
	if got := unescapeBatch("plain"); got != "plain" {
		t.Fatalf("%q", got)
	}
}

// TestCreatureRecordsLive reads a template, searches displays and lists a model's animations from
// the server and client. It needs VMANGOS_DIR (database running) and WOW_DIR, and writes nothing.
func TestCreatureRecordsLive(t *testing.T) {
	dir, clientDir := os.Getenv("VMANGOS_DIR"), os.Getenv("WOW_DIR")
	if dir == "" || clientDir == "" {
		t.Skip("VMANGOS_DIR or WOW_DIR not set")
	}
	rec, err := ReadCreature(dir, 1642) // Northshire Guard
	if err != nil {
		t.Fatal(err)
	}
	if rec.Values["name"] != "Northshire Guard" || rec.Values["level_min"] == "" || len(rec.Columns) < 70 {
		t.Fatalf("record: %d columns, name %q", len(rec.Columns), rec.Values["name"])
	}
	dataDir, err := wow.ResolveDataDir(clientDir)
	if err != nil {
		t.Fatal(err)
	}
	displays, err := SearchDisplays(dataDir, "wolf", 50)
	if err != nil || len(displays) == 0 {
		t.Fatalf("wolf displays: %v %v", displays, err)
	}
	anims, err := ModelAnimations(dataDir, `Character\Human\Male\HumanMale.mdx`)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, a := range anims {
		names[a.Name] = true
	}
	if !names["Stand"] || !names["Walk"] || !names["Run"] {
		t.Fatalf("human male animations: %+v", anims)
	}
}

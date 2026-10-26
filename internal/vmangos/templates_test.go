package vmangos

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"Meld/internal/testclient"
	"Meld/internal/wow"
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
		{Name: "faction", Kind: "uint", Max: 65535},
		{Name: "holy_res", Kind: "int", Min: -32768, Max: 32767},
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
	sql, err := templateUpdateSQL(creatureTable, cols, 42, 3, map[string]string{"name": `Bob's \ Wolf`, "subname": "", "faction": "14", "speed_walk": "1.25", "holy_res": "-5"})
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
		{"faction": "65536"},
		{"holy_res": "-32769"},
		{"speed_walk": "fast"},
		{"name": strings.Repeat("x", 101)},
		{"entry": "1"},
		{"no_such": "1"},
	} {
		if _, err := templateUpdateSQL(creatureTable, cols, 42, 0, bad); err == nil {
			t.Errorf("%v must be refused", bad)
		}
	}
	if sql, err := templateUpdateSQL(creatureTable, cols, 42, 0, nil); err != nil || sql != "" {
		t.Fatalf("no change, no SQL: %q %v", sql, err)
	}
}

func TestCreateCreatureSQL(t *testing.T) {
	cols := parseColumns([]byte(showColumns))
	sql, err := createCreatureSQL(cols, 18200, 0, "Grub")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "`unit_class`, `faction`") || !strings.Contains(sql, "VALUES (18200, 0, 'Grub', 1, 1, 1, 14, 1, 100, 100);") {
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

func TestObjectTemplateSQL(t *testing.T) {
	cols := parseColumns([]byte("entry\tmediumint(8) unsigned\tNO\tPRI\t0\t\npatch\ttinyint(3) unsigned\tNO\tPRI\t0\t\n" +
		"type\ttinyint(3) unsigned\tNO\t\t0\t\ndisplayId\tmediumint(8) unsigned\tNO\t\t0\t\nname\tvarchar(100)\tNO\t\t\t\n" +
		"size\tfloat\tNO\t\t1\t\ndata0\tint(10)\tNO\t\t0\t\n"))
	sql, err := templateUpdateSQL(objectTable, cols, 324, 0, map[string]string{"size": "0.75", "data0": "-1", "name": "Vein"})
	if err != nil {
		t.Fatal(err)
	}
	if sql != "UPDATE `gameobject_template` SET `data0` = -1, `name` = 'Vein', `size` = 0.75 WHERE `entry` = 324 AND `patch` = 0;" {
		t.Fatalf("update: %s", sql)
	}
	if _, err := templateUpdateSQL(objectTable, cols, 324, 0, map[string]string{"type": "-3"}); err == nil {
		t.Fatal("a negative type must be refused")
	}
	sql, err = createObjectSQL(cols, 180000, 0, "Crate")
	if err != nil || sql != "INSERT INTO `gameobject_template` (`entry`, `patch`, `type`, `displayId`, `name`, `size`) VALUES (180000, 0, 5, 0, 'Crate', 1);" {
		t.Fatalf("from scratch: %s %v", sql, err)
	}
	sql, err = createObjectSQL(cols, 180000, 324, "My vein")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "INSERT INTO `gameobject_template` (`entry`, `patch`, `type`, `displayId`, `name`, `size`, `data0`) SELECT 180000, 0, t.`type`, t.`displayId`, 'My vein', t.`size`, t.`data0` FROM `gameobject_template` t WHERE t.`entry` = 324") {
		t.Fatalf("copy: %s", sql)
	}
	if _, err := createObjectSQL(cols, 1, 0, strings.Repeat("x", 101)); err == nil {
		t.Fatal("a name over 100 characters must be refused")
	}
}

func TestUnitClassAllowed(t *testing.T) {
	classes := []string{"1", "2", "8"}
	if err := unitClassAllowed(" 8", classes); err != nil {
		t.Fatal(err)
	}
	for _, v := range []string{"0", "4", ""} {
		if unitClassAllowed(v, classes) == nil {
			t.Errorf("class %q must be refused", v)
		}
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

// batchRows unescapes every field, keeps an empty last column, skips rows of another width and
// gives no rows for empty output.
func TestBatchRows(t *testing.T) {
	raw := []byte("1\t" + `Back\\slash\tTab` + "\t\r\n2\tshort\n3\tTwo\\nLines\t7\n")
	rows := batchRows(raw, 3)
	if len(rows) != 2 || rows[0][1] != `Back\slash`+"\tTab" || rows[0][2] != "" || rows[1][1] != "Two\nLines" || rows[1].num(2) != 7 {
		t.Fatalf("rows %q", rows)
	}
	if r := rows[0]; r.num(0) != 1 || r.num(9) != 0 || r.u32(0) != 1 || r.f32(9) != 0 {
		t.Fatalf("fields of %q", r)
	}
	if got := batchRows(nil, 1); len(got) != 0 {
		t.Fatalf("empty output gave %q", got)
	}
}

// TestCreatureRecordsLive reads a template, searches displays and lists a model's animations from
// the server and client. It needs VMANGOS_DIR (database running) and WOW_DIR, and writes nothing.
func TestCreatureRecordsLive(t *testing.T) {
	dir, clientDir := testclient.ServerDir(t), testclient.DataDir(t)
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
	start := time.Now()
	displays, err := ListDisplays(dir, dataDir)
	if err != nil || len(displays) < 5000 {
		t.Fatalf("displays: %d, %v", len(displays), err)
	}
	t.Logf("%d displays listed in %v", len(displays), time.Since(start))
	found := false
	for _, d := range displays {
		if d.ID == 3167 { // a Stormwind guard: dressed, used by humanoids
			found = d.Humanoid && d.Type == 7 && d.Uses > 0 && strings.Contains(d.Look, "att=") && len(d.Names) > 0
		}
	}
	if !found {
		t.Fatal("display 3167 is not listed as a dressed humanoid with its creatures")
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

func TestDisplayUses(t *testing.T) {
	uses := parseDisplayUses([]byte("10\t1\tWolf\n10\t1\tTimber Wolf\n10\t8\tPup\n11\t7\tGuard\n"))
	if u := uses[10]; u == nil || u.types[1] != 2 || u.types[8] != 1 || len(u.names) != 3 {
		t.Fatalf("display 10: %+v", uses[10])
	}
	m := humanTables(t)
	list := listDisplays(m, map[int]*displayUse{10: {types: map[int]int{7: 2, 1: 1}, names: []string{"b", "a", "c", "d"}}})
	if len(list) != 1 || list[0].ID != 10 || list[0].Type != 7 || list[0].Uses != 4 || strings.Join(list[0].Names, ",") != "a,b,c" || !list[0].Humanoid {
		t.Fatalf("list %+v", list)
	}
}

func TestObjectDisplays(t *testing.T) {
	m := &modelTables{objectDisplay: testDBC(t, 2,
		[]any{31, `World\Generic\Ore\Thorium.mdx`},
		[]any{7, `World\Generic\Chests\Chest01.mdx`},
		[]any{8, ""},
	)}
	list := listObjectDisplays(m, map[int]*displayUse{31: {types: map[int]int{3: 2, 25: 1}, names: []string{"Vein b", "Vein a", "Vein c"}}})
	if len(list) != 2 || list[0].ID != 7 || list[0].Uses != 0 || list[0].Model != `World\Generic\Chests\Chest01.mdx` {
		t.Fatalf("list %+v", list)
	}
	if v := list[1]; v.ID != 31 || v.Type != 3 || v.Uses != 3 || strings.Join(v.Names, ",") != "Vein a,Vein b,Vein c" || v.Scale != 1 {
		t.Fatalf("vein %+v", v)
	}
}

// TestEditorSavesRefuseOutOfRangeValues covers the refusals the quest, item and spell editors'
// probes used to press a real Save for (#419): the value is refused with the message the editor
// shows, before any SQL exists, so nothing reaches the database.
func TestEditorSavesRefuseOutOfRangeValues(t *testing.T) {
	cases := []struct {
		name  string
		table string
		key   string
		cols  string
		col   string
		value string
		want  string
	}{
		{"quest level", questTable, "patch", "QuestLevel\ttinyint(3) unsigned\tNO\t\t0\t\n", "QuestLevel", "300", "QuestLevel must be from 0 to 255, not 300"},
		{"item level", itemTable, "patch", "required_level\ttinyint(3) unsigned\tNO\t\t0\t\n", "required_level", "300", "required_level must be from 0 to 255, not 300"},
		{"spell cost", spellTable, "build", "manaCost\tint(10) unsigned\tNO\t\t0\t\n", "manaCost", "99999999999", "manaCost must be from 0 to 4294967295, not 99999999999"},
	}
	for _, c := range cases {
		sql, err := keyedUpdateSQL(c.table, c.key, parseColumns([]byte(c.cols)), 1, 0, map[string]string{c.col: c.value})
		if err == nil || sql != "" || err.Error() != c.want {
			t.Errorf("%s: %q, %v, want the error %q", c.name, sql, err, c.want)
		}
		if r := Refused(err); r == nil || r.Column != c.col {
			t.Errorf("%s: refused %+v, want column %s", c.name, r, c.col)
		}
	}
	// Only a refused value is one: a failure that names no column stays a plain error.
	if Refused(nil) != nil || Refused(fmt.Errorf("the world database is down")) != nil {
		t.Error("an error that refuses no value gave a column")
	}
	// The first refusal's column, the whole message.
	err := fmt.Errorf("saving: %w", errors.Join(errors.New("the server said no"), refuse("MinLevel", "MinLevel is wrong"), refuse("MaxLevel", "MaxLevel too")))
	if r := Refused(err); r == nil || r.Column != "MinLevel" || r.Message != err.Error() {
		t.Errorf("joined: %+v", r)
	}
}

func TestForgetDisplays(t *testing.T) {
	displaysMu.Lock()
	displaysCache["k"] = []DisplayEntry{{ID: 1}}
	displaysMu.Unlock()
	forgetDisplays()
	displaysMu.Lock()
	defer displaysMu.Unlock()
	if len(displaysCache) != 0 {
		t.Fatalf("display cache not cleared: %d entries", len(displaysCache))
	}
}

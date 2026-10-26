package vmangos

import (
	"strings"
	"testing"
	"time"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestParseInserts(t *testing.T) {
	script := "-- a dump\n/* note; with a semicolon */\nDELETE FROM `item_template` WHERE `entry` = 25;\n" +
		"INSERT INTO `mangos`.`item_template` (`entry`, `name`, `description`) VALUES (25, 'Worn ''Short'' Sword', \"a \\\"b\\\"\\n\"), (26,'x;y',NULL);\n" +
		"replace item_template values (27, 0, 'Bare');\n" +
		"INSERT INTO creature_template (entry) VALUES (1);\n# end\n"
	stmts, skipped, err := parseInserts(script, "item_template")
	if err != nil {
		t.Fatal(err)
	}
	if skipped != 2 || len(stmts) != 2 {
		t.Fatalf("skipped %d, %d statements", skipped, len(stmts))
	}
	a := stmts[0]
	if strings.Join(a.columns, ",") != "entry,name,description" || len(a.rows) != 2 {
		t.Fatalf("first: %+v", a)
	}
	if a.rows[0][1].text != "Worn 'Short' Sword" || a.rows[0][2].text != "a \"b\"\n" || a.rows[1][1].text != "x;y" || !a.rows[1][2].null {
		t.Fatalf("values: %+v", a.rows)
	}
	if b := stmts[1]; b.columns != nil || len(b.rows) != 1 || b.rows[0][2].text != "Bare" {
		t.Fatalf("second: %+v", b)
	}
	for _, bad := range []string{
		"INSERT INTO item_template (entry) VALUES (1",
		"INSERT INTO item_template (entry) VALUES ('open",
		"INSERT INTO item_template (entry) VALUES (1) ON DUPLICATE KEY UPDATE name = 'x';",
		"INSERT INTO item_template SELECT * FROM other;",
	} {
		if _, _, err := parseInserts(bad, "item_template"); err == nil {
			t.Errorf("%q: no error", bad)
		}
	}
}

func TestPlanImport(t *testing.T) {
	order := []string{"entry", "patch", "class", "name", "description"}
	plan, err := planScript(itemScript, "INSERT INTO item_template (entry, name, shiny) VALUES (25, 'Sword', 1);\nREPLACE INTO item_template VALUES (26, 3, 2, 'Axe', '');", order)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.rows) != 2 || len(plan.keys) != 2 || plan.keys[0].entry != 25 || plan.keys[0].key != 0 || plan.keys[1].key != 3 || plan.keys[1].name != "Axe" {
		t.Fatalf("plan %+v", plan)
	}
	if strings.Join(plan.unknown, ",") != "shiny" {
		t.Fatalf("unknown %v", plan.unknown)
	}
	cols := []TemplateColumn{
		{Name: "class", Kind: "uint", Min: 0, Max: 255},
		{Name: "name", Kind: "text", MaxLen: 255},
		{Name: "description", Kind: "text", MaxLen: 255},
	}
	sql, err := importSQL(itemScript, cols, plan.rows)
	if err != nil {
		t.Fatal(err)
	}
	want := "REPLACE INTO `item_template` (`entry`, `patch`, `name`) VALUES (25, 0, 'Sword');\n" +
		"REPLACE INTO `item_template` (`entry`, `patch`, `class`, `name`, `description`) VALUES (26, 3, 2, 'Axe', '');\n"
	if sql != want {
		t.Fatalf("sql\n%s\nwant\n%s", sql, want)
	}
	if _, err := planScript(itemScript, "REPLACE INTO item_template VALUES (1, 0);", order); err == nil {
		t.Error("a row of the wrong width was taken")
	}
	if _, err := planScript(itemScript, "DELETE FROM item_template;", order); err == nil {
		t.Error("a script without rows was taken")
	}
	plan, _ = planScript(itemScript, "INSERT INTO item_template (entry, class) VALUES (5, 300);", order)
	if _, err := importSQL(itemScript, cols, plan.rows); err == nil || !strings.Contains(err.Error(), "item 5") {
		t.Errorf("an out of range value: %v", err)
	}
}

// An exported row reads back as the same values.
func TestItemsScriptRoundTrip(t *testing.T) {
	cols := append(itemScript.keyColumns(),
		TemplateColumn{Name: "name", Kind: "text", MaxLen: 255},
		TemplateColumn{Name: "description", Kind: "text", MaxLen: 255},
		TemplateColumn{Name: "dmg_min1", Kind: "float"},
		TemplateColumn{Name: "other_team_entry", Kind: "uint", Nullable: true, Max: 1<<32 - 1})
	rows := []batchRow{{"25", "0", `It's \ "fine"`, "line\none", "2.5", "NULL"}}
	script := templateScript(itemScript, cols, rows, "", time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC))
	if !strings.Contains(script, "-- It's \\ \"fine\" (entry 25, patch 0)") {
		t.Fatalf("script:\n%s", script)
	}
	order := []string{"entry", "patch", "name", "description", "dmg_min1", "other_team_entry"}
	got, err := planScript(itemScript, script, order)
	if err != nil {
		t.Fatal(err)
	}
	r := got.rows[0]
	if r.values["name"] != `It's \ "fine"` || r.values["description"] != "line\none" || r.values["dmg_min1"] != "2.5" || !r.null["other_team_entry"] {
		t.Fatalf("read back %+v", r)
	}
}

func TestCreateItemSQL(t *testing.T) {
	cols := []TemplateColumn{{Name: "class", Kind: "uint"}, {Name: "name", Kind: "text", MaxLen: 255}}
	sql, err := createItemSQL(cols, 90001, 0, "Rusty Spoon")
	if err != nil || !strings.HasPrefix(sql, "INSERT INTO `item_template` (`entry`, `patch`, `class`") || !strings.Contains(sql, "(90001, 0, 15, 0, 'Rusty Spoon', 1, 1, 1)") {
		t.Fatalf("%s %v", sql, err)
	}
	sql, err = createItemSQL(cols, 90002, 25, "Sharp Sword")
	if err != nil || !strings.Contains(sql, "SELECT 90002, 0, t.`class`, 'Sharp Sword' FROM `item_template` t WHERE t.`entry` = 25") {
		t.Fatalf("%s %v", sql, err)
	}
	if _, err := createItemSQL(cols, 1, 0, strings.Repeat("x", 256)); err == nil {
		t.Error("a name past 255 characters was taken")
	}
}

// TestItemsLive reads an item, exports it, plans its import and dresses a character in it, from
// the server and client. It needs VMANGOS_DIR (database running) and WOW_DIR, and writes nothing.
func TestItemsLive(t *testing.T) {
	dir, clientDir := testclient.ServerDir(t), testclient.DataDir(t)
	rec, err := ReadItemTemplate(dir, 25) // Worn Shortsword
	if err != nil {
		t.Fatal(err)
	}
	if rec.Values["name"] != "Worn Shortsword" || len(rec.Columns) < 120 {
		t.Fatalf("record: %d columns, name %q", len(rec.Columns), rec.Values["name"])
	}
	script, err := ExportItems(dir, []int{25, 2092})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanItemImport(dir, script)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Items) < 2 || !plan.Items[0].Exists || len(plan.Unknown) != 0 || plan.Skipped != 0 {
		t.Fatalf("plan %+v", plan)
	}
	dataDir, err := wow.ResolveDataDir(clientDir)
	if err != nil {
		t.Fatal(err)
	}
	display := rec.Values["display_id"]
	var d int
	for _, c := range display {
		d = d*10 + int(c-'0')
	}
	look, err := ItemModelLook(dataDir, d, 13, 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v", look)
	if !look.Shown || !strings.Contains(look.Model, `Character\Human\Male`) || !strings.Contains(look.Look, "att=1") || !strings.HasPrefix(look.Item, weaponItems) {
		t.Fatalf("held look %+v", look)
	}
	// A chest piece isn't shown on the character, which still stands in.
	if look, _ := ItemModelLook(dataDir, d, 5, 2, 1); look.Shown || !strings.Contains(look.Model, `Character\Orc\Female`) {
		t.Fatalf("worn look %+v", look)
	}
	// The Robes of Arcana's look (12695) painted onto a human's body (#356).
	if look, _ := ItemModelLook(dataDir, 12695, 20, 1, 0); !look.Shown || !strings.Contains(look.Look, "Robe_B_02Blue_Chest_TU_M.blp") {
		t.Fatalf("robe look %+v", look)
	}
}

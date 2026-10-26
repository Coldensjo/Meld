package vmangos

import (
	"os"
	"strings"
	"testing"
	"time"

	"Meld/internal/wow"
)

// A spell row exported reads back as the same values, keyed by entry and build; a row without a build
// takes the table's (the client's), and an entry past spell_template's smallint is refused.
func TestSpellScriptRoundTrip(t *testing.T) {
	cols := append(spellScript.keyColumns(),
		TemplateColumn{Name: "name", Kind: "text", MaxLen: 256},
		TemplateColumn{Name: "spellIconId", Kind: "uint", Max: 1<<32 - 1},
		TemplateColumn{Name: "speed", Kind: "float"},
		TemplateColumn{Name: "spellFamilyFlags", Kind: "uint", Max: 1<<63 - 1})
	rows := []batchRow{{"133", "5875", `Fire's \ "ball"`, "185", "24", "1"}}
	script := templateScript(spellScript, cols, rows, "", time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC))
	if !strings.Contains(script, "-- Fire's \\ \"ball\" (entry 133, build 5875)") || !strings.Contains(script, "REPLACE INTO `spell_template` (`entry`, `build`, `name`") ||
		!strings.Contains(script, "spell editor (Tools > Spells)") {
		t.Fatalf("script:\n%s", script)
	}
	order := []string{"entry", "build", "name", "spellIconId", "speed", "spellFamilyFlags"}
	got, err := planScript(spellScript, script, order)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.keys) != 1 || got.keys[0].entry != 133 || got.keys[0].key != 5875 {
		t.Fatalf("keys %+v", got.keys)
	}
	r := got.rows[0]
	if r.values["name"] != `Fire's \ "ball"` || r.values["spellIconId"] != "185" || r.values["speed"] != "24" {
		t.Fatalf("read back %+v", r)
	}
	sql, err := importSQL(spellScript, cols[2:], got.rows)
	if err != nil || sql != "REPLACE INTO `spell_template` (`entry`, `build`, `name`, `spellIconId`, `speed`, `spellFamilyFlags`) VALUES (133, 5875, 'Fire\\'s \\\\ \"ball\"', 185, 24, 1);\n" {
		t.Fatalf("sql %s %v", sql, err)
	}
	plan, err := planScript(spellScript, "INSERT INTO spell_template (entry, name) VALUES (40000, 'Bolt');", order)
	if err != nil || plan.keys[0].key != spellBuild || plan.rows[0].values["build"] != "5875" {
		t.Fatalf("no build: %+v %v", plan.keys, err)
	}
	if _, err := planScript(spellScript, "INSERT INTO spell_template (entry, name) VALUES (70000, 'Bolt');", order); err == nil {
		t.Error("an entry past 65535 was taken")
	}
	if _, err := planScript(spellScript, "INSERT INTO spell_template (entry, build) VALUES (1, 70000);", order); err == nil || !strings.Contains(err.Error(), "spell 1 has build") {
		t.Errorf("a build past 65535: %v", err)
	}
}

// TestSpellScriptsLive exports Fireball (133), plans the script back and makes its Spell.dbc record
// from its row. It needs VMANGOS_DIR (database running) and WOW_DIR, and writes nothing.
func TestSpellScriptsLive(t *testing.T) {
	dir, server := os.Getenv("WOW_DIR"), os.Getenv("VMANGOS_DIR")
	if dir == "" || server == "" {
		t.Skip("WOW_DIR or VMANGOS_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	script, err := ExportSpells(server, dataDir, []int{133})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanSpellImport(server, dataDir, script)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(script, "\n-- meld icon ") || !strings.Contains(script, "\n-- meld visual ") || !strings.Contains(script, "\n-- meld kit ") {
		t.Fatalf("the script doesn't carry Fireball's look:\n%s", script)
	}
	if len(plan.Spells) == 0 || len(plan.Unknown) != 0 || plan.Skipped != 0 || len(plan.Adds) != 0 {
		t.Fatalf("plan %+v", plan)
	}
	for _, s := range plan.Spells {
		if s.Entry != 133 || s.Name != "Fireball" || !s.Exists || !s.InClient || s.Newer || s.MissingIcon != 0 || s.MissingVisual != 0 || s.NewIcon != 0 || s.NewVisual != 0 {
			t.Fatalf("row %+v", s)
		}
	}
	files, err := SpellClientFiles(server, dataDir, []int{133})
	if err != nil || len(files) != 1 || files[0].Name != SpellPath {
		t.Fatalf("files %v %v", files, err)
	}
	tb, err := parseDBC(files[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	if r, ok := tb.row(133); !ok || tb.str(r, spellFName) != "Fireball" {
		t.Fatal("Fireball's record isn't in the made Spell.dbc")
	}
}

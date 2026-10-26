package vmangos

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// dbcBytes makes a DBC of rows (32-bit fields) and a string block.
func dbcBytes(fields int, rows [][]uint32, block string) []byte {
	out := []byte("WDBC")
	out = binary.LittleEndian.AppendUint32(out, uint32(len(rows)))
	out = binary.LittleEndian.AppendUint32(out, uint32(fields))
	out = binary.LittleEndian.AppendUint32(out, uint32(fields*4))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(block)))
	for _, r := range rows {
		for _, v := range r {
			out = binary.LittleEndian.AppendUint32(out, v)
		}
	}
	return append(out, block...)
}

func TestPutRecord(t *testing.T) {
	dbc := dbcBytes(3, [][]uint32{{1, 1, 7}, {2, 0, 8}}, "\x00old\x00")
	// A new row: its strings added once, an empty one at the block's zero.
	out, err := putRecord(dbc, []uint32{5, 0, 9}, map[int]string{1: "new"})
	if err != nil {
		t.Fatal(err)
	}
	tb, err := parseDBC(out)
	if err != nil {
		t.Fatal(err)
	}
	r, ok := tb.row(5)
	if tb.records != 3 || !ok || tb.str(r, 1) != "new" || tb.u32(r, 2) != 9 {
		t.Fatalf("added: %d rows, %q", tb.records, tb.str(r, 1))
	}
	if r1, _ := tb.row(1); tb.str(r1, 1) != "old" {
		t.Fatalf("row 1 lost its string: %q", tb.str(r1, 1))
	}
	// Replacing a row keeps the count; one text in two fields is stored once.
	out, err = putRecord(out, []uint32{2, 0, 0}, map[int]string{1: "same", 2: "same"})
	if err != nil {
		t.Fatal(err)
	}
	tb, _ = parseDBC(out)
	r, _ = tb.row(2)
	if tb.records != 3 || tb.str(r, 1) != "same" || tb.u32(r, 1) != tb.u32(r, 2) {
		t.Fatalf("replaced: %d rows, %q at %d and %d", tb.records, tb.str(r, 1), tb.u32(r, 1), tb.u32(r, 2))
	}
	if _, err := putRecord(out, []uint32{1, 2}, nil); err == nil {
		t.Fatal("a short row was accepted")
	}
}

func TestSpellIconRow(t *testing.T) {
	dbc := dbcBytes(2, [][]uint32{{1, 1}, {9, 22}}, "\x00Interface\\Icons\\Temp\x00Interface\\Icons\\Spell_Fire_Fire\x00")
	id, out, err := spellIconRow(dbc, "spell_fire_fire")
	if err != nil || id != 9 || out != nil {
		t.Fatalf("existing icon: %d %v %v", id, out != nil, err)
	}
	id, out, err = spellIconRow(dbc, "INV_Misc_Gem_01")
	if err != nil || id != 10 || out == nil {
		t.Fatalf("new icon: %d %v", id, err)
	}
	tb, _ := parseDBC(out)
	if r, ok := tb.row(10); !ok || tb.str(r, 1) != `Interface\Icons\INV_Misc_Gem_01` {
		t.Fatal("the new icon's row is wrong")
	}
}

func TestSpellDBCColumns(t *testing.T) {
	if len(spellDBCColumns) != 173 {
		t.Fatalf("%d fields, want 173", len(spellDBCColumns))
	}
	// The fields the tooltip reader uses sit where it reads them.
	for f, want := range map[int]string{spellFProcChance: "procChance", spellFDuration: "durationIndex", spellFEffectDie: "effectDieSides1",
		spellFEffectBase: "effectBasePoints1", spellFAmplitude: "effectAmplitude1", spellFChain: "effectChainTarget1", spellFStack: "stackAmount",
		spellFIcon: "spellIconId", spellFVisual: "spellVisual1", spellFName: "name", spellFRank: "nameSubtext", spellFDescription: "description"} {
		if spellDBCColumns[f] != want {
			t.Errorf("field %d is %s, want %s", f, spellDBCColumns[f], want)
		}
	}
}

func TestSpellClientRow(t *testing.T) {
	cols := []TemplateColumn{{Name: "school", Kind: "int"}, {Name: "speed", Kind: "float"}, {Name: "effectBasePoints1", Kind: "int"},
		{Name: "name", Kind: "text"}, {Name: "spellFamilyFlags", Kind: "int"}, {Name: "script_name", Kind: "text"}}
	base := make([]uint32, 173)
	base[spellFIcon] = 42
	rec, strs, err := spellClientRow(900, cols, map[string]string{"school": "2", "speed": "24.5", "effectBasePoints1": "-5",
		"name": "Bolt", "spellFamilyFlags": "4294967297", "script_name": "x"}, base, 173)
	if err != nil {
		t.Fatal(err)
	}
	if rec[0] != 900 || rec[1] != 2 || math.Float32frombits(rec[37]) != 24.5 || int32(rec[spellFEffectBase]) != -5 || rec[spellFIcon] != 42 {
		t.Fatalf("fields: %v", rec[:40])
	}
	if rec[161] != 1 || rec[162] != 1 {
		t.Fatalf("family flags %d %d", rec[161], rec[162])
	}
	for l := 0; l < spellLocales; l++ {
		if strs[spellFName+l] != "Bolt" {
			t.Fatalf("locale %d of the name: %q", l, strs[spellFName+l])
		}
	}
	if len(strs) != spellLocales {
		t.Fatalf("strings %v", strs)
	}
	if _, _, err := spellClientRow(1, cols, nil, nil, 170); err == nil {
		t.Fatal("a table of 170 fields was accepted")
	}
}

func TestSpellUpdateSQL(t *testing.T) {
	sql, err := keyedUpdateSQL(spellTable, "build", []TemplateColumn{{Name: "name", Kind: "text", MaxLen: 256}}, 133, 5875, map[string]string{"name": "Big Fireball"})
	if err != nil || sql != "UPDATE `spell_template` SET `name` = 'Big Fireball' WHERE `entry` = 133 AND `build` = 5875;" {
		t.Fatalf("%s %v", sql, err)
	}
}

// TestSpellColumnsMatchClient checks spellDBCColumns field by field: for every spell both have, the
// server's row (the build it uses) written as Spell.dbc fields should equal the client's, but for
// the spells VMaNGOS corrected. It needs WOW_DIR and VMANGOS_DIR, with the world database up.
func TestSpellColumnsMatchClient(t *testing.T) {
	if testing.Short() {
		t.Skip("heavy client scan; run make test-full")
	}
	dir, server := testclient.DataDir(t), testclient.ServerDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	db, err := openWorld(server)
	if err != nil {
		t.Fatal(err)
	}
	cols, err := spellColumns(db)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = "t.`" + c.Name + "`"
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT t.`entry`, %s FROM `spell_template` t WHERE t.`build` = (SELECT MAX(`build`) FROM `spell_template` "+
		"WHERE `entry` = t.`entry` AND `build` <= %d)", strings.Join(names, ", "), spellBuild))
	if err != nil {
		t.Fatal(err)
	}
	rows := batchRows(raw, len(cols)+1)
	sb, err := readClientFile(dataDir, SpellPath)
	if err != nil {
		t.Fatal(err)
	}
	tb, err := parseDBC(sb)
	if err != nil {
		t.Fatal(err)
	}
	same := make([]int, len(spellDBCColumns))
	both := 0
	for _, f := range rows {
		var entry int
		fmt.Sscan(f[0], &entry)
		r, ok := tb.row(uint32(entry))
		if !ok {
			continue
		}
		both++
		values := map[string]string{}
		for i, c := range cols {
			values[c.Name] = f[i+1]
		}
		rec, strs, err := spellClientRow(entry, cols, values, nil, tb.fields)
		if err != nil {
			t.Fatal(err)
		}
		for i, name := range spellDBCColumns {
			if name == "" {
				same[i]++
				continue
			}
			if s, ok := strs[i]; ok {
				if i == spellFName || i == spellFRank || i == spellFDescription || i == spellFDescription+9 {
					if s == tb.str(r, i) {
						same[i]++
					}
				} else {
					same[i]++
				}
			} else if rec[i] == tb.u32(r, i) {
				same[i]++
			}
		}
	}
	t.Logf("%d spells in both", both)
	if both < 10000 {
		t.Fatalf("only %d spells in both", both)
	}
	for i, n := range same {
		if n < both*95/100 {
			t.Errorf("field %d (%s) matches in %d of %d spells", i, spellDBCColumns[i], n, both)
		}
	}
}

// TestPlanSpellLive works out a copy of Fireball (133) and a save of it with a new icon and more
// damage, against the real client and world database, and reads the Spell.dbc they would write as
// the tooltips read the client's: nothing is written. It needs WOW_DIR and VMANGOS_DIR.
func TestPlanSpellLive(t *testing.T) {
	dir, server := testclient.DataDir(t), testclient.ServerDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	made, err := PlanCreateSpell(server, dataDir, 133, "", "Meld Bolt")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("new entry %d: %s", made.Entry, made.SQL[:120])
	tb, err := parseDBC(made.File.Data)
	if err != nil {
		t.Fatal(err)
	}
	r, ok := tb.row(uint32(made.Entry))
	fire, _ := tb.row(133)
	if !ok || tb.str(r, spellFName) != "Meld Bolt" || tb.str(r, spellFRank) != "Rank 1" || tb.u32(r, spellFIcon) != tb.u32(fire, spellFIcon) ||
		tb.u32(r, spellFVisual) != tb.u32(fire, spellFVisual) || tb.str(r, spellFName+3) != "Meld Bolt" {
		t.Fatalf("the copy's row: %q %q icon %d", tb.str(r, spellFName), tb.str(r, spellFRank), tb.u32(r, spellFIcon))
	}
	if text := expandSpellText(tb.str(r, spellFDescription), tb, r, map[uint32]int{9: 4000}); !strings.Contains(text, "14 to 22 Fire damage") {
		t.Fatalf("the copy's text: %q", text)
	}
	if !strings.Contains(made.SQL, "SELECT "+fmt.Sprint(made.Entry)+", ") || !strings.Contains(made.SQL, "'Meld Bolt'") || !strings.Contains(made.SQL, "''") {
		t.Fatalf("the copy's SQL: %s", made.SQL)
	}

	saved, err := PlanSpellSave(server, dataDir, 133, 5875, map[string]string{"effectBasePoints1": "99"}, "INV_Misc_Gem_Variety_01", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("save: %s, icon added %q, %d files", saved.SQL, saved.IconAdded, len(saved.Files))
	var spell, icons []byte
	for _, f := range saved.Files {
		switch f.Name {
		case SpellPath:
			spell = f.Data
		case SpellIconPath:
			icons = f.Data
		}
	}
	if spell == nil || (saved.IconAdded != "") != (icons != nil) {
		t.Fatalf("files %d, icon added %q", len(saved.Files), saved.IconAdded)
	}
	tb, _ = parseDBC(spell)
	r, _ = tb.row(133)
	if int32(tb.u32(r, spellFEffectBase)) != 99 || tb.str(r, spellFName) != "Fireball" {
		t.Fatalf("the saved row: base %d, %q", int32(tb.u32(r, spellFEffectBase)), tb.str(r, spellFName))
	}
	if icons != nil {
		it, _ := parseDBC(icons)
		ir, ok := it.row(tb.u32(r, spellFIcon))
		if !ok || it.str(ir, 1) != `Interface\Icons\INV_Misc_Gem_Variety_01` {
			t.Fatalf("the icon row of %d", tb.u32(r, spellFIcon))
		}
	}
	// Every other spell's row is as it was.
	old, _ := parseDBC(mustClientFile(t, dataDir, SpellPath))
	if old.records != tb.records {
		t.Fatalf("%d rows, was %d", tb.records, old.records)
	}
	for i := 0; i < old.records; i++ {
		if id := old.u32(i, 0); id != 133 {
			j, _ := tb.row(id)
			for f := 0; f < old.fields; f++ {
				if spellDBCColumns[f] != "" && spellTextColumns[strings.Split(spellDBCColumns[f], "#")[0]] {
					if old.str(i, f) != tb.str(j, f) {
						t.Fatalf("spell %d field %d changed", id, f)
					}
				} else if old.u32(i, f) != tb.u32(j, f) {
					t.Fatalf("spell %d field %d changed", id, f)
				}
			}
		}
	}
}

func mustClientFile(t *testing.T, dataDir, name string) []byte {
	b, err := readClientFile(dataDir, name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestSpellStartersLive plans a spell from every starter against the real client and world database
// and reads the planned Spell.dbc row back as the tooltips do; each INSERT runs into a temporary copy
// of spell_template, so nothing is written. It needs WOW_DIR and VMANGOS_DIR.
func TestSpellStartersLive(t *testing.T) {
	if testing.Short() {
		t.Skip("heavy client scan; run make test-full")
	}
	dir, server := os.Getenv("WOW_DIR"), os.Getenv("VMANGOS_DIR")
	if dir == "" || server == "" {
		t.Skip("WOW_DIR or VMANGOS_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	db, err := openWorld(server)
	if err != nil {
		t.Fatal(err)
	}
	tables, err := ReadSpellTables(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	durations := map[uint32]int{}
	for _, d := range tables.Durations {
		durations[uint32(d.ID)] = int(d.Value)
	}
	for _, s := range SpellStarters() {
		made, err := PlanCreateSpell(server, dataDir, 0, s.ID, "Meld "+s.Name)
		if err != nil {
			t.Fatalf("%s: %v", s.ID, err)
		}
		tb, err := parseDBC(made.File.Data)
		if err != nil {
			t.Fatal(err)
		}
		r, ok := tb.row(uint32(made.Entry))
		if !ok {
			t.Fatalf("%s: no row %d", s.ID, made.Entry)
		}
		text := expandSpellText(tb.str(r, spellFDescription), tb, r, durations)
		t.Logf("%s: %d %q icon %d visual %d range %d cast %d: %s", s.ID, made.Entry, tb.str(r, spellFName), tb.u32(r, spellFIcon), tb.u32(r, spellFVisual),
			tb.u32(r, 36), tb.u32(r, 18), text)
		if tb.str(r, spellFName) != "Meld "+s.Name || strings.Contains(text, "$") || tb.u32(r, spellFVisual) == 0 || tb.u32(r, spellFIcon) <= 1 ||
			tb.u32(r, 36) == 0 || tb.u32(r, 18) == 0 || tb.u32(r, 61) == 0 || tb.u32(r, 128) == 0 {
			t.Errorf("%s: the row is incomplete", s.ID)
		}
		script := "CREATE TEMPORARY TABLE `meld_try` LIKE `spell_template`;\n" + strings.Replace(made.SQL, "`spell_template`", "`meld_try`", 1) +
			"\nSELECT COUNT(*) FROM `meld_try`;"
		if err := runScript(db, script); err != nil {
			t.Errorf("%s: the INSERT fails: %v\n%s", s.ID, err, made.SQL)
		}
	}
}

// TestSpellsWithIcon finds an icon's SpellIcon row (any case, the lowest of two) and the spells that
// show it, one per name, for the Icons tool (#683).
func TestSpellsWithIcon(t *testing.T) {
	icons := map[uint32]string{
		7:  `Interface\Icons\Spell_Fire_FlameBolt`,
		12: `INTERFACE\ICONS\spell_fire_flamebolt`,
		9:  `Interface\Icons\INV_Sword_01`,
	}
	spell := func(id, icon int, name string) []any {
		row := make([]any, spellFName+1)
		for i := range row {
			row[i] = 0
		}
		row[0], row[spellFIcon], row[spellFName] = id, icon, name
		return row
	}
	tbl := testDBC(t, spellFRank+1,
		spell(133, 7, "Fireball"),
		spell(143, 7, "Fireball"),
		spell(200, 12, "Fire Bolt"),
		spell(300, 9, "Strike"),
		spell(400, 0, "Nothing"),
	)
	id, rows, count := spellsWithIcon(icons, tbl, "spell_fire_flamebolt", 8)
	if id != 7 || count != 3 || len(rows) != 2 || tbl.u32(rows[0], 0) != 133 || tbl.u32(rows[1], 0) != 200 {
		t.Fatalf("flamebolt: id %d, count %d, rows %v", id, count, rows)
	}
	if _, rows, count := spellsWithIcon(icons, tbl, "spell_fire_flamebolt", 1); count != 3 || len(rows) != 1 {
		t.Fatalf("limit 1: count %d, rows %v", count, rows)
	}
	if id, rows, count := spellsWithIcon(icons, tbl, "INV_Axe_01", 8); id != 0 || rows != nil || count != 0 {
		t.Fatalf("unused icon: id %d, count %d, rows %v", id, count, rows)
	}
}

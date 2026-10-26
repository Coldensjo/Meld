package vmangos

import (
	"fmt"
	"strconv"
	"strings"

	"Meld/internal/mpq"
)

// The spell editor's Export and Import (#357): spells written to an SQL script of spell_template
// rows (sqlscript.go) and read back. A spell is its row and its Spell.dbc record, so an import writes
// the rows into the world database and then each imported spell's record, made from the row the
// server uses, into Spell.dbc in Meld's patch, as Save does.

// ExportSpells is an SQL script that puts spells back as they are now: every build's row of each
// entry, as REPLACE statements that name their columns, with the "-- meld" lines that carry their
// icons and visuals as the client of dataDir has them (spelllooks.go).
func ExportSpells(serverRoot, dataDir string, entries []int) (string, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return "", err
	}
	cols, err := spellColumns(db)
	if err != nil {
		return "", err
	}
	return exportScript(db, spellScript, cols, entries, func(all []TemplateColumn, rows []batchRow) (string, error) {
		set, err := mpq.OpenDataDir(dataDir)
		if err != nil {
			return "", err
		}
		defer set.Close()
		var tables [3]*dbcTable
		for i, name := range []string{SpellIconPath, SpellVisualPath, SpellVisualKitPath} {
			b, err := readOverlay(set, dataDir, name)
			if err != nil {
				return "", err
			}
			if tables[i], err = parseDBC(b); err != nil {
				return "", fmt.Errorf("%s: %w", name, err)
			}
		}
		return looksComment(all, rows, tables[0], tables[1], tables[2]), nil
	})
}

// SpellImport is what an SQL script of spells would write: its spell rows, and what of it is left
// out.
type SpellImport struct {
	Spells []SpellImportRow `json:"spells"`
	// Skipped is how many statements are not spell_template rows, which importing leaves out.
	Skipped int `json:"skipped"`
	// Unknown are columns the script names that this server's spell_template lacks, left out.
	Unknown []string `json:"unknown"`
	// Adds are the client tables importing adds rows to, for the icons and visuals the script
	// carries that the client lacks (#381).
	Adds []string `json:"adds"`
}

// SpellImportRow is one spell row of a script: its entry, build and name; whether the world database
// has that row already (Exists), which importing replaces; whether the client's Spell.dbc has the
// spell (InClient), whose record importing rewrites, else adds; whether the build is newer than the
// client's, so the server never uses the row (Newer); and whether the client lacks the row's icon
// (SpellIcon.dbc) or visual (SpellVisual.dbc), as on a client the script was not exported from when
// they were Meld's own, so the game shows no icon or draws nothing.
type SpellImportRow struct {
	Entry         int    `json:"entry"`
	Build         int    `json:"build"`
	Name          string `json:"name"`
	Exists        bool   `json:"exists"`
	InClient      bool   `json:"inClient"`
	Newer         bool   `json:"newer"`
	MissingIcon   int    `json:"missingIcon"`
	MissingVisual int    `json:"missingVisual"`
	// NewIcon and NewVisual are the IDs importing gives the row's icon and visual in this client,
	// found or added from what the script carries, when they differ from the script's (0 when not).
	NewIcon   int `json:"newIcon"`
	NewVisual int `json:"newVisual"`
}

// PlanSpellImport reads an SQL script of spells and says what importing it would write, without
// writing anything.
func PlanSpellImport(serverRoot, dataDir, script string) (SpellImport, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return SpellImport{}, err
	}
	plan, err := readScript(db, spellScript, script)
	if err != nil {
		return SpellImport{}, err
	}
	have, err := existingRows(db, spellScript, plan)
	if err != nil {
		return SpellImport{}, err
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return SpellImport{}, err
	}
	defer set.Close()
	before := make([][2]int, len(plan.rows))
	for i, r := range plan.rows {
		before[i] = [2]int{lookID(r.values["spellIconId"]), lookID(r.values["spellVisual1"])}
	}
	looks, err := planScriptLooks(set, dataDir, script, plan.rows)
	if err != nil {
		return SpellImport{}, err
	}
	// The client's tables as the import leaves them: with the rows the looks add.
	added := map[string][]byte{}
	for _, f := range looks.files {
		added[f.Name] = f.Data
	}
	tables := map[string]*dbcTable{}
	for _, name := range []string{SpellPath, SpellIconPath, SpellVisualPath} {
		b, ok := added[name]
		if !ok {
			if b, err = readOverlay(set, dataDir, name); err != nil {
				return SpellImport{}, err
			}
		}
		if tables[name], err = parseDBC(b); err != nil {
			return SpellImport{}, fmt.Errorf("%s: %w", name, err)
		}
	}
	// lacks is id when the table has no row of it (0 for none, or one it has).
	lacks := func(table, v string) int {
		id, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil || id <= 0 {
			return 0
		}
		if _, ok := tables[table].row(uint32(id)); ok {
			return 0
		}
		return id
	}
	out := SpellImport{Skipped: plan.skipped, Unknown: plan.unknown}
	for _, f := range looks.files {
		out.Adds = append(out.Adds, f.Name)
	}
	changed := func(was int, now string) int {
		if n := lookID(now); n != was {
			return n
		}
		return 0
	}
	for i, k := range plan.keys {
		_, inClient := tables[SpellPath].row(uint32(k.entry))
		row := plan.rows[i].values
		out.Spells = append(out.Spells, SpellImportRow{
			Entry: k.entry, Build: k.key, Name: k.name,
			Exists:        have[rowKey(k.entry, k.key)],
			InClient:      inClient,
			Newer:         k.key > spellBuild,
			MissingIcon:   lacks(SpellIconPath, row["spellIconId"]),
			MissingVisual: lacks(SpellVisualPath, row["spellVisual1"]),
			NewIcon:       changed(before[i][0], row["spellIconId"]),
			NewVisual:     changed(before[i][1], row["spellVisual1"]),
		})
	}
	return out, nil
}

// ImportSpellRows writes the spell rows of an SQL script into the world database, replacing rows of
// the same entry and build, and returns the entries it wrote and the client tables to write into
// Meld's patch with the icons and visuals the script carries that the client of dataDir lacks
// (spelllooks.go), the rows' IDs rewritten to theirs first. Every row is checked against the table's
// columns first, and nothing is written if one is refused. SpellClientFiles then makes their
// Spell.dbc records.
func ImportSpellRows(serverRoot, dataDir, script string) ([]int, []mpq.File, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, nil, err
	}
	cols, err := spellColumns(db)
	if err != nil {
		return nil, nil, err
	}
	plan, err := readScript(db, spellScript, script)
	if err != nil {
		return nil, nil, err
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, nil, err
	}
	looks, err := planScriptLooks(set, dataDir, script, plan.rows)
	set.Close()
	if err != nil {
		return nil, nil, err
	}
	sql, err := importSQL(spellScript, cols, plan.rows)
	if err != nil {
		return nil, nil, err
	}
	if err := runScript(db, sql); err != nil {
		return nil, nil, err
	}
	return plan.entries(), looks.files, nil
}

// SpellClientFiles is Spell.dbc (as the client will have it) with the record of each of entries made
// from the spell_template row the server uses, over the client's record of the spell, else zeros. A
// spell whose rows are all of newer builds than the client's is left alone: the server doesn't use it
// either. Nil when no spell has a row the server uses.
func SpellClientFiles(serverRoot, dataDir string, entries []int) ([]mpq.File, error) {
	if len(entries) == 0 {
		return nil, nil
	}
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	cols, err := spellColumns(db)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = strconv.Itoa(e)
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT DISTINCT `entry` FROM `spell_template` WHERE `entry` IN (%s) AND `build` <= %d ORDER BY `entry`",
		strings.Join(ids, ","), spellBuild))
	if err != nil {
		return nil, err
	}
	used := batchRows(raw, 1)
	if len(used) == 0 {
		return nil, nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	sb, err := readOverlay(set, dataDir, SpellPath)
	if err != nil {
		return nil, err
	}
	for _, f := range used {
		entry, err := strconv.Atoi(f[0])
		if err != nil {
			return nil, err
		}
		_, row, err := readSpellRow(db, cols, entry)
		if err != nil {
			return nil, err
		}
		if sb, err = spellClientFile(sb, entry, 0, cols, row); err != nil {
			return nil, fmt.Errorf("spell %d: %w", entry, err)
		}
	}
	return []mpq.File{{Name: SpellPath, Data: sb}}, nil
}

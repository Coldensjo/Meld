package main

import (
	"fmt"
	"os"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SpellTexts gives the description of each spell, its $ tokens filled in, for the Shop tab's tooltips.
func (a *App) SpellTexts(ids []int) (map[int]string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SpellTexts(dataDir, ids)
}

// SearchSpells lists the client's spells by name or ID, with their rank, icon and text, for the
// creature editor's Spells tab.
func (a *App) SearchSpells(text string) ([]vmangos.SpellRef, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchSpells(dataDir, text, 80)
}

// SpellCategories lists the categories the creature editor's Spells tab browses the client's
// spells by (#340): the creature abilities, all spells, and the class, pet and profession skill lines.
func (a *App) SpellCategories() ([]vmangos.SpellCategory, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SpellCategories(dataDir)
}

// ListSpells lists the client's spells in a category and school (-1 any), narrowed by a name or ID,
// at most limit of them with the count that matched, for the creature editor's Spells tab (#340).
func (a *App) ListSpells(category string, school int, text string, limit int) (vmangos.SpellList, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.SpellList{}, err
	}
	return vmangos.ListSpells(dataDir, category, school, text, min(max(limit, 1), 2000))
}

// SpellRefs gives each of the client's spells by ID, with its rank, icon and text.
func (a *App) SpellRefs(ids []int) (map[int]vmangos.SpellRef, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SpellRefs(dataDir, ids)
}

// ReadSpell reads a spell's spell_template row (the build the server uses), for the spell editor (#294).
func (a *App) ReadSpell(entry int) (vmangos.SpellRecord, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return vmangos.SpellRecord{}, err
	}
	return vmangos.ReadSpell(server, dataDir, entry)
}

// SpellSaved is what SaveSpell wrote: the SQL it ran, the icon it added to SpellIcon.dbc ("" for
// none), and the spell's visual and whether the composer's was added as new rows; or the value it
// refused (Refused, with a nil error and nothing written), as TemplateSaved has it.
type SpellSaved struct {
	SQL         string               `json:"sql"`
	IconAdded   string               `json:"iconAdded"`
	Visual      int                  `json:"visual"`
	VisualAdded bool                 `json:"visualAdded"`
	Refused     *vmangos.ColumnError `json:"refused,omitempty"`
}

// SaveSpell writes a spell's changed values (by column), icon (a name under Interface\Icons, "" to
// keep its own) and visual (the composer's design, nil to keep it) into its spell_template row and has
// the running world server reload its spells, then writes its whole row into Spell.dbc in Meld's patch
// (with the icon's and the visual's new rows) without closing anything: at once, or once the game has
// closed when it runs (#365), so the game has it the next time it starts.
func (a *App) SaveSpell(entry, build int, values map[string]string, icon string, visual *vmangos.VisualDesign) (SpellSaved, error) {
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return SpellSaved{}, err
	}
	plan, err := vmangos.PlanSpellSave(server, dataDir, entry, build, values, icon, visual)
	if r := vmangos.Refused(err); r != nil {
		return SpellSaved{Refused: r}, nil
	}
	if err != nil {
		return SpellSaved{}, err
	}
	if err := vmangos.SaveSpellSQL(server, plan.SQL); err != nil {
		return SpellSaved{}, err
	}
	a.reloadSpells(server)
	err = a.saveClientFiles(dataDir, plan.Files)
	vmangos.ForgetSpells()
	if err != nil {
		return SpellSaved{}, fmt.Errorf("the spell is saved in the world database, but writing it into the client's patch failed (Save again to retry): %w", err)
	}
	return SpellSaved{SQL: plan.SQL, IconAdded: plan.IconAdded, Visual: plan.Visual, VisualAdded: plan.VisualAdded}, nil
}

// CreateSpell adds a spell named name, a copy of spell base (or, for base 0, made from the starter of
// that ID), to the world database and the client's Spell.dbc (in Meld's patch, written as SaveSpell
// writes it, without closing anything), and returns its entry.
func (a *App) CreateSpell(base int, starter, name string) (int, error) {
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	plan, err := vmangos.PlanCreateSpell(server, dataDir, base, starter, name)
	if err != nil {
		return 0, err
	}
	if err := vmangos.SaveSpellSQL(server, plan.SQL); err != nil {
		return 0, err
	}
	a.reloadSpells(server)
	err = a.saveClientFiles(dataDir, []mpq.File{plan.File})
	vmangos.ForgetSpells()
	if err != nil {
		return plan.Entry, fmt.Errorf("spell %d is made in the world database, but writing it into the client's patch failed (Save it to retry): %w", plan.Entry, err)
	}
	return plan.Entry, nil
}

// ExportSpells asks where to save an SQL script of spells and writes their spell_template rows there
// (#357). Returns the path, or "" if cancelled.
func (a *App) ExportSpells(entries []int, suggested string) (string, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return "", err
	}
	script, err := vmangos.ExportSpells(server, dataDir, entries)
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Export Spells", DefaultFilename: suggested + ".sql", Filters: sqlFilters})
	if err != nil || path == "" {
		return "", err
	}
	return path, os.WriteFile(path, []byte(script), 0o644)
}

// OpenSpellsDialog asks for an SQL script of spells to import. Returns "" if cancelled.
func (a *App) OpenSpellsDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Import Spells", Filters: sqlFilters})
}

// PlanSpellImport says what importing the spells of the SQL script at path would write.
func (a *App) PlanSpellImport(path string) (vmangos.SpellImport, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return vmangos.SpellImport{}, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return vmangos.SpellImport{}, err
	}
	return vmangos.PlanSpellImport(server, dataDir, string(b))
}

// ImportSpells writes the spells of the SQL script at path into the world database (and has the
// running world server reload its spells), then each one's record, made from the row the server
// uses, into Spell.dbc in Meld's patch, as SaveSpell does, with the icons and visuals the script
// carries that the client lacks (#381). Returns their entries.
func (a *App) ImportSpells(path string) ([]int, error) {
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	entries, looks, err := vmangos.ImportSpellRows(server, dataDir, string(b))
	if err != nil {
		return nil, err
	}
	a.reloadSpells(server)
	files, err := vmangos.SpellClientFiles(server, dataDir, entries)
	if err == nil {
		err = a.saveClientFiles(dataDir, append(looks, files...))
	}
	vmangos.ForgetSpells()
	if err != nil {
		return entries, fmt.Errorf("the spells are in the world database, but writing them into the client's Spell.dbc failed (Save each one, or import again, to retry): %w", err)
	}
	return entries, nil
}

// ReadSpellVisual reads a client spell visual as the composer edits it (#361).
func (a *App) ReadSpellVisual(id int) (vmangos.VisualDesign, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.VisualDesign{}, err
	}
	return vmangos.ReadSpellVisual(dataDir, id)
}

// ListVisualEffects lists the client's spell effect models, for the composer's pickers.
func (a *App) ListVisualEffects() ([]vmangos.VisualEffect, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ListVisualEffects(dataDir)
}

// SpellStarters lists the kinds of spell New spell can start from without copying another (#360).
func (a *App) SpellStarters() []vmangos.SpellStarter {
	return vmangos.SpellStarters()
}

// SpellTables lists the client's cast times, durations, ranges and radii, for the spell editor's selects.
func (a *App) SpellTables() (vmangos.SpellTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.SpellTables{}, err
	}
	return vmangos.ReadSpellTables(dataDir)
}

// SpellsWithVisual names a few of the client's spells that use a spell visual, for the spell editor.
func (a *App) SpellsWithVisual(visual int) ([]vmangos.SpellRef, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SpellsWithVisual(dataDir, visual, 5)
}

// ReadCreatureSpells reads a creature template's spell list (creature_spells), for the Spells tab.
func (a *App) ReadCreatureSpells(entry int) (vmangos.CreatureSpells, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.CreatureSpells{}, err
	}
	return vmangos.ReadCreatureSpells(server, entry)
}

// SaveCreatureSpells sets a creature template's spell list to spells, in order, and returns its
// spell_list_id now with the SQL it ran.
func (a *App) SaveCreatureSpells(entry int, spells []vmangos.CreatureSpell) (vmangos.CreatureSpellsSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.CreatureSpellsSaved{}, err
	}
	return vmangos.SaveCreatureSpells(server, entry, spells)
}

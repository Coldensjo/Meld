package main

import (
	"os"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SearchItems lists up to 100 item templates whose name has text in it (or whose entry it is).
func (a *App) SearchItems(text string) ([]vmangos.ItemRef, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchItems(server, text, 100)
}

// SearchItemsSorted is SearchItems ordered by sort ("name", "entry", "quality", "itemLevel" or
// "requiredLevel"), descending when desc, for the Item Editor's sortable list.
func (a *App) SearchItemsSorted(text, sort string, desc bool) ([]vmangos.ItemRef, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchItemsSorted(server, text, sort, desc, 100)
}

// ReadItem reads an item template's row, every column by name, for the Shop tab's tooltips.
func (a *App) ReadItem(entry int) (map[string]string, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadItem(server, entry)
}

// ItemIcons gives the inventory icon (a name under Interface\Icons) of each item display.
func (a *App) ItemIcons(displays []int) (map[int]string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ItemIcons(dataDir, displays)
}

// ItemSets gives the client's item sets (ItemSet.dbc) of the given IDs, for the tooltips' set block (#355).
func (a *App) ItemSets(ids []int) ([]vmangos.ItemSet, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ItemSets(dataDir, ids)
}

// ReadItemTemplate reads an item template's row (its newest patch) for the item editor (#353).
func (a *App) ReadItemTemplate(entry int) (vmangos.TemplateRecord, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.TemplateRecord{}, err
	}
	return vmangos.ReadItemTemplate(server, entry)
}

// SaveItem writes an item template's changed values (by column) into the world database and
// returns the SQL it ran, or the value it refused.
func (a *App) SaveItem(entry, patch int, values map[string]string) (TemplateSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return TemplateSaved{}, err
	}
	sql, err := vmangos.SaveItem(server, entry, patch, values)
	if err == nil {
		a.stale.AddItem(uint32(entry))
		a.forgetStale()
	}
	return templateSaved(sql, err)
}

// CreateItem adds an item named name, a copy of item base (or a plain junk item for 0), and returns
// its entry.
func (a *App) CreateItem(base int, name string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateItem(server, base, name)
}

// ListItemKinds lists the kinds of item (class, subclass, inventory type) the world database has, for
// the item editor's New item.
func (a *App) ListItemKinds() ([]vmangos.ItemKind, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ListItemKinds(server)
}

// CreateItemOfKind adds an item named name of a kind, with the usual basics of that kind's items and
// no stats, and returns its entry.
func (a *App) CreateItemOfKind(class, subclass, invType int, name string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateItemOfKind(server, vmangos.ItemKind{Class: class, Subclass: subclass, InvType: invType}, name)
}

// ItemModelLook is an item display on a character of race and sex (0 male, 1 female) as an item of
// inventory type invType is held or worn, and the item's model alone.
func (a *App) ItemModelLook(display, invType, race, sex int) (vmangos.ItemLook, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.ItemLook{}, err
	}
	return vmangos.ItemModelLook(dataDir, display, invType, race, sex)
}

// ListItemDisplays lists the client's item displays with their icons and the items that use them,
// for the item editor's look picker.
func (a *App) ListItemDisplays() ([]vmangos.ItemDisplayEntry, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	return vmangos.ListItemDisplays(server, dataDir)
}

// ListItemIcons lists the client's icons (names under Interface\Icons), for the item editor's icon picker.
func (a *App) ListItemIcons() ([]string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ListItemIcons(dataDir)
}

// ItemDisplayVariant is the item display showing display's model with icon ("" keeps its own) and
// shot visual (-1 keeps its own). When the client has none, it is added to ItemDisplayInfo.dbc in
// Meld's patch (the game closed around it on Windows); added says so.
func (a *App) ItemDisplayVariant(display int, icon string, visual int) (vmangos.IconDisplay, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.IconDisplay{}, err
	}
	id, dbc, err := vmangos.ItemDisplayVariant(dataDir, display, icon, visual)
	if err != nil || dbc == nil {
		return vmangos.IconDisplay{ID: id}, err
	}
	if _, err := a.installClientFiles(dataDir, []mpq.File{{Name: vmangos.ItemDisplayPath, Data: dbc}}); err != nil {
		return vmangos.IconDisplay{}, err
	}
	vmangos.ForgetItemDisplays()
	return vmangos.IconDisplay{ID: id, Added: true}, nil
}

// EquipBonuses lists the bonuses an item's Equip effect can give (healing, spell damage, crit…) with
// the client's spell for each amount, for the item editor's Stats tab.
func (a *App) EquipBonuses() ([]vmangos.EquipBonusKind, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	return vmangos.EquipBonuses(server, dataDir)
}

var sqlFilters = []runtime.FileFilter{{DisplayName: "SQL script (*.sql)", Pattern: "*.sql"}}

// ExportItems asks where to save an SQL script of items and writes their item_template rows there.
// Returns the path, or "" if cancelled.
func (a *App) ExportItems(entries []int, suggested string) (string, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return "", err
	}
	script, err := vmangos.ExportItems(server, entries)
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Export Items", DefaultFilename: suggested + ".sql", Filters: sqlFilters})
	if err != nil || path == "" {
		return "", err
	}
	return path, os.WriteFile(path, []byte(script), 0o644)
}

// OpenItemsDialog asks for an SQL script of items to import. Returns "" if cancelled.
func (a *App) OpenItemsDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Import Items", Filters: sqlFilters})
}

// PlanItemImport says what importing the items of the SQL script at path would write.
func (a *App) PlanItemImport(path string) (vmangos.ItemImport, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.ItemImport{}, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return vmangos.ItemImport{}, err
	}
	return vmangos.PlanItemImport(server, string(b))
}

// ImportItems writes the items of the SQL script at path into the world database and returns their
// entries.
func (a *App) ImportItems(path string) ([]int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	entries, err := vmangos.ImportItems(server, string(b))
	if err == nil {
		for _, e := range entries {
			a.stale.AddItem(uint32(e))
		}
		a.forgetStale()
	}
	return entries, err
}

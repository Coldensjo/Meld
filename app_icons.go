package main

import (
	"errors"
	"fmt"
	"os"

	"Meld/internal/vmangos"
)

// Icons from PNG files and back (#364): the icon pickers' Import PNG… and Export PNG….

// clientOverlay reads an icon or a sound (#684) waiting for the game to close, for the asset
// server's previews and Play buttons.
func (a *App) clientOverlay(path string) ([]byte, bool) {
	icon, sound := vmangos.IsIconPath(path), vmangos.IsSoundPath(path)
	if !icon && !sound || !vmangos.AnyPending() {
		return nil, false
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, false
	}
	if sound {
		return vmangos.PendingSound(dataDir, path)
	}
	return vmangos.PendingIcon(dataDir, path)
}

// OpenIconsDialog asks for the PNG files to add as icons. Returns none if cancelled.
func (a *App) OpenIconsDialog() ([]string, error) {
	return a.openFiles(dialogOptions{
		Title:   "Import Icons",
		Filters: imageFilters,
	})
}

// IconsImported is what ImportIcons added: the icons' names, the files refused with the reason, and
// whether the icons wait for the game to close before the patch has them.
type IconsImported struct {
	Names   []string `json:"names"`
	Refused []string `json:"refused"`
	Waiting bool     `json:"waiting"`
}

// ImportIcons adds the PNG files at paths to the client as icons under Interface\Icons, each named
// after its file, in Meld's patch without closing anything (as the spell editor saves, #365): at once,
// or once the game has closed. The game shows them from its next start.
func (a *App) ImportIcons(paths []string) (IconsImported, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return IconsImported{}, err
	}
	var res IconsImported
	var srcs []vmangos.IconSource
	for _, p := range paths {
		name, err := vmangos.IconName(p)
		if err != nil {
			res.Refused = append(res.Refused, err.Error())
			continue
		}
		data, err := os.ReadFile(p)
		if err != nil {
			res.Refused = append(res.Refused, fmt.Sprintf("%s: %v", name, err))
			continue
		}
		srcs = append(srcs, vmangos.IconSource{Name: name, PNG: data})
	}
	if len(srcs) == 0 {
		if len(res.Refused) == 0 {
			return res, errors.New("no PNG files were given")
		}
		return res, nil
	}
	files, names, refused, err := vmangos.PlanIconImport(dataDir, srcs)
	if err != nil {
		return IconsImported{}, err
	}
	res.Refused = append(res.Refused, refused...)
	if len(files) == 0 {
		return res, nil
	}
	res.Waiting = a.gameRunning()
	if err := a.saveClientFiles(dataDir, files); err != nil {
		return IconsImported{}, err
	}
	vmangos.ForgetIcons()
	res.Names = names
	return res, nil
}

// ExportIconsDialog asks for the folder to save icons in. Returns "" if cancelled.
func (a *App) ExportIconsDialog() (string, error) {
	return a.openDirectory(dialogOptions{Title: "Export Icons as PNG", CanCreateDirectories: true})
}

// IconsExported is what ExportIcons wrote: how many PNG files, and the icons it could not read.
type IconsExported struct {
	Written int      `json:"written"`
	Failed  []string `json:"failed"`
}

// ExportIcons saves the icons named names (under Interface\Icons) as PNG files in dir, <name>.png.
func (a *App) ExportIcons(names []string, dir string) (IconsExported, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return IconsExported{}, err
	}
	n, failed, err := vmangos.ExportIcons(dataDir, names, dir)
	return IconsExported{Written: n, Failed: failed}, err
}

// SpellsWithIcon gives an icon's SpellIcon.dbc ID and a few of the spells that show it, for the
// Icons tool (#683).
func (a *App) SpellsWithIcon(name string) (vmangos.IconSpells, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.IconSpells{}, err
	}
	return vmangos.SpellsWithIcon(dataDir, name, 8)
}

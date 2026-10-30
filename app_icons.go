package main

import (
	"errors"
	"fmt"

	"Meld/internal/vmangos"
)

// Icons from PNG files and back (#364): the icon pickers' Import PNG… and Export PNG…, and the Icons
// tool's Replace… and Delete… (#717).

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

// IconsImported is what ImportIconPictures added: the icons' names, the pictures refused with the
// reason, and whether the icons wait for the game to close before the patch has them.
type IconsImported struct {
	Names   []string `json:"names"`
	Refused []string `json:"refused"`
	Waiting bool     `json:"waiting"`
}

// IconPicture is a picture the page made into an icon (#717): its name under Interface\Icons and its
// wow.IconSize square RGBA pixels, fitted, framed and backed as the import step chose.
type IconPicture struct {
	Name   string `json:"name"`
	Pixels []byte `json:"pixels"`
}

// ImportIconPictures adds the pictures to the client as icons under Interface\Icons, in Meld's patch
// without closing anything (as the spell editor saves, #365): at once, or once the game has closed.
// The game shows them from its next start. A name the client has outside Meld's patch is refused
// unless replace is set (the Icons tool's Replace…, #717), which overrides the client's icon.
func (a *App) ImportIconPictures(pics []IconPicture, replace bool) (IconsImported, error) {
	if len(pics) == 0 {
		return IconsImported{}, errors.New("no pictures were given")
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return IconsImported{}, err
	}
	srcs := make([]vmangos.IconSource, len(pics))
	for i, p := range pics {
		srcs[i] = vmangos.IconSource{Name: p.Name, Pixels: p.Pixels}
		if p.Pixels == nil {
			srcs[i].Pixels = []byte{}
		}
	}
	var res IconsImported
	files, names, refused, err := vmangos.PlanIconImport(dataDir, srcs, replace)
	if err != nil {
		return IconsImported{}, err
	}
	res.Refused = refused
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

// IconState says whether the icon named name is in Meld's patch (or waits for it) and in the client's
// own archives, for the Icons tool's Delete (#717).
func (a *App) IconState(name string) (vmangos.IconState, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.IconState{}, err
	}
	return vmangos.ReadIconState(dataDir, name)
}

// IconDeleted is what DeleteIcon did: whether the client's own icon of that name shows again.
type IconDeleted struct {
	Restored bool `json:"restored"`
}

// DeleteIcon takes the icon named name out of Meld's patch (#717), and drops it if it waits for the
// game to close. Only an icon Meld added or replaced can go: the client's own archives are never
// written, so deleting a replaced icon brings the client's picture back. A patch the game holds open
// can't be written again without it, so with the icon in the patch the game must be closed first.
func (a *App) DeleteIcon(name string) (IconDeleted, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return IconDeleted{}, err
	}
	st, err := vmangos.ReadIconState(dataDir, name)
	if err != nil {
		return IconDeleted{}, err
	}
	if !st.InPatch && !st.Waiting {
		return IconDeleted{}, fmt.Errorf("%s is one of the client's own icons, which Meld never removes: only an icon Meld added or replaced can be deleted", name)
	}
	// The probes' throwaway client has a patch of its own, which the game never holds.
	if st.InPatch && !a.sandboxed() && a.gameRunning() {
		return IconDeleted{}, errors.New("the game has Meld's patch open: close it, then delete the icon")
	}
	path := vmangos.IconPath(name)
	if st.InPatch {
		if _, err := vmangos.RemovePatchFiles(dataDir, []string{path}); err != nil {
			return IconDeleted{}, err
		}
	} else if _, err := vmangos.DropPendingFiles(dataDir, []string{path}); err != nil {
		return IconDeleted{}, err
	}
	a.emitPending(dataDir)
	vmangos.ForgetIcons()
	return IconDeleted{Restored: st.InClient}, nil
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

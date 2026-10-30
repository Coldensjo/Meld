package main

import (
	"errors"
	"path/filepath"
	"strings"

	"Meld/internal/wow"
)

// Another client's models and textures (#858): Tools › Import from Another Client… opens a second
// client read-only (a.other, served at /wowx/* as the current one is at /wow/*), shows its assets as
// thumbnails, and copies the chosen ones with every file they need into the current client's patch.
// The other clients are a list in the preferences (a name and a folder each); one is open at a time.

// otherPrefix is where the other client's asset server answers: /wowx/model is its /wow/model.
const otherPrefix = "/wowx/"

// BrowseOtherClient asks for another client's folder. Returns "" if cancelled.
func (a *App) BrowseOtherClient() (string, error) {
	return a.openDirectory(dialogOptions{Title: "Select another World of Warcraft 1.x client folder"})
}

// OpenOtherClient opens the client at path read-only as the one to import from, closing the one
// open before; "" closes it, freeing what was decoded from it. The current client can't be opened
// as the other one.
func (a *App) OpenOtherClient(path string) (wow.Status, error) {
	if path != "" {
		data, err := wow.ResolveDataDir(path)
		if err != nil {
			return wow.Status{Path: path, Error: err.Error()}, err
		}
		if cur, err := a.clientDataDir(); err == nil && samePath(cur, data) {
			err := errors.New("that is the current client: pick another one")
			return wow.Status{Path: path, Error: err.Error()}, err
		}
	}
	err := a.other.Open(path)
	return a.other.Status(), err
}

// OtherClientStatus is the other client's status: its folder, and whether it is open.
func (a *App) OtherClientStatus() wow.Status {
	return a.other.Status()
}

// samePath says whether two folders are the same, as the OS compares names (no case on Windows).
func samePath(x, y string) bool {
	x, y = filepath.Clean(x), filepath.Clean(y)
	if filepath.Separator == '\\' {
		return strings.EqualFold(x, y)
	}
	return x == y
}

// AssetsImported is what ImportOtherAssets did (wow.ImportPlan, less the files): the assets copied,
// those the current client has already and those refused (with the refused ones whose own file the
// current client has a different copy of apart, for the dialog's Replace), the needed files kept as
// the current client has them, those neither client has and those written over the current client's
// copy, how many files and bytes it wrote, and whether they wait for the game to close before the
// patch has them.
type AssetsImported struct {
	Imported []string `json:"imported"`
	Present  []string `json:"present"`
	Refused  []string `json:"refused"`
	Differs  []string `json:"differs"`
	Kept     []string `json:"kept"`
	Missing  []string `json:"missing"`
	Replaced []string `json:"replaced"`
	Files    int      `json:"files"`
	Bytes    int64    `json:"bytes"`
	Waiting  bool     `json:"waiting"`
}

// ImportOtherAssets copies the other client's assets at paths (models, buildings, tilesets), with
// every file each needs, into the current client's patch under the same paths, without closing the
// game: at once, or once it has closed (#661). A file the current client has a different copy of is
// replaced only as opts allow (wow.PlanImport, #878).
func (a *App) ImportOtherAssets(paths []string, opts wow.ImportOptions) (AssetsImported, error) {
	if !a.other.Status().Loaded {
		return AssetsImported{}, errors.New("no other client is open")
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return AssetsImported{}, err
	}
	if !a.wow.Status().Loaded {
		return AssetsImported{}, errors.New("the current client isn't loaded")
	}
	plan, err := wow.PlanImport(a.other, a.wow, paths, opts)
	if err != nil {
		return AssetsImported{}, err
	}
	// Lists, never null, for the page.
	list := func(s []string) []string { return append([]string{}, s...) }
	res := AssetsImported{
		Imported: list(plan.Imported), Present: list(plan.Present), Refused: list(plan.Refused), Differs: list(plan.Differs),
		Kept: list(plan.Kept), Missing: list(plan.Missing), Replaced: list(plan.Replaced),
		Files: len(plan.Files), Bytes: plan.Bytes,
	}
	if len(plan.Files) == 0 {
		return res, nil
	}
	_, res.Waiting, err = a.queueClientFiles(dataDir, plan.Files)
	if err != nil {
		return AssetsImported{}, err
	}
	return res, nil
}

package vmangos

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// Icons the author adds to the client from PNG files, and the client's icons saved as PNG files
// (#364). An added icon is a BLP under Interface\Icons in Meld's patch, written as the spell editor's
// tables are (at once, or once the game has closed); the icon pickers list it with the client's, and
// a spell or item that takes it adds its SpellIcon.dbc or ItemDisplayInfo.dbc row as for any icon.

// IconDir is the client's folder of spell and item icons.
const IconDir = `Interface\Icons\`

// IconPath is the file of the icon named name.
func IconPath(name string) string { return IconDir + name + ".blp" }

var iconNameRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// CheckIconName says whether name can be an added icon's (the file's name under Interface\Icons):
// letters, digits, _ and - only, as the client names its icons (INV_Misc_Bag_07), and at most 100.
func CheckIconName(name string) error {
	if !iconNameRe.MatchString(name) {
		return errors.New("an icon's name takes only letters, digits, _ and -")
	}
	if len(name) > 100 {
		return errors.New("the name is longer than 100 letters")
	}
	return nil
}

// IconSource is a picture to add as an icon: a PNG file's bytes, or an IconSize square RGBA picture
// the page made (Pixels, #717: fitted, framed and backed there).
type IconSource struct {
	Name   string
	PNG    []byte
	Pixels []byte
}

// PlanIconImport makes the patch files of the icons to add, and the names they take. An icon is
// refused (with the reason, in refused) when its name or picture isn't one an icon can be made of, or,
// unless replace is set, when the client has an icon of its name outside Meld's patch: an import keeps
// the client's own icons, while one added earlier is replaced, so an icon drawn again can be imported
// again under its name. With replace (the Icons tool's Replace…, #717) a client's icon is overridden
// by one in Meld's patch, which the game reads before its own archives; deleting it from the patch
// brings the client's back.
func PlanIconImport(dataDir string, srcs []IconSource, replace bool) (files []mpq.File, names, refused []string, err error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, nil, nil, err
	}
	defer set.Close()
	seen := map[string]bool{}
	for _, s := range srcs {
		key := strings.ToLower(s.Name)
		if err := CheckIconName(s.Name); err != nil {
			refused = append(refused, s.Name+": "+err.Error())
			continue
		}
		switch {
		case seen[key]:
			refused = append(refused, s.Name+": two pictures give this name")
			continue
		case !replace && clientHasIcon(set, s.Name):
			refused = append(refused, s.Name+": the client has an icon of this name (rename it, or pick that icon in Tools › Icons and use Replace…)")
			continue
		}
		var blp []byte
		if s.Pixels != nil {
			blp, err = wow.IconFromPixels(s.Pixels)
		} else {
			blp, err = wow.IconFromPNG(s.PNG)
		}
		if err != nil {
			refused = append(refused, s.Name+": "+err.Error())
			continue
		}
		seen[key] = true
		files = append(files, mpq.File{Name: IconPath(s.Name), Data: blp})
		names = append(names, s.Name)
	}
	return files, names, refused, nil
}

// IconState says where an icon is: in Meld's patch, waiting for the game to close before the patch
// has it, and in the client's own archives (outside Meld's patch). Only an icon in the patch or
// waiting can be deleted (#717); deleting one the client has too brings the client's picture back.
type IconState struct {
	InPatch  bool `json:"inPatch"`
	Waiting  bool `json:"waiting"`
	InClient bool `json:"inClient"`
}

// ReadIconState is the IconState of the icon named name.
func ReadIconState(dataDir, name string) (IconState, error) {
	if !iconNameOK(name) {
		return IconState{}, fmt.Errorf("%q is not an icon's name", name)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return IconState{}, err
	}
	defer set.Close()
	path := IconPath(name)
	var st IconState
	st.InClient = clientHasIcon(set, name)
	_, st.Waiting = pendingFile(dataDir, path)
	if a, err := mpq.Open(filepath.Join(dataDir, PatchName)); err == nil {
		st.InPatch = a.Has(path)
		_ = a.Close()
	}
	return st, nil
}

// clientHasIcon says whether an archive other than Meld's patch has the icon named name.
func clientHasIcon(set *mpq.Set, name string) bool {
	_, err := set.ReadFileExcept(IconPath(name), PatchName)
	return err == nil
}

// ForgetIcons drops the icon list, after icons were added.
func ForgetIcons() {
	itemDisplaysMu.Lock()
	clear(itemIconListCache)
	itemDisplaysMu.Unlock()
}

// pendingFileNames are the paths of the client files waiting for the game to close.
func pendingFileNames(dataDir string) []string {
	pending, err := PendingFiles(dataDir)
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(pending))
	for _, f := range pending {
		names = append(names, f.Name)
	}
	return names
}

// PendingIcon is the data of an icon file (a path under Interface\Icons) waiting for the game to
// close, so Meld's previews show an added icon before the patch has it.
func PendingIcon(dataDir, path string) ([]byte, bool) {
	if !IsIconPath(path) {
		return nil, false
	}
	return pendingFile(dataDir, strings.ReplaceAll(path, "/", `\`))
}

// IsIconPath says whether a client file is in the icons' folder.
func IsIconPath(path string) bool {
	return len(path) > len(IconDir) && strings.EqualFold(strings.ReplaceAll(path[:len(IconDir)], "/", `\`), IconDir)
}

// ExportIcons writes the icons named names into dir as PNG files (<name>.png, alpha kept), as the game
// will show them (an added icon waiting for the game to close included), and returns how many it
// wrote and the names it could not read.
func ExportIcons(dataDir string, names []string, dir string) (int, []string, error) {
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return 0, nil, fmt.Errorf("%s is not a folder", dir)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return 0, nil, err
	}
	defer set.Close()
	n := 0
	var failed []string
	for _, name := range names {
		if !iconNameOK(name) {
			failed = append(failed, name)
			continue
		}
		blp, err := readOverlay(set, dataDir, IconPath(name))
		if err != nil {
			failed = append(failed, name)
			continue
		}
		data, err := wow.IconPNG(blp)
		if err != nil {
			failed = append(failed, name)
			continue
		}
		if err := os.WriteFile(filepath.Join(dir, name+".png"), data, 0o644); err != nil {
			return n, failed, err
		}
		n++
	}
	if n == 0 && len(failed) > 0 {
		return 0, failed, errors.New("none of the icons could be read")
	}
	return n, failed, nil
}

// iconNameOK says whether name is a single file name (a client icon's can hold spaces and other
// marks, but no folder).
func iconNameOK(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "\\/:*?\"<>|\x00")
}

package clientbuild

import (
	"bufio"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// PatchName is the archive in the Data folder that Meld writes its edits into for a client of build
// b (#1065). 1.12.1 and 2.4.3 ship patch.MPQ and patch-2.MPQ only, so Meld's is patch-3.MPQ, which
// VMaNGOS's and CMaNGOS's extractors read once patched (cmangosmaps.go). 3.3.5a ships its own
// patch-3.MPQ, so Meld's is patch-4.MPQ there: the client loads it above patch-3.MPQ and every locale
// archive (DBCs included, mpq.laterPriority), and TrinityCore's and AzerothCore's map extractors list
// it in CONF_mpq_list. An unknown build is read as 1.12.
func (b Build) PatchName() string {
	if b == WotLK {
		return "patch-4.MPQ"
	}
	return "patch-3.MPQ"
}

// PatchFor is the name of Meld's patch in the client whose Data folder is dataDir, by its build.
func PatchFor(dataDir string) string { return Detect(dataDir).Build.PatchName() }

// Locale is the name of the locale folder in the Data folder dataDir (enUS, deDE, ...): the one that
// holds locale-<name>.MPQ, which 2.4.3 and 3.3.5a ship and 1.12 does not, so "" for a 1.12 client.
// With several, the one WTF\Config.wtf's SET locale names wins, else the first by name.
func Locale(dataDir string) string {
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return ""
	}
	var found []string
	for _, e := range entries {
		if e.IsDir() && holds(filepath.Join(dataDir, e.Name()), "locale-"+e.Name()+".mpq") {
			found = append(found, e.Name())
		}
	}
	if len(found) == 0 {
		return ""
	}
	sort.Slice(found, func(i, j int) bool { return strings.ToLower(found[i]) < strings.ToLower(found[j]) })
	if want := configLocale(filepath.Dir(dataDir)); want != "" {
		for _, f := range found {
			if strings.EqualFold(f, want) {
				return f
			}
		}
	}
	return found[0]
}

// holds reports whether dir has a file named name, in any case.
func holds(dir, name string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() && strings.EqualFold(e.Name(), name) {
			return true
		}
	}
	return false
}

// configLocale is the locale the client root's WTF\Config.wtf sets (SET locale "enUS"), or "".
func configLocale(root string) string {
	f, err := os.Open(filepath.Join(root, "WTF", "Config.wtf"))
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) >= 3 && strings.EqualFold(fields[0], "set") && strings.EqualFold(fields[1], "locale") {
			return strings.Trim(fields[2], `"`)
		}
	}
	return ""
}

package mpq

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"Meld/internal/clientbuild"
)

// Set is a stack of archives where later (higher priority) archives override
// earlier ones, mirroring how the WoW client applies patch-N.MPQ files.
type Set struct {
	archives []*Archive // lowest priority first
	// build is the client's build, told when the set opened (#1063), so a reader follows its formats.
	build clientbuild.Info
}

// priority orders 1.x client archives: base data first, patches last.
func priority(name string) int {
	n := strings.ToLower(name)
	switch {
	case strings.HasPrefix(n, "patch-"):
		// patch-2.mpq > patch.mpq; patch-a > patch-9 as the client does.
		return 1000 + int(n[len("patch-")])
	case strings.HasPrefix(n, "patch"):
		return 900
	case n == "backup.mpq":
		return 0
	default:
		return 100
	}
}

// laterPriority orders the archives of a 2.4.3 or 3.3.5a client (#1065), the Data folder's and those
// of its locale folder loc (locale says which the archive is in), as the 3.3.5a client weighs them
// (the reverse-engineered enUS list in Noggit Red's ClientData.hpp, highest first: alternate, patch-A,
// patch-3, patch-2, enUS\patch-enUS-3, enUS\patch-enUS-2, patch, enUS\patch-enUS, base, expansion,
// lichking, common, common-2, then the locale and speech archives). Past the names in that list, every
// Data patch-<x> is taken to beat every locale patch-<loc>-<x>, which beat patch.MPQ, so Meld's
// patch-4.MPQ beats the locale archives' DBCs. 2.4.3 is read the same way until a 2.4.3 client is here to check it (#1075).
func laterPriority(name, loc string, locale bool) int {
	n, l := strings.TrimSuffix(strings.ToLower(name), ".mpq"), strings.ToLower(loc)
	if locale {
		switch n {
		case "lichking-speech-" + l:
			return 40
		case "expansion-speech-" + l:
			return 41
		case "lichking-locale-" + l:
			return 42
		case "expansion-locale-" + l:
			return 43
		case "speech-" + l:
			return 44
		case "locale-" + l:
			return 45
		case "patch-" + l:
			return 1000
		}
		if p := "patch-" + l + "-"; strings.HasPrefix(n, p) && len(n) > len(p) {
			return 2000 + int(n[len(p)])
		}
		return 30
	}
	switch n {
	case "common-2":
		return 46
	case "common":
		return 47
	case "lichking":
		return 48
	case "expansion":
		return 49
	case "patch":
		return 1500
	case "alternate":
		return 9000
	}
	if strings.HasPrefix(n, "patch-") && len(n) > len("patch-") {
		// patch-a > patch-9, as in 1.12.
		return 3000 + int(n[len("patch-")])
	}
	return 100
}

// archive is one archive OpenDataDir opens: its path and its priority.
type archive struct {
	path, name string
	rank       int
}

// ArchivePaths are the archives OpenDataDir opens for the client whose Data folder is dir and whose
// build is b, lowest priority first: dir's *.MPQ, and for 2.4.3 and 3.3.5a those of its locale folder
// too (clientbuild.Locale), where their DBCs live.
func ArchivePaths(dir string, b clientbuild.Build) []string {
	later := b == clientbuild.TBC || b == clientbuild.WotLK
	var list []archive
	add := func(d string, locale bool, loc string) {
		entries, err := os.ReadDir(d)
		if err != nil {
			return
		}
		for _, e := range entries {
			if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".mpq") {
				continue
			}
			rank := priority(e.Name())
			if later {
				rank = laterPriority(e.Name(), loc, locale)
			}
			list = append(list, archive{filepath.Join(d, e.Name()), e.Name(), rank})
		}
	}
	loc := ""
	if later {
		loc = clientbuild.Locale(dir)
	}
	add(dir, false, loc)
	if loc != "" {
		add(filepath.Join(dir, loc), true, loc)
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].rank != list[j].rank {
			return list[i].rank < list[j].rank
		}
		return strings.ToLower(list[i].name) < strings.ToLower(list[j].name)
	})
	out := make([]string, len(list))
	for i, a := range list {
		out[i] = a.path
	}
	return out
}

// OpenDataDir opens the archives of a WoW client's Data directory in the client's order
// (ArchivePaths, by the build clientbuild.Detect tells).
func OpenDataDir(dir string) (*Set, error) {
	if _, err := os.Stat(dir); err != nil {
		return nil, err
	}
	s := &Set{build: clientbuild.Detect(dir)}
	for _, p := range ArchivePaths(dir, s.Build()) {
		a, err := Open(p)
		if err != nil {
			continue // skip unreadable archives rather than failing entirely
		}
		s.archives = append(s.archives, a)
	}
	if len(s.archives) == 0 {
		return nil, os.ErrNotExist
	}
	return s, nil
}

// Build is the build of the client the set's archives are from (Vanilla for one Meld doesn't know).
func (s *Set) Build() clientbuild.Build {
	if s.build.Build == clientbuild.Unknown {
		return clientbuild.Vanilla
	}
	return s.build.Build
}

// PatchName is the name of Meld's patch in the set's client (clientbuild.Build.PatchName), the
// archive a caller skips to read the client's files without Meld's edits (ReadFileExcept).
func (s *Set) PatchName() string { return s.Build().PatchName() }

// BuildInfo is how the client's build was told, with the warning for a build Meld doesn't know.
func (s *Set) BuildInfo() clientbuild.Info { return s.build }

// Archives returns the opened archives, lowest priority first.
func (s *Set) Archives() []*Archive { return s.archives }

// ReadFile reads name from the highest-priority archive that has it.
func (s *Set) ReadFile(name string) ([]byte, error) {
	return s.ReadPrefix(name, -1)
}

// ReadPrefix reads at least the first n bytes of name as ReadFile finds it (Archive.ReadPrefix).
func (s *Set) ReadPrefix(name string, n int) ([]byte, error) {
	for i := len(s.archives) - 1; i >= 0; i-- {
		a := s.archives[i]
		if b, ok := a.find(name); ok {
			if b.flags&flagDeleted != 0 {
				return nil, ErrNotFound
			}
			return a.ReadPrefix(name, n)
		}
	}
	return nil, ErrNotFound
}

// ReadFileExcept reads name as ReadFile does but as if the archive whose file name is skip (any case)
// weren't there, so a caller can read the client's files without one patch's changes and keep the
// others' (Blizzard's patch.MPQ and patch-2.MPQ update tiles too).
func (s *Set) ReadFileExcept(name, skip string) ([]byte, error) {
	for i := len(s.archives) - 1; i >= 0; i-- {
		a := s.archives[i]
		if strings.EqualFold(filepath.Base(a.Path), skip) {
			continue
		}
		if b, ok := a.find(name); ok {
			if b.flags&flagDeleted != 0 {
				return nil, ErrNotFound
			}
			return a.ReadFile(name)
		}
	}
	return nil, ErrNotFound
}

// Has reports whether any archive contains name.
func (s *Set) Has(name string) bool {
	for i := len(s.archives) - 1; i >= 0; i-- {
		if b, ok := s.archives[i].find(name); ok {
			return b.flags&flagDeleted == 0
		}
	}
	return false
}

// List returns the union of all listfiles (deduplicated, original casing of
// the first occurrence), restricted to files that actually resolve.
func (s *Set) List() []string {
	seen := map[string]struct{}{}
	var out []string
	for i := len(s.archives) - 1; i >= 0; i-- {
		names, err := s.archives[i].ListFile()
		if err != nil {
			continue
		}
		for _, n := range names {
			k := strings.ToLower(strings.ReplaceAll(n, "/", `\`))
			if _, ok := seen[k]; ok {
				continue
			}
			seen[k] = struct{}{}
			out = append(out, strings.ReplaceAll(n, "/", `\`))
		}
	}
	sort.Strings(out)
	return out
}

func (s *Set) Close() {
	for _, a := range s.archives {
		_ = a.Close()
	}
}

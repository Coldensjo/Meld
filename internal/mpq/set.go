package mpq

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Set is a stack of archives where later (higher priority) archives override
// earlier ones, mirroring how the WoW client applies patch-N.MPQ files.
type Set struct {
	archives []*Archive // lowest priority first
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

// OpenDataDir opens every *.MPQ in a WoW client's Data directory.
func OpenDataDir(dir string) (*Set, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.EqualFold(filepath.Ext(e.Name()), ".mpq") {
			names = append(names, e.Name())
		}
	}
	sort.SliceStable(names, func(i, j int) bool {
		pi, pj := priority(names[i]), priority(names[j])
		if pi != pj {
			return pi < pj
		}
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})
	s := &Set{}
	for _, n := range names {
		a, err := Open(filepath.Join(dir, n))
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

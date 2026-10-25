package game

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// The 1.12.1 client asks the server for a creature's or game object's template (name, type, model)
// once and keeps the answer across sessions in WDB\creaturecache.wdb and WDB\gameobjectcache.wdb.
// It never asks again: the file's header is compared by equality, with no age or checksum, and an
// entry is only dropped when the server says so (Benilla's notes on the client's DBCache.cpp,
// crates/benilla-app/src/name_persist.rs). A template the editors change would keep its old name
// and type in the game, so Stale remembers the entries saved and Forget takes them out of the
// caches while the game is closed; the client then asks the server for them again.
//
// Quests are cached the same way, in WDB\questcache.wdb (their texts, objectives and rewards), so a
// quest the quest editor saved is taken out of it too (#259), and so are items, in WDB\itemcache.wdb
// (the whole template: name, stats, tooltip) and WDB\itemnamecache.wdb (the name), both keyed by
// the item's entry, for the item editor (#353).
//
// Benilla keeps the creature half in benilla-config/cache/<realm>.tsv (game objects only for the
// session), so its lines for those creatures go too.

const (
	creatureCache = "creaturecache.wdb"
	objectCache   = "gameobjectcache.wdb"
	questCache    = "questcache.wdb"
	itemCache     = "itemcache.wdb"
	itemNameCache = "itemnamecache.wdb"
	// wdbHeader is the size of a WDB file's header: FourCC, build, locale, record size, version.
	wdbHeader = 20
	// benillaCacheTag starts the first line of Benilla's name cache files.
	benillaCacheTag = "benilla-namecache"
)

// Stale is the creature, game object and item templates and the quests saved since the game's caches were
// last cleaned. It's safe to use from several goroutines.
type Stale struct {
	mu        sync.Mutex
	creatures map[uint32]bool
	objects   map[uint32]bool
	quests    map[uint32]bool
	items     map[uint32]bool
}

// AddCreature marks a creature template as changed.
func (s *Stale) AddCreature(entry uint32) { s.add(&s.creatures, entry) }

// AddObject marks a game object template as changed.
func (s *Stale) AddObject(entry uint32) { s.add(&s.objects, entry) }

// AddQuest marks a quest as changed.
func (s *Stale) AddQuest(entry uint32) { s.add(&s.quests, entry) }

// AddItem marks an item template as changed.
func (s *Stale) AddItem(entry uint32) { s.add(&s.items, entry) }

func (s *Stale) add(set *map[uint32]bool, entry uint32) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if *set == nil {
		*set = map[uint32]bool{}
	}
	(*set)[entry] = true
}

// Empty reports whether no template is waiting to be forgotten.
func (s *Stale) Empty() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.creatures) == 0 && len(s.objects) == 0 && len(s.quests) == 0 && len(s.items) == 0
}

// Forget takes the changed templates out of the game's caches: the client's WDB files in clientRoot
// and, when benilla is set, Benilla's name caches. The game must be closed, since it writes its
// caches back as it exits. The entries are kept for the next try if a file couldn't be written.
func (s *Stale) Forget(clientRoot, benilla string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.creatures) == 0 && len(s.objects) == 0 && len(s.quests) == 0 && len(s.items) == 0 {
		return nil
	}
	wdb := filepath.Join(clientRoot, "WDB")
	errs := []error{
		pruneWDB(filepath.Join(wdb, creatureCache), s.creatures),
		pruneWDB(filepath.Join(wdb, objectCache), s.objects),
		pruneWDB(filepath.Join(wdb, questCache), s.quests),
		pruneWDB(filepath.Join(wdb, itemCache), s.items),
		pruneWDB(filepath.Join(wdb, itemNameCache), s.items),
	}
	if benilla != "" {
		errs = append(errs, pruneBenilla(filepath.Join(benilla, "benilla-config", "cache"), s.creatures))
	}
	if err := errors.Join(errs...); err != nil {
		return err
	}
	s.creatures, s.objects, s.quests, s.items = nil, nil, nil, nil
	return nil
}

// pruneWDB rewrites a WDB cache file without the records of entries. A missing file is fine; one
// that doesn't parse is deleted, which costs the client only asking for everything again.
func pruneWDB(path string, entries map[uint32]bool) error {
	if len(entries) == 0 {
		return nil
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	out, ok := pruneRecords(b, entries)
	if !ok {
		return os.Remove(path)
	}
	if len(out) == len(b) {
		return nil
	}
	return writeReplacing(path, out)
}

// pruneRecords drops the records of entries from a WDB file's bytes: a header, then records of
// entry, size and that many bytes, ended by an entry and size of zero. It reports false when b
// isn't such a file.
func pruneRecords(b []byte, entries map[uint32]bool) ([]byte, bool) {
	if len(b) < wdbHeader {
		return nil, false
	}
	out := append(make([]byte, 0, len(b)), b[:wdbHeader]...)
	p := wdbHeader
	for {
		if p+8 > len(b) {
			// No end marker: the client writes one, so this file was cut short.
			return nil, false
		}
		entry := binary.LittleEndian.Uint32(b[p:])
		size := int(binary.LittleEndian.Uint32(b[p+4:]))
		if entry == 0 && size == 0 {
			return append(out, b[p:]...), true
		}
		end := p + 8 + size
		if size < 0 || end > len(b) {
			return nil, false
		}
		if !entries[entry] {
			out = append(out, b[p:end]...)
		}
		p = end
	}
}

// pruneBenilla drops the creature lines ("C", tab, entry) of entries from every name cache file in
// Benilla's cache folder.
func pruneBenilla(dir string, entries map[uint32]bool) error {
	if len(entries) == 0 {
		return nil
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.tsv"))
	if err != nil {
		return err
	}
	var errs []error
	for _, path := range files {
		b, err := os.ReadFile(path)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if !bytes.HasPrefix(b, []byte(benillaCacheTag)) {
			continue
		}
		if out, changed := pruneLines(b, entries); changed {
			errs = append(errs, writeReplacing(path, out))
		}
	}
	return errors.Join(errs...)
}

// pruneLines drops the lines of a Benilla name cache that hold a creature in entries.
func pruneLines(b []byte, entries map[uint32]bool) ([]byte, bool) {
	var out bytes.Buffer
	changed := false
	sc := bufio.NewScanner(bytes.NewReader(b))
	sc.Buffer(make([]byte, 0, 64*1024), len(b)+1)
	for sc.Scan() {
		line := sc.Text()
		if rest, ok := strings.CutPrefix(line, "C\t"); ok {
			id, _, _ := strings.Cut(rest, "\t")
			if n, err := strconv.ParseUint(id, 10, 32); err == nil && entries[uint32(n)] {
				changed = true
				continue
			}
		}
		out.WriteString(line)
		out.WriteByte('\n')
	}
	return out.Bytes(), changed
}

// writeReplacing writes b to a file beside path and moves it over path, so a failed write leaves the
// old file whole.
func writeReplacing(path string, b []byte) error {
	tmp := path + ".meld"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

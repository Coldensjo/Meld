// Package recovery keeps autosaved copies of the maps with unsaved changes, so that a crash (of Meld,
// the WebView or the machine) doesn't lose the edits since the last save.
//
// Each running editor is a session. It writes a dirty map as <session>_<doc>.wmap with a JSON
// <session>_<doc>.json beside it (the map's name, its file or region, when it was written), and
// keeps <session>.alive fresh while it runs. A copy whose session has no fresh alive file is one a
// session left behind without quitting cleanly: List offers those, and a clean quit drops its own.
package recovery

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"Meld/internal/mapfile"
)

// Heartbeat is how often a running session touches its alive file; Stale is when an alive file
// that wasn't touched means its session is gone.
const (
	Heartbeat = 10 * time.Second
	Stale     = 30 * time.Second
)

// Info describes one recovery copy.
type Info struct {
	// ID is <session>_<doc>, the copy's file name without its extension.
	ID      string `json:"id"`
	Session string `json:"session"`
	// Name is the map's tab name.
	Name string `json:"name"`
	// File is the map's own file, or "" for an untitled map or a region of the client.
	File string `json:"file"`
	// Region labels the client's tiles a region was opened from ("Azeroth 32_48, 2x2"), or "".
	Region string `json:"region"`
	// Saved is when the copy was written, in Unix milliseconds.
	Saved int64 `json:"saved"`
	// FileTime is when File was last saved, in Unix milliseconds; 0 without one. Set by List.
	FileTime int64 `json:"fileTime"`
}

// Store is the recovery folder as one session sees it.
type Store struct {
	Dir     string
	Session string

	// mu keeps a heartbeat from writing the alive file back after End removed it.
	mu    sync.Mutex
	ended bool

	// parts holds, by doc, the large fields of a copy being sent in parts (AddPart) until Save takes
	// them. They stay in memory, so a crash between parts leaves no half copy on disk.
	partsMu sync.Mutex
	parts   map[int]map[string]*strings.Builder
}

// partFields are the MapData fields a copy may send in parts: the large base64 arrays.
var partFields = map[string]bool{"heights": true, "weights": true, "chunkSlots": true}

// AddPart appends part, the next slice of the base64 of field ("heights", "weights" or
// "chunkSlots"), to doc's pending copy. Index 0 starts the field afresh, so a copy given up halfway
// is replaced by the next one.
func (s *Store) AddPart(doc int, field string, index int, part string) error {
	if !partFields[field] {
		return errors.New("not a field sent in parts: " + field)
	}
	s.partsMu.Lock()
	defer s.partsMu.Unlock()
	if s.parts == nil {
		s.parts = map[int]map[string]*strings.Builder{}
	}
	fields := s.parts[doc]
	if fields == nil {
		fields = map[string]*strings.Builder{}
		s.parts[doc] = fields
	}
	sb := fields[field]
	if index == 0 {
		sb = &strings.Builder{}
		fields[field] = sb
	} else if sb == nil {
		return errors.New("recovery part " + strconv.Itoa(index) + " of " + field + " without part 0")
	}
	sb.WriteString(part)
	return nil
}

// DropParts forgets doc's pending parts: the copy was given up.
func (s *Store) DropParts(doc int) {
	s.partsMu.Lock()
	defer s.partsMu.Unlock()
	delete(s.parts, doc)
}

// takeParts fills m's fields from doc's pending parts, if any, and forgets them.
func (s *Store) takeParts(doc int, m *mapfile.MapData) {
	s.partsMu.Lock()
	fields := s.parts[doc]
	delete(s.parts, doc)
	s.partsMu.Unlock()
	for f, sb := range fields {
		switch f {
		case "heights":
			m.Heights = sb.String()
		case "weights":
			m.Weights = sb.String()
		case "chunkSlots":
			m.ChunkSlots = sb.String()
		}
	}
}

var idPattern = regexp.MustCompile(`^[0-9A-Za-z-]+_[0-9]+$`)

// Open makes the folder and starts a new session in it.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	var b [3]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, err
	}
	return &Store{Dir: dir, Session: time.Now().Format("20060102-150405") + "-" + hex.EncodeToString(b[:])}, nil
}

func (s *Store) path(id, ext string) (string, error) {
	if !idPattern.MatchString(id) {
		return "", errors.New("not a recovery copy: " + id)
	}
	return filepath.Join(s.Dir, id+ext), nil
}

func (s *Store) alivePath(session string) string {
	return filepath.Join(s.Dir, session+".alive")
}

// Touch marks the session as running.
func (s *Store) Touch() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended {
		return nil
	}
	p := s.alivePath(s.Session)
	now := time.Now()
	if err := os.Chtimes(p, now, now); err == nil {
		return nil
	}
	return os.WriteFile(p, nil, 0o644)
}

// Save writes doc's map and its info as this session's copy and returns the info with its ID set.
// The fields sent in parts (AddPart) since doc's last Save take their place in m. The info is
// written last, so a copy List sees always has its whole map.
func (s *Store) Save(doc int, info Info, m *mapfile.MapData) (Info, error) {
	s.takeParts(doc, m)
	info.Session = s.Session
	info.ID = s.Session + "_" + strconv.Itoa(doc)
	info.Saved = time.Now().UnixMilli()
	info.FileTime = 0
	mp, err := s.path(info.ID, ".wmap")
	if err != nil {
		return info, err
	}
	if err := mapfile.Save(mp, m); err != nil {
		return info, err
	}
	b, err := json.Marshal(info)
	if err != nil {
		return info, err
	}
	jp, _ := s.path(info.ID, ".json")
	tmp := jp + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return info, err
	}
	return info, os.Rename(tmp, jp)
}

// Drop removes a copy. A copy already gone is not an error.
func (s *Store) Drop(id string) error {
	jp, err := s.path(id, ".json")
	if err != nil {
		return err
	}
	mp, _ := s.path(id, ".wmap")
	// The info first, so a half-dropped copy is never listed.
	if err := os.Remove(jp); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Remove(mp); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// DropSession removes this session's copies and alive file: the editor quit cleanly.
func (s *Store) DropSession() error {
	infos, err := s.read()
	if err != nil {
		return err
	}
	for _, in := range infos {
		if in.Session == s.Session {
			if err := s.Drop(in.ID); err != nil {
				return err
			}
		}
	}
	return s.End()
}

// End removes this session's alive file, leaving its copies for the next start to offer.
func (s *Store) End() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ended = true
	if err := os.Remove(s.alivePath(s.Session)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// dropDeadSessions removes the stale alive files of sessions without copies: a session killed with
// every map saved leaves only its alive file, which nothing else would ever remove.
func (s *Store) dropDeadSessions(infos []Info, now time.Time) {
	names, err := filepath.Glob(filepath.Join(s.Dir, "*.alive"))
	if err != nil {
		return
	}
	has := make(map[string]bool, len(infos))
	for _, in := range infos {
		has[in.Session] = true
	}
	for _, n := range names {
		session := strings.TrimSuffix(filepath.Base(n), ".alive")
		if session == s.Session || has[session] {
			continue
		}
		if st, err := os.Stat(n); err == nil && now.Sub(st.ModTime()) >= Stale {
			_ = os.Remove(n)
		}
	}
}

// List gives the copies left by sessions that are no longer running, newest first.
func (s *Store) List() ([]Info, error) {
	infos, err := s.read()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	s.dropDeadSessions(infos, now)
	out := infos[:0]
	for _, in := range infos {
		if in.Session == s.Session {
			continue
		}
		if st, err := os.Stat(s.alivePath(in.Session)); err == nil && now.Sub(st.ModTime()) < Stale {
			continue
		}
		if in.File != "" {
			if st, err := os.Stat(in.File); err == nil {
				in.FileTime = st.ModTime().UnixMilli()
			}
		}
		out = append(out, in)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Saved > out[j].Saved })
	return out, nil
}

// Load reads a copy's map.
func (s *Store) Load(id string) (*mapfile.MapData, error) {
	mp, err := s.path(id, ".wmap")
	if err != nil {
		return nil, err
	}
	return mapfile.Load(mp)
}

// read gives every copy in the folder with its info. A copy whose info is unreadable is skipped.
func (s *Store) read() ([]Info, error) {
	names, err := filepath.Glob(filepath.Join(s.Dir, "*.json"))
	if err != nil {
		return nil, err
	}
	var out []Info
	for _, n := range names {
		id := strings.TrimSuffix(filepath.Base(n), ".json")
		if !idPattern.MatchString(id) {
			continue
		}
		b, err := os.ReadFile(n)
		if err != nil {
			continue
		}
		var in Info
		if json.Unmarshal(b, &in) != nil || in.ID != id {
			continue
		}
		out = append(out, in)
	}
	return out, nil
}

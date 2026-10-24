// Package recovery keeps autosaved copies of the cube worlds with unsaved changes, so that a crash (of
// the editor, the WebView or the machine) doesn't lose the edits since the last save.
//
// Each running editor is a session. It writes a dirty world as <session>_<doc>.world, in the game's
// world format, with a JSON <session>_<doc>.json beside it (the world's name, its file, when it was
// written), and keeps <session>.alive fresh while it runs. A copy whose session has no fresh alive file is one a
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

	"Meld/internal/worldfile"
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
	// Name is the world's tab name.
	Name string `json:"name"`
	// File is the world's own file, or "" for an untitled world.
	File string `json:"file"`
	// World is set for a cube world's copy, a .world file (SaveWorld). An older editor's copy of a
	// .wmap map has it unset: List drops those, as nothing opens them now.
	World bool `json:"world"`
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

// SaveWorld writes doc's cube world and then its info as this session's copy and returns the info
// with its ID set. The info is written last, so a copy List sees always has its whole world.
func (s *Store) SaveWorld(doc int, info Info, w *worldfile.World) (Info, error) {
	info.World = true
	info.Session = s.Session
	info.ID = s.Session + "_" + strconv.Itoa(doc)
	info.Saved = time.Now().UnixMilli()
	info.FileTime = 0
	wp, err := s.path(info.ID, worldExt)
	if err != nil {
		return info, err
	}
	if err := worldfile.Save(wp, w); err != nil {
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

const (
	worldExt = ".world"
	// oldMapExt is an older editor's copy of a .wmap map, which Drop removes too.
	oldMapExt = ".wmap"
)

// Drop removes a copy. A copy already gone is not an error.
func (s *Store) Drop(id string) error {
	jp, err := s.path(id, ".json")
	if err != nil {
		return err
	}
	// The info first, so a half-dropped copy is never listed.
	if err := os.Remove(jp); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, ext := range []string{oldMapExt, worldExt} {
		p, _ := s.path(id, ext)
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
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
			os.Remove(n)
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
		if !in.World {
			s.Drop(in.ID)
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

// LoadWorld reads a cube world's copy.
func (s *Store) LoadWorld(id string) (*worldfile.World, error) {
	wp, err := s.path(id, worldExt)
	if err != nil {
		return nil, err
	}
	return worldfile.Load(wp)
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

// Package handoff passes the large binary part of a bound method's reply to the page as one GET from
// the asset server, rather than inside the reply: Wails sends a reply as one JSON message, which the
// page parses whole, and a 3x3 region's alpha maps were 33 of its 36.5 MB, as 6,000-odd base64
// strings (#636). The method puts the bytes here and returns their URL; the page fetches it once. A
// GET has no request body, so the WebKitGTK crash on POST bodies (CLAUDE.md) doesn't apply.
package handoff

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Path is the asset server path a handoff is fetched from, with its id as ?id=.
const Path = "/handoff"

// TTL is how long a handoff waits for its fetch before it is dropped, so a reply the page never
// fetched (it failed after the method returned) doesn't hold its bytes for the whole session.
const TTL = 2 * time.Minute

// Store holds the handoffs not fetched yet. The zero value is ready to use.
type Store struct {
	mu    sync.Mutex
	next  uint64
	items map[string]item
}

type item struct {
	b     []byte
	timer *time.Timer
}

// Put keeps b until it is fetched or TTL passes, and returns the URL the page fetches it from; ""
// for no bytes, which the page reads as empty without a fetch.
func (s *Store) Put(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.items == nil {
		s.items = map[string]item{}
	}
	s.next++
	id := strconv.FormatUint(s.next, 10)
	s.items[id] = item{b: b, timer: time.AfterFunc(TTL, func() { s.Take(id) })}
	return Path + "?id=" + id
}

// Take returns the handoff with this id and forgets it.
func (s *Store) Take(id string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	it, ok := s.items[id]
	if !ok {
		return nil, false
	}
	delete(s.items, id)
	it.timer.Stop()
	return it.b, true
}

// Pending is the number of handoffs not fetched yet.
func (s *Store) Pending() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.items)
}

// ServeHTTP serves Path?id=: the handoff's bytes once, then 404.
func (s *Store) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b, ok := s.Take(r.URL.Query().Get("id"))
	if !ok {
		http.Error(w, "no such handoff: it was fetched already or expired", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.Write(b)
}

package handoff

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A handoff is served once, as its bytes, then 404s; empty bytes give no URL.
func TestServeOnce(t *testing.T) {
	var s Store
	if u := s.Put(nil); u != "" {
		t.Fatalf("empty bytes gave %q", u)
	}
	want := []byte{1, 2, 3, 250}
	u := s.Put(want)
	if !strings.HasPrefix(u, Path+"?id=") {
		t.Fatalf("url %q", u)
	}
	other := s.Put([]byte{9})
	if u == other || s.Pending() != 2 {
		t.Fatalf("urls %q %q, %d pending", u, other, s.Pending())
	}
	get := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, u, nil))
		return rec
	}
	rec := get()
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), want) {
		t.Fatalf("got %d %v", rec.Code, rec.Body.Bytes())
	}
	if rec := get(); rec.Code != http.StatusNotFound {
		t.Fatalf("second fetch got %d", rec.Code)
	}
	if s.Pending() != 1 {
		t.Fatalf("%d pending after one fetch", s.Pending())
	}
}

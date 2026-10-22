package wow

import (
	"encoding/binary"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"Meld/internal/mpq"
)

// shortM2 is an MD20 of n bytes that ParseM2 reads as far as its extras: version 256 and one empty
// view at 0x08 (whose arrays all read zero), so it draws nothing.
func shortM2(n int) []byte {
	b := make([]byte, n)
	copy(b, "MD20")
	binary.LittleEndian.PutUint32(b[4:], 256)
	binary.LittleEndian.PutUint32(b[0x4C:], 1)
	binary.LittleEndian.PutUint32(b[0x50:], 0x08)
	return b
}

// TestParseM2TruncatedHeader checks that an M2 cut short inside the vanilla header is an error,
// not a panic: the attachments, lights, ribbons and emitters are read from 0x104 to 0x143 (#487).
func TestParseM2TruncatedHeader(t *testing.T) {
	for n := 0xB4; n < m2HeaderSize; n++ {
		func() {
			defer func() {
				if v := recover(); v != nil {
					t.Fatalf("%#x bytes: panic %v", n, v)
				}
			}()
			if _, err := ParseM2(shortM2(n), "x.m2"); err == nil || errors.Is(err, ErrNothingToDraw) {
				t.Fatalf("%#x bytes: %v, want a truncated header", n, err)
			}
		}()
	}
	// The whole header with nothing in it is still a model that draws nothing.
	if _, err := ParseM2(shortM2(m2HeaderSize), "x.m2"); !errors.Is(err, ErrNothingToDraw) {
		t.Fatalf("a full empty header: %v, want ErrNothingToDraw", err)
	}
}

// TestRecoverPanics checks that a panicking handler answers a 500 naming the panic.
func TestRecoverPanics(t *testing.T) {
	h := RecoverPanics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b []byte
		_ = b[3]
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/wow/model?path=x.m2", nil))
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), "index out of range") {
		t.Fatalf("%d %q, want a 500 naming the panic", w.Code, w.Body.String())
	}
}

// TestHandlerTruncatedModel asks /wow/model for a truncated M2 the overlay serves: an error reply.
func TestHandlerTruncatedModel(t *testing.T) {
	c := NewClient()
	c.set = &mpq.Set{}
	c.SetOverlay(func(path string) ([]byte, bool) { return shortM2(0x110), true })
	w := httptest.NewRecorder()
	c.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/wow/model?path=x.m2", nil))
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), "header truncated") {
		t.Fatalf("%d %q, want a 500 for a truncated header", w.Code, w.Body.String())
	}
}

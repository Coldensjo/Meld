package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"Meld/internal/sessionlog"
)

func TestDebugLogSwitch(t *testing.T) {
	for v, want := range map[string]bool{"": false, "0": false, "1": true, "yes": true} {
		t.Setenv(debugLogEnv, v)
		if got := debugLogOn(); got != want {
			t.Errorf("%s=%q: on %v, want %v", debugLogEnv, v, got, want)
		}
	}
	for _, on := range []bool{false, true} {
		rec := httptest.NewRecorder()
		(&App{debugLog: on}).serveDebugLog(rec, httptest.NewRequest("GET", debugLogPath, nil))
		if want := map[bool]string{false: "0", true: "1"}[on]; rec.Body.String() != want {
			t.Errorf("on %v answers %q", on, rec.Body.String())
		}
	}
}

func TestLogRequests(t *testing.T) {
	l, err := sessionlog.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/wow/missing" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("ok"))
	})
	off := &App{slog: l}
	if got := off.logRequests(h); got == nil {
		t.Fatal("no handler")
	}
	off.logRequests(h).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/wow/texture?path=a.blp", nil))
	if text, _ := l.Read(); text != "" {
		t.Fatalf("the switch off logged %q", text)
	}
	on := (&App{slog: l, debugLog: true}).logRequests(h)
	rec := httptest.NewRecorder()
	on.ServeHTTP(rec, httptest.NewRequest("GET", `/wow/texture?path=Interface%5CIcons%5Ca.blp`, nil))
	if rec.Body.String() != "ok" {
		t.Fatalf("the wrapped handler answered %q", rec.Body.String())
	}
	on.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/wow/missing", nil))
	on.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", debugLogPath, nil))
	text, _ := l.Read()
	lines := strings.Split(strings.TrimSpace(text), "\n")
	if len(lines) != 2 {
		t.Fatalf("logged %q, want the two asset requests (not the switch's own)", text)
	}
	if !strings.Contains(lines[0], "asset GET /wow/texture?path=Interface%5CIcons%5Ca.blp 200 ") || !strings.Contains(lines[1], "asset GET /wow/missing 404 ") {
		t.Fatalf("lines %q", lines)
	}
	// Without a log folder nothing is written and nothing breaks.
	(&App{debugLog: true}).logRequests(h).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/x", nil))
}

package main

import (
	"net/url"
	"testing"

	"Meld/internal/config"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Without the app (the Go tests, as the browser page has no native windows) OpenToolWindow answers false,
// so the page opens its in-page window (#909).
func TestOpenToolWindowFallsBack(t *testing.T) {
	a := &App{}
	ok, err := a.OpenToolWindow("history", map[string]string{"x": "1"})
	if err != nil || ok {
		t.Fatalf("OpenToolWindow with no app = %v, %v; want false, nil", ok, err)
	}
	if _, err := a.OpenToolWindow("nope", nil); err == nil {
		t.Fatal("an unknown kind gave no error")
	}
	// The rest are no-ops without the app.
	a.CloseToolWindow("history")
	a.closeToolWindows()
	a.saveToolWindows()
}

func TestToolWindowURL(t *testing.T) {
	u, err := url.Parse(toolWindowURL("history", map[string]string{"id": "7 8", "window": "other"}))
	if err != nil {
		t.Fatal(err)
	}
	if u.Path != "/" {
		t.Fatalf("path %q, want /", u.Path)
	}
	q := u.Query()
	if q.Get("window") != "history" || q.Get("id") != "7 8" {
		t.Fatalf("query %v: want window=history (the kind wins over an argument of that name) and id=7 8", q)
	}
}

func TestToolWindowOnScreen(t *testing.T) {
	areas := []application.Rect{{X: 0, Y: 0, Width: 1920, Height: 1040}, {X: 1920, Y: 0, Width: 1280, Height: 1000}}
	for _, c := range []struct {
		name string
		p    config.Place
		want bool
	}{
		{"inside", config.Place{X: 100, Y: 100, Width: 300, Height: 500}, true},
		{"on the second screen", config.Place{X: 2500, Y: 200, Width: 300, Height: 500}, true},
		{"on a screen gone since", config.Place{X: 4000, Y: 200, Width: 300, Height: 500}, false},
		{"title bar above the screens", config.Place{X: 100, Y: -400, Width: 300, Height: 500}, false},
		{"only a sliver in view", config.Place{X: -280, Y: 100, Width: 300, Height: 500}, false},
		{"half off the left edge", config.Place{X: -150, Y: 100, Width: 300, Height: 500}, true},
	} {
		if got := onScreen(c.p, areas); got != c.want {
			t.Errorf("%s: onScreen = %v, want %v", c.name, got, c.want)
		}
	}
	if onScreen(config.Place{X: 0, Y: 0, Width: 300, Height: 300}, nil) {
		t.Error("onScreen with no screens = true")
	}
}

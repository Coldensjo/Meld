package main

import (
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"Meld/internal/config"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Tool windows as their own OS windows (#909, #861): a tool window (History, the Inspector (#910), the
// doodad brush editor (#911), and later the template editors) opens as a Wails window loading the page with `?window=<kind>`, which
// main.ts mounts as a light shell without the Engine (components/toolwin/ToolShell.svelte). It is its
// own JavaScript context, so it talks to the main page over events (lib/toolwin/channel.ts). The
// browser page (server mode) has no native windows: OpenToolWindow answers false there and the page
// opens its in-page window, as it did before.

// toolWindowKind is a kind of tool window: its title and the size it first opens at.
type toolWindowKind struct {
	title               string
	width, height       int
	minWidth, minHeight int
}

// toolWindowKinds are the tool windows that open as their own OS windows.
var toolWindowKinds = map[string]toolWindowKind{
	"history":   {title: "History", width: 300, height: 520, minWidth: 220, minHeight: 200},
	"inspector": {title: "Inspector", width: 320, height: 640, minWidth: 260, minHeight: 240},
	// The doodad brush editor (#911): the model picker beside the brush, as wide as it was full screen.
	"doodad-brushes": {title: "Doodad brushes", width: 1440, height: 880, minWidth: 1000, minHeight: 520},
	// The database editors (#912 onwards), as wide as they were full screen.
	"item":     {title: "Items", width: 1400, height: 900, minWidth: 960, minHeight: 560},
	"spell":    {title: "Spells", width: 1400, height: 900, minWidth: 960, minHeight: 560},
	"quest":    {title: "Quests", width: 1400, height: 900, minWidth: 960, minHeight: 560},
	"creature": {title: "Creatures", width: 1400, height: 900, minWidth: 960, minHeight: 560},
	"object":   {title: "Game objects", width: 1400, height: 900, minWidth: 960, minHeight: 560},
}

// toolWindowPrefix starts the Wails name of every tool window, followed by its kind.
const toolWindowPrefix = "tool-"

// toolWindowURL is the page a tool window loads: the kind and its arguments as the query.
func toolWindowURL(kind string, args map[string]string) string {
	q := url.Values{}
	for k, v := range args {
		q.Set(k, v)
	}
	q.Set("window", kind)
	return "/?" + q.Encode()
}

// OpenToolWindow opens the tool window of kind as its own OS window, or brings it to the front and
// sends it args (the toolwin:args event) when it is open already. It answers false when there are no
// native windows (the browser page, the Go tests), and the page then opens its in-page window.
func (a *App) OpenToolWindow(kind string, args map[string]string) (bool, error) {
	k, ok := toolWindowKinds[kind]
	if !ok {
		return false, fmt.Errorf("no tool window of kind %q", kind)
	}
	if serverMode || a.app == nil {
		return false, nil
	}
	a.toolMu.Lock()
	defer a.toolMu.Unlock()
	if w := a.window(toolWindowPrefix + kind); w != nil {
		if w.IsMinimised() {
			w.Restore()
		}
		w.Show()
		w.Focus()
		a.emit("toolwin:args", map[string]any{"kind": kind, "args": args})
		return true, nil
	}
	a.cfgMu.Lock()
	place, saved := a.cfg.ToolWindows[kind]
	a.cfgMu.Unlock()
	opts := application.WebviewWindowOptions{
		Name:             toolWindowPrefix + kind,
		Title:            k.title,
		URL:              toolWindowURL(kind, args),
		Width:            k.width,
		Height:           k.height,
		MinWidth:         k.minWidth,
		MinHeight:        k.minHeight,
		BackgroundColour: application.NewRGB(17, 19, 24),
	}
	if saved && place.Width >= k.minWidth && place.Height >= k.minHeight && onScreen(place, a.workAreas()) {
		opts.Width, opts.Height = place.Width, place.Height
		opts.InitialPosition, opts.X, opts.Y = application.WindowXY, place.X, place.Y
	}
	w := a.newWindow(opts)
	// Its place is kept for the next time it opens, and the main page learns it closed (its menu's check
	// mark). A tool window holding unsaved edits of its own (a template editor, SetToolWindowUnsaved) asks
	// its page first instead, cancelling the close, as the main window's hook does (main.go).
	w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if a.toolClose.stop(kind, time.Now()) {
			e.Cancel()
			a.emit("toolwin:close-asked", map[string]any{"kind": kind})
			return
		}
		a.saveToolWindow(kind, w)
		a.emit("toolwin:closed", map[string]any{"kind": kind})
	})
	return true, nil
}

// CloseToolWindow closes the tool window of kind if it is open as its own OS window.
func (a *App) CloseToolWindow(kind string) {
	if a.app == nil {
		return
	}
	if w := a.window(toolWindowPrefix + kind); w != nil {
		w.Close()
	}
}

// closeToolWindows closes every tool window, once the main window closes: Wails quits only when the
// last window has closed, so one left open would keep Meld running.
func (a *App) closeToolWindows() {
	// The main window closing drops a tool window's unsaved edits, as it did the full-screen editor's.
	a.toolClose.forget()
	for _, w := range a.toolWindows() {
		w.Close()
	}
}

// saveToolWindows keeps every open tool window's place, for a quit (Quit) that closes no window.
func (a *App) saveToolWindows() {
	for _, w := range a.toolWindows() {
		a.saveToolWindow(strings.TrimPrefix(w.Name(), toolWindowPrefix), w)
	}
}

// saveToolWindow keeps where the tool window of kind is and its size, for the next time it opens.
func (a *App) saveToolWindow(kind string, w *application.WebviewWindow) {
	if w.IsMinimised() || w.IsMaximised() || w.IsFullscreen() {
		return
	}
	x, y := w.Position()
	width, height := w.Size()
	p := config.Place{X: x, Y: y, Width: width, Height: height}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	if a.cfg.ToolWindows == nil {
		a.cfg.ToolWindows = map[string]config.Place{}
	}
	a.cfg.ToolWindows[kind] = p
	_ = config.Update(func(c *config.Config) error {
		if c.ToolWindows == nil {
			c.ToolWindows = map[string]config.Place{}
		}
		c.ToolWindows[kind] = p
		return nil
	})
}

// onScreen is whether a window at p would show its title bar on one of the screens' work areas, so a
// place saved on a monitor that is gone since is not used.
func onScreen(p config.Place, areas []application.Rect) bool {
	// The strip along the top that holds the title bar: enough of it must be in view to drag it.
	const bar, grip = 30, 60
	for _, r := range areas {
		left, right := max(p.X, r.X), min(p.X+p.Width, r.X+r.Width)
		top, bottom := max(p.Y, r.Y), min(p.Y+bar, r.Y+r.Height)
		if right-left >= grip && bottom-top > 0 {
			return true
		}
	}
	return false
}

// SetToolWindowUnsaved tells whether the tool window of kind holds unsaved edits of its own (a database
// editor's values, #912), so closing it with its title bar's button asks its page first. A call also
// answers a close that was stopped.
func (a *App) SetToolWindowUnsaved(kind string, unsaved bool) {
	a.toolClose.set(kind, unsaved)
}

// toolCloseGuard stops a tool window's close while its page has unsaved edits, as the main window's
// beforeClose does for a map: the page is asked (toolwin:close-asked) and shows its Discard bar. A page
// that hangs never answers, so a second close after closeAckWait without an answer goes through.
type toolCloseGuard struct {
	mu      sync.Mutex
	unsaved map[string]bool
	// asked is when a close of each kind was stopped and not yet answered, in Unix ms.
	asked map[string]int64
}

func (g *toolCloseGuard) set(kind string, unsaved bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.unsaved == nil {
		g.unsaved = map[string]bool{}
	}
	g.unsaved[kind] = unsaved
	delete(g.asked, kind)
}

// stop decides a close of kind at now: stopped while it is unsaved, unless an earlier stopped close
// went unanswered for longer than closeAckWait.
func (g *toolCloseGuard) stop(kind string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.unsaved[kind] {
		return false
	}
	if g.asked == nil {
		g.asked = map[string]int64{}
	}
	ms := now.UnixMilli()
	asked := g.asked[kind]
	g.asked[kind] = ms
	return asked == 0 || ms-asked <= closeAckWait.Milliseconds()
}

// forget drops every unsaved mark, so the closes that follow go through.
func (g *toolCloseGuard) forget() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.unsaved, g.asked = nil, nil
}

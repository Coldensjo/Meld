package main

import (
	"embed"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"strings"

	"Meld/internal/handoff"
	"Meld/internal/wow"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// backendScriptPath is a script index.html loads first: it marks the page as served by Go, so the
// bindings are set up (frontend/src/lib/wails/App.ts). A page without Go, such as a plain Vite
// server, gets a 404 and runs without them.
const backendScriptPath = "/meld/backend.js"

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	wa := application.New(application.Options{
		Name:        "Meld",
		Description: "A World of Warcraft 1.12.1 map editor",
		Services:    []application.Service{application.NewService(app)},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			// /wow/* is served from the user's local WoW client (see internal/wow).
			Middleware: func(next http.Handler) http.Handler {
				wowHandler := app.wow.Handler()
				// The client assets are imported from (#858) answers at /wowx/* as the current one does at /wow/*.
				otherHandler := app.other.Handler()
				// The nav tiles parse the client's files too, so a panic there answers a 500 as well (#487).
				// With MELD_DEBUG_LOG set, each request goes to the session log too (#626).
				return app.logRequests(wow.RecoverPanics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == backendScriptPath {
						w.Header().Set("Content-Type", "text/javascript")
						_, _ = fmt.Fprintf(w, "window.__meldBackend = true\nwindow.__meldServerMode = %v\n", serverMode)
						return
					}
					if r.URL.Path == debugLogPath {
						app.serveDebugLog(w, r)
						return
					}
					if r.URL.Path == "/wow/navtile" {
						app.serveNavTile(w, r)
						return
					}
					if r.URL.Path == handoff.Path {
						app.handoffs.ServeHTTP(w, r)
						return
					}
					if rest, ok := strings.CutPrefix(r.URL.Path, otherPrefix); ok {
						r2 := r.Clone(r.Context())
						r2.URL.Path = "/wow/" + rest
						otherHandler.ServeHTTP(w, r2)
						return
					}
					if strings.HasPrefix(r.URL.Path, "/wow/") {
						wowHandler.ServeHTTP(w, r)
						return
					}
					next.ServeHTTP(w, r)
				})))
			},
			DisableLogging: true,
		},
		LogLevel:   logLevel(),
		OnShutdown: app.shutdown,
		Linux: application.LinuxOptions{
			ProgramName: "Meld",
		},
		// The browser page (make dev-page, server mode) listens where wails dev's page did, so the probes
		// and the docs keep their address (#854).
		Server: application.ServerOptions{Port: 34115},
	})
	app.app = wa

	// The window opens at the size it was closed at.
	width, height, state := 1600, 900, application.WindowStateNormal
	if w := app.cfg.Window; w.Width >= 1024 && w.Height >= 640 {
		width, height = w.Width, w.Height
	}
	if app.cfg.Window.Maximised {
		state = application.WindowStateMaximised
	}
	app.win = wa.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "Meld",
		Width:            width,
		Height:           height,
		MinWidth:         1024,
		MinHeight:        640,
		StartState:       state,
		BackgroundColour: application.NewRGB(17, 19, 24),
		Linux: application.LinuxWindow{
			// WebGL performance on WebKitGTK depends heavily on this.
			WebviewGpuPolicy: application.WebviewGpuPolicyAlways,
		},
	})
	// Closing the window with an unsaved map is stopped, and the frontend asks first (beforeClose).
	app.win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if app.beforeClose() {
			e.Cancel()
		}
	})
	// A close that goes through closes the tool windows too (app_windows.go), or Meld would keep running.
	app.win.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		app.closeToolWindows()
	})

	if err := wa.Run(); err != nil {
		log.Fatal(err)
	}
}

// logLevel is what Wails' log prints: the bound methods' notes (logInfo) in a dev build, warnings only
// in a release one.
func logLevel() slog.Level {
	if devBuild {
		return slog.LevelInfo
	}
	return slog.LevelWarn
}

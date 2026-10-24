package main

import (
	"embed"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"

	"Meld/internal/handoff"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	// The window opens at the size it was closed at.
	width, height, state := 1600, 900, options.Normal
	if w := app.cfg.Window; w.Width >= 1024 && w.Height >= 640 {
		width, height = w.Width, w.Height
	}
	if app.cfg.Window.Maximised {
		state = options.Maximised
	}

	err := wails.Run(&options.App{
		Title:            "Meld",
		Width:            width,
		Height:           height,
		MinWidth:         1024,
		MinHeight:        640,
		WindowStartState: state,
		AssetServer: &assetserver.Options{
			Assets: assets,
			// The handoff path serves the binary parts of bound replies (internal/handoff).
			Middleware: func(next http.Handler) http.Handler {
				return recoverPanics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == handoff.Path {
						app.handoffs.ServeHTTP(w, r)
						return
					}
					next.ServeHTTP(w, r)
				}))
			},
		},
		BackgroundColour: &options.RGBA{R: 17, G: 19, B: 24, A: 1},
		Logger:           newQuietLogger(),
		OnStartup:        app.startup,
		OnBeforeClose:    app.beforeClose,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
		Linux: &linux.Options{
			// WebGL performance on WebKitGTK depends heavily on this.
			WebviewGpuPolicy: linux.WebviewGpuPolicyAlways,
			ProgramName:      "Meld",
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

// recoverPanics answers a request whose handler panics with a 500 that names the panic, and logs it
// with the path and stack: Wails' desktop asset server runs each request in a goroutine of its own
// with no recover, where a panic ends the process (#487); only wails dev's net/http server survives one.
func recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Printf("panic serving %s: %v\n%s", r.URL.RequestURI(), v, debug.Stack())
				http.Error(w, fmt.Sprintf("internal error: %v", v), http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

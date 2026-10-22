package main

import (
	"embed"
	"net/http"
	"strings"

	"Meld/internal/handoff"
	"Meld/internal/wow"

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
			// /wow/* is served from the user's local WoW client (see internal/wow).
			Middleware: func(next http.Handler) http.Handler {
				wowHandler := app.wow.Handler()
				// The nav tiles parse the client's files too, so a panic there answers a 500 as well (#487).
				return wow.RecoverPanics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/wow/navtile" {
						app.serveNavTile(w, r)
						return
					}
					if r.URL.Path == handoff.Path {
						app.handoffs.ServeHTTP(w, r)
						return
					}
					if strings.HasPrefix(r.URL.Path, "/wow/") {
						wowHandler.ServeHTTP(w, r)
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

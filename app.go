package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"

	"WorldEditor/internal/config"
	"WorldEditor/internal/mapfile"
	"WorldEditor/internal/wow"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound to the frontend. Go owns everything that touches the file
// system; rendering and editing live entirely in the frontend.
type App struct {
	ctx context.Context
	wow *wow.Client

	cfgMu sync.Mutex // bound methods run concurrently
	cfg   config.Config
}

func NewApp() *App {
	return &App{wow: wow.NewClient(), cfg: config.Load()}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.cfg.WowPath != "" {
		go func() {
			a.wow.Open(a.cfg.WowPath)
			runtime.EventsEmit(a.ctx, "wow:status", a.wow.Status())
		}()
	}
}

// WowStatus reports whether a WoW client is configured and loaded.
func (a *App) WowStatus() wow.Status {
	return a.wow.Status()
}

// BrowseWowFolder lets the user pick a WoW 1.x client folder. Returns "" if cancelled.
func (a *App) BrowseWowFolder() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Select World of Warcraft 1.x client folder",
		DefaultDirectory: a.cfg.WowPath,
	})
}

// SetWowPath loads the client at path (or unloads with "") and remembers it.
func (a *App) SetWowPath(path string) (wow.Status, error) {
	err := a.wow.Open(path)
	st := a.wow.Status()
	if err != nil {
		return st, err
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.WowPath = path
	if err := config.Save(a.cfg); err != nil {
		return st, err
	}
	return st, nil
}

// SaveThumbnail caches a rendered palette thumbnail (base64 PNG) for key.
func (a *App) SaveThumbnail(key string, pngBase64 string) error {
	png, err := base64.StdEncoding.DecodeString(pngBase64)
	if err != nil {
		return err
	}
	return a.wow.SaveThumb(key, png)
}

// ClearThumbnailCache removes cached palette thumbnails for the current client.
func (a *App) ClearThumbnailCache() error {
	return a.wow.ClearThumbs()
}

// LoadPrefs returns the saved preferences JSON ("" if none).
func (a *App) LoadPrefs() string {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return string(a.cfg.Prefs)
}

// SavePrefs stores the preferences JSON in the user config file.
func (a *App) SavePrefs(prefs string) error {
	if !json.Valid([]byte(prefs)) {
		return errors.New("invalid preferences JSON")
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.Prefs = json.RawMessage(prefs)
	return config.Save(a.cfg)
}

// Quit closes the application.
func (a *App) Quit() {
	runtime.Quit(a.ctx)
}

var mapFilters = []runtime.FileFilter{{DisplayName: "WorldEditor Map (*.wmap)", Pattern: "*.wmap"}}

// SaveMapDialog asks for a destination path. Returns "" if cancelled.
func (a *App) SaveMapDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "untitled"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Map",
		DefaultFilename: suggested + ".wmap",
		Filters:         mapFilters,
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".wmap") {
		path += ".wmap"
	}
	return path, nil
}

// OpenMapDialog asks for a map to open. Returns "" if cancelled.
func (a *App) OpenMapDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Open Map",
		Filters: mapFilters,
	})
}

// SaveMap writes the map to path.
func (a *App) SaveMap(path string, data mapfile.MapData) error {
	if err := mapfile.Save(path, &data); err != nil {
		return err
	}
	runtime.WindowSetTitle(a.ctx, "WorldEditor — "+filepath.Base(path))
	return nil
}

// LoadMap reads the map at path.
func (a *App) LoadMap(path string) (*mapfile.MapData, error) {
	m, err := mapfile.Load(path)
	if err != nil {
		return nil, err
	}
	runtime.WindowSetTitle(a.ctx, "WorldEditor — "+filepath.Base(path))
	return m, nil
}

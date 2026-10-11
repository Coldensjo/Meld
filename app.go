package main

import (
	"context"
	"path/filepath"
	"strings"

	"WorldEditor/internal/mapfile"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound to the frontend. Go owns everything that touches the file
// system; rendering and editing live entirely in the frontend.
type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

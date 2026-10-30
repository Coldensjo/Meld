package main

import (
	"context"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The few parts of the Wails runtime the bound methods use, behind helpers shaped like v2's runtime
// calls (#854): the app (a.app) and its window (a.win) are nil in the Go tests, which construct App
// directly, so every helper is a no-op there.

// ServiceStartup runs when the app starts, before the window loads (Wails' service lifecycle).
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.ctx = ctx
	a.startup()
	return nil
}

// fileFilter is one entry of a dialog's file type list: a name and a semicolon-separated list of
// patterns, such as "*.png;*.jpg".
type fileFilter = application.FileFilter

// dialogOptions are a file or folder dialog's settings, as v2's OpenDialogOptions and SaveDialogOptions
// had them.
type dialogOptions struct {
	Title                string
	DefaultDirectory     string
	DefaultFilename      string
	Filters              []fileFilter
	CanCreateDirectories bool
}

// cancelled reports whether a dialog's error only says the user cancelled it, which v2 returned as an
// empty path: the bound methods document "" for a cancel, and the frontend shows any error.
func cancelled(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "cancel")
}

func (a *App) openDialog(o dialogOptions, dirs bool) *application.OpenFileDialogStruct {
	return a.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:                o.Title,
		Directory:            o.DefaultDirectory,
		Filters:              o.Filters,
		CanChooseFiles:       !dirs,
		CanChooseDirectories: dirs,
		CanCreateDirectories: o.CanCreateDirectories || dirs,
		Window:               a.win,
	})
}

// openFile asks for one file to open; "" if cancelled.
func (a *App) openFile(o dialogOptions) (string, error) {
	if a.app == nil {
		return "", nil
	}
	path, err := a.openDialog(o, false).PromptForSingleSelection()
	if cancelled(err) {
		return "", nil
	}
	return path, err
}

// openFiles asks for files to open; nil if cancelled.
func (a *App) openFiles(o dialogOptions) ([]string, error) {
	if a.app == nil {
		return nil, nil
	}
	paths, err := a.openDialog(o, false).PromptForMultipleSelection()
	if cancelled(err) {
		return nil, nil
	}
	return paths, err
}

// openDirectory asks for a folder; "" if cancelled.
func (a *App) openDirectory(o dialogOptions) (string, error) {
	if a.app == nil {
		return "", nil
	}
	path, err := a.openDialog(o, true).PromptForSingleSelection()
	if cancelled(err) {
		return "", nil
	}
	return path, err
}

// saveFile asks where to save a file; "" if cancelled.
func (a *App) saveFile(o dialogOptions) (string, error) {
	if a.app == nil {
		return "", nil
	}
	path, err := a.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:                o.Title,
		Directory:            o.DefaultDirectory,
		Filename:             o.DefaultFilename,
		Filters:              o.Filters,
		CanCreateDirectories: true,
		Window:               a.win,
	}).PromptForSingleSelection()
	if cancelled(err) {
		return "", nil
	}
	return path, err
}

// emit sends an event to the frontend (EventsOn in lib/wails/runtime.ts).
func (a *App) emit(name string, data ...any) {
	if a.app != nil {
		a.app.Event.Emit(name, data...)
	}
}

// window is the open window named name (main.go's "main", a tool window's "tool-<kind>"), or nil.
func (a *App) window(name string) *application.WebviewWindow {
	if a.app == nil {
		return nil
	}
	w, ok := a.app.Window.GetByName(name)
	if !ok {
		return nil
	}
	ww, _ := w.(*application.WebviewWindow)
	return ww
}

// newWindow opens another window beside the main one (a tool window, app_windows.go).
func (a *App) newWindow(o application.WebviewWindowOptions) *application.WebviewWindow {
	return a.app.Window.NewWithOptions(o)
}

// toolWindows are the tool windows open now (app_windows.go); none without the app.
func (a *App) toolWindows() []*application.WebviewWindow {
	if a.app == nil {
		return nil
	}
	var ws []*application.WebviewWindow
	for _, w := range a.app.Window.GetAll() {
		if ww, ok := w.(*application.WebviewWindow); ok && strings.HasPrefix(ww.Name(), toolWindowPrefix) {
			ws = append(ws, ww)
		}
	}
	return ws
}

// workAreas are the screens' work areas (without the taskbar), in device-independent pixels.
func (a *App) workAreas() []application.Rect {
	if a.app == nil {
		return nil
	}
	var rs []application.Rect
	for _, s := range a.app.Screen.GetAll() {
		rs = append(rs, s.WorkArea)
	}
	return rs
}

// setTitle sets the window's title.
func (a *App) setTitle(title string) {
	if a.win != nil {
		a.win.SetTitle(title)
	}
}

// logInfo and logWarning write to Wails' log, which make dev and make dev-page print (logInfo only in a
// dev build, logLevel in main.go).
func (a *App) logInfo(msg string) {
	if a.app != nil {
		a.app.Logger.Info(msg)
	}
}

func (a *App) logWarning(msg string) {
	if a.app != nil {
		a.app.Logger.Warn(msg)
	}
}

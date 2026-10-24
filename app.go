package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"Meld/internal/config"
	"Meld/internal/handoff"
	"Meld/internal/recovery"
	"Meld/internal/sessionlog"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound to the frontend. Go owns everything that touches the file
// system; rendering and editing live entirely in the frontend.
type App struct {
	ctx context.Context
	// handoffs holds the binary parts of bound replies until the page fetches them (#636).
	handoffs handoff.Store

	cfgMu sync.Mutex // bound methods run concurrently
	cfg   config.Config

	// rec holds the autosaved copies of dirty worlds; nil if its folder couldn't be made.
	rec *recovery.Store
	// slog is this session's log file in the user cache; nil if its folder couldn't be made.
	slog *sessionlog.Log
	// unsaved is whether an open world has unsaved changes (SetUnsaved).
	unsaved atomic.Bool
	// closeAsked is when a close was stopped and not yet answered (AckClose), in Unix ms; 0 for none.
	closeAsked atomic.Int64
}

func NewApp() *App {
	a := &App{cfg: config.Load()}
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.startRecovery()
	a.startSessionLog()
}

// SetUnsaved tells whether an open world has unsaved changes, so closing the window asks first.
// File › Quit's own dialog clears it before quitting.
func (a *App) SetUnsaved(unsaved bool) {
	a.unsaved.Store(unsaved)
}

// beforeClose remembers the window's size for the next start. With an unsaved world it stops the close
// and asks the frontend to show the "Unsaved changes" dialog, as File › Quit does (#188).
// A frontend that hangs never answers, so a second close after closeAckWait without an answer
// (AckClose) goes through; the autosaved copies then hold the unsaved worlds.
func (a *App) beforeClose(ctx context.Context) bool {
	a.saveWindow(ctx)
	if !a.stopClose(time.Now()) {
		return false
	}
	runtime.EventsEmit(ctx, "app:close")
	return true
}

// stopClose decides a close at now: stopped while a world is unsaved, unless an earlier stopped close
// went unanswered for longer than closeAckWait.
func (a *App) stopClose(now time.Time) bool {
	if !a.unsaved.Load() {
		return false
	}
	ms := now.UnixMilli()
	asked := a.closeAsked.Swap(ms)
	return asked == 0 || ms-asked <= closeAckWait.Milliseconds()
}

// closeAckWait is how long the frontend has to answer a close before a second one goes through.
const closeAckWait = 2 * time.Second

// AckClose tells that the frontend showed the "Unsaved changes" dialog for a close.
func (a *App) AckClose() {
	a.closeAsked.Store(0)
}

func (a *App) saveWindow(ctx context.Context) {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	w := &a.cfg.Window
	switch {
	case runtime.WindowIsMinimised(ctx):
		// Keep the size from before it was minimised.
	case runtime.WindowIsMaximised(ctx) || runtime.WindowIsFullscreen(ctx):
		// The unmaximised size isn't available, so the last one saved stays.
		w.Maximised = true
	default:
		w.Width, w.Height = runtime.WindowGetSize(ctx)
		w.Maximised = false
	}
	_ = config.Update(func(c *config.Config) error {
		c.Window = *w
		return nil
	})
}

// LoadPrefs returns the saved preferences JSON ("" if none).
func (a *App) LoadPrefs() string {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return string(a.cfg.Prefs)
}

// SavePrefs stores preferences in the user config file: prefs is a JSON object of the keys that
// changed, merged over the file's current preferences (read again, since another window or the
// dev page may have written since), so two windows don't wipe each other's settings.
func (a *App) SavePrefs(prefs string) error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return config.Update(func(c *config.Config) error {
		merged, err := config.MergePrefs(c.Prefs, json.RawMessage(prefs))
		if err != nil {
			return fmt.Errorf("invalid preferences JSON: %w", err)
		}
		c.Prefs = merged
		a.cfg.Prefs = merged
		return nil
	})
}

// Quit closes the application.
func (a *App) Quit() {
	runtime.Quit(a.ctx)
}

// OpenMapDialog asks for a cube world to open. Returns "" if cancelled.
func (a *App) OpenMapDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Open World",
		DefaultDirectory: a.projectDir(),
		Filters:          []runtime.FileFilter{{DisplayName: "Cube World (*.world)", Pattern: "*.world"}},
	})
}

// startRecovery opens the recovery folder and keeps this session marked as running while it runs.
func (a *App) startRecovery() {
	base, err := os.UserCacheDir()
	if err != nil {
		return
	}
	rec, err := recovery.Open(filepath.Join(base, "Meld", "recovery"))
	if err != nil {
		return
	}
	a.rec = rec
	rec.Touch()
	go func() {
		t := time.NewTicker(recovery.Heartbeat)
		defer t.Stop()
		for {
			select {
			case <-a.ctx.Done():
				return
			case <-t.C:
				rec.Touch()
			}
		}
	}()
}

// startSessionLog opens this session's log file in the user cache (#319).
func (a *App) startSessionLog() {
	base, err := os.UserCacheDir()
	if err != nil {
		return
	}
	if l, err := sessionlog.Open(filepath.Join(base, "Meld", "logs")); err == nil {
		a.slog = l
	}
}

// AppendLog adds the Log window's new lines to the session's log file, which outlives Meld.
func (a *App) AppendLog(lines []string) error {
	if a.slog == nil {
		return nil
	}
	return a.slog.Append(lines)
}

// SessionLog gives what the session's log file holds so far.
func (a *App) SessionLog() (string, error) {
	if a.slog == nil {
		return "", errors.New("no log folder")
	}
	return a.slog.Read()
}

// shutdown ends the session; its copies stay unless the editor quit through Quit, which drops them
// first (EndRecovery), so closing the window on unsaved worlds still leaves them to recover.
func (a *App) shutdown(ctx context.Context) {
	if a.rec != nil {
		a.rec.End()
	}
}

var errNoRecovery = errors.New("no recovery folder")

// DropRecovery removes an autosaved copy: its world was saved, closed or recovered, or the author
// discarded it.
func (a *App) DropRecovery(id string) error {
	if a.rec == nil {
		return errNoRecovery
	}
	return a.rec.Drop(id)
}

// ListRecovery names the autosaved copies that earlier sessions left behind without quitting cleanly.
func (a *App) ListRecovery() ([]recovery.Info, error) {
	if a.rec == nil {
		return nil, nil
	}
	return a.rec.List()
}

// EndRecovery drops this session's copies: the author quit, having saved or discarded every world.
func (a *App) EndRecovery() error {
	if a.rec == nil {
		return nil
	}
	return a.rec.DropSession()
}

// sceneKeep is how many scene copies SaveSceneWorld keeps; older ones are removed.
const sceneKeep = 20

// saveSceneCopy writes a scene's copy, of extension ext, through save into the scenes folder of the
// user's cache dir, removes all but the newest sceneKeep copies there and returns its path.
func saveSceneCopy(ext string, save func(path string) error) (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Meld", "scenes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "scene-"+time.Now().Format("20060102-150405.000")+ext)
	if err := save(path); err != nil {
		return "", err
	}
	// The names sort by time, so the oldest come first; an older editor's .wmap copies count too.
	if old, err := filepath.Glob(filepath.Join(dir, "scene-*.w*")); err == nil && len(old) > sceneKeep {
		sort.Strings(old)
		for _, f := range old[:len(old)-sceneKeep] {
			os.Remove(f)
		}
	}
	return path, nil
}

// BrowsePrefabFolder lets the user pick the folder their prefabs are kept in (#170). Returns "" if cancelled.
func (a *App) BrowsePrefabFolder(current string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Select the folder for prefabs",
		DefaultDirectory: current,
	})
}

// PrefabFile is one prefab of the prefab folder: its file name and its TOML.
type PrefabFile struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

// prefabMaxBytes skips files too big to be a prefab, so a stray file can't stall the list.
const prefabMaxBytes = 1 << 20

// ListPrefabs reads every .toml file of the prefab folder, sorted by name.
func (a *App) ListPrefabs(dir string) ([]PrefabFile, error) {
	if dir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []PrefabFile
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".toml") {
			continue
		}
		if info, err := e.Info(); err != nil || info.Size() > prefabMaxBytes {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		out = append(out, PrefabFile{Name: e.Name(), Text: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// SavePrefabDialog asks where to save a prefab, starting in the prefab folder. Returns "" if cancelled.
func (a *App) SavePrefabDialog(dir, suggested string) (string, error) {
	if suggested == "" {
		suggested = "prefab"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save Selection as Prefab",
		DefaultDirectory: dir,
		DefaultFilename:  suggested + ".toml",
		Filters:          []runtime.FileFilter{{DisplayName: "Meld prefab (*.toml)", Pattern: "*.toml"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".toml") {
		path += ".toml"
	}
	return path, nil
}

// WriteTextFile saves text at path.
func (a *App) WriteTextFile(path, text string) error {
	return os.WriteFile(path, []byte(text), 0o644)
}

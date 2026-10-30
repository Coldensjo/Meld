package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"Meld/internal/config"
	"Meld/internal/game"
	"Meld/internal/handoff"
	"Meld/internal/recovery"
	"Meld/internal/sandbox"
	"Meld/internal/sessionlog"
	"Meld/internal/vmangos"
	"Meld/internal/wow"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// App is bound to the frontend. Go owns everything that touches the file
// system; rendering and editing live entirely in the frontend.
type App struct {
	// ctx is the app's context, cancelled when it shuts down; app and win are the Wails app and its
	// window. All three are nil in the Go tests, which construct App directly.
	ctx context.Context
	app *application.App
	win *application.WebviewWindow
	// toolMu keeps two OpenToolWindow calls from making the same tool window twice (app_toolwindows.go).
	toolMu sync.Mutex
	// toolClose holds the tool windows' unsaved edits and their stopped closes (app_toolwindows.go, #912).
	toolClose toolCloseGuard
	wow       *wow.Client
	// other is the client assets are imported from (app_otherclient.go, #858), read-only.
	other *wow.Client
	// handoffs holds the binary parts of bound replies until the page fetches them (#636).
	handoffs handoff.Store

	cfgMu sync.Mutex // bound methods run concurrently
	cfg   config.Config

	// rec holds the autosaved copies of dirty maps; nil if its folder couldn't be made.
	rec *recovery.Store
	// slog is this session's log file in the user cache; nil if its folder couldn't be made.
	slog *sessionlog.Log
	// debugLog is whether MELD_DEBUG_LOG asked for the asset requests and the page's console
	// warnings in the session log (#626, app_debuglog.go).
	debugLog bool
	// unsaved is whether an open map has unsaved changes (SetUnsaved).
	unsaved atomic.Bool
	// closeAsked is when a close was stopped and not yet answered (AckClose), in Unix ms; 0 for none.
	closeAsked atomic.Int64
	// stale holds the templates saved since the game's caches were last cleared of them (game.Stale).
	stale game.Stale
	// pendingWatch is whether the watcher of the client files waiting for the game to close runs.
	pendingWatch atomic.Bool
	// gameUp, when set, is gameRunning's answer, for the tests of the client file chain (#405).
	gameUp func() bool
	// runSQL, when set, runs a script in the world database in place of vmangos.ApplySQL, for the tests
	// of the saves that write the database and then the patch (#477).
	runSQL func(server, script string) error
	// serverBusy is whether UpdateRegionServer or PublishVmangosMap runs: both rewrite the server's map
	// data, so a second one is refused (#486).
	serverBusy atomic.Bool
	// serverControl is whether the File menu's Start, Stop or Restart Server runs (app_server.go, #857).
	serverControl atomic.Bool

	// The probes' throwaway client (app_sandbox.go, #368). sandboxData, under cfgMu, is its Data
	// folder while it is on; the rest is under sandboxMu.
	sandboxData  string
	sandboxMu    sync.Mutex
	sandboxGen   int
	sandboxTimer *time.Timer
	sandboxReal  string
	sandboxStamp sandbox.Stamp
}

func NewApp() *App {
	a := &App{wow: wow.NewClient(), other: wow.NewClient(), cfg: config.Load(), debugLog: debugLogOn() || len(debugWindowKinds()) > 0}
	// The asset server previews an icon added while the game ran before the patch has it (#364).
	a.wow.SetOverlay(a.clientOverlay)
	// A patch write closes the client's archives for its rename only, and the asset server forgets
	// just the files it changed (#471).
	vmangos.SetClientReader(a.wow)
	return a
}

func (a *App) startup() {
	a.startRecovery()
	a.startSessionLog()
	a.startDebugWindows(debugWindowKinds())
	// Client files saved while the game ran last time go into the patch once it isn't running.
	a.watchPending()
	if a.cfg.WowPath != "" {
		go func() {
			_ = a.wow.Open(a.cfg.WowPath)
			a.emit("wow:status", a.wow.Status())
		}()
	}
}

// SetUnsaved tells whether an open map has unsaved changes, so closing the window asks first.
// File › Quit's own dialog clears it before quitting.
func (a *App) SetUnsaved(unsaved bool) {
	a.unsaved.Store(unsaved)
}

// beforeClose remembers the window's size for the next start. With an unsaved map it stops the close
// and asks the frontend to show the "Unsaved changes" dialog, as File › Quit does (#188).
// A frontend that hangs never answers, so a second close after closeAckWait without an answer
// (AckClose) goes through; the autosaved copies then hold the unsaved maps.
func (a *App) beforeClose() bool {
	a.saveWindow()
	if !a.stopClose(time.Now()) {
		return false
	}
	a.emit("app:close")
	return true
}

// stopClose decides a close at now: stopped while a map is unsaved, unless an earlier stopped close
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

func (a *App) saveWindow() {
	if a.win == nil {
		return
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	w := &a.cfg.Window
	switch {
	case a.win.IsMinimised():
		// Keep the size from before it was minimised.
	case a.win.IsMaximised() || a.win.IsFullscreen():
		// The unmaximised size isn't available, so the last one saved stays.
		w.Maximised = true
	default:
		w.Width, w.Height = a.win.Size()
		w.Maximised = false
	}
	_ = config.Update(func(c *config.Config) error {
		c.Window = *w
		return nil
	})
}

// WowStatus reports whether a WoW client is configured and loaded.
func (a *App) WowStatus() wow.Status {
	return a.wow.Status()
}

// BrowseWowFolder lets the user pick a WoW 1.x client folder. Returns "" if cancelled.
func (a *App) BrowseWowFolder() (string, error) {
	return a.openDirectory(dialogOptions{
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
	if err := config.Update(func(c *config.Config) error {
		c.WowPath = path
		projectClientChanged(c, path)
		a.cfg.Projects, a.cfg.ProjectPath = c.Projects, c.ProjectPath
		return nil
	}); err != nil {
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

// ForgetThumbnails deletes the cached palette thumbnails of keys, whose files an import replaced (#922).
func (a *App) ForgetThumbnails(keys []string) error {
	return a.wow.ForgetThumbs(keys)
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

// buildMoveMaps is Edit › Preferences › Compile and export › Build movement maps on compile (the frontend's buildMoveMaps pref, #173),
// on unless saved off: a compile to the server then rebuilds the mmaps of the tiles it rebuilt.
func (a *App) buildMoveMaps() bool {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	var p struct {
		BuildMoveMaps *bool `json:"buildMoveMaps"`
	}
	if json.Unmarshal(a.cfg.Prefs, &p) != nil || p.BuildMoveMaps == nil {
		return true
	}
	return *p.BuildMoveMaps
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
	if a.app != nil {
		a.saveToolWindows()
		a.app.Quit()
	}
}

// shutdown ends the session; its copies stay unless the editor quit through Quit, which drops them
// first (EndRecovery), so closing the window on unsaved maps still leaves them to recover.
func (a *App) shutdown() {
	if a.rec != nil {
		_ = a.rec.End()
	}
}

// VmangosPath returns the VMaNGOS server folder map exports are written for, or "".
func (a *App) VmangosPath() string {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return a.cfg.VmangosPath
}

// BrowseVmangosFolder lets the user pick a VMaNGOS server folder. Returns "" if cancelled.
func (a *App) BrowseVmangosFolder() (string, error) {
	return a.openDirectory(dialogOptions{
		Title:            "Select the VMaNGOS server folder",
		DefaultDirectory: a.VmangosPath(),
	})
}

// SetVmangosPath checks that path is a VMaNGOS server folder and remembers it. "" forgets it.
func (a *App) SetVmangosPath(path string) error {
	if path != "" {
		if err := vmangos.CheckServer(path); err != nil {
			return err
		}
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.VmangosPath = path
	return config.Update(func(c *config.Config) error {
		c.VmangosPath = path
		return nil
	})
}

// clientDataDir is the loaded client's Data folder, or an error if none is set. While a probe has
// the throwaway client on (app_sandbox.go), it is that copy's.
func (a *App) clientDataDir() (string, error) {
	a.cfgMu.Lock()
	wowPath, sandboxData := a.cfg.WowPath, a.sandboxData
	a.cfgMu.Unlock()
	if sandboxData != "" {
		return sandboxData, nil
	}
	if wowPath == "" {
		return "", errors.New("no WoW client is set")
	}
	return wow.ResolveDataDir(wowPath)
}

// serverAndData are the VMaNGOS server folder and the client's data folder, which the spawn
// bindings need both of.
func (a *App) serverAndData() (string, string, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	// An external database (#856) needs no server folder: server is then "" and the databases come
	// from its mangosd.conf.
	if server == "" && !externalOn() {
		return "", "", errors.New("set the VMaNGOS server folder first (Edit › Preferences › Folders)")
	}
	dataDir, err := a.clientDataDir()
	return server, dataDir, err
}

// clientRoot is the WoW client's folder (the one holding Data), whichever of the two was configured.
func (a *App) clientRoot() (string, error) {
	a.cfgMu.Lock()
	path, sandboxed := a.cfg.WowPath, a.sandboxData != ""
	a.cfgMu.Unlock()
	if sandboxed {
		return "", errSandboxed
	}
	if path == "" {
		return "", errors.New("no WoW client is set")
	}
	if strings.EqualFold(filepath.Base(path), "Data") {
		return filepath.Dir(path), nil
	}
	return path, nil
}

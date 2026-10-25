package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"Meld/internal/config"
	"Meld/internal/game"
	"Meld/internal/handoff"
	"Meld/internal/heightmap"
	"Meld/internal/mapfile"
	"Meld/internal/mpq"
	"Meld/internal/recovery"
	"Meld/internal/sandbox"
	"Meld/internal/sessionlog"
	"Meld/internal/vmangos"
	"Meld/internal/wow"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound to the frontend. Go owns everything that touches the file
// system; rendering and editing live entirely in the frontend.
type App struct {
	ctx context.Context
	wow *wow.Client
	// handoffs holds the binary parts of bound replies until the page fetches them (#636).
	handoffs handoff.Store

	cfgMu sync.Mutex // bound methods run concurrently
	cfg   config.Config

	// rec holds the autosaved copies of dirty maps; nil if its folder couldn't be made.
	rec *recovery.Store
	// slog is this session's log file in the user cache; nil if its folder couldn't be made.
	slog *sessionlog.Log
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
	a := &App{wow: wow.NewClient(), cfg: config.Load()}
	// The asset server previews an icon added while the game ran before the patch has it (#364).
	a.wow.SetOverlay(a.clientOverlay)
	// A patch write closes the client's archives for its rename only, and the asset server forgets
	// just the files it changed (#471).
	vmangos.SetClientReader(a.wow)
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.startRecovery()
	a.startSessionLog()
	// Client files saved while the game ran last time go into the patch once it isn't running.
	a.watchPending()
	if a.cfg.WowPath != "" {
		go func() {
			_ = a.wow.Open(a.cfg.WowPath)
			runtime.EventsEmit(a.ctx, "wow:status", a.wow.Status())
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
func (a *App) beforeClose(ctx context.Context) bool {
	a.saveWindow(ctx)
	if !a.stopClose(time.Now()) {
		return false
	}
	runtime.EventsEmit(ctx, "app:close")
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

// buildMoveMaps is Preferences › Build movement maps on compile (the frontend's buildMoveMaps pref, #173),
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
	runtime.Quit(a.ctx)
}

var mapFilters = []runtime.FileFilter{{DisplayName: "Meld Map (*.wmap)", Pattern: "*.wmap"}}

// SaveMapDialog asks for a destination path. Returns "" if cancelled.
func (a *App) SaveMapDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "untitled"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save Map",
		DefaultDirectory: a.projectDir(),
		DefaultFilename:  suggested + ".wmap",
		Filters:          mapFilters,
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
		Title:            "Open Map",
		DefaultDirectory: a.projectDir(),
		Filters:          mapFilters,
	})
}

// SaveMap writes the map to path.
func (a *App) SaveMap(path string, data mapfile.MapData) error {
	if err := mapfile.Save(path, &data); err != nil {
		return err
	}
	runtime.WindowSetTitle(a.ctx, "Meld — "+filepath.Base(path))
	return nil
}

// LoadMap reads the map at path.
func (a *App) LoadMap(path string) (*mapfile.MapData, error) {
	m, err := mapfile.Load(path)
	if err != nil {
		return nil, err
	}
	runtime.WindowSetTitle(a.ctx, "Meld — "+filepath.Base(path))
	return m, nil
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
	_ = rec.Touch()
	go func() {
		t := time.NewTicker(recovery.Heartbeat)
		defer t.Stop()
		for {
			select {
			case <-a.ctx.Done():
				return
			case <-t.C:
				_ = rec.Touch()
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
// first (EndRecovery), so closing the window on unsaved maps still leaves them to recover.
func (a *App) shutdown(ctx context.Context) {
	if a.rec != nil {
		_ = a.rec.End()
	}
}

var errNoRecovery = errors.New("no recovery folder")

// SaveRecovery writes the autosaved copy of open map doc (a tab's id) and returns its info. Its
// large fields may come before it through SaveRecoveryPart, empty in data.
func (a *App) SaveRecovery(doc int, info recovery.Info, data mapfile.MapData) (recovery.Info, error) {
	if a.rec == nil {
		return info, errNoRecovery
	}
	return a.rec.Save(doc, info, &data)
}

// SaveRecoveryPart sends the next slice of a large field of doc's autosaved copy ("heights",
// "weights" or "chunkSlots", base64), index 0 first; the SaveRecovery after them writes the copy
// with them. A region's copy is ~100 MB of base64, which crossed the bridge in one call before (#637).
func (a *App) SaveRecoveryPart(doc int, field string, index int, part string) error {
	if a.rec == nil {
		return errNoRecovery
	}
	return a.rec.AddPart(doc, field, index, part)
}

// DropRecoveryParts forgets the parts sent for doc's copy, which the autosave gave up.
func (a *App) DropRecoveryParts(doc int) {
	if a.rec != nil {
		a.rec.DropParts(doc)
	}
}

// DropRecovery removes an autosaved copy: its map was saved, closed or recovered, or the author
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

// LoadRecovery reads an autosaved copy's map. Unlike LoadMap it leaves the window title alone.
func (a *App) LoadRecovery(id string) (*mapfile.MapData, error) {
	if a.rec == nil {
		return nil, errNoRecovery
	}
	return a.rec.Load(id)
}

// EndRecovery drops this session's copies: the author quit, having saved or discarded every map.
func (a *App) EndRecovery() error {
	if a.rec == nil {
		return nil
	}
	return a.rec.DropSession()
}

// sceneKeep is how many scene map copies SaveSceneMap keeps; older ones are removed.
const sceneKeep = 20

// SaveSceneMap writes a copy of the open map for a copied scene (Help > Copy Scene) into the
// user's cache dir and returns its path. Unlike SaveMap it leaves the window title alone.
func (a *App) SaveSceneMap(data mapfile.MapData) (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Meld", "scenes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "scene-"+time.Now().Format("20060102-150405.000")+".wmap")
	if err := mapfile.Save(path, &data); err != nil {
		return "", err
	}
	// The names sort by time, so the oldest come first.
	if old, err := filepath.Glob(filepath.Join(dir, "scene-*.wmap")); err == nil && len(old) > sceneKeep {
		sort.Strings(old)
		for _, f := range old[:len(old)-sceneKeep] {
			_ = os.Remove(f)
		}
	}
	return path, nil
}

// VmangosPath returns the VMaNGOS server folder map exports are written for, or "".
func (a *App) VmangosPath() string {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return a.cfg.VmangosPath
}

// serveNavTile serves /wow/navtile?map=&x=&y= (#240): a tile of the server's movement maps for the
// walkable-ground view's server mode (vmangos.NavTile), 404 when the server has none there and 412
// when no VMaNGOS folder is set. Unexported, so Wails doesn't bind it.
func (a *App) serveNavTile(w http.ResponseWriter, r *http.Request) {
	server := a.VmangosPath()
	if server == "" {
		http.Error(w, "no VMaNGOS folder is set", http.StatusPreconditionFailed)
		return
	}
	q := r.URL.Query()
	num := func(k string) int {
		n, err := strconv.Atoi(q.Get(k))
		if err != nil {
			return -1
		}
		return n
	}
	b, err := vmangos.NavTile(server, num("map"), num("x"), num("y"))
	switch {
	case vmangos.IsNotExist(err):
		http.Error(w, "the server has no movement map there", http.StatusNotFound)
	case err != nil:
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
	default:
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Write(b)
	}
}

// BrowseVmangosFolder lets the user pick a VMaNGOS server folder. Returns "" if cancelled.
func (a *App) BrowseVmangosFolder() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Select the VMaNGOS server folder",
		DefaultDirectory: a.VmangosPath(),
	})
}

// BrowseBrushImageFolder lets the user pick the folder of greyscale images that shape the image
// brushes (Noggit Red's Samples folder). Returns "" if cancelled.
func (a *App) BrowseBrushImageFolder(current string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Select the folder of brush images",
		DefaultDirectory: current,
	})
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

// ListBrushImages names the PNG and JPEG images in the brush image folder.
func (a *App) ListBrushImages(dir string) ([]string, error) {
	return heightmap.ListImages(dir)
}

// ReadBrushImage reads one image of the brush image folder as grey levels, at most 256 pixels a side.
func (a *App) ReadBrushImage(dir, name string) (*heightmap.GreyView, error) {
	if name != filepath.Base(name) {
		return nil, errors.New("not an image of the brush folder")
	}
	g, err := heightmap.ReadGrey(filepath.Join(dir, name), 256)
	if err != nil {
		return nil, err
	}
	return g.View(), nil
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

// InstallMapPatch writes the given archive files (path to base64 bytes) into the loaded client's
// patch-3.MPQ, for the server to load. Returns the archive's path.
func (a *App) InstallMapPatch(files map[string]string) (string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return "", err
	}
	list := make([]mpq.File, 0, len(files))
	for name, b64 := range files {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return "", fmt.Errorf("%s: %w", name, err)
		}
		list = append(list, mpq.File{Name: name, Data: data})
	}
	return vmangos.InstallPatch(dataDir, list)
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

// LoadRegion reads a square block of 1.12 map tiles from the client: its heights, texture layers
// and models, stitched into one block the editor shows.
func (a *App) LoadRegion(mapName string, x, y, size int) (*vmangos.RegionView, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return a.handOffAlpha(vmangos.ReadRegion(dataDir, mapName, x, y, size))
}

// LoadBaseRegionPaint reads a block's texture layers and alpha maps as the client has them without
// Meld's patch, for Restore the Client's Paint (#645). Only the view's chunks and alphaUrl are set.
func (a *App) LoadBaseRegionPaint(mapName string, x, y, size int) (*vmangos.RegionView, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return a.handOffAlpha(vmangos.ReadBaseRegionPaint(dataDir, mapName, x, y, size))
}

// handOffAlpha puts a region view's alpha maps in the handoffs for the page to fetch (AlphaURL),
// since in the reply's JSON they were most of its size (#636).
func (a *App) handOffAlpha(view *vmangos.RegionView, err error) (*vmangos.RegionView, error) {
	if err != nil {
		return nil, err
	}
	view.AlphaURL = a.handoffs.Put(view.Alpha)
	view.Alpha = nil
	return view, nil
}

// LoadBuildingMap reads a WMO-only map (a dungeon that is one building and no terrain tiles) as the
// region over the tiles its building covers, with the building as its one model (#271).
func (a *App) LoadBuildingMap(mapName string) (*vmangos.RegionView, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return a.handOffAlpha(vmangos.ReadWMOOnlyRegion(dataDir, mapName))
}

// RegionShadows reads the baked terrain shadows (MCSH) of a square block of 1.12 map tiles from the
// client, for the editor to draw as the client does.
func (a *App) RegionShadows(mapName string, x, y, size int) (*vmangos.RegionShadows, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadRegionShadows(dataDir, mapName, x, y, size)
}

// RegionInner reads how far each cell's middle lies above its corners' mean in a square block of 1.12
// map tiles (their MCVT inner heights), for the walkable-ground view to build the server's ground (#284).
func (a *App) RegionInner(mapName string, x, y, size int) (*vmangos.RegionInner, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadRegionInner(dataDir, mapName, x, y, size)
}

// RegionHorizon reads the map's far horizon (its WDL tiles) within five tiles around a square block of
// 1.12 map tiles, for the editor to draw past the block as the client does. Five tiles, as Benilla
// draws it: the client's own three leave hills still in view uncovered.
func (a *App) RegionHorizon(mapName string, x, y, size int) ([]vmangos.HorizonTile, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadRegionHorizon(dataDir, mapName, x, y, size, 5)
}

// WorldHorizon reads every WDL tile of a map for the world view's horizon (#15), each at its own tile
// coordinates.
func (a *App) WorldHorizon(mapName string) ([]vmangos.HorizonTile, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadWorldHorizon(dataDir, mapName)
}

// RegionEdges reads the client's border rows of the tiles around a region, for File › Check Map's
// seam check (#195).
func (a *App) RegionEdges(mapName string, x, y, size int) ([]vmangos.EdgeSegment, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadRegionEdges(dataDir, mapName, x, y, size)
}

// LiquidTypes lists the client's LiquidType.dbc rows: every liquid it knows, for the Water tool.
func (a *App) LiquidTypes() ([]vmangos.LiquidTypeEntry, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadLiquidTypes(dataDir)
}

// GroundEffects reads the client's ground effect tables (the grass tufts each texture grows). The
// first call for a client learns the texture-to-effect pairs from its tiles, which takes a while;
// progress goes out as "effects:log" events, and the result is cached in the user's cache dir.
func (a *App) GroundEffects() (*vmangos.GroundEffectTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadGroundEffects(dataDir, cacheDir, func(line string) { runtime.EventsEmit(a.ctx, "effects:log", line) })
}

// AddGroundEffect writes a new ground effect (GroundEffectTexture row) growing the given detail models
// into the client's patch, with the game closed around it on Windows, and returns its ID.
func (a *App) AddGroundEffect(doodads []string, density, terrain uint32) (uint32, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return 0, err
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return 0, err
	}
	doodadDBC, err := set.ReadFile(`DBFilesClient\GroundEffectDoodad.dbc`)
	if err == nil {
		var textureDBC []byte
		if textureDBC, err = set.ReadFile(`DBFilesClient\GroundEffectTexture.dbc`); err == nil {
			set.Close()
			out, id, err := vmangos.AddGroundEffect(doodadDBC, textureDBC, doodads, density, terrain)
			if err != nil {
				return 0, err
			}
			_, err = a.installClientFiles(dataDir, []mpq.File{{Name: `DBFilesClient\GroundEffectTexture.dbc`, Data: out}})
			return id, err
		}
	}
	set.Close()
	return 0, err
}

// MapEntries lists the maps the client knows (continents, dungeons, raids, battlegrounds, arenas), so
// the New Map dialog can offer their IDs.
func (a *App) MapEntries() ([]vmangos.MapEntry, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadMapEntries(dataDir)
}

// MapZones lists the client's named zones as tile rectangles, so a part of a continent can be picked by
// name.
func (a *App) MapZones() ([]vmangos.Zone, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadZones(dataDir)
}

// WMODoodadSets names a WMO's doodad sets, by index (set 0 is the global set), for the Inspector's
// doodad set choice.
func (a *App) WMODoodadSets(path string) ([]string, error) {
	return a.wow.WMODoodadSets(path)
}

// Areas lists the client's zones and subzones (AreaTable.dbc), which the Map data tool paints into
// chunks by ID.
func (a *App) Areas() ([]vmangos.Area, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadAreas(dataDir)
}

// LoadSpawns reads the creatures and game objects the server's world database places in a block of
// tiles. It needs the VMaNGOS server folder, and the server's database running.
func (a *App) LoadSpawns(mapName string, x, y, size int) ([]vmangos.WorldSpawn, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server == "" {
		return nil, errors.New("set the VMaNGOS server folder first (Preferences › VMaNGOS Server Folder)")
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadSpawns(server, dataDir, mapName, x, y, size)
}

// serverAndData are the VMaNGOS server folder and the client's data folder, which the spawn
// bindings need both of.
func (a *App) serverAndData() (string, string, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server == "" {
		return "", "", errors.New("set the VMaNGOS server folder first (Preferences › VMaNGOS Server Folder)")
	}
	dataDir, err := a.clientDataDir()
	return server, dataDir, err
}

// SpawnLook dresses a creature display with an equipment and a pose, for a spawn whose display,
// equipment, stand state, emote or sheath state was edited.
func (a *App) SpawnLook(display, equipment, stand, emote, sheath int) (vmangos.LookResult, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return vmangos.LookResult{}, err
	}
	return vmangos.CreatureLook(server, dataDir, display, equipment, stand, emote, sheath)
}

// ListWeapons lists every item of the world database a creature can hold, for the gear picker.
func (a *App) ListWeapons() ([]vmangos.WeaponEntry, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ListWeapons(server, dataDir)
}

// EquipmentItems are the main hand, off hand and ranged items of an equipment template.
func (a *App) EquipmentItems(id int) ([3]int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return [3]int{}, err
	}
	return vmangos.EquipmentItems(server, id)
}

// EquipmentFor is the equipment template with these items (main hand, off hand, ranged), made
// in the world database when none has them; 0 for none.
func (a *App) EquipmentFor(items [3]int) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.EquipmentFor(server, items)
}

// GameEvents lists the world database's events (holidays, the Darkmoon Faire, invasions), for showing
// the spawns of each.
func (a *App) GameEvents() ([]vmangos.GameEvent, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.GameEvents(server)
}

// SpawnEmotes lists the client's emotes, for picking a spawn's looping emote.
func (a *App) SpawnEmotes() ([]vmangos.Emote, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.Emotes(dataDir)
}

// SearchCreatures lists up to 100 creature templates of the world database whose name has text
// in it (or whose entry it is), for placing new creatures.
func (a *App) SearchCreatures(text string) ([]vmangos.CreatureTemplate, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchCreatures(server, text, 100)
}

// ListCreatureTemplates lists every creature template of the world database, dressed for a thumbnail.
func (a *App) ListCreatureTemplates() ([]vmangos.CreatureTemplate, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ListCreatureTemplates(server, dataDir)
}

// ListObjectTemplates lists every game object template of the world database with its model.
func (a *App) ListObjectTemplates() ([]vmangos.ObjectTemplate, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ListObjectTemplates(server, dataDir)
}

// ReadObject reads a game object template's row (its newest patch) for the game object editor.
func (a *App) ReadObject(entry int) (vmangos.TemplateRecord, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.TemplateRecord{}, err
	}
	return vmangos.ReadObject(server, entry)
}

// SaveObject writes a game object template's changed values (by column) into the world database
// and returns the SQL it ran.
func (a *App) SaveObject(entry, patch int, values map[string]string) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	sql, err := vmangos.SaveObject(server, entry, patch, values)
	if err == nil {
		a.stale.AddObject(uint32(entry))
		a.forgetStale()
	}
	return sql, err
}

// CreateObject adds a game object template named name, a copy of template base (or a generic
// object for 0), and returns its entry.
func (a *App) CreateObject(base int, name string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateObject(server, base, name)
}

// ReadObjectLoot reads what game object template entry holds when its loot list is loot: the rows,
// the other objects holding the same list and entry's spawn count, for the Contents tab.
func (a *App) ReadObjectLoot(entry, loot int) (vmangos.ObjectLoot, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.ObjectLoot{}, err
	}
	return vmangos.ReadObjectLoot(server, entry, loot)
}

// SaveObjectLoot replaces game object loot list loot's rows with items and returns the SQL it ran.
func (a *App) SaveObjectLoot(loot int, items []vmangos.LootItem) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveObjectLoot(server, loot, items)
}

// NextObjectLoot is the first loot id no game object uses yet.
func (a *App) NextObjectLoot() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextObjectLoot(server)
}

// ObjectModel is the client model a game object display shows ("" for none), for a spawn whose
// template's display changed.
func (a *App) ObjectModel(display int) (string, error) {
	_, dataDir, err := a.serverAndData()
	if err != nil {
		return "", err
	}
	return vmangos.ObjectModel(dataDir, display)
}

// SpawnTeleports lists where a creature (kind "creature") or game object (kind "object") spawn sends
// a player or moves itself: its gossip, the spells it casts and the scripts it runs (#306, #308).
func (a *App) SpawnTeleports(kind string, entry, guid int) ([]vmangos.SpawnTeleport, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SpawnTeleports(server, kind, entry, guid)
}

// NextObjectGUID is the first free game object guid of the world database, for placed objects.
func (a *App) NextObjectGUID() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextObjectGUID(server)
}

// NextPoolEntry is the first spawn pool entry the world database doesn't use yet, for a pool made
// in the editor.
func (a *App) NextPoolEntry() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextPoolEntry(server)
}

// NextCreatureGUID is the first creature guid the world database doesn't use yet, for creatures
// placed in the editor.
func (a *App) NextCreatureGUID() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextCreatureGUID(server)
}

// CheckSpawnIDs tells File › Check Map what the world database has under the unsaved spawns' guids
// and entries (#195).
func (a *App) CheckSpawnIDs(q vmangos.SpawnIDQuery) (vmangos.SpawnIDReport, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.SpawnIDReport{}, err
	}
	return vmangos.CheckSpawnIDs(server, q)
}

// ReadCreature reads a creature template's row (its newest patch) for the creature editor.
func (a *App) ReadCreature(entry int) (vmangos.TemplateRecord, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.TemplateRecord{}, err
	}
	return vmangos.ReadCreature(server, entry)
}

// SaveCreature writes a creature template's changed values (by column) into the world database
// and returns the SQL it ran.
func (a *App) SaveCreature(entry, patch int, values map[string]string) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	sql, err := vmangos.SaveCreature(server, entry, patch, values)
	if err == nil {
		a.stale.AddCreature(uint32(entry))
		a.forgetStale()
	}
	return sql, err
}

// forgetStale takes the saved templates out of the game's caches now when the game is closed, so a
// game started outside Meld asks the server for them too. With the game open it waits: the game
// writes its caches as it exits, and the next start from Meld clears them (game.Session.Start).
func (a *App) forgetStale() {
	sess, err := a.gameSession()
	if err != nil || sess.GameRunning() {
		return
	}
	if err := sess.ForgetStale(); err != nil {
		runtime.LogWarning(a.ctx, "The game's cache of changed templates wasn't cleared: "+err.Error())
	}
}

// ReadVendor reads what a creature template sells (npc_vendor), for the creature editor's Shop tab.
func (a *App) ReadVendor(entry int) (vmangos.Vendor, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.Vendor{}, err
	}
	return vmangos.ReadVendor(server, entry)
}

// SaveVendor replaces what a creature template sells with items, in order, and returns the SQL it ran.
func (a *App) SaveVendor(entry int, items []vmangos.VendorItem) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveVendor(server, entry, items)
}

// ReadCreatureQuests reads the quests a creature template starts and ends, for the creature editor's Quests tab.
func (a *App) ReadCreatureQuests(entry int) (vmangos.QuestLists, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.QuestLists{}, err
	}
	return vmangos.ReadCreatureQuests(server, entry)
}

// SaveCreatureQuests replaces the quests a creature template starts and ends, and returns the SQL it ran.
func (a *App) SaveCreatureQuests(entry int, quests vmangos.QuestLists) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveCreatureQuests(server, entry, quests)
}

// ReadObjectQuests reads the quests a game object template starts and ends, for the game object
// editor's Quests tab.
func (a *App) ReadObjectQuests(entry int) (vmangos.QuestLists, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.QuestLists{}, err
	}
	return vmangos.ReadObjectQuests(server, entry)
}

// SaveObjectQuests replaces the quests a game object template starts and ends, and returns the SQL
// it ran. An object that is not of the quest giver type is refused new quests.
func (a *App) SaveObjectQuests(entry int, quests vmangos.QuestLists) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveObjectQuests(server, entry, quests)
}

// SearchQuests lists up to 100 quests whose title has text in it (or whose entry it is).
func (a *App) SearchQuests(text string) ([]vmangos.QuestRef, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchQuests(server, text, 100)
}

// ReadQuest reads a quest's quest_template row (its newest patch) for the quest editor (#259).
func (a *App) ReadQuest(entry int) (vmangos.TemplateRecord, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.TemplateRecord{}, err
	}
	return vmangos.ReadQuest(server, entry)
}

// SaveQuest writes a quest's changed values (by column) into the world database once they pass the
// server's rules and what they name exists, and returns the SQL it ran.
func (a *App) SaveQuest(entry, patch int, values map[string]string) (string, error) {
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	sql, err := vmangos.SaveQuest(server, dataDir, entry, patch, values)
	if err == nil {
		a.stale.AddQuest(uint32(entry))
		a.forgetStale()
	}
	return sql, err
}

// CreateQuest adds a quest titled title, a copy of quest base (or a blank level 1 quest for 0), and
// returns its entry.
func (a *App) CreateQuest(base int, title string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateQuest(server, base, title)
}

// PlanQuestDelete lists what deleting quest entry removes and leaves dangling, changing nothing.
func (a *App) PlanQuestDelete(entry int) (vmangos.QuestDeletePlan, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.QuestDeletePlan{}, err
	}
	return vmangos.PlanQuestDelete(server, entry)
}

// DeleteQuest removes quest entry and its relation, script and translation rows, and returns the SQL.
func (a *App) DeleteQuest(entry int) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	sql, err := vmangos.DeleteQuest(server, entry)
	if err == nil {
		a.stale.AddQuest(uint32(entry))
		a.forgetStale()
	}
	return sql, err
}

// ReadQuestGivers reads the creatures and game objects that start and end a quest.
func (a *App) ReadQuestGivers(entry int) (vmangos.QuestGivers, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.QuestGivers{}, err
	}
	return vmangos.ReadQuestGivers(server, entry)
}

// SaveQuestGivers replaces the creatures and game objects that start and end a quest, gives the
// creatures in flag the Quest giver flag, and returns the SQL it ran.
func (a *App) SaveQuestGivers(entry int, givers vmangos.QuestGivers, flag []int) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	return vmangos.SaveQuestGivers(server, entry, givers, flag)
}

// TemplateNames names item, creature, object or quest templates (kind) by entry, for the quest
// editor's references.
func (a *App) TemplateNames(kind string, ids []int) (map[int]vmangos.NamedRef, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.TemplateNames(server, kind, ids)
}

// QuestTables lists the client's quest sorts, skills and reputation factions, for the quest editor.
func (a *App) QuestTables() (vmangos.QuestTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.QuestTables{}, err
	}
	return vmangos.LoadQuestTables(dataDir)
}

// ReadGossip reads what a creature template says when talked to (its gossip menu), for the Messages tab.
func (a *App) ReadGossip(entry int) (vmangos.Gossip, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.Gossip{}, err
	}
	return vmangos.ReadGossip(server, entry)
}

// SaveGreeting sets what a creature template says when talked to, for a man and a woman player
// (an empty female text uses the male one), and returns its gossip menu now.
func (a *App) SaveGreeting(entry int, male, female string) (vmangos.GreetingSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.GreetingSaved{}, err
	}
	return vmangos.SaveGreeting(server, entry, male, female)
}

// SaveConditionText sets a text a creature template's gossip menu shows under a condition: the row
// showing npc_text textID (0 for a new row) now shows male and female when condition cond holds.
func (a *App) SaveConditionText(entry, textID, cond int, male, female string) (vmangos.GreetingSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.GreetingSaved{}, err
	}
	return vmangos.SaveConditionText(server, entry, textID, cond, male, female)
}

// DeleteConditionText removes the conditioned text row showing npc_text textID from a creature
// template's gossip menu.
func (a *App) DeleteConditionText(entry, textID int) (vmangos.GreetingSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.GreetingSaved{}, err
	}
	return vmangos.DeleteConditionText(server, entry, textID)
}

// SaveGossipOptions replaces the options (the lines a player can pick) of a creature template's
// gossip menu, and returns its gossip menu now.
func (a *App) SaveGossipOptions(entry int, options []vmangos.GossipOption) (vmangos.GreetingSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.GreetingSaved{}, err
	}
	return vmangos.SaveGossipOptions(server, entry, options)
}

// Factions lists the client's faction templates with their names and how each treats an Alliance
// and a Horde player, for the creature guide.
func (a *App) Factions() ([]vmangos.FactionInfo, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.Factions(dataDir)
}

// ClassLevelStats reads what the server gives a creature of a unit class at each level from from to
// to (creature_classlevelstats), for the creature guide's stats step.
func (a *App) ClassLevelStats(class, from, to int) ([]vmangos.ClassLevelStats, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadClassLevelStats(server, class, from, to)
}

// ZoneSounds names the client's zone music, intro music, ambience and sound preference rows, each
// with a file to play, for the zone editor (#31).
func (a *App) ZoneSounds() (vmangos.ZoneSoundTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.ZoneSoundTables{}, err
	}
	return vmangos.ZoneSounds(dataDir)
}

// SearchItems lists up to 100 item templates whose name has text in it (or whose entry it is).
func (a *App) SearchItems(text string) ([]vmangos.ItemRef, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchItems(server, text, 100)
}

// ReadItem reads an item template's row, every column by name, for the Shop tab's tooltips.
func (a *App) ReadItem(entry int) (map[string]string, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadItem(server, entry)
}

// ItemIcons gives the inventory icon (a name under Interface\Icons) of each item display.
func (a *App) ItemIcons(displays []int) (map[int]string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ItemIcons(dataDir, displays)
}

// ItemSets gives the client's item sets (ItemSet.dbc) of the given IDs, for the tooltips' set block (#355).
func (a *App) ItemSets(ids []int) ([]vmangos.ItemSet, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ItemSets(dataDir, ids)
}

// ReadItemTemplate reads an item template's row (its newest patch) for the item editor (#353).
func (a *App) ReadItemTemplate(entry int) (vmangos.TemplateRecord, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.TemplateRecord{}, err
	}
	return vmangos.ReadItemTemplate(server, entry)
}

// SaveItem writes an item template's changed values (by column) into the world database and
// returns the SQL it ran.
func (a *App) SaveItem(entry, patch int, values map[string]string) (string, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return "", err
	}
	sql, err := vmangos.SaveItem(server, entry, patch, values)
	if err == nil {
		a.stale.AddItem(uint32(entry))
		a.forgetStale()
	}
	return sql, err
}

// CreateItem adds an item named name, a copy of item base (or a plain junk item for 0), and returns
// its entry.
func (a *App) CreateItem(base int, name string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateItem(server, base, name)
}

// ListItemKinds lists the kinds of item (class, subclass, inventory type) the world database has, for
// the item editor's New item.
func (a *App) ListItemKinds() ([]vmangos.ItemKind, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return nil, err
	}
	return vmangos.ListItemKinds(server)
}

// CreateItemOfKind adds an item named name of a kind, with the usual basics of that kind's items and
// no stats, and returns its entry.
func (a *App) CreateItemOfKind(class, subclass, invType int, name string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateItemOfKind(server, vmangos.ItemKind{Class: class, Subclass: subclass, InvType: invType}, name)
}

// ItemModelLook is an item display on a character of race and sex (0 male, 1 female) as an item of
// inventory type invType is held or worn, and the item's model alone.
func (a *App) ItemModelLook(display, invType, race, sex int) (vmangos.ItemLook, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.ItemLook{}, err
	}
	return vmangos.ItemModelLook(dataDir, display, invType, race, sex)
}

// ListItemDisplays lists the client's item displays with their icons and the items that use them,
// for the item editor's look picker.
func (a *App) ListItemDisplays() ([]vmangos.ItemDisplayEntry, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	return vmangos.ListItemDisplays(server, dataDir)
}

// ListItemIcons lists the client's icons (names under Interface\Icons), for the item editor's icon picker.
func (a *App) ListItemIcons() ([]string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ListItemIcons(dataDir)
}

// ItemDisplayVariant is the item display showing display's model with icon ("" keeps its own) and
// shot visual (-1 keeps its own). When the client has none, it is added to ItemDisplayInfo.dbc in
// Meld's patch (the game closed around it on Windows); added says so.
func (a *App) ItemDisplayVariant(display int, icon string, visual int) (vmangos.IconDisplay, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.IconDisplay{}, err
	}
	id, dbc, err := vmangos.ItemDisplayVariant(dataDir, display, icon, visual)
	if err != nil || dbc == nil {
		return vmangos.IconDisplay{ID: id}, err
	}
	if _, err := a.installClientFiles(dataDir, []mpq.File{{Name: vmangos.ItemDisplayPath, Data: dbc}}); err != nil {
		return vmangos.IconDisplay{}, err
	}
	vmangos.ForgetItemDisplays()
	return vmangos.IconDisplay{ID: id, Added: true}, nil
}

// EquipBonuses lists the bonuses an item's Equip effect can give (healing, spell damage, crit…) with
// the client's spell for each amount, for the item editor's Stats tab.
func (a *App) EquipBonuses() ([]vmangos.EquipBonusKind, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	return vmangos.EquipBonuses(server, dataDir)
}

var sqlFilters = []runtime.FileFilter{{DisplayName: "SQL script (*.sql)", Pattern: "*.sql"}}

// ExportItems asks where to save an SQL script of items and writes their item_template rows there.
// Returns the path, or "" if cancelled.
func (a *App) ExportItems(entries []int, suggested string) (string, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return "", err
	}
	script, err := vmangos.ExportItems(server, entries)
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Export Items", DefaultFilename: suggested + ".sql", Filters: sqlFilters})
	if err != nil || path == "" {
		return "", err
	}
	return path, os.WriteFile(path, []byte(script), 0o644)
}

// OpenItemsDialog asks for an SQL script of items to import. Returns "" if cancelled.
func (a *App) OpenItemsDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Import Items", Filters: sqlFilters})
}

// PlanItemImport says what importing the items of the SQL script at path would write.
func (a *App) PlanItemImport(path string) (vmangos.ItemImport, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.ItemImport{}, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return vmangos.ItemImport{}, err
	}
	return vmangos.PlanItemImport(server, string(b))
}

// ImportItems writes the items of the SQL script at path into the world database and returns their
// entries.
func (a *App) ImportItems(path string) ([]int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	entries, err := vmangos.ImportItems(server, string(b))
	if err == nil {
		for _, e := range entries {
			a.stale.AddItem(uint32(e))
		}
		a.forgetStale()
	}
	return entries, err
}

// SpellTexts gives the description of each spell, its $ tokens filled in, for the Shop tab's tooltips.
func (a *App) SpellTexts(ids []int) (map[int]string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SpellTexts(dataDir, ids)
}

// SearchSpells lists the client's spells by name or ID, with their rank, icon and text, for the
// creature editor's Spells tab.
func (a *App) SearchSpells(text string) ([]vmangos.SpellRef, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SearchSpells(dataDir, text, 80)
}

// SpellCategories lists the categories the creature editor's Spells tab browses the client's
// spells by (#340): the creature abilities, all spells, and the class, pet and profession skill lines.
func (a *App) SpellCategories() ([]vmangos.SpellCategory, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SpellCategories(dataDir)
}

// ListSpells lists the client's spells in a category and school (-1 any), narrowed by a name or ID,
// at most limit of them with the count that matched, for the creature editor's Spells tab (#340).
func (a *App) ListSpells(category string, school int, text string, limit int) (vmangos.SpellList, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.SpellList{}, err
	}
	return vmangos.ListSpells(dataDir, category, school, text, min(max(limit, 1), 2000))
}

// SpellRefs gives each of the client's spells by ID, with its rank, icon and text.
func (a *App) SpellRefs(ids []int) (map[int]vmangos.SpellRef, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SpellRefs(dataDir, ids)
}

// ReadSpell reads a spell's spell_template row (the build the server uses), for the spell editor (#294).
func (a *App) ReadSpell(entry int) (vmangos.SpellRecord, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return vmangos.SpellRecord{}, err
	}
	return vmangos.ReadSpell(server, dataDir, entry)
}

// SpellSaved is what SaveSpell wrote: the SQL it ran, the icon it added to SpellIcon.dbc ("" for
// none), and the spell's visual and whether the composer's was added as new rows.
type SpellSaved struct {
	SQL         string `json:"sql"`
	IconAdded   string `json:"iconAdded"`
	Visual      int    `json:"visual"`
	VisualAdded bool   `json:"visualAdded"`
}

// SaveSpell writes a spell's changed values (by column), icon (a name under Interface\Icons, "" to
// keep its own) and visual (the composer's design, nil to keep it) into its spell_template row and has
// the running world server reload its spells, then writes its whole row into Spell.dbc in Meld's patch
// (with the icon's and the visual's new rows) without closing anything: at once, or once the game has
// closed when it runs (#365), so the game has it the next time it starts.
func (a *App) SaveSpell(entry, build int, values map[string]string, icon string, visual *vmangos.VisualDesign) (SpellSaved, error) {
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return SpellSaved{}, err
	}
	plan, err := vmangos.PlanSpellSave(server, dataDir, entry, build, values, icon, visual)
	if err != nil {
		return SpellSaved{}, err
	}
	if err := vmangos.SaveSpellSQL(server, plan.SQL); err != nil {
		return SpellSaved{}, err
	}
	a.reloadSpells(server)
	err = a.saveClientFiles(dataDir, plan.Files)
	vmangos.ForgetSpells()
	if err != nil {
		return SpellSaved{}, fmt.Errorf("the spell is saved in the world database, but writing it into the client's patch failed (Save again to retry): %w", err)
	}
	return SpellSaved{SQL: plan.SQL, IconAdded: plan.IconAdded, Visual: plan.Visual, VisualAdded: plan.VisualAdded}, nil
}

// CreateSpell adds a spell named name, a copy of spell base (or, for base 0, made from the starter of
// that ID), to the world database and the client's Spell.dbc (in Meld's patch, written as SaveSpell
// writes it, without closing anything), and returns its entry.
func (a *App) CreateSpell(base int, starter, name string) (int, error) {
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	plan, err := vmangos.PlanCreateSpell(server, dataDir, base, starter, name)
	if err != nil {
		return 0, err
	}
	if err := vmangos.SaveSpellSQL(server, plan.SQL); err != nil {
		return 0, err
	}
	a.reloadSpells(server)
	err = a.saveClientFiles(dataDir, []mpq.File{plan.File})
	vmangos.ForgetSpells()
	if err != nil {
		return plan.Entry, fmt.Errorf("spell %d is made in the world database, but writing it into the client's patch failed (Save it to retry): %w", plan.Entry, err)
	}
	return plan.Entry, nil
}

// ExportSpells asks where to save an SQL script of spells and writes their spell_template rows there
// (#357). Returns the path, or "" if cancelled.
func (a *App) ExportSpells(entries []int, suggested string) (string, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return "", err
	}
	script, err := vmangos.ExportSpells(server, dataDir, entries)
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Export Spells", DefaultFilename: suggested + ".sql", Filters: sqlFilters})
	if err != nil || path == "" {
		return "", err
	}
	return path, os.WriteFile(path, []byte(script), 0o644)
}

// OpenSpellsDialog asks for an SQL script of spells to import. Returns "" if cancelled.
func (a *App) OpenSpellsDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Import Spells", Filters: sqlFilters})
}

// PlanSpellImport says what importing the spells of the SQL script at path would write.
func (a *App) PlanSpellImport(path string) (vmangos.SpellImport, error) {
	server, dataDir, err := a.serverAndData()
	if err != nil {
		return vmangos.SpellImport{}, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return vmangos.SpellImport{}, err
	}
	return vmangos.PlanSpellImport(server, dataDir, string(b))
}

// ImportSpells writes the spells of the SQL script at path into the world database (and has the
// running world server reload its spells), then each one's record, made from the row the server
// uses, into Spell.dbc in Meld's patch, as SaveSpell does, with the icons and visuals the script
// carries that the client lacks (#381). Returns their entries.
func (a *App) ImportSpells(path string) ([]int, error) {
	server, dataDir, err := a.serverForWrite()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	entries, looks, err := vmangos.ImportSpellRows(server, dataDir, string(b))
	if err != nil {
		return nil, err
	}
	a.reloadSpells(server)
	files, err := vmangos.SpellClientFiles(server, dataDir, entries)
	if err == nil {
		err = a.saveClientFiles(dataDir, append(looks, files...))
	}
	vmangos.ForgetSpells()
	if err != nil {
		return entries, fmt.Errorf("the spells are in the world database, but writing them into the client's Spell.dbc failed (Save each one, or import again, to retry): %w", err)
	}
	return entries, nil
}

// ReadSpellVisual reads a client spell visual as the composer edits it (#361).
func (a *App) ReadSpellVisual(id int) (vmangos.VisualDesign, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.VisualDesign{}, err
	}
	return vmangos.ReadSpellVisual(dataDir, id)
}

// ListVisualEffects lists the client's spell effect models, for the composer's pickers.
func (a *App) ListVisualEffects() ([]vmangos.VisualEffect, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ListVisualEffects(dataDir)
}

// SpellStarters lists the kinds of spell New spell can start from without copying another (#360).
func (a *App) SpellStarters() []vmangos.SpellStarter {
	return vmangos.SpellStarters()
}

// SpellTables lists the client's cast times, durations, ranges and radii, for the spell editor's selects.
func (a *App) SpellTables() (vmangos.SpellTables, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.SpellTables{}, err
	}
	return vmangos.ReadSpellTables(dataDir)
}

// SpellsWithVisual names a few of the client's spells that use a spell visual, for the spell editor.
func (a *App) SpellsWithVisual(visual int) ([]vmangos.SpellRef, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SpellsWithVisual(dataDir, visual, 5)
}

// ReadCreatureSpells reads a creature template's spell list (creature_spells), for the Spells tab.
func (a *App) ReadCreatureSpells(entry int) (vmangos.CreatureSpells, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.CreatureSpells{}, err
	}
	return vmangos.ReadCreatureSpells(server, entry)
}

// SaveCreatureSpells sets a creature template's spell list to spells, in order, and returns its
// spell_list_id now with the SQL it ran.
func (a *App) SaveCreatureSpells(entry int, spells []vmangos.CreatureSpell) (vmangos.CreatureSpellsSaved, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.CreatureSpellsSaved{}, err
	}
	return vmangos.SaveCreatureSpells(server, entry, spells)
}

// CreateCreature adds a creature template named name, a copy of template base (or the defaults
// for 0), and returns its entry.
func (a *App) CreateCreature(base int, name string) (int, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return 0, err
	}
	return vmangos.CreateCreature(server, base, name)
}

// ListDisplays lists every creature display, dressed, with the creatures that use it, for the
// creature editor's display picker. The world database is optional: without it the displays come
// without their creatures.
func (a *App) ListDisplays() ([]vmangos.DisplayEntry, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ListDisplays(server, dataDir)
}

// ListObjectDisplays lists every game object display with a model and the objects that use it, for
// the game object editor's display picker. The world database is optional, as for ListDisplays.
func (a *App) ListObjectDisplays() ([]vmangos.DisplayEntry, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ListObjectDisplays(server, dataDir)
}

// ModelAnimations lists the animations an M2 model has, for the creature editor's preview.
func (a *App) ModelAnimations(model string) ([]vmangos.AnimInfo, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ModelAnimations(dataDir, model)
}

// SpawnEditSQL turns a region's spawn edits into SQL for the world database, without running it.
func (a *App) SpawnEditSQL(mapName string, x, y, size int, edits []vmangos.SpawnEdit) (vmangos.Result, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.Result{}, err
	}
	return vmangos.SpawnSQL(server, mapName, x, y, size, edits, time.Now())
}

// ApplySpawnEdits writes a region's spawn edits into the world database. The SQL run is kept in
// <user cache>/Meld/spawn-sql first, so what changed can be looked up (or undone by hand).
func (a *App) ApplySpawnEdits(mapName string, x, y, size int, edits []vmangos.SpawnEdit) (vmangos.Result, error) {
	server, _, err := a.serverForWrite()
	if err != nil {
		return vmangos.Result{}, err
	}
	// A new spawn whose guid another spawn took since must not replace that spawn (#199).
	if err := vmangos.CheckCreatedGUIDs(server, edits); err != nil {
		return vmangos.Result{}, err
	}
	res, err := vmangos.SpawnSQL(server, mapName, x, y, size, edits, time.Now())
	if err != nil {
		return res, err
	}
	if cache, err := os.UserCacheDir(); err == nil {
		dir := filepath.Join(cache, "Meld", "spawn-sql")
		if os.MkdirAll(dir, 0o755) == nil {
			_ = os.WriteFile(filepath.Join(dir, time.Now().Format("20060102-150405")+"-"+mapName+".sql"), []byte(res.SQL), 0o644)
		}
	}
	return res, vmangos.ApplySQL(server, res.SQL)
}

// SaveSQLDialog asks where to save an SQL file. Returns "" if cancelled.
func (a *App) SaveSQLDialog(suggested string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Spawn SQL",
		DefaultFilename: suggested + ".sql",
		Filters:         []runtime.FileFilter{{DisplayName: "SQL script (*.sql)", Pattern: "*.sql"}},
	})
}

// SaveRegion writes an edited block back into the client's patch, into the tiles it came from and
// those beside it that list a model by its edge (#647), and says what it wrote. Only the tiles that differ from the patch's copies are written; with nothing
// changed the patch is left alone. Nothing is closed or restarted (#661): on Windows, while the game
// holds the patch open, the tiles wait for it to close (RegionResult.Waiting). The server's map data
// is built from the patch by UpdateRegionServer, which Compile All calls next.
func (a *App) SaveRegion(edit vmangos.RegionEdit) (vmangos.RegionResult, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.RegionResult{}, err
	}
	files, res, err := vmangos.RegionChanges(dataDir, edit)
	if err != nil || len(files) == 0 {
		return res, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server != "" && res.MapID >= 0 {
		// Before the write, as it makes the patch newer than the server's map data.
		res.TilesCurrent = vmangos.ServerMapsCurrent(server, uint32(res.MapID), dataDir)
	}
	res.Patch, res.Waiting, err = a.installClient(dataDir, files, nil)
	return res, err
}

// RegionPending builds an edited block as SaveRegion would and says what differs from the client's
// patch (RegionResult.Files, Changed), without writing anything or closing the game: Launch asks it
// whether the open region has edits the client lacks (#214), and Compile to Server whether the patch
// it builds from is current.
func (a *App) RegionPending(edit vmangos.RegionEdit) (vmangos.RegionResult, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.RegionResult{}, err
	}
	_, res, err := vmangos.RegionChanges(dataDir, edit)
	return res, err
}

// RegionMapID is the map ID the client's Map.dbc gives a region's folder, or -1 for a folder it lacks:
// Compile to Server rebuilds the server's map data of that map (#467).
func (a *App) RegionMapID(mapName string) (int, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return -1, err
	}
	if id, ok := vmangos.ClientMapID(dataDir, mapName); ok {
		return int(id), nil
	}
	return -1, nil
}

// errServerBusy is what a second server map rebuild gets while one runs (#486).
var errServerBusy = errors.New("the server's map data is being rebuilt")

// UpdateRegionServer rebuilds the server's map data for a continent after SaveRegion wrote tiles of it:
// only those tiles (RegionResult.ChangedTiles) when the server's data matched the patch before, else the
// whole map (#211). Nothing is stopped or started (#661): the rebuild waits until the game is closed
// (while tiles wait for it to reach the patch) and the world server is stopped. It runs in the
// background: progress arrives as "servermaps:log" events and "servermaps:done" carries an error
// message, or nothing.
func (a *App) UpdateRegionServer(mapID int, tiles []string) (err error) {
	if !a.serverBusy.CompareAndSwap(false, true) {
		return errServerBusy
	}
	started := false
	defer func() {
		if !started {
			a.serverBusy.Store(false)
		}
	}()
	clientDir, err := a.clientRoot()
	if err != nil {
		return err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server == "" {
		return errors.New("set the VMaNGOS server folder first (Preferences › VMaNGOS Server Folder)")
	}
	if mapID < 0 {
		return errors.New("only a continent of the client updates this way")
	}
	if err := vmangos.CheckServer(server); err != nil {
		return err
	}
	started = true
	go func() {
		defer a.serverBusy.Store(false)
		logf := func(line string) { runtime.EventsEmit(a.ctx, "servermaps:log", line) }
		msg := ""
		plan := vmangos.PublishPlan{ClientRoot: clientDir, ServerRoot: server, SkipMoveMaps: !a.buildMoveMaps()}
		dataDir := filepath.Join(clientDir, "Data")
		if err := a.waitForGameClosed(dataDir, logf); err != nil {
			msg = err.Error()
		} else if err := vmangos.UpdateServerMaps(plan, dataDir, uint32(mapID), tiles, logf); err != nil {
			msg = err.Error()
		}
		runtime.EventsEmit(a.ctx, "servermaps:done", msg)
	}()
	return nil
}

// WriteMinimapTiles puts rendered tiles into the client's minimap for the map whose folder is mapDir
// (B-129): their BLPs and the minimap index go into Meld's patch, with the game closed around it.
// Returns the patch's path.
func (a *App) WriteMinimapTiles(mapDir string, tiles []vmangos.MinimapTile) (string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return "", err
	}
	files, err := vmangos.MinimapFiles(dataDir, mapDir, tiles)
	if err != nil {
		return "", err
	}
	return a.installClientFiles(dataDir, files)
}

// ReadWorldMap reads the client's world map of a zone (WorldMapArea.dbc's row of the map and area, and
// its art), for World › World Map (#181); a view without a row when the zone has none.
func (a *App) ReadWorldMap(mapID, areaID uint32) (*vmangos.WorldMapView, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.ReadWorldMap(dataDir, mapID, areaID)
}

// WorldMapResult is what Write World Map wrote: the row (with its ID), the overlays (with theirs,
// without pictures) and the patch.
type WorldMapResult struct {
	Row      vmangos.WorldMapRow       `json:"row"`
	Overlays []vmangos.WorldMapOverlay `json:"overlays"`
	Patch    string                    `json:"patch"`
}

// WriteWorldMap writes a zone's world map into the client's patch: its twelve art tiles, its
// WorldMapArea.dbc row and its exploration overlays (WorldMapOverlay.dbc rows and their art, #219),
// with the game closed around it.
func (a *App) WriteWorldMap(spec vmangos.WorldMapSpec) (WorldMapResult, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return WorldMapResult{}, err
	}
	files, row, overlays, err := vmangos.WorldMapFiles(dataDir, spec)
	if err != nil {
		return WorldMapResult{}, err
	}
	patch, err := a.installClientFiles(dataDir, files)
	return WorldMapResult{Row: row, Overlays: overlays, Patch: patch}, err
}

// ReadImageFile returns a PNG file's bytes as base64, for the frontend to decode (a picture to import).
func (a *App) ReadImageFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if !bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")) {
		return "", errors.New("not a PNG image")
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// MapLights reads a map's lights from the client's Light tables, for the preview's client lighting.
func (a *App) MapLights(mapID uint32) (*vmangos.MapLights, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadMapLights(dataDir, mapID)
}

// LightIDs are the IDs a new light and its params row take (see vmangos.NewLightIDs).
type LightIDs struct {
	Light  uint32 `json:"light"`
	Params uint32 `json:"params"`
}

// NewLightIDs gives the light editor the IDs for a new light; nothing is written until SaveLights.
func (a *App) NewLightIDs() (LightIDs, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return LightIDs{}, err
	}
	tables, err := vmangos.LoadLightTables(dataDir)
	if err != nil {
		return LightIDs{}, err
	}
	l, p, err := vmangos.NewLightIDs(tables[0], tables[1])
	return LightIDs{Light: l, Params: p}, err
}

// SaveLights writes the light editor's lights and params into the client's light tables in Meld's
// patch (only the tables that changed; the game closed around it on Windows). Returns the
// patch's path, or "" when nothing changed. The server doesn't read the lights.
func (a *App) SaveLights(edit vmangos.LightsEdit) (string, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return "", err
	}
	tables, err := vmangos.LoadLightTables(dataDir)
	if err != nil {
		return "", err
	}
	out, err := vmangos.WriteLights(tables, edit)
	if err != nil {
		return "", err
	}
	files := vmangos.LightFiles(tables, out)
	if len(files) == 0 {
		return "", nil
	}
	return a.installClientFiles(dataDir, files)
}

// LoadingScreens lists the client's loading screens, which a map made for the client may show.
func (a *App) LoadingScreens() ([]vmangos.LoadingScreen, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.LoadLoadingScreens(dataDir)
}

// LoadingScreenResult is what Write Loading Screen wrote: the LoadingScreens.dbc row and the patch.
type LoadingScreenResult struct {
	Row   vmangos.LoadingScreen `json:"row"`
	Patch string                `json:"patch"`
}

// WriteLoadingScreen writes a map's own loading screen into the client's patch (#218): the picture as
// a BLP, its LoadingScreens.dbc row and, when the client has the map already, its Map.dbc row pointing
// at it, with the game closed around it.
func (a *App) WriteLoadingScreen(spec vmangos.LoadingScreenSpec) (LoadingScreenResult, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return LoadingScreenResult{}, err
	}
	files, row, err := vmangos.LoadingScreenFiles(dataDir, spec)
	if err != nil {
		return LoadingScreenResult{}, err
	}
	patch, err := a.installClientFiles(dataDir, files)
	return LoadingScreenResult{Row: row, Patch: patch}, err
}

// AreaRows lists a map's zones and subzones from the client's AreaTable.dbc, for the zone editor.
func (a *App) AreaRows(mapID uint32) ([]vmangos.AreaRow, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	dbc, err := vmangos.LoadAreaTable(dataDir)
	if err != nil {
		return nil, err
	}
	return vmangos.ReadAreaRows(dbc, mapID)
}

// NewAreaRow is a new zone (parent 0) or subzone on a map, with a free ID and exploration bit. It is
// not written until SaveAreas.
func (a *App) NewAreaRow(mapID, parent uint32) (vmangos.AreaRow, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.AreaRow{}, err
	}
	dbc, err := vmangos.LoadAreaTable(dataDir)
	if err != nil {
		return vmangos.AreaRow{}, err
	}
	return vmangos.NewAreaRow(dbc, mapID, parent)
}

// AreaSaveResult says where the zone editor's rows went: the client's patch, and whether the
// server's world database (area_template) took them too. Waiting says the patch's files wait for the
// game to close, and Restart that the world server runs and reads them only at its start, so the
// author restarts it: Meld restarts nothing (#661).
type AreaSaveResult struct {
	Patch   string `json:"patch"`
	Server  bool   `json:"server"`
	Waiting bool   `json:"waiting"`
	Restart bool   `json:"restart"`
}

// ZoneWeatherList is every zone's weather from the world database's game_weather, and whether a
// server folder is set to read it from (without one, Zones is empty and the weather can't be edited).
type ZoneWeatherList struct {
	Server bool                  `json:"server"`
	Zones  []vmangos.ZoneWeather `json:"zones"`
}

// ZoneWeather reads every zone's weather chances for the zone editor (#185).
func (a *App) ZoneWeather() (ZoneWeatherList, error) {
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server == "" {
		return ZoneWeatherList{}, nil
	}
	zones, err := vmangos.ReadWeather(server)
	return ZoneWeatherList{Server: true, Zones: zones}, err
}

// applySQL runs script in the server's world database.
func (a *App) applySQL(server, script string) error {
	if a.runSQL != nil {
		return a.runSQL(server, script)
	}
	return vmangos.ApplySQL(server, script)
}

// afterDatabase is the error of a client write that failed once the world database already held the
// save (what names it), so the user knows the server and the client disagree until a Save again (#477).
func afterDatabase(what string, err error) error {
	return fmt.Errorf("%s saved in the world database, but writing them into the client's patch failed (Save again to retry): %w", what, err)
}

// SaveAreas writes the zone editor's rows into the client's AreaTable.dbc (in Meld's patch) and,
// with a server folder set, into the world database's area_template, which the server reads areas
// from, with the zones' weather into game_weather. Nothing is closed or restarted (#661): the server
// reads area_template only at its start, so the result says when to restart it.
func (a *App) SaveAreas(rows []vmangos.AreaRow, weather []vmangos.ZoneWeather) (AreaSaveResult, error) {
	var res AreaSaveResult
	// Before anything is read: the throwaway client's server tables are the real ones (#383).
	server, err := a.optionalServerForWrite()
	if err != nil {
		return res, err
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	dbc, err := vmangos.LoadAreaTable(dataDir)
	if err != nil {
		return res, err
	}
	out, err := vmangos.SetAreaRows(dbc, rows)
	if err != nil {
		return res, err
	}
	weatherSQL, err := vmangos.WeatherSQL(weather)
	if err != nil {
		return res, err
	}
	if server == "" && len(weather) > 0 {
		return res, errors.New("the weather is the server's: set the VMaNGOS server folder first")
	}
	if server != "" {
		if err := a.applySQL(server, vmangos.AreaSQL(rows)+weatherSQL); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
		res.Server = true
		res.Restart = len(rows) > 0 && a.worldRunning()
	}
	if len(rows) > 0 && !bytes.Equal(out, dbc) {
		if res.Patch, res.Waiting, err = a.installClient(dataDir, []mpq.File{{Name: vmangos.AreaTablePath, Data: out}}, nil); err != nil {
			if res.Server {
				err = afterDatabase("the zones are", err)
			}
			return res, err
		}
	}
	return res, nil
}

// AreaTriggerList is a map's area triggers with the server's names and teleports, and the ID a new
// trigger takes.
type AreaTriggerList struct {
	Triggers []vmangos.AreaTrigger `json:"triggers"`
	NextID   uint32                `json:"nextId"`
}

// AreaTriggers lists the area triggers of map mapID from the client's AreaTrigger.dbc, with their
// names and teleports from the world database when a server folder is set (the Portals dialog).
func (a *App) AreaTriggers(mapID uint32) (AreaTriggerList, error) {
	var res AreaTriggerList
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	dbc, err := vmangos.LoadAreaTriggerTable(dataDir)
	if err != nil {
		return res, err
	}
	if res.Triggers, err = vmangos.ReadAreaTriggers(dbc, mapID); err != nil {
		return res, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	var top uint32
	if server != "" {
		if top, err = vmangos.TriggerExtras(server, res.Triggers); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
	}
	res.NextID, err = vmangos.NewAreaTriggerID(dbc, top)
	return res, err
}

// SaveAreaTriggers writes the Portals dialog's changed triggers (rows) and removed ones (remove, by
// ID) into the client's AreaTrigger.dbc in Meld's patch and into the world database's
// areatrigger_template and areatrigger_teleport, which the server reads. Nothing is closed or
// restarted (#661): the server reads areatrigger_template only at its start, so the result says when
// to restart it.
func (a *App) SaveAreaTriggers(rows []vmangos.AreaTrigger, remove []uint32) (AreaSaveResult, error) {
	var res AreaSaveResult
	// Before anything is read: the throwaway client's server tables are the real ones (#383).
	server, err := a.optionalServerForWrite()
	if err != nil {
		return res, err
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	dbc, err := vmangos.LoadAreaTriggerTable(dataDir)
	if err != nil {
		return res, err
	}
	out, err := vmangos.SetAreaTriggers(dbc, rows, remove)
	if err != nil {
		return res, err
	}
	if server != "" {
		if err := a.applySQL(server, vmangos.AreaTriggerSQL(rows, remove)); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
		res.Server = true
		res.Restart = a.worldRunning()
	}
	if !bytes.Equal(out, dbc) {
		if res.Patch, res.Waiting, err = a.installClient(dataDir, []mpq.File{{Name: vmangos.AreaTriggerPath, Data: out}}, nil); err != nil {
			if res.Server {
				err = afterDatabase("the portals are", err)
			}
			return res, err
		}
	}
	return res, nil
}

// TaxiNetwork lists map mapID's flight stops and the routes from or to them from the client's taxi
// tables, with the IDs a new stop (above the world database's taxi_nodes too, when a server folder
// is set) and route take, for the Flight Paths window (#180).
func (a *App) TaxiNetwork(mapID uint32) (vmangos.TaxiNetwork, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return vmangos.TaxiNetwork{}, err
	}
	tt, err := vmangos.LoadTaxiTables(dataDir)
	if err != nil {
		return vmangos.TaxiNetwork{}, err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	var top uint32
	if server != "" {
		if top, err = vmangos.ServerTaxiMax(server); err != nil {
			return vmangos.TaxiNetwork{}, fmt.Errorf("world database: %w", err)
		}
	}
	return vmangos.ReadTaxiNetwork(tt, mapID, top)
}

// SaveTaxi writes the Flight Paths window's changed and removed stops and routes into the client's
// three taxi tables (Meld's patch) and, with a server folder set, the stops into the world database's
// taxi_nodes and the route tables into the server's data, which it reads at start. Nothing is closed
// or restarted (#661): the result says when the world server needs a restart for the new routes.
func (a *App) SaveTaxi(edit vmangos.TaxiEdit) (AreaSaveResult, error) {
	var res AreaSaveResult
	// Before anything is read: the throwaway client's server tables are the real ones (#383).
	server, err := a.optionalServerForWrite()
	if err != nil {
		return res, err
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return res, err
	}
	tt, err := vmangos.LoadTaxiTables(dataDir)
	if err != nil {
		return res, err
	}
	out, err := vmangos.SetTaxi(tt, edit.Nodes, edit.RemoveNodes, edit.Routes, edit.RemoveRoutes)
	if err != nil {
		return res, err
	}
	if server != "" {
		if err := a.applySQL(server, vmangos.TaxiSQL(edit.Nodes, edit.RemoveNodes, edit.RemoveRoutes)); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
	}
	var files []mpq.File
	for _, f := range []struct {
		name     string
		old, new []byte
	}{{vmangos.TaxiNodesPath, tt.Nodes, out.Nodes}, {vmangos.TaxiPathPath, tt.Paths, out.Paths}, {vmangos.TaxiPathNodePath, tt.Points, out.Points}} {
		if !bytes.Equal(f.old, f.new) {
			files = append(files, mpq.File{Name: f.name, Data: f.new})
		}
	}
	// The client's tables are written (or wait for the game) by the time the server's run, so their
	// failure says the stops are in the world database and the client but the routes are not.
	tablesTried := false
	serverTables := func() error {
		tablesTried = true
		if server == "" {
			return nil
		}
		if _, err := vmangos.InstallServerTaxi(server, out); err != nil {
			where := "the world database and the client's patch"
			if len(files) == 0 {
				where = "the world database"
			}
			return fmt.Errorf("the flight stops are saved in %s, but writing the routes into the server's data failed (Save again to retry): %w", where, err)
		}
		res.Server = true
		res.Restart = a.worldRunning()
		return nil
	}
	if len(files) == 0 {
		return res, serverTables()
	}
	res.Patch, res.Waiting, err = a.installClient(dataDir, files, serverTables)
	if err != nil && server != "" && !tablesTried {
		err = afterDatabase("the flight stops are", err)
	}
	return res, err
}

// gameSession is the game and server a region export restarts, with the saved login.
func (a *App) gameSession() (game.Session, error) {
	if a.sandboxed() {
		return game.Session{}, errSandboxed
	}
	root, err := a.clientRoot()
	if err != nil {
		return game.Session{}, err
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	s := game.Session{
		ClientRoot: root,
		ServerRoot: a.cfg.VmangosPath,
		Login:      a.cfg.Login,
		Run:        vmangos.OSRunner{},
		Log: func(msg string) {
			runtime.LogInfo(a.ctx, msg)
			if a.slog != nil {
				_ = a.slog.Append([]string{time.Now().Format("15:04:05") + " " + msg})
			}
		},
		Stale: &a.stale,
	}
	if a.cfg.GameClient == "benilla" && a.cfg.BenillaPath != "" {
		s.Benilla = a.cfg.BenillaPath
		if s.ServerRoot != "" {
			// Without it Benilla stops at the realm list; a database that's down only costs that.
			s.Realm, _ = vmangos.RealmName(s.ServerRoot)
		}
	}
	s.Window = game.Window{Mode: a.cfg.GameWindow, Resolution: a.cfg.GameResolution}
	return s, nil
}

// GameWindowInfo is how the game's window opens when Meld starts it (game.Window).
type GameWindowInfo struct {
	// Mode is "" (the game's own setting), "windowed" or "fullscreen".
	Mode       string `json:"mode"`
	Resolution string `json:"resolution"`
}

// GameWindow says how the game's window opens when Meld starts it.
func (a *App) GameWindow() GameWindowInfo {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return GameWindowInfo{Mode: a.cfg.GameWindow, Resolution: a.cfg.GameResolution}
}

// SetGameWindow sets how the game's window opens when Meld starts it: mode "" (the game's own
// setting), "windowed" or "fullscreen", at resolution ("1280x720"). It's written into the game's
// own settings the next time Meld starts it.
func (a *App) SetGameWindow(mode, resolution string) error {
	w := game.Window{Mode: mode, Resolution: resolution}
	if err := w.Check(); err != nil {
		return err
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.GameWindow, a.cfg.GameResolution = mode, resolution
	return config.Update(func(c *config.Config) error {
		c.GameWindow, c.GameResolution = mode, resolution
		return nil
	})
}

// GameClientInfo is which game Meld closes and opens around an export, and Benilla's folder.
type GameClientInfo struct {
	// Client is "wow" (Wow.exe) or "benilla".
	Client      string `json:"client"`
	BenillaPath string `json:"benillaPath"`
	// BenillaBuilt says the Benilla folder has a release build of the program.
	BenillaBuilt bool `json:"benillaBuilt"`
}

// GameClient says which game client Meld uses.
func (a *App) GameClient() GameClientInfo {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	info := GameClientInfo{Client: "wow", BenillaPath: a.cfg.BenillaPath}
	if a.cfg.GameClient == "benilla" {
		info.Client = "benilla"
	}
	if info.BenillaPath != "" {
		_, err := os.Stat(game.BenillaExe(info.BenillaPath))
		info.BenillaBuilt = err == nil
	}
	return info
}

// SetGameClient picks the game Meld closes and opens around an export: "wow" or "benilla". Benilla
// needs its folder set first, with a release build in it.
func (a *App) SetGameClient(client string) error {
	if client != "wow" && client != "benilla" {
		return fmt.Errorf("unknown game client %q", client)
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	if client == "benilla" {
		if a.cfg.BenillaPath == "" {
			return errors.New("choose the Benilla folder first (Settings › Benilla Folder…)")
		}
		if _, err := os.Stat(game.BenillaExe(a.cfg.BenillaPath)); err != nil {
			return fmt.Errorf("Benilla isn't built in %s: run cargo build --release -p benilla there", a.cfg.BenillaPath)
		}
	}
	value := ""
	if client == "benilla" {
		value = "benilla"
	}
	a.cfg.GameClient = value
	return config.Update(func(c *config.Config) error {
		c.GameClient = value
		return nil
	})
}

// BrowseBenillaFolder lets the user pick the Benilla folder (its repository). Returns "" if cancelled.
func (a *App) BrowseBenillaFolder() (string, error) {
	a.cfgMu.Lock()
	dir := a.cfg.BenillaPath
	a.cfgMu.Unlock()
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Select the Benilla folder", DefaultDirectory: dir})
}

// SetBenillaPath saves the Benilla folder: the repository, with its Cargo.toml (the program is built
// into target/release there).
func (a *App) SetBenillaPath(path string) error {
	if path != "" {
		if _, err := os.Stat(filepath.Join(path, "crates", "benilla-mpq")); err != nil {
			return fmt.Errorf("%s isn't a Benilla folder (it has no crates/benilla-mpq)", path)
		}
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.BenillaPath = path
	return config.Update(func(c *config.Config) error {
		c.BenillaPath = path
		return nil
	})
}

// LaunchGame opens the chosen game client now (Wow.exe or Benilla), logged in when a login is saved.
func (a *App) LaunchGame() error {
	sess, err := a.gameSession()
	if err != nil {
		return err
	}
	a.flushPending()
	return sess.StartGame()
}

// LaunchGameAt is LaunchGame with the saved character entering the world at spot (where the editor's
// camera is): with the server folder set, the game is closed, the character logged out and moved
// there in the server's database first. It returns the character placed, or "" when there is no
// character or server to place it on, and the game is only launched.
func (a *App) LaunchGameAt(spot vmangos.CharacterSpot) (string, error) {
	sess, err := a.gameSession()
	if err != nil {
		return "", err
	}
	character := sess.Login.Character
	if character == "" || sess.ServerRoot == "" {
		a.flushPending()
		return "", sess.StartGame()
	}
	if err := sess.StopGame(); err != nil {
		return "", err
	}
	if err := vmangos.PlaceCharacter(sess.ServerRoot, character, spot, sess.WorldRunning); err != nil {
		return "", err
	}
	a.flushPending()
	return character, sess.StartGame()
}

// PlayHere moves the Game Login's character, in the world now, to spot (where the editor's camera is)
// through the running world server's SOAP console, without closing the game. It returns the character
// moved, or an error that says why it can't (no character or server set, the world server not running,
// SOAP off, the character not in the world), so the editor can point to Launch instead.
func (a *App) PlayHere(spot vmangos.CharacterSpot) (string, error) {
	sess, err := a.gameSession()
	if err != nil {
		return "", err
	}
	character := sess.Login.Character
	switch {
	case character == "":
		return "", errors.New("Game Login has no character to move")
	case sess.ServerRoot == "":
		return "", errors.New("no VMaNGOS server folder is set")
	case !sess.WorldRunning():
		return "", errors.New("the world server isn't running")
	}
	if err := vmangos.TeleportCharacter(sess.ServerRoot, sess.Login.Account, sess.Login.Password, character, spot); err != nil {
		return "", err
	}
	return character, nil
}

// GameLoginInfo is the saved game login. The password itself never goes to the frontend.
type GameLoginInfo struct {
	Account     string `json:"account"`
	HasPassword bool   `json:"hasPassword"`
	Character   string `json:"character"`
}

// GameLogin returns the account the game logs in with after a region export.
func (a *App) GameLogin() GameLoginInfo {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	l := a.cfg.Login
	return GameLoginInfo{Account: l.Account, HasPassword: l.Password != "", Character: l.Character}
}

// SetGameLogin saves the account and password the game logs in with, and the character it enters the
// world as ("" for character select). An empty account clears the login. An empty password keeps the
// saved one when the account is unchanged, and otherwise saves none.
func (a *App) SetGameLogin(account, password, character string) error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	account = strings.TrimSpace(account)
	if account == "" {
		a.cfg.Login = config.Login{}
	} else {
		if password == "" && a.cfg.Login.Account == account {
			password = a.cfg.Login.Password
		}
		a.cfg.Login = config.Login{Account: account, Password: password, Character: strings.TrimSpace(character)}
	}
	login := a.cfg.Login
	return config.Update(func(c *config.Config) error {
		c.Login = login
		return nil
	})
}

// PublishVmangosMap makes a map made in the editor playable: it's written into the client's patch, added to
// the server's tables, and the server's map data is extracted again. It runs in the background. Progress
// arrives as "publish:log" events, and "publish:done" carries an error message, or nothing when the
// publish finished. Nothing is closed or started (#661): it waits for the author to close the game
// (which holds the patch open on Windows) and to stop the world server (which holds its map data), and
// the author starts them again.
func (a *App) PublishVmangosMap(m vmangos.MapSpec) (err error) {
	if !a.serverBusy.CompareAndSwap(false, true) {
		return errServerBusy
	}
	started := false
	defer func() {
		if !started {
			a.serverBusy.Store(false)
		}
	}()
	clientDir, err := a.clientRoot()
	if err != nil {
		return err
	}
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server == "" {
		return errors.New("set the VMaNGOS server folder first (Preferences › VMaNGOS Server Folder)")
	}
	started = true
	go func() {
		defer a.serverBusy.Store(false)
		logf := func(line string) { runtime.EventsEmit(a.ctx, "publish:log", line) }
		msg := ""
		if err := a.waitForGameClosed(filepath.Join(clientDir, "Data"), logf); err != nil {
			msg = err.Error()
		} else if err := vmangos.Publish(vmangos.PublishPlan{ClientRoot: clientDir, ServerRoot: server, SkipMoveMaps: !a.buildMoveMaps()}, m, logf); err != nil {
			msg = err.Error()
		}
		runtime.EventsEmit(a.ctx, "publish:done", msg)
	}()
	return nil
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

// HeightmapData is a square grid of terrain heights read from an image: Side samples a side, row by row.
type HeightmapData struct {
	Side    int       `json:"side"`
	Heights []float32 `json:"heights"`
}

var heightmapFilters = []runtime.FileFilter{{DisplayName: "PNG heightmap (*.png)", Pattern: "*.png"}}

// SaveHeightmapDialog asks where to save a heightmap image. Returns "" if cancelled.
func (a *App) SaveHeightmapDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "heightmap"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Heightmap",
		DefaultFilename: suggested + ".png",
		Filters:         heightmapFilters,
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".png") {
		path += ".png"
	}
	return path, nil
}

// OpenImageDialog asks for a PNG image to read, under the given dialog title. Returns "" if cancelled.
func (a *App) OpenImageDialog(title string) (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: title, Filters: imageFilters})
}

var referenceFilters = []runtime.FileFilter{{DisplayName: "Image (*.png, *.jpg)", Pattern: "*.png;*.jpg;*.jpeg"}}

// OpenReferenceImageDialog asks for the reference image to lay over the map (View › Reference
// Image, #184). Returns "" if cancelled.
func (a *App) OpenReferenceImageDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Reference Image", Filters: referenceFilters})
}

// referenceMaxBytes skips a file too big to be a reference image, so a stray pick can't stall the bridge.
const referenceMaxBytes = 64 << 20

// ReadReferenceImage returns a PNG or JPEG file's bytes as base64, for the page to decode itself
// (in colour, at its own size); the map keeps only the path.
func (a *App) ReadReferenceImage(path string) (string, error) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg":
	default:
		return "", errors.New("a reference image is a PNG or JPEG file")
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.Size() > referenceMaxBytes {
		return "", fmt.Errorf("%s is %d MB, more than a reference image may be (%d MB)", filepath.Base(path), info.Size()>>20, referenceMaxBytes>>20)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// OpenHeightmapDialog asks for a heightmap image to import. Returns "" if cancelled.
func (a *App) OpenHeightmapDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import Heightmap",
		Filters: heightmapFilters,
	})
}

// WriteHeightmap saves a grid of heights as a 16-bit PNG at path.
func (a *App) WriteHeightmap(path string, side int, heights []float32) error {
	data, err := heightmap.Encode(side, heights)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// WriteNormalMap saves a normal map: side x side RGB pixels, three bytes each, sent base64-encoded.
func (a *App) WriteNormalMap(path string, side int, rgb string) error {
	raw, err := base64.StdEncoding.DecodeString(rgb)
	if err != nil {
		return err
	}
	data, err := heightmap.EncodeRGB(side, raw)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// ReadHeightmap reads a heightmap image as a grid of heights.
func (a *App) ReadHeightmap(path string) (HeightmapData, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return HeightmapData{}, err
	}
	side, heights, err := heightmap.Decode(data)
	if err != nil {
		return HeightmapData{}, err
	}
	return HeightmapData{Side: side, Heights: heights}, nil
}

var textFilters = []runtime.FileFilter{{DisplayName: "Text file (*.txt)", Pattern: "*.txt"}}

// SaveTextDialog asks where to save a text file. Returns "" if cancelled.
func (a *App) SaveTextDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "list"
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Object List",
		DefaultFilename: suggested + ".txt",
		Filters:         textFilters,
	})
}

// OpenTextDialog asks for a text file to import. Returns "" if cancelled.
func (a *App) OpenTextDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import Object List",
		Filters: textFilters,
	})
}

var brushFilters = []runtime.FileFilter{{DisplayName: "Doodad brush (*.toml)", Pattern: "*.toml"}}

// SaveBrushDialog asks where to save a doodad brush. Returns "" if cancelled.
func (a *App) SaveBrushDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "brush"
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Doodad Brush",
		DefaultFilename: suggested + ".toml",
		Filters:         brushFilters,
	})
}

// OpenBrushDialog asks for doodad brush files to import. Returns none if cancelled.
func (a *App) OpenBrushDialog() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import Doodad Brushes",
		Filters: brushFilters,
	})
}

var setFilters = []runtime.FileFilter{{DisplayName: "Model set (*.toml)", Pattern: "*.toml"}}

// SaveModelSetDialog asks where to save a model set. Returns "" if cancelled.
func (a *App) SaveModelSetDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "set"
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Model Set",
		DefaultFilename: suggested + ".toml",
		Filters:         setFilters,
	})
}

// OpenModelSetDialog asks for model set files to import. Returns none if cancelled.
func (a *App) OpenModelSetDialog() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import Model Sets",
		Filters: setFilters,
	})
}

// WriteTextFile saves text at path.
func (a *App) WriteTextFile(path, text string) error {
	return os.WriteFile(path, []byte(text), 0o644)
}

var imageFilters = []runtime.FileFilter{{DisplayName: "PNG image (*.png)", Pattern: "*.png"}}

// SaveImageDialog asks where to save a PNG image. Returns "" if cancelled.
func (a *App) SaveImageDialog(title, suggested string) (string, error) {
	if suggested == "" {
		suggested = "image"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           title,
		DefaultFilename: suggested + ".png",
		Filters:         imageFilters,
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".png") {
		path += ".png"
	}
	return path, nil
}

// WritePNG saves a PNG image, given as base64 (a binding, since the asset server must not get
// request bodies), at path. It refuses anything that isn't a PNG.
func (a *App) WritePNG(path, pngBase64 string) error {
	b, err := base64.StdEncoding.DecodeString(pngBase64)
	if err != nil {
		return err
	}
	if !bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")) {
		return errors.New("not a PNG image")
	}
	return os.WriteFile(path, b, 0o644)
}

// ReadTextFile returns the text of the file at path.
func (a *App) ReadTextFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	return string(b), err
}

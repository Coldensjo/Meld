package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"Meld/internal/config"
	"Meld/internal/game"
	"Meld/internal/heightmap"
	"Meld/internal/mapfile"
	"Meld/internal/mpq"
	"Meld/internal/recovery"
	"Meld/internal/vmangos"
	"Meld/internal/wow"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound to the frontend. Go owns everything that touches the file
// system; rendering and editing live entirely in the frontend.
type App struct {
	ctx context.Context
	wow *wow.Client

	cfgMu sync.Mutex // bound methods run concurrently
	cfg   config.Config

	// rec holds the autosaved copies of dirty maps; nil if its folder couldn't be made.
	rec *recovery.Store
	// unsaved is whether an open map has unsaved changes (SetUnsaved).
	unsaved atomic.Bool
	// closeAsked is when a close was stopped and not yet answered (AckClose), in Unix ms; 0 for none.
	closeAsked atomic.Int64
	// stale holds the templates saved since the game's caches were last cleared of them (game.Stale).
	stale game.Stale
}

func NewApp() *App {
	return &App{wow: wow.NewClient(), cfg: config.Load()}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.startRecovery()
	if a.cfg.WowPath != "" {
		go func() {
			a.wow.Open(a.cfg.WowPath)
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

// shutdown ends the session; its copies stay unless the editor quit through Quit, which drops them
// first (EndRecovery), so closing the window on unsaved maps still leaves them to recover.
func (a *App) shutdown(ctx context.Context) {
	if a.rec != nil {
		a.rec.End()
	}
}

var errNoRecovery = errors.New("no recovery folder")

// SaveRecovery writes the autosaved copy of open map doc (a tab's id) and returns its info.
func (a *App) SaveRecovery(doc int, info recovery.Info, data mapfile.MapData) (recovery.Info, error) {
	if a.rec == nil {
		return info, errNoRecovery
	}
	return a.rec.Save(doc, info, &data)
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
			os.Remove(f)
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
	defer a.releaseClient()()
	a.cfgMu.Lock()
	wowPath := a.cfg.WowPath
	a.cfgMu.Unlock()
	if wowPath == "" {
		return "", errors.New("no WoW client is set")
	}
	dataDir, err := wow.ResolveDataDir(wowPath)
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

// clientDataDir is the loaded client's Data folder, or an error if none is set.
func (a *App) clientDataDir() (string, error) {
	a.cfgMu.Lock()
	wowPath := a.cfg.WowPath
	a.cfgMu.Unlock()
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
	return vmangos.ReadRegion(dataDir, mapName, x, y, size)
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
	defer a.releaseClient()()
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
			_, err = a.installWithGameClosed(dataDir, []mpq.File{{Name: `DBFilesClient\GroundEffectTexture.dbc`, Data: out}})
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
	server, _, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
	if err != nil {
		return "", err
	}
	return vmangos.SaveVendor(server, entry, items)
}

// ReadCreatureQuests reads the quests a creature template starts and ends, for the creature editor's Quests tab.
func (a *App) ReadCreatureQuests(entry int) (vmangos.CreatureQuests, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.CreatureQuests{}, err
	}
	return vmangos.ReadCreatureQuests(server, entry)
}

// SaveCreatureQuests replaces the quests a creature template starts and ends, and returns the SQL it ran.
func (a *App) SaveCreatureQuests(entry int, quests vmangos.CreatureQuests) (string, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return "", err
	}
	return vmangos.SaveCreatureQuests(server, entry, quests)
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
	server, dataDir, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.GreetingSaved{}, err
	}
	return vmangos.SaveGreeting(server, entry, male, female)
}

// SaveGossipOptions replaces the options (the lines a player can pick) of a creature template's
// gossip menu, and returns its gossip menu now.
func (a *App) SaveGossipOptions(entry int, options []vmangos.GossipOption) (vmangos.GreetingSaved, error) {
	server, _, err := a.serverAndData()
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

// SpellRefs gives each of the client's spells by ID, with its rank, icon and text.
func (a *App) SpellRefs(ids []int) (map[int]vmangos.SpellRef, error) {
	dataDir, err := a.clientDataDir()
	if err != nil {
		return nil, err
	}
	return vmangos.SpellRefs(dataDir, ids)
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
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.CreatureSpellsSaved{}, err
	}
	return vmangos.SaveCreatureSpells(server, entry, spells)
}

// CreateCreature adds a creature template named name, a copy of template base (or the defaults
// for 0), and returns its entry.
func (a *App) CreateCreature(base int, name string) (int, error) {
	server, _, err := a.serverAndData()
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
	server, _, err := a.serverAndData()
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

// SaveRegion writes an edited block back into the client's patch, into the tiles it came from, and
// says what it wrote. Only the tiles that differ from the patch's copies are written; with nothing
// changed the patch, the game and the servers are left alone. The server's map data is built from
// the patch. On Windows the game and the servers are closed first, since they hold the patch open,
// and opened again afterwards.
func (a *App) SaveRegion(edit vmangos.RegionEdit) (vmangos.RegionResult, error) {
	defer a.releaseClient()()
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
	res.Patch, err = a.installWithGameClosed(dataDir, files)
	return res, err
}

// UpdateRegionServer rebuilds the server's map data for a continent after SaveRegion wrote tiles of it:
// only those tiles (RegionResult.ChangedTiles) when the server's data matched the patch before, else the
// whole map (#211). The world server stops and starts around it. It runs in the background: progress
// arrives as "servermaps:log" events and "servermaps:done" carries an error message, or nothing.
func (a *App) UpdateRegionServer(mapID int, tiles []string) error {
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
	go func() {
		defer a.releaseClient()()
		logf := func(line string) { runtime.EventsEmit(a.ctx, "servermaps:log", line) }
		msg := ""
		plan := vmangos.PublishPlan{ClientRoot: clientDir, ServerRoot: server}
		if err := vmangos.UpdateServerMaps(plan, filepath.Join(clientDir, "Data"), uint32(mapID), tiles, logf); err != nil {
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
	defer a.releaseClient()()
	dataDir, err := a.clientDataDir()
	if err != nil {
		return "", err
	}
	files, err := vmangos.MinimapFiles(dataDir, mapDir, tiles)
	if err != nil {
		return "", err
	}
	return a.installWithGameClosed(dataDir, files)
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

// WorldMapResult is what Write World Map wrote: the row (with its ID) and the patch.
type WorldMapResult struct {
	Row   vmangos.WorldMapRow `json:"row"`
	Patch string              `json:"patch"`
}

// WriteWorldMap writes a zone's world map into the client's patch: its twelve art tiles and its
// WorldMapArea.dbc row, with the game closed around it.
func (a *App) WriteWorldMap(spec vmangos.WorldMapSpec) (WorldMapResult, error) {
	defer a.releaseClient()()
	dataDir, err := a.clientDataDir()
	if err != nil {
		return WorldMapResult{}, err
	}
	files, row, err := vmangos.WorldMapFiles(dataDir, spec)
	if err != nil {
		return WorldMapResult{}, err
	}
	patch, err := a.installWithGameClosed(dataDir, files)
	return WorldMapResult{Row: row, Patch: patch}, err
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

// installWithGameClosed writes files into the client's patch. On Windows the game and the servers
// hold the patch open, so they are closed first and opened again afterwards.
func (a *App) installWithGameClosed(dataDir string, files []mpq.File) (string, error) {
	if goruntime.GOOS != "windows" {
		return vmangos.InstallPatch(dataDir, files)
	}
	sess, err := a.gameSession()
	if err != nil {
		return "", err
	}
	closed, err := sess.Stop()
	if err != nil {
		// Open what did close again, and leave the patch alone.
		return "", errors.Join(err, sess.Start(closed))
	}
	patch, err := vmangos.InstallPatch(dataDir, files)
	if restart := sess.Start(closed); restart != nil {
		err = errors.Join(err, restart)
	}
	return patch, err
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
// patch (only the tables that changed; the game and servers closed around it on Windows). Returns the
// patch's path, or "" when nothing changed. The server doesn't read the lights.
func (a *App) SaveLights(edit vmangos.LightsEdit) (string, error) {
	defer a.releaseClient()()
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
	return a.installWithGameClosed(dataDir, files)
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
	defer a.releaseClient()()
	dataDir, err := a.clientDataDir()
	if err != nil {
		return LoadingScreenResult{}, err
	}
	files, row, err := vmangos.LoadingScreenFiles(dataDir, spec)
	if err != nil {
		return LoadingScreenResult{}, err
	}
	patch, err := a.installWithGameClosed(dataDir, files)
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
// server's world database (area_template) took them too.
type AreaSaveResult struct {
	Patch  string `json:"patch"`
	Server bool   `json:"server"`
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

// SaveAreas writes the zone editor's rows into the client's AreaTable.dbc (in Meld's patch) and,
// with a server folder set, into the world database's area_template, which the server reads areas
// from, with the zones' weather into game_weather. The game and the servers are closed around the
// patch write on Windows.
func (a *App) SaveAreas(rows []vmangos.AreaRow, weather []vmangos.ZoneWeather) (AreaSaveResult, error) {
	var res AreaSaveResult
	defer a.releaseClient()()
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
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server == "" && len(weather) > 0 {
		return res, errors.New("the weather is the server's: set the VMaNGOS server folder first")
	}
	if server != "" {
		if err := vmangos.ApplySQL(server, vmangos.AreaSQL(rows)+weatherSQL); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
		res.Server = true
	}
	if len(rows) > 0 && !bytes.Equal(out, dbc) {
		if res.Patch, err = a.installWithGameClosed(dataDir, []mpq.File{{Name: vmangos.AreaTablePath, Data: out}}); err != nil {
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
// areatrigger_template and areatrigger_teleport, which the server reads. The game and the servers
// are closed around the patch write on Windows.
func (a *App) SaveAreaTriggers(rows []vmangos.AreaTrigger, remove []uint32) (AreaSaveResult, error) {
	var res AreaSaveResult
	defer a.releaseClient()()
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
	a.cfgMu.Lock()
	server := a.cfg.VmangosPath
	a.cfgMu.Unlock()
	if server != "" {
		if err := vmangos.ApplySQL(server, vmangos.AreaTriggerSQL(rows, remove)); err != nil {
			return res, fmt.Errorf("world database: %w", err)
		}
		res.Server = true
	}
	if !bytes.Equal(out, dbc) {
		if res.Patch, err = a.installWithGameClosed(dataDir, []mpq.File{{Name: vmangos.AreaTriggerPath, Data: out}}); err != nil {
			return res, err
		}
	}
	return res, nil
}

// gameSession is the game and server a region export restarts, with the saved login.
func (a *App) gameSession() (game.Session, error) {
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
		Log:        func(msg string) { runtime.LogInfo(a.ctx, msg) },
		Stale:      &a.stale,
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
		return "", sess.StartGame()
	}
	if err := sess.StopGame(); err != nil {
		return "", err
	}
	if err := vmangos.PlaceCharacter(sess.ServerRoot, character, spot, sess.WorldRunning); err != nil {
		return "", err
	}
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
// the server's tables, and the server's map data is extracted again before the world server restarts.
// It runs in the background. Progress arrives as "publish:log" events, and "publish:done" carries an error
// message, or nothing when the publish finished.
func (a *App) PublishVmangosMap(m vmangos.MapSpec) error {
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
	go func() {
		defer a.releaseClient()()
		logf := func(line string) { runtime.EventsEmit(a.ctx, "publish:log", line) }
		msg := ""
		if err := vmangos.Publish(vmangos.PublishPlan{ClientRoot: clientDir, ServerRoot: server}, m, logf); err != nil {
			msg = err.Error()
		}
		runtime.EventsEmit(a.ctx, "publish:done", msg)
	}()
	return nil
}

// clientRoot is the WoW client's folder (the one holding Data), whichever of the two was configured.
func (a *App) clientRoot() (string, error) {
	a.cfgMu.Lock()
	path := a.cfg.WowPath
	a.cfgMu.Unlock()
	if path == "" {
		return "", errors.New("no WoW client is set")
	}
	if strings.EqualFold(filepath.Base(path), "Data") {
		return filepath.Dir(path), nil
	}
	return path, nil
}

// releaseClient lets the game's files be written: the client's archives keep them open while
// they're loaded, so they close until the returned function runs.
func (a *App) releaseClient() func() {
	a.wow.Suspend()
	return func() { _ = a.wow.Resume() }
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

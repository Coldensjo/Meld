package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	goruntime "runtime"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"Meld/internal/config"
	"Meld/internal/game"
	"Meld/internal/heightmap"
	"Meld/internal/mapfile"
	"Meld/internal/mpq"
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

// beforeClose remembers the window's size for the next start. It never stops the close.
func (a *App) beforeClose(ctx context.Context) bool {
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
	_ = config.Save(a.cfg)
	return false
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
	return config.Save(a.cfg)
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

// NextCreatureGUID is the first creature guid the world database doesn't use yet, for creatures
// placed in the editor.
func (a *App) NextCreatureGUID() (int, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return 0, err
	}
	return vmangos.NextCreatureGUID(server)
}

// ReadCreature reads a creature template's row (its newest patch) for the creature editor.
func (a *App) ReadCreature(entry int) (vmangos.CreatureRecord, error) {
	server, _, err := a.serverAndData()
	if err != nil {
		return vmangos.CreatureRecord{}, err
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
	return vmangos.SaveCreature(server, entry, patch, values)
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
// returns the patch's path. The server's map data is built from the patch. On Windows the game and
// the servers are closed first, since they hold the patch open, and opened again afterwards.
func (a *App) SaveRegion(edit vmangos.RegionEdit) (string, error) {
	defer a.releaseClient()()
	dataDir, err := a.clientDataDir()
	if err != nil {
		return "", err
	}
	if goruntime.GOOS != "windows" {
		return vmangos.SaveRegion(dataDir, edit)
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
	patch, err := vmangos.SaveRegion(dataDir, edit)
	if restart := sess.Start(closed); restart != nil {
		err = errors.Join(err, restart)
	}
	return patch, err
}

// gameSession is the game and server a region export restarts, with the saved login.
func (a *App) gameSession() (game.Session, error) {
	root, err := a.clientRoot()
	if err != nil {
		return game.Session{}, err
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return game.Session{
		ClientRoot: root,
		ServerRoot: a.cfg.VmangosPath,
		Login:      a.cfg.Login,
		Run:        vmangos.OSRunner{},
		Log:        func(msg string) { runtime.LogInfo(a.ctx, msg) },
	}, nil
}

// GameLoginInfo is the saved game login. The password itself never goes to the frontend.
type GameLoginInfo struct {
	Account     string `json:"account"`
	HasPassword bool   `json:"hasPassword"`
}

// GameLogin returns the account the game logs in with after a region export.
func (a *App) GameLogin() GameLoginInfo {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return GameLoginInfo{Account: a.cfg.Login.Account, HasPassword: a.cfg.Login.Password != ""}
}

// SetGameLogin saves the account and password the game logs in with. An empty account clears the login.
// An empty password keeps the saved one when the account is unchanged, and otherwise saves none.
func (a *App) SetGameLogin(account, password string) error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	account = strings.TrimSpace(account)
	if account == "" {
		a.cfg.Login = config.Login{}
	} else {
		if password == "" && a.cfg.Login.Account == account {
			password = a.cfg.Login.Password
		}
		a.cfg.Login = config.Login{Account: account, Password: password}
	}
	return config.Save(a.cfg)
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

// WriteTextFile saves text at path.
func (a *App) WriteTextFile(path, text string) error {
	return os.WriteFile(path, []byte(text), 0o644)
}

// ReadTextFile returns the text of the file at path.
func (a *App) ReadTextFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	return string(b), err
}

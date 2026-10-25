package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"

	"Meld/internal/mpq"
	"Meld/internal/vmangos"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

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

package main

import (
	"errors"
	"path/filepath"

	"Meld/internal/config"
	"Meld/internal/vmangos"
)

// A CMaNGOS classic server, the first core beside VMaNGOS (#894): File › Export Spawn SQL writes its
// spawns, and File › Compile to CMaNGOS Server rebuilds its map data from the client's patch with its
// own extractors (the owner's choice). Every other server tool stays VMaNGOS-only.

// CmangosPath returns the CMaNGOS classic server folder, or "".
func (a *App) CmangosPath() string {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return a.cfg.CmangosPath
}

// BrowseCmangosFolder lets the user pick a CMaNGOS server folder. Returns "" if cancelled.
func (a *App) BrowseCmangosFolder() (string, error) {
	return a.openDirectory(dialogOptions{
		Title:            "Select the CMaNGOS classic server folder (the one with mangosd.exe)",
		DefaultDirectory: a.CmangosPath(),
	})
}

// SetCmangosPath checks that path is a CMaNGOS server folder and remembers it. "" forgets it.
func (a *App) SetCmangosPath(path string) error {
	if path != "" {
		if _, err := vmangos.CheckCMaNGOS(path); err != nil {
			return err
		}
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.CmangosPath = path
	return config.Update(func(c *config.Config) error {
		c.CmangosPath = path
		return nil
	})
}

// UpdateCMaNGOSServer rebuilds the CMaNGOS server's map data from the client's patch for mapID (the
// open region's map), once the game is closed and the world server stopped, in the background, as
// UpdateRegionServer does for VMaNGOS: its progress arrives as "servermaps:log" events and
// "servermaps:done" carries an error message, or nothing. It shares the VMaNGOS rebuild's busy flag,
// since both read the patch and their world servers are both mangosd.exe.
func (a *App) UpdateCMaNGOSServer(mapID int) (err error) {
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
	path := a.CmangosPath()
	if path == "" {
		return errors.New("set the CMaNGOS server folder first (Edit › Preferences › Folders)")
	}
	if mapID < 0 {
		return errors.New("the client's Map.dbc has no row for this map")
	}
	server, err := vmangos.CheckCMaNGOS(path)
	if err != nil {
		return err
	}
	started = true
	go func() {
		defer a.serverBusy.Store(false)
		logf := func(line string) { a.emit("servermaps:log", line) }
		msg := ""
		dataDir := filepath.Join(clientDir, "Data")
		if err := a.waitForGameClosed(dataDir, logf); err != nil {
			msg = err.Error()
		} else if err := vmangos.UpdateCMaNGOSMaps(server, clientDir, uint32(mapID), !a.buildMoveMaps(), nil, logf); err != nil {
			msg = err.Error()
		}
		a.emit("servermaps:done", msg)
	}()
	return nil
}

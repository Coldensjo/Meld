package main

import (
	"errors"
	"path/filepath"

	"Meld/internal/config"
	"Meld/internal/vmangos"
)

// An AzerothCore server, the 3.3.5a core (#1073, #1094): File › Export Spawn SQL writes its spawns, and
// File › Compile to AzerothCore Server rebuilds its map data from the client's patch with its own
// extractors. Every other server tool stays VMaNGOS-only.

// AzerothcorePath returns the AzerothCore server folder, or "".
func (a *App) AzerothcorePath() string {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return a.cfg.AzerothcorePath
}

// BrowseAzerothcoreFolder lets the user pick an AzerothCore server folder. Returns "" if cancelled.
func (a *App) BrowseAzerothcoreFolder() (string, error) {
	return a.openDirectory(dialogOptions{
		Title:            "Select the AzerothCore server folder (the one with bin and etc)",
		DefaultDirectory: a.AzerothcorePath(),
	})
}

// SetAzerothcorePath checks that path is an AzerothCore server folder and remembers it. "" forgets it.
func (a *App) SetAzerothcorePath(path string) error {
	if path != "" {
		if _, err := vmangos.CheckAzerothCore(path); err != nil {
			return err
		}
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.AzerothcorePath = path
	return config.Update(func(c *config.Config) error {
		c.AzerothcorePath = path
		return nil
	})
}

// UpdateAzerothCoreServer rebuilds the AzerothCore server's map data from the client's patch for mapID
// (the open region's map), its movement maps for tiles ("x_y"; none for the whole map), once the game is
// closed and the world server stopped, in the background, as UpdateCMaNGOSServer does: its progress
// arrives as "servermaps:log" events and "servermaps:done" carries an error message, or nothing. It
// shares the server rebuilds' busy flag, since they all read the patch.
func (a *App) UpdateAzerothCoreServer(mapID int, tiles []string) (err error) {
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
	path := a.AzerothcorePath()
	if path == "" {
		return errors.New("set the AzerothCore server folder first (Edit › Preferences › Folders)")
	}
	if mapID < 0 {
		return errors.New("the client's Map.dbc has no row for this map")
	}
	server, err := vmangos.CheckAzerothCore(path)
	if err != nil {
		return err
	}
	started = true
	go func() {
		defer a.serverBusy.Store(false)
		logf := func(line string) { a.emit("servermaps:log", line) }
		msg := ""
		if err := a.waitForGameClosed(filepath.Join(clientDir, "Data"), logf); err != nil {
			msg = err.Error()
		} else if err := vmangos.UpdateAzerothCoreMaps(server, clientDir, uint32(mapID), tiles, !a.buildMoveMaps(), nil, logf); err != nil {
			msg = err.Error()
		}
		a.emit("servermaps:done", msg)
	}()
	return nil
}

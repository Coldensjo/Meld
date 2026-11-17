package main

import (
	"errors"
	"path/filepath"

	"Meld/internal/clientbuild"
	"Meld/internal/config"
	"Meld/internal/vmangos"
)

// An AzerothCore server, the 3.3.5a core (#1073, #1094): File › Export Spawn SQL writes its spawns, and
// File › Compile to AzerothCore Server rebuilds its map data from the client's patch with its own
// extractors. While the client is 3.3.5a, its world database (acore_world) is also the one the region's
// spawns, the creature and object templates and the Place tool read (acWorld). The database editors
// (items, quests, spells, loot) and the game tools stay VMaNGOS-only.

// acWorld is the AzerothCore server whose world database the spawn bindings use instead of VMaNGOS's,
// with the client's Data folder: the AzerothCore server folder, while the client is 3.3.5a. ok is false
// when either is not so, and the bindings go to the VMaNGOS server as before; err is set when the folder
// is set for a 3.3.5a client but is no AzerothCore server.
func (a *App) acWorld() (server vmangos.AzerothCoreServer, dataDir string, ok bool, err error) {
	path := a.AzerothcorePath()
	if path == "" {
		return server, "", false, nil
	}
	dataDir, err = a.clientDataDir()
	if err != nil || clientbuild.Detect(dataDir).Build != clientbuild.WotLK {
		return server, "", false, nil
	}
	server, err = vmangos.CheckAzerothCore(path)
	return server, dataDir, err == nil, err
}

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

// SetAzerothcorePath checks that path is an AzerothCore server folder and remembers it, or the install
// its build names when it is AzerothCore's source. "" forgets it.
func (a *App) SetAzerothcorePath(path string) error {
	if path != "" {
		s, err := vmangos.CheckAzerothCore(path)
		if err != nil {
			return err
		}
		path = s.Root
	}
	vmangos.ForgetACTemplates()
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

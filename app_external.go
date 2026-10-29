package main

import (
	"errors"
	"fmt"
	"path/filepath"

	"Meld/internal/config"
	"Meld/internal/vmangos"
)

// File › Connect to External Database (#856): the databases of a VMaNGOS server on another machine,
// read from a copy of its mangosd.conf (the owner's choice: Meld stores no password), after a warning
// that names them. The connection lasts the session: each start of Meld uses the server folder's own
// databases until the user connects again, past the warning again. While connected, the database
// editors (spawns, templates, items, quests, spells) read and write it, and everything that writes
// files into a server folder or drives the local server is off (errExternal): Compile to Server,
// Publish, the server controls, Play here, the flight routes and the account and character writes.

// errExternal is what a binding that writes into the local server folder, or drives the local server,
// says while an external database is connected.
var errExternal = errors.New("this is off while Meld is connected to an external database, since it writes into the local server folder or drives the local server (File › Disconnect External Database)")

// errExternalRoutes is SaveTaxi's errExternal: the stops are database rows, the routes server files.
var errExternalRoutes = errors.New("flight routes go into the server folder's data, which is off while Meld is connected to an external database: save the stops alone, or disconnect first")

// externalOn says whether an external database is connected.
func externalOn() bool {
	return vmangos.External() != ""
}

// hasDB says whether a binding has a world database to use: the server folder's, or an external one.
func hasDB(server string) bool {
	return server != "" || externalOn()
}

// BrowseExternalConf lets the user pick the mangosd.conf of the server to connect to. Returns "" if
// cancelled.
func (a *App) BrowseExternalConf() (string, error) {
	a.cfgMu.Lock()
	last := a.cfg.ExternalConf
	a.cfgMu.Unlock()
	dir := ""
	if last != "" {
		dir = filepath.Dir(last)
	}
	return a.openFile(dialogOptions{
		Title:            "Select the external server's mangosd.conf",
		DefaultDirectory: dir,
		Filters:          []fileFilter{{DisplayName: "Server configuration (*.conf)", Pattern: "*.conf"}, {DisplayName: "All files", Pattern: "*.*"}},
	})
}

// ReadExternalDatabase reads the databases a mangosd.conf names, without connecting, for the warning
// shown before ConnectExternalDatabase.
func (a *App) ReadExternalDatabase(path string) (vmangos.ExternalDatabase, error) {
	return vmangos.ReadExternal(path)
}

// ConnectExternalDatabase points every database connection at the mangosd.conf at path, once its world
// database answers. The editor calls it only after the user confirmed the warning.
func (a *App) ConnectExternalDatabase(path string) (vmangos.ExternalDatabase, error) {
	if path == "" {
		return vmangos.ExternalDatabase{}, errors.New("no mangosd.conf was picked")
	}
	if a.serverControl.Load() {
		return vmangos.ExternalDatabase{}, errors.New("the local server is being started or stopped: wait for it to finish")
	}
	info, err := vmangos.ReadExternal(path)
	if err != nil {
		return info, err
	}
	if err := vmangos.PingExternal(path); err != nil {
		return info, fmt.Errorf("the world database at %s:%s did not answer: %w", info.World.Host, info.World.Port, err)
	}
	vmangos.SetExternal(path)
	a.cfgMu.Lock()
	a.cfg.ExternalConf = path
	a.cfgMu.Unlock()
	if err := config.Update(func(c *config.Config) error {
		c.ExternalConf = path
		return nil
	}); err != nil {
		a.logWarning("The external database's mangosd.conf path wasn't saved: " + err.Error())
	}
	a.logInfo(fmt.Sprintf("Connected to the external database %s at %s:%s (from %s). Edits to the server's tables now change that server.", info.World.Name, info.World.Host, info.World.Port, path))
	return info, nil
}

// DisconnectExternalDatabase goes back to the server folder's own databases.
func (a *App) DisconnectExternalDatabase() {
	if !externalOn() {
		return
	}
	vmangos.SetExternal("")
	a.logInfo("Disconnected from the external database: Meld uses the VMaNGOS server folder's databases again.")
}

// ExternalDatabaseInfo is the connected external database (Conf "" for none), for the status bar and
// the File menu.
func (a *App) ExternalDatabaseInfo() vmangos.ExternalDatabase {
	path := vmangos.External()
	if path == "" {
		return vmangos.ExternalDatabase{}
	}
	info, err := vmangos.ReadExternal(path)
	if err != nil {
		// The file changed or went since the connect: still say which one is connected.
		return vmangos.ExternalDatabase{Conf: path}
	}
	return info
}

package main

import "Meld/internal/records"

// recordHost is the records package's Host for a save on server and dataDir: client files wait for
// the game the app sees running, a queued file shows in the status bar and starts the pending watcher,
// and a write to the world database marks the game's cached rows stale and has the running world
// server reload it. meldtool's write commands give the package a Host of their own (#1055).
func (a *App) recordHost(server, dataDir string) records.Host {
	return records.Host{
		Server:      server,
		Data:        dataDir,
		GameRunning: a.gameRunning,
		Queued: func() {
			a.emitPending(dataDir)
			a.watchPending()
		},
		Changed: a.recordChanged,
	}
}

// recordChanged follows a write to the world database: the game's caches forget the old rows (now
// when the game is closed, else at its next start from Meld), and the running world server reloads it.
func (a *App) recordChanged(c records.Change) {
	if c.Cached != "" {
		records.MarkStale(&a.stale, c)
		a.forgetStale()
	}
	a.reloadWorld(c.Save, c.Entries...)
}

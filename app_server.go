package main

import (
	"errors"

	"Meld/internal/game"
	"Meld/internal/vmangos"
)

// The File menu's Start, Stop and Restart Server (#857): the local VMaNGOS server's database, auth
// and world servers, brought up and down together (game/server.go).

// ServerStatusInfo is what the File menu shows of the local server.
type ServerStatusInfo struct {
	// Available says the controls work here; Reason says why not when they don't (no server folder,
	// not Windows, a probe's sandbox).
	Available bool   `json:"available"`
	Reason    string `json:"reason"`
	// Database says the world database answers, OwnDatabase that it is the server folder's own (the one
	// Stop shuts down); Auth and World that realmd and mangosd run.
	Database    bool `json:"database"`
	OwnDatabase bool `json:"ownDatabase"`
	Auth        bool `json:"auth"`
	World       bool `json:"world"`
	// Busy says a Start, Stop or Restart is running.
	Busy bool `json:"busy"`
}

// serverSession is the session the server controls use: the server folder and the saved login, with
// no client needed.
func (a *App) serverSession() (game.Session, error) {
	if a.sandboxed() {
		return game.Session{}, errSandboxed
	}
	a.cfgMu.Lock()
	s := game.Session{ServerRoot: a.cfg.VmangosPath, Login: a.cfg.Login, Run: vmangos.OSRunner{}, Log: a.logStep}
	a.cfgMu.Unlock()
	if s.ServerRoot == "" {
		return s, errors.New("no VMaNGOS server folder is set (Edit › Preferences › Folders)")
	}
	if err := vmangos.Supported(s.Run); err != nil {
		return s, err
	}
	return s, nil
}

// ServerStatus says whether the local server's database, auth and world servers run.
func (a *App) ServerStatus() ServerStatusInfo {
	s, err := a.serverSession()
	if err != nil {
		return ServerStatusInfo{Reason: err.Error()}
	}
	st := s.ServerState()
	return ServerStatusInfo{Available: true, Database: st.Database, OwnDatabase: st.OwnDatabase, Auth: st.Auth, World: st.World, Busy: a.serverControl.Load()}
}

// StartServer starts the local server: its database, then the auth and world servers.
func (a *App) StartServer() error {
	return a.controlServer(game.Session.StartServer)
}

// StopServer stops the local server: the world server (saving the characters), the auth server, then
// the server folder's own database.
func (a *App) StopServer() error {
	return a.controlServer(game.Session.StopServer)
}

// RestartServer stops the local server and starts it again.
func (a *App) RestartServer() error {
	return a.controlServer(game.Session.RestartServer)
}

// controlServer runs one server control at a time, and none while a compile rewrites the server's map
// data (serverBusy), which may restart the world server itself.
func (a *App) controlServer(do func(game.Session) error) error {
	s, err := a.serverSession()
	if err != nil {
		return err
	}
	if a.serverBusy.Load() {
		return errors.New("a compile to the server is running: wait for it to finish")
	}
	if !a.serverControl.CompareAndSwap(false, true) {
		return errors.New("the server is already being started or stopped")
	}
	defer a.serverControl.Store(false)
	return do(s)
}

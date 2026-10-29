package game

import (
	"errors"
	"fmt"

	"Meld/internal/vmangos"
)

// The File menu's server controls (#857): the local VMaNGOS server's database, auth server (realmd)
// and world server (mangosd), started and stopped together, as start-server.bat and stop-server.bat
// do. They are the author's own action: no compile calls them (#661).

// The database steps, variables so tests can stand in for the database.
var (
	databaseState = vmangos.DatabaseState
	startDatabase = vmangos.StartDatabase
	stopDatabase  = vmangos.StopDatabase
	shutdownWorld = vmangos.ShutdownWorld
)

// ServerState says which of the local server's programs run.
type ServerState struct {
	// Database says the world database answers; OwnDatabase that it is the server folder's own, the
	// one Stop shuts down.
	Database    bool
	OwnDatabase bool
	Auth        bool
	World       bool
}

// errNoServer is what the controls say without a server folder.
var errNoServer = errors.New("no VMaNGOS server folder is set (Edit › Preferences › Folders)")

// checkServer says why the server can't be started or stopped here, or nil.
func (s Session) checkServer() error {
	if s.ServerRoot == "" {
		return errNoServer
	}
	return vmangos.Supported(s.Run)
}

// ServerState reads which of the server's programs run.
func (s Session) ServerState() ServerState {
	var st ServerState
	if s.checkServer() != nil {
		return st
	}
	st.Database, st.OwnDatabase = databaseState(s.ServerRoot)
	st.Auth = s.Run.Running(authImage)
	st.World = s.Run.Running(worldImage)
	return st
}

// StartServer starts what isn't running of the database, then the auth server, then the world
// server, and waits for the servers to accept connections.
func (s Session) StartServer() error {
	if err := s.checkServer(); err != nil {
		return err
	}
	s.log("Starting the world database…")
	if err := startDatabase(s.ServerRoot); err != nil {
		// The servers can't start without it.
		return err
	}
	return s.Start(Closed{Auth: !s.Run.Running(authImage), World: !s.Run.Running(worldImage)})
}

// StopServer stops the world server (letting it save the characters first), then the auth server,
// then the database, when it is the server folder's own. A database that isn't is left running, and
// said so in the log.
func (s Session) StopServer() error {
	if err := s.checkServer(); err != nil {
		return err
	}
	if s.Run.Running(worldImage) {
		s.log("Stopping the world server…")
		if err := s.stopWorld(); err != nil {
			return err
		}
	}
	if s.Run.Running(authImage) {
		s.log("Stopping the auth server…")
		if err := s.closeAuth(); err != nil {
			return err
		}
	}
	s.log("Stopping the world database…")
	err := stopDatabase(s.ServerRoot)
	if errors.Is(err, vmangos.ErrForeignDatabase) {
		s.log("The world database was left running: " + err.Error() + ".")
		return nil
	}
	return err
}

// RestartServer stops the server, then starts it again.
func (s Session) RestartServer() error {
	if err := s.StopServer(); err != nil {
		return err
	}
	return s.StartServer()
}

// stopWorld stops the world server: a shutdown through its SOAP console when that is on and a login
// is saved (the server saves the characters in the world before it exits), else the close a console
// window gets; when it is still up after that, it is forced, since the author asked for it to stop.
func (s Session) stopWorld() error {
	gone := func() bool { return !s.Run.Running(worldImage) }
	err := shutdownWorld(s.ServerRoot, s.Login.Account, s.Login.Password)
	switch {
	case err == nil:
		if waitFor(gone, exitWait) {
			return nil
		}
	case !errors.Is(err, vmangos.ErrSoapOff) && s.Login.Account != "":
		// A server that exits before it answers breaks the reply: give it a moment.
		if waitFor(gone, authGrace) {
			return nil
		}
		s.log("The world server's console didn't take the shutdown (" + err.Error() + "); closing its window.")
	}
	s.kill(worldImage, false)
	if waitFor(gone, exitWait) {
		return nil
	}
	s.log("The world server didn't close; forcing it.")
	s.kill(worldImage, true)
	if !waitFor(gone, exitWait) {
		return fmt.Errorf("%s did not stop", worldImage)
	}
	return nil
}

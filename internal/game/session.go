// Package game closes the WoW client and the VMaNGOS servers around a region export, then opens them
// again and logs the client in.
package game

import (
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"time"

	"Meld/internal/config"
	"Meld/internal/vmangos"
)

const (
	gameImage    = "Wow.exe"
	benillaImage = "benilla.exe"
	worldImage   = "mangosd.exe"
	authImage    = "realmd.exe"

	// The ports the servers listen on by default. A server whose conf changes them only costs the wait.
	authPort  = 3724
	worldPort = 8085
)

// How long to wait for a program to exit after it's asked to, and for a server to accept connections.
var (
	exitWait  = 20 * time.Second
	readyWait = 60 * time.Second
	// authGrace is how long the auth server gets to close on its own before it's forced.
	authGrace = 3 * time.Second
)

// Session is the game and server a region export shuts down and brings back.
type Session struct {
	// ClientRoot is the WoW client's folder, with Wow.exe in it.
	ClientRoot string
	// ServerRoot is the VMaNGOS server folder. Empty means no server to close or start.
	ServerRoot string
	// Login is the account the client logs in with once it's open. Without a password it isn't logged in.
	Login config.Login
	// Run starts and stops programs.
	Run vmangos.Runner
	// Log gets a line per step. Nil discards them.
	Log func(string)
	// Ready reports whether a port accepts connections. Nil checks it on this machine.
	Ready func(port int) bool
	// Benilla, when set, is the Benilla folder: the game closed and opened is Benilla instead of
	// Wow.exe, started from that folder with the install's Data folder and the login in its environment.
	Benilla string
	// Window is how the game's window opens, written into its settings before it starts.
	Window Window
	// Realm is the realm Benilla picks after logging in (WOW_REALM), so it doesn't stop at the realm
	// list. Empty leaves the pick to Benilla (the realm it was last on).
	Realm string
}

// BenillaExe is where a release build of Benilla puts its program, under its folder.
func BenillaExe(folder string) string {
	return filepath.Join(folder, "target", "release", benillaImage)
}

// envStarter is a Runner that can also start a program with extra environment variables.
type envStarter interface {
	StartEnv(dir, name string, env []string, args ...string) error
}

// game is the image of the game this session closes and opens.
func (s Session) game() string {
	if s.Benilla != "" {
		return benillaImage
	}
	return gameImage
}

// Closed is what Stop shut down, so Start opens only those again.
type Closed struct {
	Game  bool
	World bool
	Auth  bool
}

// Stop closes the game, then the world and auth servers, each only if it's running. It waits for each
// one to exit. On an error it returns what it did close, so the caller can still Start them.
func (s Session) Stop() (Closed, error) {
	var c Closed
	if s.Run.Running(s.game()) {
		if err := s.close(s.game()); err != nil {
			return c, err
		}
		c.Game = true
	}
	if s.ServerRoot == "" {
		return c, nil
	}
	if s.Run.Running(worldImage) {
		if err := s.close(worldImage); err != nil {
			return c, err
		}
		c.World = true
	}
	if s.Run.Running(authImage) {
		if err := s.closeAuth(); err != nil {
			return c, err
		}
		c.Auth = true
	}
	return c, nil
}

// Start opens what Stop closed: the auth server, then the world server, then the client. The client
// is logged in once the servers accept connections. Errors are joined, and every step is tried.
func (s Session) Start(c Closed) error {
	var errs []error
	if c.Auth {
		s.log("Starting the auth server…")
		errs = append(errs, s.launch(authImage, "realmd.conf"))
	}
	if c.World {
		s.log("Starting the world server…")
		errs = append(errs, s.launch(worldImage, "mangosd.conf"))
	}
	if c.Auth && !s.waitReady(authPort) {
		s.log("The auth server is not accepting connections yet.")
	}
	if c.World && !s.waitReady(worldPort) {
		s.log("The world server is not accepting connections yet.")
	}
	if c.Game {
		if err := s.applyWindow(); err != nil {
			s.log("The game's window setting wasn't written: " + err.Error())
		}
	}
	if c.Game && s.Benilla != "" {
		s.log("Starting Benilla…")
		errs = append(errs, s.startBenilla())
	} else if c.Game {
		s.log("Starting World of Warcraft…")
		if err := s.Run.Start(s.ClientRoot, filepath.Join(s.ClientRoot, gameImage)); err != nil {
			errs = append(errs, fmt.Errorf("starting the game: %w", err))
		} else if s.Login.Account != "" && s.Login.Password != "" {
			go s.logIn()
		}
	}
	return errors.Join(errs...)
}

// startBenilla starts Benilla from its folder (where it keeps benilla-config), reading the install's
// Data folder; with a saved login, Benilla logs itself in (WOW_USER and WOW_PASS), no typing needed,
// picks the realm (WOW_REALM) and, with a saved character, enters the world as it (WOW_CHAR).
func (s Session) startBenilla() error {
	env := []string{"WOW_DATA=" + filepath.Join(s.ClientRoot, "Data")}
	if s.Login.Account != "" && s.Login.Password != "" {
		env = append(env, "WOW_USER="+s.Login.Account, "WOW_PASS="+s.Login.Password)
		if s.Realm != "" {
			env = append(env, "WOW_REALM="+s.Realm)
		}
		if s.Login.Character != "" {
			env = append(env, "WOW_CHAR="+s.Login.Character)
		}
	}
	exe := BenillaExe(s.Benilla)
	if r, ok := s.Run.(envStarter); ok {
		if err := r.StartEnv(s.Benilla, exe, env); err != nil {
			return fmt.Errorf("starting Benilla: %w", err)
		}
		return nil
	}
	return errors.New("this runner can't start Benilla with its data folder")
}

// StartGame opens the session's game on its own (the menu's Launch Game), logged in when a login is saved.
func (s Session) StartGame() error {
	return s.Start(Closed{Game: true})
}

// StopGame closes the session's game, when it's running, and leaves the servers alone.
func (s Session) StopGame() error {
	if !s.Run.Running(s.game()) {
		return nil
	}
	return s.close(s.game())
}

// WorldRunning reports whether the world server is running.
func (s Session) WorldRunning() bool {
	return s.Run.Running(worldImage)
}

// logIn types the saved account into the client's login screen. It runs in the background, since the
// window takes a while to appear, and its failures go to the log.
func (s Session) logIn() {
	if err := Login(s.Login, s.Log); err != nil {
		s.log("Logging in failed: " + err.Error())
	}
}

// close asks a program to exit, the way closing its window does, and waits for it to go.
func (s Session) close(image string) error {
	_ = s.Run.Run("", "taskkill", []string{"/IM", image}, nil)
	if !waitFor(func() bool { return !s.Run.Running(image) }, exitWait) {
		return fmt.Errorf("%s did not close: close it and export again", image)
	}
	return nil
}

// closeAuth closes the auth server. It has no window, so a graceful close can't reach it, and it keeps
// no state that a forced stop could lose. It's given a short graceful try, then forced.
func (s Session) closeAuth() error {
	_ = s.Run.Run("", "taskkill", []string{"/IM", authImage}, nil)
	if waitFor(func() bool { return !s.Run.Running(authImage) }, authGrace) {
		return nil
	}
	_ = s.Run.Run("", "taskkill", []string{"/F", "/IM", authImage}, nil)
	if !waitFor(func() bool { return !s.Run.Running(authImage) }, exitWait) {
		return fmt.Errorf("%s did not close: close it and export again", authImage)
	}
	return nil
}

// launch starts a server program from its folder under run, with its conf file.
func (s Session) launch(image, conf string) error {
	run := filepath.Join(s.ServerRoot, "run")
	if err := s.Run.Start(run, filepath.Join(run, image), "-c", filepath.Join(run, conf)); err != nil {
		return fmt.Errorf("starting %s: %w", image, err)
	}
	return nil
}

func (s Session) waitReady(port int) bool {
	ready := s.Ready
	if ready == nil {
		ready = portOpen
	}
	return waitFor(func() bool { return ready(port) }, readyWait)
}

func (s Session) log(msg string) {
	if s.Log != nil {
		s.Log(msg)
	}
}

// portOpen reports whether something on this machine accepts connections on port.
func portOpen(port int) bool {
	c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), time.Second)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// waitFor polls done until it's true or the timeout passes, and reports which.
func waitFor(done func() bool, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for !done() {
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(250 * time.Millisecond)
	}
	return true
}

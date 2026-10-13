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
	gameImage  = "Wow.exe"
	worldImage = "mangosd.exe"
	authImage  = "realmd.exe"

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
	if s.Run.Running(gameImage) {
		if err := s.close(gameImage); err != nil {
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
		s.log("Starting World of Warcraft…")
		if err := s.Run.Start(s.ClientRoot, filepath.Join(s.ClientRoot, gameImage)); err != nil {
			errs = append(errs, fmt.Errorf("starting the game: %w", err))
		} else if s.Login.Account != "" && s.Login.Password != "" {
			go s.logIn()
		}
	}
	return errors.Join(errs...)
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

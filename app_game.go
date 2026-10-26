package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"Meld/internal/config"
	"Meld/internal/game"
	"Meld/internal/vmangos"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// gameSession is the game and server a region export restarts, with the saved login.
func (a *App) gameSession() (game.Session, error) {
	if a.sandboxed() {
		return game.Session{}, errSandboxed
	}
	root, err := a.clientRoot()
	if err != nil {
		return game.Session{}, err
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	s := game.Session{
		ClientRoot: root,
		ServerRoot: a.cfg.VmangosPath,
		Login:      a.cfg.Login,
		Run:        vmangos.OSRunner{},
		Log: func(msg string) {
			runtime.LogInfo(a.ctx, msg)
			if a.slog != nil {
				_ = a.slog.Append([]string{time.Now().Format("15:04:05") + " " + msg})
			}
		},
		Stale: &a.stale,
	}
	if a.cfg.GameClient == "benilla" && a.cfg.BenillaPath != "" {
		s.Benilla = a.cfg.BenillaPath
		if s.ServerRoot != "" {
			// Without it Benilla stops at the realm list; a database that's down only costs that.
			s.Realm, _ = vmangos.RealmName(s.ServerRoot)
		}
	}
	s.Window = game.Window{Mode: a.cfg.GameWindow, Resolution: a.cfg.GameResolution}
	return s, nil
}

// GameWindowInfo is how the game's window opens when Meld starts it (game.Window).
type GameWindowInfo struct {
	// Mode is "" (the game's own setting), "windowed" or "fullscreen".
	Mode       string `json:"mode"`
	Resolution string `json:"resolution"`
}

// GameWindow says how the game's window opens when Meld starts it.
func (a *App) GameWindow() GameWindowInfo {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return GameWindowInfo{Mode: a.cfg.GameWindow, Resolution: a.cfg.GameResolution}
}

// SetGameWindow sets how the game's window opens when Meld starts it: mode "" (the game's own
// setting), "windowed" or "fullscreen", at resolution ("1280x720"). It's written into the game's
// own settings the next time Meld starts it.
func (a *App) SetGameWindow(mode, resolution string) error {
	w := game.Window{Mode: mode, Resolution: resolution}
	if err := w.Check(); err != nil {
		return err
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.GameWindow, a.cfg.GameResolution = mode, resolution
	return config.Update(func(c *config.Config) error {
		c.GameWindow, c.GameResolution = mode, resolution
		return nil
	})
}

// GameClientInfo is which game Meld closes and opens around an export, and Benilla's folder.
type GameClientInfo struct {
	// Client is "wow" (Wow.exe) or "benilla".
	Client      string `json:"client"`
	BenillaPath string `json:"benillaPath"`
	// BenillaBuilt says the Benilla folder has a release build of the program.
	BenillaBuilt bool `json:"benillaBuilt"`
}

// GameClient says which game client Meld uses.
func (a *App) GameClient() GameClientInfo {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	info := GameClientInfo{Client: "wow", BenillaPath: a.cfg.BenillaPath}
	if a.cfg.GameClient == "benilla" {
		info.Client = "benilla"
	}
	if info.BenillaPath != "" {
		_, err := os.Stat(game.BenillaExe(info.BenillaPath))
		info.BenillaBuilt = err == nil
	}
	return info
}

// SetGameClient picks the game Meld closes and opens around an export: "wow" or "benilla". Benilla
// needs its folder set first, with a release build in it.
func (a *App) SetGameClient(client string) error {
	if client != "wow" && client != "benilla" {
		return fmt.Errorf("unknown game client %q", client)
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	if client == "benilla" {
		if a.cfg.BenillaPath == "" {
			return errors.New("choose the Benilla folder first (Settings › Benilla Folder…)")
		}
		if _, err := os.Stat(game.BenillaExe(a.cfg.BenillaPath)); err != nil {
			return fmt.Errorf("Benilla isn't built in %s: run cargo build --release -p benilla there", a.cfg.BenillaPath)
		}
	}
	value := ""
	if client == "benilla" {
		value = "benilla"
	}
	a.cfg.GameClient = value
	return config.Update(func(c *config.Config) error {
		c.GameClient = value
		return nil
	})
}

// BrowseBenillaFolder lets the user pick the Benilla folder (its repository). Returns "" if cancelled.
func (a *App) BrowseBenillaFolder() (string, error) {
	a.cfgMu.Lock()
	dir := a.cfg.BenillaPath
	a.cfgMu.Unlock()
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Select the Benilla folder", DefaultDirectory: dir})
}

// SetBenillaPath saves the Benilla folder: the repository, with its Cargo.toml (the program is built
// into target/release there).
func (a *App) SetBenillaPath(path string) error {
	if path != "" {
		if _, err := os.Stat(filepath.Join(path, "crates", "benilla-mpq")); err != nil {
			return fmt.Errorf("%s isn't a Benilla folder (it has no crates/benilla-mpq)", path)
		}
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.BenillaPath = path
	return config.Update(func(c *config.Config) error {
		c.BenillaPath = path
		return nil
	})
}

// LaunchGame opens the chosen game client now (Wow.exe or Benilla), logged in when a login is saved.
func (a *App) LaunchGame() error {
	sess, err := a.gameSession()
	if err != nil {
		return err
	}
	a.flushPending()
	return sess.StartGame()
}

// LaunchGameAt is LaunchGame with the saved character entering the world at spot (where the editor's
// camera is): with the server folder set, the game is closed, the character logged out and moved
// there in the server's database first. It returns the character placed, or "" when there is no
// character or server to place it on, and the game is only launched.
func (a *App) LaunchGameAt(spot vmangos.CharacterSpot) (string, error) {
	sess, err := a.gameSession()
	if err != nil {
		return "", err
	}
	character := sess.Login.Character
	if character == "" || sess.ServerRoot == "" {
		a.flushPending()
		return "", sess.StartGame()
	}
	if err := sess.StopGame(); err != nil {
		return "", err
	}
	if err := vmangos.PlaceCharacter(sess.ServerRoot, character, spot, sess.WorldRunning); err != nil {
		return "", err
	}
	a.flushPending()
	return character, sess.StartGame()
}

// PlayHere moves the Game Login's character, in the world now, to spot (where the editor's camera is)
// through the running world server's SOAP console, without closing the game. It returns the character
// moved, or an error that says why it can't (no character or server set, the world server not running,
// SOAP off, the character not in the world), so the editor can point to Launch instead.
func (a *App) PlayHere(spot vmangos.CharacterSpot) (string, error) {
	sess, err := a.gameSession()
	if err != nil {
		return "", err
	}
	character := sess.Login.Character
	switch {
	case character == "":
		return "", errors.New("Game Login has no character to move")
	case sess.ServerRoot == "":
		return "", errors.New("no VMaNGOS server folder is set")
	case vmangos.Supported(sess.Run) != nil:
		return "", vmangos.Supported(sess.Run)
	case !sess.WorldRunning():
		return "", errors.New("the world server isn't running")
	}
	if err := vmangos.TeleportCharacter(sess.ServerRoot, sess.Login.Account, sess.Login.Password, character, spot); err != nil {
		return "", err
	}
	return character, nil
}

// GameLoginInfo is the saved game login. The password itself never goes to the frontend.
type GameLoginInfo struct {
	Account     string `json:"account"`
	HasPassword bool   `json:"hasPassword"`
	Character   string `json:"character"`
}

// GameLogin returns the account the game logs in with after a region export.
func (a *App) GameLogin() GameLoginInfo {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	l := a.cfg.Login
	return GameLoginInfo{Account: l.Account, HasPassword: l.Password != "", Character: l.Character}
}

// SetGameLogin saves the account and password the game logs in with, and the character it enters the
// world as ("" for character select). An empty account clears the login. An empty password keeps the
// saved one when the account is unchanged, and otherwise saves none.
func (a *App) SetGameLogin(account, password, character string) error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	account = strings.TrimSpace(account)
	if account == "" {
		a.cfg.Login = config.Login{}
	} else {
		if password == "" && a.cfg.Login.Account == account {
			password = a.cfg.Login.Password
		}
		a.cfg.Login = config.Login{Account: account, Password: password, Character: strings.TrimSpace(character)}
	}
	login := a.cfg.Login
	return config.Update(func(c *config.Config) error {
		c.Login = login
		return nil
	})
}

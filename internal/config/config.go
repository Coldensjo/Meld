// Package config persists small per-user settings in the OS config dir
// (e.g. ~/.config/Meld/config.json, %AppData%\Meld\config.json).
package config

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

type Config struct {
	// WowPath is a local WoW 1.x client folder whose MPQs are read live.
	WowPath string `json:"wowPath"`
	// VmangosPath is the VMaNGOS server folder that map patches and SQL are written for.
	VmangosPath string `json:"vmangosPath,omitempty"`
	// ExternalConf is the mangosd.conf copy last picked to connect to an external database (#856), for
	// the file dialog's start. Only its path: the connection itself lasts one session.
	ExternalConf string `json:"externalConf,omitempty"`
	// Login is the account a region export logs the game back in with. The password is stored in
	// plain text, so this is for a local dev setup only.
	Login Login `json:"login,omitempty"`
	// Prefs is the frontend's preferences object, stored opaquely.
	Prefs json.RawMessage `json:"prefs,omitempty"`
	// Window is the main window's size when it was last closed.
	Window Window `json:"window,omitempty"`
	// ToolWindows is where each tool window opened as its own OS window (app_toolwindows.go, #909) was
	// last closed, by kind ("history").
	ToolWindows map[string]Place `json:"toolWindows,omitempty"`
	// GameClient is the game Meld closes and opens around an export: "" for the WoW client (Wow.exe),
	// "benilla" for Benilla, the open-source 1.12.1 client, which reads the same install.
	GameClient string `json:"gameClient,omitempty"`
	// BenillaPath is the Benilla folder (its repository, with target/release/benilla.exe built in it).
	BenillaPath string `json:"benillaPath,omitempty"`
	// BlenderPath is the Blender folder (a portable Blender, or its install folder) Open in Blender starts
	// (internal/blender). Empty, Meld looks for a blender folder beside the client's, then on the PATH.
	BlenderPath string `json:"blenderPath,omitempty"`
	// GameWindow is how the game's window opens when Meld starts it: "" the game's own setting,
	// "windowed" or "fullscreen", at GameResolution ("1280x720"). See game.Window.
	GameWindow     string `json:"gameWindow,omitempty"`
	GameResolution string `json:"gameResolution,omitempty"`
	// ProjectPath is the open project's folder (project.go), "" for none; Projects is the recent
	// list, newest first, the open one included.
	ProjectPath string    `json:"projectPath,omitempty"`
	Projects    []Project `json:"projects,omitempty"`
}

// Window is the main window's last size (unmaximised) and whether it was maximised.
type Window struct {
	Width     int  `json:"width,omitempty"`
	Height    int  `json:"height,omitempty"`
	Maximised bool `json:"maximised,omitempty"`
}

// Place is a window's last position and size, in the desktop's device-independent pixels.
type Place struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Login is a game account to log in with after a region export.
type Login struct {
	Account  string `json:"account,omitempty"`
	Password string `json:"password,omitempty"`
	// Character is the account's character the game enters the world as, skipping character select
	// (Benilla's WOW_CHAR), and the one Launch places where the editor's camera is. Empty for none.
	Character string `json:"character,omitempty"`
}

// dirName is the app's folder in the config dir. oldDirName is what it was called before the
// app was renamed; an existing folder by that name is moved over once so settings survive.
const (
	dirName    = "Meld"
	oldDirName = "WorldEditor"
)

func path() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	migrate(dir)
	return filepath.Join(dir, dirName, "config.json"), nil
}

// migrate renames the old app folder to the new one if only the old one exists.
func migrate(dir string) {
	newDir, oldDir := filepath.Join(dir, dirName), filepath.Join(dir, oldDirName)
	if _, err := os.Stat(newDir); err == nil {
		return
	}
	if _, err := os.Stat(oldDir); err != nil {
		return
	}
	_ = os.Rename(oldDir, newDir)
}

// read loads the config file. A file that does not exist is an empty config with no error; one that
// exists but does not parse (truncated, hand-edited wrongly, empty) returns the parse error with an
// empty config, so Update can tell it from a fresh install.
func read(p string) (Config, error) {
	var c Config
	b, err := os.ReadFile(p)
	if err != nil {
		return c, nil
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return Config{}, err
	}
	return c, nil
}

func Load() Config {
	p, err := path()
	if err != nil {
		return Config{}
	}
	c, _ := read(p)
	return c
}

// Save writes the config through a temp file and a rename, so a crash mid-write leaves the old file
// whole instead of a truncated one.
func Save(c Config) error {
	p, err := path()
	if err != nil {
		return err
	}
	return write(p, c)
}

func write(p string, c Config) error {
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// Update applies change to the config as the file holds it now and saves the result. Two windows
// share one config file, so a window that sets one field (its client folder, its size) must not
// write the other fields from its own older copy over what the other window saved since.
//
// A file that exists but no longer parses is not written over: it is kept as config.json.broken
// (replacing an older one) and the change starts from an empty config, so the user can recover
// their settings by hand.
func Update(change func(*Config) error) error {
	p, err := path()
	if err != nil {
		return err
	}
	c, perr := read(p)
	if perr != nil {
		log.Printf("config: %s does not parse (%v); kept as config.json.broken, starting from an empty config", p, perr)
		if err := os.Rename(p, p+".broken"); err != nil {
			return fmt.Errorf("config file %s does not parse and could not be set aside: %w", p, err)
		}
	}
	if err := change(&c); err != nil {
		return err
	}
	return write(p, c)
}

// MergePrefs overlays the keys of patch (a JSON object of preference keys) onto existing (the
// stored preferences object, or empty) and returns the merged object. Two windows share one
// config file, and each saves only the preferences it changed, so one window's brushes are not
// wiped by the other's save of its camera speed.
func MergePrefs(existing, patch json.RawMessage) (json.RawMessage, error) {
	merged := map[string]json.RawMessage{}
	if len(existing) > 0 {
		if err := json.Unmarshal(existing, &merged); err != nil {
			// A file that isn't an object is replaced rather than kept.
			merged = map[string]json.RawMessage{}
		}
	}
	var changes map[string]json.RawMessage
	if err := json.Unmarshal(patch, &changes); err != nil {
		return nil, err
	}
	for k, v := range changes {
		merged[k] = v
	}
	return json.Marshal(merged)
}

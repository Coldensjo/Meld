// Package config persists small per-user settings in the OS config dir
// (e.g. ~/.config/Meld/config.json, %AppData%\Meld\config.json).
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	// WowPath is a local WoW 1.x client folder whose MPQs are read live.
	WowPath string `json:"wowPath"`
	// VmangosPath is the VMaNGOS server folder that map patches and SQL are written for.
	VmangosPath string `json:"vmangosPath,omitempty"`
	// Login is the account a region export logs the game back in with. The password is stored in
	// plain text, so this is for a local dev setup only.
	Login Login `json:"login,omitempty"`
	// Prefs is the frontend's preferences object, stored opaquely.
	Prefs json.RawMessage `json:"prefs,omitempty"`
	// Window is the main window's size when it was last closed.
	Window Window `json:"window,omitempty"`
	// GameClient is the game Meld closes and opens around an export: "" for the WoW client (Wow.exe),
	// "benilla" for Benilla, the open-source 1.12.1 client, which reads the same install.
	GameClient string `json:"gameClient,omitempty"`
	// BenillaPath is the Benilla folder (its repository, with target/release/benilla.exe built in it).
	BenillaPath string `json:"benillaPath,omitempty"`
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

func Load() Config {
	var c Config
	p, err := path()
	if err != nil {
		return c
	}
	if b, err := os.ReadFile(p); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	return c
}

func Save(c Config) error {
	p, err := path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(p, b, 0o644)
}

// Update applies change to the config as the file holds it now and saves the result. Two windows
// share one config file, so a window that sets one field (its client folder, its size) must not
// write the other fields from its own older copy over what the other window saved since.
func Update(change func(*Config) error) error {
	c := Load()
	if err := change(&c); err != nil {
		return err
	}
	return Save(c)
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

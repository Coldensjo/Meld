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

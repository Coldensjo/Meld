// Package config persists small per-user settings in the OS config dir
// (e.g. ~/.config/WorldEditor/config.json, %AppData%\WorldEditor\config.json).
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
}

// Login is a game account to log in with after a region export.
type Login struct {
	Account  string `json:"account,omitempty"`
	Password string `json:"password,omitempty"`
}

func path() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "WorldEditor", "config.json"), nil
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

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
	// Prefs is the frontend's preferences object, stored opaquely.
	Prefs json.RawMessage `json:"prefs,omitempty"`
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

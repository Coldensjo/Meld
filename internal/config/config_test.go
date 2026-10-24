package config

import (
	"encoding/json"
	"os"
	"testing"
)

func TestMergePrefsKeepsTheOtherWindowsKeys(t *testing.T) {
	existing := json.RawMessage(`{"cameraSpeed": 2, "doodadBrushes": [{"name": "Bushes"}], "fog": true}`)
	merged, err := MergePrefs(existing, json.RawMessage(`{"cameraSpeed": 5, "clouds": false}`))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(merged, &got); err != nil {
		t.Fatal(err)
	}
	if string(got["cameraSpeed"]) != "5" || string(got["clouds"]) != "false" {
		t.Fatalf("patched keys: %s", merged)
	}
	if string(got["doodadBrushes"]) != `[{"name":"Bushes"}]` || string(got["fog"]) != "true" {
		t.Fatalf("the other keys changed: %s", merged)
	}
}

func TestMergePrefsStartsFromNothing(t *testing.T) {
	merged, err := MergePrefs(nil, json.RawMessage(`{"a": 1}`))
	if err != nil || string(merged) != `{"a":1}` {
		t.Fatalf("%s %v", merged, err)
	}
	merged, err = MergePrefs(json.RawMessage(`"not an object"`), json.RawMessage(`{"a": 1}`))
	if err != nil || string(merged) != `{"a":1}` {
		t.Fatalf("a broken file is replaced: %s %v", merged, err)
	}
	if _, err := MergePrefs(nil, json.RawMessage(`[1, 2]`)); err == nil {
		t.Fatal("a patch that is not an object must be refused")
	}
}

// TestUpdateKeepsTheOtherWindowsFields sets one field the way a window does and checks a field another
// window saved in the meantime survives.
func TestUpdateKeepsTheOtherWindowsFields(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	t.Setenv("XDG_CONFIG_HOME", dir)
	t.Setenv("HOME", dir)
	if err := Save(Config{ProjectPath: "project", WorldClientPath: "game"}); err != nil {
		t.Fatal(err)
	}
	// This window started before the other one set the game client; it only sets its size.
	if err := Update(func(c *Config) error {
		c.Window = Window{Width: 800, Height: 600}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	got := Load()
	if got.ProjectPath != "project" || got.WorldClientPath != "game" || got.Window.Width != 800 {
		t.Fatalf("config after the update = %+v", got)
	}
}

// TestUpdateKeepsAFileThatNoLongerParses checks a truncated config is set aside as config.json.broken
// instead of being replaced by an empty config with one field changed, and that no temp file is left.
func TestUpdateKeepsAFileThatNoLongerParses(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	t.Setenv("XDG_CONFIG_HOME", dir)
	t.Setenv("HOME", dir)
	if err := Save(Config{ProjectPath: "project"}); err != nil {
		t.Fatal(err)
	}
	p, err := path()
	if err != nil {
		t.Fatal(err)
	}
	broken := []byte(`{"wowPath": "client", "vmangosPa`)
	if err := os.WriteFile(p, broken, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Update(func(c *Config) error {
		c.Window = Window{Width: 800, Height: 600}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	kept, err := os.ReadFile(p + ".broken")
	if err != nil || string(kept) != string(broken) {
		t.Fatalf("config.json.broken = %q, %v; want the old bytes", kept, err)
	}
	if got := Load(); got.Window.Width != 800 {
		t.Fatalf("config after the update = %+v", got)
	}
	if _, err := os.Stat(p + ".tmp"); err == nil {
		t.Fatal("temp file left behind")
	}
}

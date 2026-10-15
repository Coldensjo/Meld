package config

import (
	"encoding/json"
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

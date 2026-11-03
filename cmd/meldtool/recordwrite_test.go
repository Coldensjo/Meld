package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestRecordValues reads a set command's values: --values as JSON or @file, then column=value over it.
func TestRecordValues(t *testing.T) {
	file := filepath.Join(t.TempDir(), "values.json")
	if err := os.WriteFile(file, []byte(`{"name":"From file"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := recordValues(`{"name":"Bob","level_min":12,"civilian":true,"subname":null,"speed_run":1.5}`, []string{"name=Bob=2", "faction = 14"})
	want := map[string]string{"name": "Bob=2", "level_min": "12", "civilian": "1", "subname": "", "speed_run": "1.5", "faction": " 14"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("values: %v, %v; want %v", got, err, want)
	}
	if got, err := recordValues("@"+file, nil); err != nil || got["name"] != "From file" {
		t.Fatalf("@file: %v, %v", got, err)
	}
	for _, c := range []struct {
		flag  string
		pairs []string
	}{{"", nil}, {"", []string{"novalue"}}, {"", []string{"=5"}}, {"[1]", nil}, {`{"a":[1]}`, nil}} {
		if _, err := recordValues(c.flag, c.pairs); err == nil {
			t.Errorf("%q %v: no error", c.flag, c.pairs)
		}
	}
}

// TestRecordWriteArguments checks the write commands' arguments, which fail before any database call.
func TestRecordWriteArguments(t *testing.T) {
	for _, args := range [][]string{
		{"creature", "set"},
		{"creature", "set", "448"},
		{"creature", "set", "abc", "name=x"},
		{"object", "set", "5", "--build", "3", "name=x"},
		{"creature", "new"},
		{"creature", "new", "--starter", "bolt", "X"},
		{"object", "new", "--kind", "2,7,13", "X"},
		{"item", "new", "--from", "25", "--kind", "2,7,13", "X"},
		{"item", "new", "--kind", "2,7", "X"},
		{"spell", "new", "X"},
		{"spell", "new", "--from", "133", "--starter", "bolt", "X"},
		{"spell", "new", "--starter", "nope", "X"},
		{"item", "export"},
		{"item", "export", "25,x"},
		{"item", "import"},
	} {
		if code, _, errOut := call(t, args...); code != 2 || !strings.Contains(errOut, "bad arguments") {
			t.Errorf("%v: exit %d, %q", args, code, strings.SplitN(errOut, "\n", 2)[0])
		}
	}
	if e, err := parseEntries([]string{"25,26", "27"}); err != nil || !reflect.DeepEqual(e, []int{25, 26, 27}) {
		t.Errorf("entries: %v, %v", e, err)
	}
}

// TestMCPWriteTools checks that the write tools are not read-only, write only when asked, and pass
// their values as --values JSON.
func TestMCPWriteTools(t *testing.T) {
	for _, name := range []string{"creature_set", "creature_new", "object_set", "object_new", "item_set", "item_new", "spell_set", "spell_new", "item_export", "item_import"} {
		if toolNamed(t, name).readOnly {
			t.Errorf("%s is marked read-only", name)
		}
	}
	set := toolNamed(t, "creature_set")
	got, err := set.argv(json.RawMessage(`{"entry":448,"values":{ "name": "Hog", "level_min": 12 },"write":true}`))
	want := []string{"creature", "set", `--values={"name":"Hog","level_min":12}`, "--write=true", "448"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("creature_set argv = %q, %v; want %q", got, err, want)
	}
	if _, err := set.argv(json.RawMessage(`{"entry":448,"values":[1]}`)); err == nil || !strings.Contains(err.Error(), "a JSON object") {
		t.Fatalf("values as a list: %v", err)
	}
	if _, err := set.argv(json.RawMessage(`{"entry":448}`)); err == nil {
		t.Fatal("creature_set without values: no error")
	}
	if got, err := toolNamed(t, "spell_new").argv(json.RawMessage(`{"name":"Bolt","starter":"bolt"}`)); err != nil || !reflect.DeepEqual(got, []string{"spell", "new", "--starter=bolt", "Bolt"}) {
		t.Fatalf("spell_new argv = %q, %v", got, err)
	}
}

// TestRecordWritesLive runs the write commands' dry runs on the machine's server and client
// (testclient: skipped without them): each gives the SQL it would write, and the world database is
// left as it was.
func TestRecordWritesLive(t *testing.T) {
	server := testclient.ServerDir(t)
	data, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	var res struct {
		DryRun bool   `json:"dryRun"`
		Entry  int    `json:"entry"`
		SQL    string `json:"sql"`
		Files  []struct {
			Name string `json:"name"`
		} `json:"files"`
	}
	dry := func(args ...string) {
		t.Helper()
		code, out, errOut := call(t, args...)
		if code != 0 {
			t.Fatalf("%v: exit %d: %s", args, code, errOut)
		}
		res.Files = nil
		if err := json.Unmarshal([]byte(out), &res); err != nil || !res.DryRun {
			t.Fatalf("%v: %v, %s", args, err, out)
		}
	}
	dry("creature", "set", "--server", server, "448", "name=Hogger the Probe")
	if !strings.Contains(res.SQL, "'Hogger the Probe' WHERE `entry` = 448") {
		t.Fatalf("creature set: %s", res.SQL)
	}
	code, out, _ := call(t, "creature", "get", "--server", server, "448")
	if code != 0 || !strings.Contains(out, `"name": "Hogger"`) {
		t.Fatalf("the dry run wrote: %s", out[:min(len(out), 300)])
	}
	if code, _, errOut := call(t, "creature", "set", "--server", server, "448", "level_min=999"); code != 2 || !strings.Contains(errOut, "level_min must be from 0 to 255") {
		t.Fatalf("a refused value: exit %d, %q", code, errOut)
	}
	dry("item", "new", "--server", server, "--kind", "2,7,13", "Probe Sword")
	if res.Entry == 0 || !strings.Contains(res.SQL, "'Probe Sword'") {
		t.Fatalf("item new: %+v", res)
	}
	dry("spell", "set", "--server", server, "--client", data, "133", "name=Fireball the Probe")
	if !strings.Contains(res.SQL, "spell_template") || len(res.Files) != 1 || !strings.HasSuffix(res.Files[0].Name, "Spell.dbc") {
		t.Fatalf("spell set: %+v", res)
	}
	script := filepath.Join(t.TempDir(), "items.sql")
	if code, _, errOut := call(t, "item", "export", "--server", server, "-o", script, "25"); code != 0 {
		t.Fatalf("item export: exit %d: %s", code, errOut)
	}
	code, out, errOut := call(t, "item", "import", "--server", server, script)
	if code != 0 || !strings.Contains(out, `"exists": true`) || !strings.Contains(out, `"dryRun": true`) {
		t.Fatalf("item import: exit %d: %s%s", code, errOut, out)
	}
}

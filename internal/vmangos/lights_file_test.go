package vmangos

import (
	"reflect"
	"strings"
	"testing"
)

// TestLightsFileRoundTrip exports the synthetic tables' lights and params as a lights file and reads it
// back: the edit must come back equal, with the params in ID order, and a file that isn't one, one from
// a newer Meld or one with a band the client can't hold is refused (#945).
func TestLightsFileRoundTrip(t *testing.T) {
	tables := lightTestTables()
	az, err := ReadMapLights(tables[0], tables[1], tables[2], tables[3], 0)
	if err != nil {
		t.Fatal(err)
	}
	e := LightsEdit{MapID: 0, Lights: az.Lights, Params: []LightParamSet{az.Params[2], az.Params[1]}}
	b, err := MarshalLightsFile(e)
	if err != nil {
		t.Fatal(err)
	}
	back, err := ParseLightsFile(b)
	if err != nil {
		t.Fatal(err)
	}
	want := LightsEdit{MapID: 0, Lights: az.Lights, Params: []LightParamSet{az.Params[1], az.Params[2]}}
	if !reflect.DeepEqual(back, want) {
		t.Fatalf("read back\n%+v\nwant\n%+v", back, want)
	}
	if e.Params[0].ID != 2 {
		t.Fatal("MarshalLightsFile sorted the caller's params in place")
	}
	// The file written back is the same file.
	if again, _ := MarshalLightsFile(back); string(again) != string(b) {
		t.Fatal("a lights file read and written again differs")
	}
	// A written edit reads the same through the tables as through the file.
	if _, err := WriteLights(tables, back); err != nil {
		t.Fatalf("writing an imported file: %v", err)
	}

	for name, text := range map[string]string{
		"not json":   "lights",
		"other kind": `{"kind":"meld-prefab","version":1,"lights":[{"id":1,"global":true}]}`,
		"newer":      `{"kind":"meld-lights","version":99,"lights":[{"id":1,"global":true}]}`,
		"no lights":  `{"kind":"meld-lights","version":1,"lights":[]}`,
		"radii":      `{"kind":"meld-lights","version":1,"lights":[{"id":5,"inner":50,"outer":10}]}`,
		"bands":      `{"kind":"meld-lights","version":1,"lights":[{"id":1,"global":true}],"params":[{"id":3,"colors":[[]],"floats":[]}]}`,
	} {
		if _, err := ParseLightsFile([]byte(text)); err == nil {
			t.Errorf("%s: read without an error", name)
		}
	}
	long := az.Params[1]
	long.Colors = append([][]LightKey(nil), long.Colors...)
	long.Colors[0] = make([]LightKey, 17)
	if _, err := MarshalLightsFile(LightsEdit{Lights: az.Lights, Params: []LightParamSet{long}}); err == nil || !strings.Contains(err.Error(), "16") {
		t.Errorf("a band of 17 keys: %v", err)
	}
}

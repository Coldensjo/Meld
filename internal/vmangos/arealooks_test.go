package vmangos

import (
	"math"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

// soundRow is a SoundEntries row (29 fields) of one file in dir.
func soundRow(id int, name, file, dir string) []any {
	row := make([]any, 29)
	for i := range row {
		row[i] = 0
	}
	row[0], row[seType], row[seName], row[seFile], row[seDir] = id, 28, name, file, dir
	for f := seFile + 1; f < seFile+soundFiles; f++ {
		row[f] = ""
	}
	row[seFreq], row[seVolume] = 1, math.Float32bits(0.8)
	return row
}

// band is a light band row (34 fields) of one key.
func bandRow(id, t int, v uint32) []any {
	row := make([]any, 34)
	for i := range row {
		row[i] = 0
	}
	row[0], row[1], row[2], row[18] = id, 1, t, v
	return row
}

// TestAreaScriptCarriesSoundsAndLights checks a zone's own rows travel with it (#997): the export
// carries the music, ambience and light rows an area names with the sounds they play and the light's
// params and bands, and the import finds each in another client by content (the ambience and its
// sound under other IDs), adds what it lacks past its largest IDs (the music and its sound, the light
// and a params row whose bands land on free IDs), rewrites the area to the IDs they came to, lists an
// added sound's file the client lacks, and leaves an ID the script doesn't carry (intro music 99) as it
// is. Planned again over the written tables, nothing more is added.
func TestAreaScriptCarriesSoundsAndLights(t *testing.T) {
	mapF := func(v float32) uint32 { return math.Float32bits(v) }
	from := &AreaLooks{Tables: map[string][]byte{
		"SoundEntries":        testDBC(t, 29, soundRow(100, "Meld Song", "song.mp3", `Sound\Meld`), soundRow(101, "Rain Day", "rain.wav", `Sound\Ambience`)).data,
		"ZoneMusic":           testDBC(t, 8, []any{50, "Meld Set", 180000, 180000, 300000, 300000, 100, 100}).data,
		"ZoneIntroMusicTable": testDBC(t, 5).data,
		"SoundAmbience":       testDBC(t, 3, []any{20, 101, 101}).data,
		"Light":               testDBC(t, 12, []any{7, 451, mapF(3600), mapF(360), mapF(7200), mapF(720), mapF(1800), 30, 0, 0, 0, 0}).data,
		"LightParams":         testDBC(t, 9, []any{30, 1, 0, 0, mapF(0.5), mapF(1), mapF(0.5), mapF(1), mapF(0.25)}).data,
		"LightIntBand":        testDBC(t, 34, bandRow(30*18-17, 0, 0x336699), bandRow(30*18-16, 1440, 0x112233)).data,
		"LightFloatBand":      testDBC(t, 34, bandRow(30*6-5, 0, mapF(400))).data,
	}}
	zone := AreaRow{ID: 5000, MapID: 451, AreaBit: 1100, Name: "Meld Vale", Music: 50, Ambience: 20, Light: 7, IntroMusic: 99}
	script, err := AreaScript([]AreaRow{zone}, nil, false, "", from, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`-- meld zonemusic 50 "Meld Set" 180000 180000 300000 300000 100 100`,
		`-- meld ambience 20 101 101`,
		`-- meld sound 100 28 "Meld Song" "song.mp3" "" `,
		`-- meld light 7 451 `,
		`-- meld lightparams 30 1 `,
		`-- meld lightint 523 1 0 `,
		`-- meld lightint 524 1 1440 `,
		`-- meld lightfloat 175 1 0 `,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("the script lacks %q:\n%s", want, script)
		}
	}
	if strings.Contains(script, "intromusic") {
		t.Fatalf("the script carries an intro music its client lacks:\n%s", script)
	}

	// The importing client: another row under the music's, sound's, light's and params' IDs, the rain
	// sound as 77 and an ambience of it as 21.
	other := soundRow(100, "Other", "other.wav", `Sound\Music`)
	to := &AreaLooks{Tables: map[string][]byte{
		"SoundEntries":        testDBC(t, 29, other, soundRow(77, "Rain Day", "rain.wav", `Sound\Ambience`)).data,
		"ZoneMusic":           testDBC(t, 8, []any{50, "Other Set", 1, 1, 1, 1, 100, 100}).data,
		"ZoneIntroMusicTable": testDBC(t, 5).data,
		"SoundAmbience":       testDBC(t, 3, []any{20, 5, 5}, []any{21, 77, 77}).data,
		"Light":               testDBC(t, 12, []any{7, 0, 0, 0, 0, 0, 0, 30, 0, 0, 0, 0}).data,
		"LightParams":         testDBC(t, 9, []any{30, 0, 0, 0, mapF(1)}).data,
		"LightIntBand":        testDBC(t, 34, bandRow(30*18-17, 0, 0xffffff)).data,
		"LightFloatBand":      testDBC(t, 34, bandRow(30*6, 0, mapF(1))).data,
	}, HasFile: func(path string) bool { return path == `Sound\Ambience\rain.wav` }}
	refs := AreaRefs{Music: map[uint32]bool{50: true}, Intro: map[uint32]bool{}, Ambience: map[uint32]bool{20: true, 21: true}, Lights: map[uint32]bool{7: true}}
	dbc := areaDBC([4]uint32{12, 0, 0, 5})
	plan, rows, _, files, err := PlanAreaImport(dbc, script, refs, to, false)
	if err != nil {
		t.Fatal(err)
	}
	if a := rows[0]; a.Music != 51 || a.Ambience != 21 || a.Light != 8 || a.IntroMusic != 99 {
		t.Fatalf("imported area = %+v, want music 51, ambience 21, light 8 and intro music 99", a)
	}
	wantCarried := []string{"zone music 50 (Meld Set) added as 51", "ambience 20 (Rain Day) is this client's 21", "light 7 added as 8"}
	if !reflect.DeepEqual(plan.Carried, wantCarried) {
		t.Fatalf("carried = %q, want %q", plan.Carried, wantCarried)
	}
	if !reflect.DeepEqual(plan.MissingFiles, []string{`Sound\Meld\song.mp3 (Meld Song)`}) {
		t.Fatalf("missing files = %q", plan.MissingFiles)
	}
	if !reflect.DeepEqual(plan.Missing, []string{"intro music 99 (Meld Vale)"}) {
		t.Fatalf("missing = %q", plan.Missing)
	}
	written := map[string]*dbcTable{}
	for _, f := range files {
		name := strings.TrimSuffix(strings.TrimPrefix(f.Name, `DBFilesClient\`), ".dbc")
		if written[name], err = parseDBC(f.Data); err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
	}
	names := make([]string, 0, len(written))
	for n := range written {
		names = append(names, n)
	}
	slices.Sort(names)
	if want := []string{"Light", "LightFloatBand", "LightIntBand", "LightParams", "SoundEntries", "ZoneMusic"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("written tables %v, want %v", names, want)
	}
	se := written["SoundEntries"]
	if r, ok := se.row(101); !ok || se.str(r, seName) != "Meld Song" || se.str(r, seDir) != `Sound\Meld` || se.f32(r, seVolume) != 0.8 {
		t.Fatal("the song isn't added as sound 101")
	}
	if r, ok := se.row(100); !ok || se.str(r, seName) != "Other" {
		t.Fatal("the client's own sound 100 changed")
	}
	if zm := written["ZoneMusic"]; zm.records != 2 {
		t.Fatalf("ZoneMusic has %d rows, want 2", zm.records)
	} else if r, _ := zm.row(51); zm.str(r, 1) != "Meld Set" || zm.u32(r, musicDay) != 101 || zm.u32(r, musicNight) != 101 || zm.u32(r, 2) != 180000 {
		t.Fatal("music 51 doesn't play the added sound 101")
	}
	lt := written["Light"]
	if r, ok := lt.row(8); !ok || lt.u32(r, 1) != 451 || lt.f32(r, 2) != 3600 || lt.u32(r, lightParamsAt) != 31 {
		t.Fatal("light 8 isn't the carried light on params 31")
	}
	if pt := written["LightParams"]; pt.records != 2 {
		t.Fatalf("LightParams has %d rows, want 2", pt.records)
	} else if r, _ := pt.row(31); pt.u32(r, 1) != 1 || pt.f32(r, 8) != 0.25 {
		t.Fatal("params 31 isn't the carried row")
	}
	it, ft := written["LightIntBand"], written["LightFloatBand"]
	if r, ok := it.row(31*18 - 17); !ok || it.u32(r, 18) != 0x336699 {
		t.Fatal("params 31's first colour band isn't the carried one")
	}
	if r, ok := it.row(31*18 - 16); !ok || it.u32(r, 2) != 1440 {
		t.Fatal("params 31's second colour band isn't the carried one")
	}
	if r, ok := ft.row(31*6 - 5); !ok || ft.f32(r, 18) != 400 {
		t.Fatal("params 31's fog band isn't the carried one")
	}

	// Planned again over the written tables, every carried row is found.
	for _, f := range files {
		name := strings.TrimSuffix(strings.TrimPrefix(f.Name, `DBFilesClient\`), ".dbc")
		to.Tables[name] = f.Data
	}
	plan, rows, _, files, err = PlanAreaImport(dbc, script, refs, to, false)
	if err != nil || len(files) != 0 || len(plan.MissingFiles) != 0 || rows[0].Music != 51 || rows[0].Light != 8 {
		t.Fatalf("again: %d files, missing files %v, area %+v (%v)", len(files), plan.MissingFiles, rows[0], err)
	}

	// A carried line cut short refuses the script.
	if _, _, _, _, err := PlanAreaImport(dbc, script+"-- meld ambience 22 1\n", refs, to, false); err == nil || !strings.Contains(err.Error(), "has 2 fields, not 3") {
		t.Fatalf("a short line: %v", err)
	}
}

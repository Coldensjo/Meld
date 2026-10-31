package vmangos

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
	"time"

	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestAreaScriptRoundTrip checks the Zones dialog's export (#942): the script carries every field of
// the areas' AreaTable rows in its "-- meld area" lines, a name with quotes and spaces included, with
// each area's area_template row and each zone's weather (a DELETE for a zone without any), and its
// import plan gives back the same rows and weather.
func TestAreaScriptRoundTrip(t *testing.T) {
	rows := []AreaRow{
		{ID: 5000, MapID: 451, AreaBit: 1100, Flags: 64 | 0x200, SoundPref: 3, SoundSwim: 4, Ambience: 5, Music: 6, IntroMusic: 7, Level: 30,
			Name: `Meld's "Big" Vale`, Faction: 2, Liquid: 1, MinElevation: -500.25, AmbientMul: 0.35, Light: 9},
		{ID: 5001, MapID: 451, Parent: 5000, AreaBit: 1101, Flags: 64, Level: 31, Name: "Hollow  Two", MinElevation: 0.1},
		{ID: 5002, MapID: 451, AreaBit: 1102, Name: "Dry Flats"},
	}
	weather := []ZoneWeather{{Zone: 5000, Rain: [4]int{20, 15, 25, 0}, Snow: [4]int{0, 0, 0, 40}, Storm: [4]int{1, 2, 3, 4}}, {Zone: 12, Rain: [4]int{5, 5, 5, 5}}}
	script, err := AreaScript(rows, weather, true, "Meld Isle", time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"3 areas of map 451 (Meld Isle)",
		`-- meld area 5000 451 0 1100 576 3 4 5 6 7 30 2 1 -500.25 0.35 9 "Meld's \"Big\" Vale"`,
		"REPLACE INTO area_template (entry, map_id, zone_id, explore_flag, flags, area_level, name, team, liquid_type) VALUES (5001, 451, 5000, 1101,",
		"REPLACE INTO game_weather (zone, spring_rain_chance",
		"DELETE FROM game_weather WHERE zone = 5002;",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("the script lacks %q:\n%s", want, script)
		}
	}
	if strings.Contains(script, "zone = 5001") || strings.Contains(script, "VALUES (12,") {
		t.Fatalf("the script has a subzone's or another zone's weather:\n%s", script)
	}

	// Into another client that has none of them: every row new, as exported.
	dbc := areaDBC([4]uint32{12, 0, 0, 5}, [4]uint32{14, 1, 0, 7})
	plan, got, gotWeather, err := PlanAreaImport(dbc, script, AreaRefs{}, true)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, rows) {
		t.Fatalf("imported rows = %+v\nwant %+v", got, rows)
	}
	want := []ZoneWeather{weather[0], {Zone: 5002}}
	if !reflect.DeepEqual(gotWeather, want) {
		t.Fatalf("imported weather = %+v, want %+v", gotWeather, want)
	}
	if plan.Weather != 1 || plan.ClearWeather != 1 || len(plan.Refused) != 0 || plan.Skipped != 0 || plan.Others != 0 || len(plan.Areas) != 3 || plan.Areas[0].Exists {
		t.Fatalf("plan = %+v", plan)
	}
	if !reflect.DeepEqual(plan.Maps, []uint32{451}) {
		t.Fatalf("maps = %v, want [451]", plan.Maps)
	}
	// Written as Save writes them, they read back the same.
	out, err := SetAreaRows(dbc, got)
	if err != nil {
		t.Fatal(err)
	}
	back, err := ReadAreaRows(out, 451)
	if err != nil {
		t.Fatal(err)
	}
	sorted := []AreaRow{rows[2], rows[0], rows[1]} // zones by name, then the subzone
	if !reflect.DeepEqual(back, sorted) {
		t.Fatalf("written and read back = %+v\nwant %+v", back, sorted)
	}

	// Without a server folder the weather is left out, though the plan still counts it.
	plan, _, gotWeather, err = PlanAreaImport(dbc, script, AreaRefs{}, false)
	if err != nil || gotWeather != nil || plan.Server || plan.Weather != 1 {
		t.Fatalf("without a server: weather %v, plan %+v (%v)", gotWeather, plan, err)
	}

	// Exported without a server, the script holds no weather and says so.
	noWeather, err := AreaScript(rows[:1], nil, false, "", time.Now())
	if err != nil || strings.Contains(noWeather, "game_weather (") || !strings.Contains(noWeather, "No weather") {
		t.Fatalf("a script without weather:\n%s (%v)", noWeather, err)
	}
}

// TestAreaImportPlan checks what the plan says of a script on a client that has some of its IDs: an
// ID of another area of this client (another name or map) is replaced and named, an exploration bit
// another area holds moves to the next free one, a subzone of a zone neither has is listed, IDs the
// client's tables lack are listed, and other statements and other zones' weather are counted.
func TestAreaImportPlan(t *testing.T) {
	// The client: 12 AreaA on map 0 (bit 5), 14 AreaB on map 1 (bit 7).
	dbc := areaDBC([4]uint32{12, 0, 0, 5}, [4]uint32{14, 1, 0, 7})
	script := strings.Join([]string{
		"-- Zones exported by Meld.",
		areaLine(AreaRow{ID: 12, MapID: 0, AreaBit: 5, Name: "AreaA", Music: 77}),
		areaLine(AreaRow{ID: 14, MapID: 451, AreaBit: 8, Name: "Clash"}),
		areaLine(AreaRow{ID: 600, MapID: 451, AreaBit: 7, Name: "Bit taken", Light: 3}),
		areaLine(AreaRow{ID: 601, MapID: 451, Parent: 999, AreaBit: 9, Name: "Orphan"}),
		"REPLACE INTO game_weather (zone, spring_rain_chance, shiny) VALUES (600, 30, 1);",
		"REPLACE INTO game_weather (zone, spring_rain_chance) VALUES (999, 30);",
		"DELETE FROM game_weather WHERE zone = 601;",
		"UPDATE creature_template SET name = 'x' WHERE entry = 1;",
		"REPLACE INTO area_template (entry, name) VALUES (600, 'Bit taken');",
	}, "\n")
	refs := AreaRefs{Maps: map[uint32]bool{0: true, 1: true}, Music: map[uint32]bool{}, Lights: map[uint32]bool{3: true}}
	plan, rows, weather, err := PlanAreaImport(dbc, script, refs, true)
	if err != nil {
		t.Fatal(err)
	}
	if a := plan.Areas[0]; !a.Exists || a.Was != "" {
		t.Fatalf("the same area again = %+v, want it to replace itself unnamed", a)
	}
	if a := plan.Areas[1]; !a.Exists || a.Was != "AreaB" || a.WasMap != 1 {
		t.Fatalf("another area's ID = %+v, want it to name AreaB on map 1", a)
	}
	if a := plan.Areas[2]; a.Exists || a.FromBit != 7 || a.Bit != 10 || rows[2].AreaBit != 10 {
		t.Fatalf("a taken bit = %+v (row bit %d), want it moved from 7 to 10", a, rows[2].AreaBit)
	}
	if !reflect.DeepEqual(plan.MissingZones, []uint32{999}) || !reflect.DeepEqual(plan.MissingMaps, []uint32{451}) {
		t.Fatalf("missing zones %v, maps %v; want [999] and [451]", plan.MissingZones, plan.MissingMaps)
	}
	if !reflect.DeepEqual(plan.Missing, []string{"zone music 77 (AreaA)"}) {
		t.Fatalf("missing = %q", plan.Missing)
	}
	// 600's weather (the subzone 601's DELETE and 999's row are of no zone of the script).
	if len(weather) != 1 || weather[0].Zone != 600 || weather[0].Rain[0] != 30 || plan.Others != 2 {
		t.Fatalf("weather %+v, others %d; want 600's alone and two left out", weather, plan.Others)
	}
	if plan.Skipped != 1 || !reflect.DeepEqual(plan.Unknown, []string{"shiny"}) || len(plan.Refused) != 0 {
		t.Fatalf("skipped %d, unknown %v, refused %v", plan.Skipped, plan.Unknown, plan.Refused)
	}
	if _, err := SetAreaRows(dbc, rows); err != nil {
		t.Fatalf("the planned rows don't write: %v", err)
	}

	// A row Save would refuse refuses the import.
	bad := areaLine(AreaRow{ID: 700, MapID: 0, AreaBit: 11, Name: "  "})
	if plan, _, _, err := PlanAreaImport(dbc, bad, AreaRefs{}, false); err != nil || len(plan.Refused) != 1 || !strings.Contains(plan.Refused[0], "needs a name") {
		t.Fatalf("a nameless area: refused %v (%v)", plan.Refused, err)
	}
}

// TestAreaScriptRefusesWhatItCantRead checks that a script without "-- meld area" lines, or with one
// cut short, a doubled area or a weather chance past 100, is refused with a message saying why.
func TestAreaScriptRefusesWhatItCantRead(t *testing.T) {
	dbc := areaDBC([4]uint32{12, 0, 0, 5})
	line := areaLine(AreaRow{ID: 600, MapID: 0, AreaBit: 9, Name: "Vale"})
	for name, c := range map[string]struct{ script, want string }{
		"no meld lines":  {"REPLACE INTO area_template (entry, name) VALUES (600, 'Vale');", "carries no zones"},
		"cut short":      {"-- meld area 600 0 0 9 64", "has 5 fields"},
		"an open quote":  {`-- meld area 600 0 0 9 64 0 0 0 0 0 1 0 0 0 0 0 "Vale`, "not closed"},
		"not a number":   {`-- meld area 600 x 0 9 64 0 0 0 0 0 1 0 0 0 0 0 "Vale"`, `map "x"`},
		"twice":          {line + line, "twice"},
		"a chance > 100": {line + "REPLACE INTO game_weather (zone, spring_rain_chance) VALUES (600, 120);", "not between 0 and 100"},
	} {
		_, _, _, err := PlanAreaImport(dbc, c.script, AreaRefs{}, true)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v, want %q", name, err, c.want)
		}
	}
}

// TestMeldLineFields checks the "-- meld" line writer and reader agree on text with spaces, quotes,
// backslashes and newlines, and on floats.
func TestMeldLineFields(t *testing.T) {
	line := meldLine("thing", uint32(7), int32(-3), float32(0.1), "a \"b\" \\c\nd", "")
	got, err := readMeldLines("x\n"+line+"-- meld other 1\n", "thing")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"7", "-3", "0.1", "a \"b\" \\c\nd", ""}
	if len(got) != 1 || got[0].line != 2 || !reflect.DeepEqual(got[0].fields, want) {
		t.Fatalf("read back %+v from %q, want %q", got, line, want)
	}
}

// TestClientAreaScriptRoundTrip exports the client's own Azeroth areas (with the server's weather
// when its database answers) and plans the script's import back into the same client: every area
// replaces itself under its own name and bit, nothing is refused, and the rows written
// back leave AreaTable.dbc as it was. It needs WOW_DIR (and VMANGOS_DIR for the weather).
func TestClientAreaScriptRoundTrip(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	dbc, err := LoadAreaTable(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := ReadAreaRows(dbc, 0)
	if err != nil {
		t.Fatal(err)
	}
	var weather []ZoneWeather
	server := testclient.ServerDirIfAny(t)
	if server != "" {
		if weather, err = ReadWeather(server); err != nil {
			t.Fatal(err)
		}
	}
	script, err := AreaScript(rows, weather, server != "", "Eastern Kingdoms", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	plan, got, gotWeather, err := PlanAreaImport(dbc, script, LoadAreaRefs(dataDir), server != "")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Refused) > 0 || len(plan.MissingMaps) > 0 || len(plan.MissingZones) > 0 || plan.Skipped > 0 || plan.Others > 0 {
		t.Fatalf("plan = refused %v, missing maps %v, zones %v, skipped %d, others %d", plan.Refused, plan.MissingMaps, plan.MissingZones, plan.Skipped, plan.Others)
	}
	// The stock client names a few IDs its own tables lack (Northshire Abbey's intro music 67), which
	// the plan lists on any client.
	t.Logf("IDs this client lacks: %v", plan.Missing)
	for _, a := range plan.Areas {
		if !a.Exists || a.Was != "" || a.FromBit != 0 {
			t.Fatalf("area %+v, want it to replace itself", a)
		}
	}
	if !reflect.DeepEqual(got, rows) {
		t.Fatal("the imported rows differ from the exported ones")
	}
	if out, err := SetAreaRows(dbc, got); err != nil || !bytes.Equal(out, dbc) {
		t.Fatalf("written back, AreaTable.dbc changed (%v)", err)
	}
	if server != "" {
		zones := 0
		for _, a := range rows {
			if a.Parent == 0 {
				zones++
			}
		}
		if len(gotWeather) != zones || plan.Weather == 0 {
			t.Fatalf("weather of %d zones (%d set), want all %d of Azeroth's", len(gotWeather), plan.Weather, zones)
		}
	}
}

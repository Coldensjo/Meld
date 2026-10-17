package vmangos

import (
	"strings"
	"testing"
)

// TestWeatherReadAndWrite reads game_weather's rows season by season and writes them back: a row
// with a chance replaces the zone's, one with none deletes it, and a chance past 100 is refused.
func TestWeatherReadAndWrite(t *testing.T) {
	old := runSQL
	defer func() { runSQL = old }()
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		if !strings.HasPrefix(sql, "SELECT zone, spring_rain_chance, spring_snow_chance, spring_storm_chance, summer_rain_chance") || !strings.Contains(sql, "winter_storm_chance FROM game_weather") {
			t.Fatalf("unexpected query %s", sql)
		}
		return []byte("3\t0\t0\t20\t0\t0\t20\t0\t0\t20\t0\t0\t15\n45\t23\t0\t0\t15\t0\t0\t23\t0\t0\t23\t1\t0\n"), nil
	}
	rows, err := readWeather(worldDB{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].Zone != 3 || rows[0].Storm != [4]int{20, 20, 20, 15} || rows[1].Rain != [4]int{23, 15, 23, 23} || rows[1].Snow[3] != 1 {
		t.Fatalf("rows = %+v", rows)
	}
	sql, err := WeatherSQL([]ZoneWeather{rows[1], {Zone: 12}})
	if err != nil {
		t.Fatal(err)
	}
	want := "REPLACE INTO game_weather (zone, spring_rain_chance, spring_snow_chance, spring_storm_chance, summer_rain_chance, summer_snow_chance, summer_storm_chance, fall_rain_chance, fall_snow_chance, fall_storm_chance, winter_rain_chance, winter_snow_chance, winter_storm_chance) VALUES (45, 23, 0, 0, 15, 0, 0, 23, 0, 0, 23, 1, 0);"
	if !strings.Contains(sql, want) || !strings.Contains(sql, "DELETE FROM game_weather WHERE zone = 12;") || !strings.HasPrefix(sql, "START TRANSACTION;") {
		t.Fatalf("sql = %s", sql)
	}
	if _, err := WeatherSQL([]ZoneWeather{{Zone: 1, Rain: [4]int{101}}}); err == nil {
		t.Fatal("a chance of 101 was written")
	}
}

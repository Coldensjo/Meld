package vmangos

import (
	"fmt"
	"strconv"
	"strings"
)

// Weather lives in the world database's game_weather, a row a zone (the zone's area ID, never a
// subzone's: the server looks weather up by the player's zone): the chance, 0 to 100, of rain, snow
// and storm in each season. The server (Weather::ReGenerate) draws a number from 1 to 100 against the
// three chances in that order each time the weather changes, so their sum past 100 leaves the later
// ones less, and what is left below 100 is fine weather. A zone with no row has no weather at all.
// The server reads the table when it starts, or on `.reload game_weather`.

// WeatherSeasons are game_weather's seasons in its column order.
var WeatherSeasons = [4]string{"spring", "summer", "fall", "winter"}

// ZoneWeather is a zone's game_weather row: Rain[s], Snow[s] and Storm[s] are the chances in season
// s (spring, summer, fall, winter).
type ZoneWeather struct {
	Zone  uint32 `json:"zone"`
	Rain  [4]int `json:"rain"`
	Snow  [4]int `json:"snow"`
	Storm [4]int `json:"storm"`
}

// none says the row has no chance of any weather, which the server treats as a zone without a row.
func (w ZoneWeather) none() bool {
	for s := range 4 {
		if w.Rain[s] != 0 || w.Snow[s] != 0 || w.Storm[s] != 0 {
			return false
		}
	}
	return true
}

// weatherColumns are game_weather's chance columns in the order ZoneWeather reads and writes them.
func weatherColumns() []string {
	var cols []string
	for _, s := range WeatherSeasons {
		cols = append(cols, s+"_rain_chance", s+"_snow_chance", s+"_storm_chance")
	}
	return cols
}

// readWeather reads every zone's weather from the world database.
func readWeather(db worldDB) ([]ZoneWeather, error) {
	raw, err := runSQL(db, "SELECT zone, "+strings.Join(weatherColumns(), ", ")+" FROM game_weather ORDER BY zone")
	if err != nil {
		return nil, err
	}
	var out []ZoneWeather
	for _, f := range batchRows(raw, 13) {
		var v [13]int
		for i, s := range f {
			if v[i], err = strconv.Atoi(strings.TrimSpace(s)); err != nil {
				return nil, fmt.Errorf("game_weather: %q is not a number", s)
			}
		}
		w := ZoneWeather{Zone: uint32(v[0])}
		for s := range 4 {
			w.Rain[s], w.Snow[s], w.Storm[s] = v[1+s*3], v[2+s*3], v[3+s*3]
		}
		out = append(out, w)
	}
	return out, nil
}

// ReadWeather reads every zone's weather from the server's world database, starting it when it is down.
func ReadWeather(serverRoot string) ([]ZoneWeather, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return nil, err
	}
	return readWeather(db)
}

// WeatherSQL writes the zones' weather into game_weather: a row with a chance replaces the zone's,
// and one with none deletes it, as a zone without a row has no weather either. No transaction of
// its own: runScript wraps the script in one, and SaveAreas runs it after AreaSQL in that one.
func WeatherSQL(rows []ZoneWeather) (string, error) {
	var b strings.Builder
	for _, w := range rows {
		if w.Zone == 0 {
			return "", fmt.Errorf("weather needs a zone")
		}
		if w.none() {
			fmt.Fprintf(&b, "DELETE FROM game_weather WHERE zone = %d;\n", w.Zone)
			continue
		}
		vals := []string{strconv.FormatUint(uint64(w.Zone), 10)}
		for s := range 4 {
			for _, c := range [3]int{w.Rain[s], w.Snow[s], w.Storm[s]} {
				if c < 0 || c > 100 {
					return "", fmt.Errorf("zone %d's %s weather chance %d is not between 0 and 100", w.Zone, WeatherSeasons[s], c)
				}
				vals = append(vals, strconv.Itoa(c))
			}
		}
		fmt.Fprintf(&b, "REPLACE INTO game_weather (zone, %s) VALUES (%s);\n", strings.Join(weatherColumns(), ", "), strings.Join(vals, ", "))
	}
	return b.String(), nil
}

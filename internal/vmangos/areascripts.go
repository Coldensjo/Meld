package vmangos

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The Zones dialog's Export and Import (#942): a map's zones and subzones as an SQL script. The server
// half is its statements, each area's area_template row (AreaSQL, as Save writes it) and each zone's
// game_weather row, or a DELETE of it for a zone without weather, so the script run on a server
// replaces the zone's weather rather than leaving the old one. The client half is the areas'
// AreaTable.dbc rows, which the server never reads, carried as "-- meld area" lines (meldlines.go):
//
//	-- meld area <id> <map> <parent> <bit> <flags> <sound pref> <sound pref underwater> <ambience>
//	   <music> <intro music> <level> <faction> <liquid> <min elevation> <ambient mul> <light> "<name>"
//
// (one line). Import writes the areas from those lines, into the client's AreaTable.dbc and the
// server's area_template through SaveAreas, so the script's area_template statements are only for a
// server owner without Meld; it takes the weather from the game_weather statements.

// areaLineFields names the "-- meld area" line's fields, in order.
var areaLineFields = []string{"id", "map", "zone", "exploration bit", "flags", "sound preferences", "underwater sound preferences",
	"ambience", "music", "intro music", "level", "faction", "liquid", "min elevation", "ambient multiplier", "light", "name"}

// areaLine is an area's "-- meld area" line.
func areaLine(a AreaRow) string {
	return meldLine("area", a.ID, a.MapID, a.Parent, a.AreaBit, a.Flags, a.SoundPref, a.SoundSwim, a.Ambience, a.Music, a.IntroMusic,
		a.Level, a.Faction, a.Liquid, a.MinElevation, a.AmbientMul, a.Light, a.Name)
}

// parseAreaLine reads an area's row from a "-- meld area" line's fields.
func parseAreaLine(f []string) (AreaRow, error) {
	if len(f) != len(areaLineFields) {
		return AreaRow{}, fmt.Errorf("has %d fields, not %d", len(f), len(areaLineFields))
	}
	ints := append(append([]string{}, f[:10]...), f[11:13]...)
	ints = append(ints, f[15])
	names := append(append([]string{}, areaLineFields[:10]...), areaLineFields[11:13]...)
	names = append(names, areaLineFields[15])
	u, err := meldUints(ints, names...)
	if err != nil {
		return AreaRow{}, err
	}
	level, err := strconv.ParseInt(f[10], 10, 32)
	if err != nil {
		return AreaRow{}, fmt.Errorf("level %q is not a whole number", f[10])
	}
	var fl [2]float32
	for i, at := range [2]int{13, 14} {
		v, err := strconv.ParseFloat(f[at], 32)
		if err != nil {
			return AreaRow{}, fmt.Errorf("%s %q is not a number", areaLineFields[at], f[at])
		}
		fl[i] = float32(v)
	}
	a := AreaRow{ID: u[0], MapID: u[1], Parent: u[2], AreaBit: u[3], Flags: u[4], SoundPref: u[5], SoundSwim: u[6], Ambience: u[7],
		Music: u[8], IntroMusic: u[9], Level: int32(level), Faction: u[10], Liquid: u[11], MinElevation: fl[0], AmbientMul: fl[1],
		Light: u[12], Name: f[16]}
	if a.ID == 0 {
		return AreaRow{}, errors.New("has no area ID")
	}
	return a, nil
}

// AreaScript is the SQL script of a map's areas (rows, zones before their subzones as ReadAreaRows
// lists them) and, when withWeather, their zones' weather (weather: the server's game_weather rows; a
// zone it lacks gets a DELETE). mapName names the map in the header.
func AreaScript(rows []AreaRow, weather []ZoneWeather, withWeather bool, mapName string, now time.Time) (string, error) {
	if len(rows) == 0 {
		return "", errors.New("no zones to export")
	}
	byZone := map[uint32]ZoneWeather{}
	for _, w := range weather {
		byZone[w.Zone] = w
	}
	var b strings.Builder
	maps := map[uint32]bool{}
	for _, a := range rows {
		maps[a.MapID] = true
	}
	where := "map " + strconv.FormatUint(uint64(rows[0].MapID), 10)
	if mapName != "" {
		where += " (" + commentSafe(mapName) + ")"
	}
	if len(maps) > 1 {
		where = fmt.Sprintf("%d maps", len(maps))
	}
	fmt.Fprintf(&b, "-- Zones exported by Meld on %s: %d %s of %s.\n", now.Format("2006-01-02 15:04"), len(rows), plural(len(rows), "area", "areas"), where)
	b.WriteString("-- Load it with Import in Meld's Zones dialog (World > Zones), or run it on the world database.\n")
	b.WriteString("-- The meld lines carry the areas' rows of the client's AreaTable.dbc, which the server never reads; Import writes them into the client's patch, and the server's area_template from them.\n")
	if !withWeather {
		b.WriteString("-- No weather: the exporting Meld had no VMaNGOS server folder set, so an import keeps the weather the zones have.\n")
	}
	for _, a := range rows {
		b.WriteString(areaLine(a))
	}
	for _, a := range rows {
		kind := "zone"
		if a.Parent != 0 {
			kind = fmt.Sprintf("subzone of %d", a.Parent)
		}
		fmt.Fprintf(&b, "\n-- %s (area %d, %s)\n", commentSafe(a.Name), a.ID, kind)
		b.WriteString(AreaSQL([]AreaRow{a}))
		if withWeather && a.Parent == 0 {
			w, ok := byZone[a.ID]
			if !ok {
				w = ZoneWeather{Zone: a.ID}
			}
			sql, err := WeatherSQL([]ZoneWeather{w})
			if err != nil {
				return "", err
			}
			b.WriteString(sql)
		}
	}
	return b.String(), nil
}

// areaScript is what an exported zones script holds.
type areaScript struct {
	rows []AreaRow
	// weather is the weather of the script's zones: a game_weather row, or none() for a DELETE.
	weather []ZoneWeather
	// others counts the game_weather rows and DELETEs of zones the script has no zone row of.
	others int
	// skipped counts the statements that are none of area_template's and game_weather's.
	skipped int
	// unknown are the game_weather columns the script names that Meld doesn't know, left out.
	unknown []string
}

// readAreaScript reads a zones script: the areas from its "-- meld area" lines, and its zones' weather
// from its game_weather statements.
func readAreaScript(script string) (areaScript, error) {
	lines, err := readMeldLines(script, "area")
	if err != nil {
		return areaScript{}, err
	}
	var s areaScript
	seen := map[uint32]bool{}
	for _, l := range lines {
		a, err := parseAreaLine(l.fields)
		if err != nil {
			return areaScript{}, fmt.Errorf("line %d (-- meld area): %w", l.line, err)
		}
		if seen[a.ID] {
			return areaScript{}, fmt.Errorf("line %d: area %d is in the script twice", l.line, a.ID)
		}
		seen[a.ID] = true
		s.rows = append(s.rows, a)
	}
	if len(s.rows) == 0 {
		return areaScript{}, errors.New("the script carries no zones: Import reads the client's AreaTable rows from its \"-- meld area\" lines, which only a script exported from Meld's Zones dialog has")
	}
	zones := map[uint32]bool{}
	for _, a := range s.rows {
		if a.Parent == 0 {
			zones[a.ID] = true
		}
	}

	inserts, skipped, err := parseInserts(script, "game_weather")
	if err != nil {
		return areaScript{}, err
	}
	deletes, err := parseDeletes(script, "game_weather", "zone")
	if err != nil {
		return areaScript{}, err
	}
	areaInserts, _, err := parseInserts(script, "area_template")
	if err != nil {
		return areaScript{}, err
	}
	// The statements game_weather's reader skipped, but area_template's and the DELETEs.
	s.skipped = skipped - len(areaInserts) - len(deletes)

	order := append([]string{"zone"}, weatherColumns()...)
	known := map[string]int{}
	for i, c := range order {
		known[c] = i
	}
	unknown := map[string]bool{}
	byZone := map[uint32]ZoneWeather{}
	add := func(w ZoneWeather) {
		if !zones[w.Zone] {
			s.others++
			return
		}
		byZone[w.Zone] = w
	}
	for _, z := range deletes {
		add(ZoneWeather{Zone: uint32(z)})
	}
	for _, st := range inserts {
		names := st.columns
		if names == nil {
			names = order
		}
		for _, tuple := range st.rows {
			if len(tuple) != len(names) {
				return areaScript{}, fmt.Errorf("a game_weather row has %d values for %d columns", len(tuple), len(names))
			}
			var v [13]int
			has := false
			for i, n := range names {
				at, ok := known[n]
				if !ok {
					unknown[n] = true
					continue
				}
				x, err := strconv.Atoi(strings.TrimSpace(tuple[i].text))
				if err != nil || tuple[i].null {
					return areaScript{}, fmt.Errorf("a game_weather row's %s %q is not a number", n, tuple[i].text)
				}
				v[at] = x
				has = has || at == 0
			}
			if !has || v[0] <= 0 {
				return areaScript{}, errors.New("a game_weather row has no zone")
			}
			w := ZoneWeather{Zone: uint32(v[0])}
			for se := range 4 {
				w.Rain[se], w.Snow[se], w.Storm[se] = v[1+se*3], v[2+se*3], v[3+se*3]
			}
			add(w)
		}
	}
	// In the script's order of the zones, a REPLACE winning over a DELETE of the same zone.
	for _, a := range s.rows {
		if w, ok := byZone[a.ID]; ok && a.Parent == 0 {
			s.weather = append(s.weather, w)
		}
	}
	// Each chance checked as Save checks it.
	if _, err := WeatherSQL(s.weather); err != nil {
		return areaScript{}, err
	}
	for n := range unknown {
		s.unknown = append(s.unknown, n)
	}
	sort.Strings(s.unknown)
	return s, nil
}

// AreaRefs are the client's IDs an imported area may name, for the plan to list those this client
// lacks; a nil set is not checked.
type AreaRefs struct {
	Maps, Music, Intro, Ambience, SoundPrefs, Lights, Liquids map[uint32]bool
}

// AreaImportRow is an area of a script as the import plan lists it.
type AreaImportRow struct {
	ID     uint32 `json:"id"`
	MapID  uint32 `json:"mapId"`
	Parent uint32 `json:"parent"`
	Name   string `json:"name"`
	// Exists says the client has an area of this ID, which the import replaces; Was is that area's
	// name and WasMap its map, for a plan that says when the ID is another area's on this client.
	Exists bool   `json:"exists"`
	Was    string `json:"was"`
	WasMap uint32 `json:"wasMap"`
	// Bit is the exploration bit the area gets; FromBit, when not 0, the script's, which another
	// area of this client holds, so the import takes the next free one.
	Bit     uint32 `json:"bit"`
	FromBit uint32 `json:"fromBit"`
}

// AreaImport is what importing a zones script would write.
type AreaImport struct {
	Areas []AreaImportRow `json:"areas"`
	// Maps are the maps the areas are on, each once; MissingMaps those this client's Map.dbc lacks.
	Maps        []uint32 `json:"maps"`
	MissingMaps []uint32 `json:"missingMaps"`
	// MissingZones are the zones subzones of the script name that neither the script nor the client has.
	MissingZones []uint32 `json:"missingZones"`
	// Missing names the sounds, music, liquids and lights the areas name that this client lacks, kept as they are.
	Missing []string `json:"missing"`
	// Weather and ClearWeather count the zones whose weather the import sets and clears.
	Weather      int `json:"weather"`
	ClearWeather int `json:"clearWeather"`
	// Server says a server folder is set, so area_template and the weather are written too; without
	// one, the script's weather is left out.
	Server  bool     `json:"server"`
	Others  int      `json:"others"`
	Skipped int      `json:"skipped"`
	Unknown []string `json:"unknown"`
	// Refused are the problems that stop the import; nothing is written while there is one.
	Refused []string `json:"refused"`
}

// PlanAreaImport says what importing a zones script into a client (its AreaTable.dbc, dbc) and,
// with server, its server would write, and returns the rows and weather the import writes: the
// script's areas, a row whose exploration bit another area of this client holds given the next free
// one, and its zones' weather (none without a server).
func PlanAreaImport(dbc []byte, script string, refs AreaRefs, server bool) (AreaImport, []AreaRow, []ZoneWeather, error) {
	t, err := areaTable(dbc)
	if err != nil {
		return AreaImport{}, nil, nil, err
	}
	s, err := readAreaScript(script)
	if err != nil {
		return AreaImport{}, nil, nil, err
	}
	plan := AreaImport{Server: server, Others: s.others, Skipped: s.skipped, Unknown: s.unknown}
	// The exploration bits as SetAreaRows checks them: the table's, then each written row's.
	bits := map[uint32]uint32{}
	top := uint32(0)
	for r := 0; r < t.records; r++ {
		bits[t.u32(r, areaBit)] = t.u32(r, areaID)
		top = max(top, t.u32(r, areaBit))
	}
	for _, a := range s.rows {
		top = max(top, a.AreaBit)
	}
	inScript := map[uint32]bool{}
	for _, a := range s.rows {
		inScript[a.ID] = true
	}
	maps := map[uint32]bool{}
	rows := make([]AreaRow, len(s.rows))
	missing := map[string]bool{}
	var missingList []string
	lack := func(set map[uint32]bool, id uint32, what string, a AreaRow) {
		if set == nil || id == 0 || set[id] {
			return
		}
		m := fmt.Sprintf("%s %d", what, id)
		if !missing[m] {
			missing[m] = true
			missingList = append(missingList, fmt.Sprintf("%s (%s)", m, a.Name))
		}
	}
	for i, a := range s.rows {
		p := AreaImportRow{ID: a.ID, MapID: a.MapID, Parent: a.Parent, Name: a.Name}
		if r, ok := t.row(a.ID); ok {
			p.Exists = true
			if was, wasMap := t.str(r, areaName), t.u32(r, areaMap); was != a.Name || wasMap != a.MapID {
				p.Was, p.WasMap = was, wasMap
			}
		}
		if owner, ok := bits[a.AreaBit]; ok && owner != a.ID {
			p.FromBit = a.AreaBit
			for {
				top++
				if _, taken := bits[top]; !taken {
					break
				}
			}
			a.AreaBit = top
		}
		bits[a.AreaBit] = a.ID
		p.Bit = a.AreaBit
		rows[i] = a
		plan.Areas = append(plan.Areas, p)
		if !maps[a.MapID] {
			maps[a.MapID] = true
			plan.Maps = append(plan.Maps, a.MapID)
			if refs.Maps != nil && !refs.Maps[a.MapID] {
				plan.MissingMaps = append(plan.MissingMaps, a.MapID)
			}
		}
		if a.Parent != 0 && !inScript[a.Parent] && !slices.Contains(plan.MissingZones, a.Parent) {
			if _, ok := t.row(a.Parent); !ok {
				plan.MissingZones = append(plan.MissingZones, a.Parent)
			}
		}
		lack(refs.Music, a.Music, "zone music", a)
		lack(refs.Intro, a.IntroMusic, "intro music", a)
		lack(refs.Ambience, a.Ambience, "ambience", a)
		lack(refs.SoundPrefs, a.SoundPref, "sound preferences", a)
		lack(refs.SoundPrefs, a.SoundSwim, "sound preferences", a)
		lack(refs.Liquids, a.Liquid, "liquid", a)
		lack(refs.Lights, a.Light, "light", a)
	}
	plan.Missing = missingList
	if _, err := SetAreaRows(dbc, rows); err != nil {
		plan.Refused = append(plan.Refused, err.Error())
	}
	var weather []ZoneWeather
	for _, w := range s.weather {
		if w.none() {
			plan.ClearWeather++
		} else {
			plan.Weather++
		}
	}
	if server {
		weather = s.weather
	}
	return plan, rows, weather, nil
}

// LoadAreaRefs reads the IDs of the client's maps, zone sounds, liquids and lights, for an import
// plan; a table that can't be read is left unchecked.
func LoadAreaRefs(dataDir string) AreaRefs {
	var refs AreaRefs
	set := func(n int, id func(int) uint32) map[uint32]bool {
		m := make(map[uint32]bool, n)
		for i := range n {
			m[id(i)] = true
		}
		return m
	}
	if maps, err := LoadMapEntries(dataDir); err == nil {
		refs.Maps = set(len(maps), func(i int) uint32 { return maps[i].ID })
	}
	if s, err := ZoneSounds(dataDir); err == nil {
		opts := func(o []SoundOption) map[uint32]bool { return set(len(o), func(i int) uint32 { return o[i].ID }) }
		refs.Music, refs.Intro, refs.Ambience, refs.SoundPrefs = opts(s.Music), opts(s.Intro), opts(s.Ambience), opts(s.Prefs)
	}
	if l, err := LoadLiquidTypes(dataDir); err == nil {
		refs.Liquids = set(len(l), func(i int) uint32 { return uint32(l[i].ID) })
	}
	if tables, err := LoadLightTables(dataDir); err == nil {
		if t, err := parseDBC(tables[0]); err == nil {
			refs.Lights = set(t.records, func(r int) uint32 { return t.u32(r, 0) })
		}
	}
	return refs
}

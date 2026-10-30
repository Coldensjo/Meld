package vmangos

import (
	"fmt"
	"sort"
	"strings"

	"Meld/internal/mpq"
)

// SoundOption is a row of a sound table the zone editor names: its ID, a name, and a sound file of
// it to play (a client path under Sound\, "" when it has none).
type SoundOption struct {
	ID   uint32 `json:"id"`
	Name string `json:"name"`
	File string `json:"file"`
}

// ZoneSoundTables are the rows AreaTable.dbc's sound fields point at (#31): ZoneMusic,
// ZoneIntroMusicTable, SoundAmbience (named by its day sound) and SoundProviderPreferences.
type ZoneSoundTables struct {
	Music    []SoundOption `json:"music"`
	Intro    []SoundOption `json:"intro"`
	Ambience []SoundOption `json:"ambience"`
	Prefs    []SoundOption `json:"prefs"`
}

// soundEntry is a SoundEntries.dbc row as the zone editor needs it: its name and first file.
type soundEntry struct {
	name, file string
}

// 1.12 layouts, checked against the client (#31): SoundEntries is ID, type, name, ten files, ten
// frequencies, the folder, then volume, flags and distances (29 fields); ZoneMusic is ID, set name,
// two silence ranges and two SoundEntries (8); ZoneIntroMusicTable is ID, name, sound, priority and
// delay (5); SoundAmbience is ID and a day and a night SoundEntries (3); SoundProviderPreferences
// is ID and a description, then the provider's numbers (24).
var soundTableFields = map[string]int{"SoundEntries": 29, "ZoneMusic": 8, "ZoneIntroMusicTable": 5, "SoundAmbience": 3, "SoundProviderPreferences": 24}

func soundEntries(t *dbcTable) map[uint32]soundEntry {
	out := make(map[uint32]soundEntry, t.records)
	for r := 0; r < t.records; r++ {
		e := soundEntry{name: t.str(r, 2)}
		dir := t.str(r, 23)
		for f := 3; f <= 12; f++ {
			if file := t.str(r, f); file != "" {
				e.file = strings.TrimSuffix(dir, `\`) + `\` + file
				break
			}
		}
		out[t.u32(r, 0)] = e
	}
	return out
}

// zoneSoundTables builds the options from the five tables' bytes, by name.
func zoneSoundTables(tables map[string][]byte) (ZoneSoundTables, error) {
	parsed := map[string]*dbcTable{}
	for name, want := range soundTableFields {
		t, err := parseDBC(tables[name])
		if err != nil {
			return ZoneSoundTables{}, fmt.Errorf("%s.dbc: %w", name, err)
		}
		if t.fields != want {
			return ZoneSoundTables{}, fmt.Errorf("%s.dbc has %d fields, not 1.12's %d", name, t.fields, want)
		}
		parsed[name] = t
	}
	sounds := soundEntries(parsed["SoundEntries"])
	var z ZoneSoundTables
	m := parsed["ZoneMusic"]
	for r := 0; r < m.records; r++ {
		day := sounds[m.u32(r, 6)]
		z.Music = append(z.Music, SoundOption{ID: m.u32(r, 0), Name: m.str(r, 1), File: day.file})
	}
	in := parsed["ZoneIntroMusicTable"]
	for r := 0; r < in.records; r++ {
		z.Intro = append(z.Intro, SoundOption{ID: in.u32(r, 0), Name: in.str(r, 1), File: sounds[in.u32(r, 2)].file})
	}
	a := parsed["SoundAmbience"]
	for r := 0; r < a.records; r++ {
		day, night := sounds[a.u32(r, 1)], sounds[a.u32(r, 2)]
		name := day.name
		if night.name != "" && night.name != day.name {
			name += " / " + night.name
		}
		z.Ambience = append(z.Ambience, SoundOption{ID: a.u32(r, 0), Name: name, File: day.file})
	}
	p := parsed["SoundProviderPreferences"]
	for r := 0; r < p.records; r++ {
		z.Prefs = append(z.Prefs, SoundOption{ID: p.u32(r, 0), Name: p.str(r, 1)})
	}
	for _, list := range [][]SoundOption{z.Music, z.Intro, z.Ambience, z.Prefs} {
		sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	}
	return z, nil
}

// ZoneSounds reads the client's sound tables for the zone editor, as the game will have them: a
// sound the Sound tool imported while the game ran (#684) is listed too.
func ZoneSounds(dataDir string) (ZoneSoundTables, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return ZoneSoundTables{}, err
	}
	defer set.Close()
	tables := map[string][]byte{}
	for name := range soundTableFields {
		b, err := readOverlay(set, dataDir, `DBFilesClient\`+name+`.dbc`)
		if err != nil {
			return ZoneSoundTables{}, fmt.Errorf("%s.dbc: %w", name, err)
		}
		tables[name] = b
	}
	return zoneSoundTables(tables)
}

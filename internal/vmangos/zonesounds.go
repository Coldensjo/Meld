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

// soundTables are the zone sound tables by name (#31; their layouts are in dbcschemas.go).
var soundTables = map[string]*dbcSchema{
	"SoundEntries": dbcSoundEntries, "ZoneMusic": dbcZoneMusic, "ZoneIntroMusicTable": dbcZoneIntro,
	"SoundAmbience": dbcSoundAmbience, "SoundProviderPreferences": dbcSoundPrefs,
}

func soundEntries(t *dbcTable) map[uint32]soundEntry {
	c := seColsOf(t.l)
	out := make(map[uint32]soundEntry, t.records)
	for r := 0; r < t.records; r++ {
		e := soundEntry{name: t.str(r, c.name)}
		dir := t.str(r, c.dir)
		for f := c.file; f < c.file+c.files; f++ {
			if file := t.str(r, f); file != "" {
				e.file = strings.TrimSuffix(dir, `\`) + `\` + file
				break
			}
		}
		out[t.u32(r, c.id)] = e
	}
	return out
}

// zoneSoundTables builds the options from the five tables' bytes, by name.
func zoneSoundTables(tables map[string][]byte) (ZoneSoundTables, error) {
	parsed := map[string]*dbcTable{}
	for name, s := range soundTables {
		t, err := parseTable(tables[name], s)
		if err != nil {
			return ZoneSoundTables{}, fmt.Errorf("%s.dbc: %w", name, err)
		}
		if t.fields != t.l.columns {
			return ZoneSoundTables{}, fmt.Errorf("%s.dbc has %d fields, not 1.12's %d", name, t.fields, s.layouts[0].columns)
		}
		parsed[name] = t
	}
	sounds := soundEntries(parsed["SoundEntries"])
	var z ZoneSoundTables
	m := parsed["ZoneMusic"]
	mid, mname, mday := m.col("ID"), m.col("Name"), m.col("Day")
	for r := 0; r < m.records; r++ {
		day := sounds[m.u32(r, mday)]
		z.Music = append(z.Music, SoundOption{ID: m.u32(r, mid), Name: m.str(r, mname), File: day.file})
	}
	in := parsed["ZoneIntroMusicTable"]
	iid, iname, isound := in.col("ID"), in.col("Name"), in.col("Sound")
	for r := 0; r < in.records; r++ {
		z.Intro = append(z.Intro, SoundOption{ID: in.u32(r, iid), Name: in.str(r, iname), File: sounds[in.u32(r, isound)].file})
	}
	a := parsed["SoundAmbience"]
	aid, aday, anight := a.col("ID"), a.col("Day"), a.col("Night")
	for r := 0; r < a.records; r++ {
		day, night := sounds[a.u32(r, aday)], sounds[a.u32(r, anight)]
		name := day.name
		if night.name != "" && night.name != day.name {
			name += " / " + night.name
		}
		z.Ambience = append(z.Ambience, SoundOption{ID: a.u32(r, aid), Name: name, File: day.file})
	}
	p := parsed["SoundProviderPreferences"]
	pid, pname := p.col("ID"), p.col("Description")
	for r := 0; r < p.records; r++ {
		z.Prefs = append(z.Prefs, SoundOption{ID: p.u32(r, pid), Name: p.str(r, pname)})
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
	for name, s := range soundTables {
		b, err := readOverlay(set, dataDir, s.file())
		if err != nil {
			return ZoneSoundTables{}, fmt.Errorf("%s.dbc: %w", name, err)
		}
		tables[name] = b
	}
	return zoneSoundTables(tables)
}

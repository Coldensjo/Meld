package vmangos

import (
	"fmt"
	"sort"
	"strings"

	"Meld/internal/mpq"
)

// Deleting an imported sound (#901): the Sound tool's Delete takes an import back, its file out of
// Meld's patch and its SoundEntries row with the ZoneMusic or SoundAmbience row the import added, and
// clears every field that still names either, so no row is left pointing at an ID a later import
// would take again (an import takes the table's largest ID plus one). Only an imported sound (its
// folder ImportedSoundDir) can go: the client's own rows are never removed.

// SoundDeletePlan is what deleting an imported sound removes and clears, for the confirmation and the
// write: the files dropped from Meld's patch, the zone sound rows that named it (a ZoneMusic or
// SoundAmbience row left playing nothing is removed, the one its import added among them), the intro
// rows whose sound is cleared, the zones (AreaTable rows) that played it through one of those, and the
// game object displays whose sound slots named it, cleared to none.
type SoundDeletePlan struct {
	ID       uint32        `json:"id"`
	Name     string        `json:"name"`
	Files    []string      `json:"files"`
	Music    []SoundOption `json:"music"`
	Ambience []SoundOption `json:"ambience"`
	Intro    []SoundOption `json:"intro"`
	Zones    []SoundOption `json:"zones"`
	Displays []uint32      `json:"displays"`
}

// soundDeletePaths are the tables a delete reads, by name: the Sound tool's and AreaTable.
func soundDeletePaths() map[string]string {
	out := make(map[string]string, len(soundTablePaths)+1)
	for k, v := range soundTablePaths {
		out[k] = v
	}
	out["AreaTable"] = AreaTablePath
	return out
}

// deleteSoundRows returns the tables (by name, only the ones it changed) without the imported sound
// id: its SoundEntries row removed, every ZoneMusic, SoundAmbience and ZoneIntroMusicTable field and
// game object display slot that names it set to 0, a ZoneMusic or SoundAmbience row that then plays
// nothing removed, and the zones' fields that named a removed row set to 0. A table missing from
// tables is skipped (SoundEntries must be there).
func deleteSoundRows(tables map[string][]byte, id uint32) (map[string][]byte, SoundDeletePlan, error) {
	plan := SoundDeletePlan{ID: id, Files: []string{}, Music: []SoundOption{}, Ambience: []SoundOption{}, Intro: []SoundOption{}, Zones: []SoundOption{}, Displays: []uint32{}}
	se, err := parseExact(tables["SoundEntries"], dbcSoundEntries)
	if err != nil {
		return nil, plan, err
	}
	c := seColsOf(se.l)
	r, ok := se.row(id)
	if !ok || id == 0 {
		return nil, plan, fmt.Errorf("the client has no sound %d in SoundEntries.dbc", id)
	}
	dir := strings.TrimSuffix(se.str(r, c.dir), `\`)
	if !strings.EqualFold(dir, ImportedSoundDir) {
		return nil, plan, fmt.Errorf("%s (%d) is one of the client's own sounds, which Meld never removes: only an imported sound can be deleted", se.str(r, c.name), id)
	}
	plan.Name = se.str(r, c.name)
	plan.Files = soleFiles(se, r)
	out := map[string][]byte{}
	if out["SoundEntries"], err = removeRecords(tables["SoundEntries"], map[uint32]bool{id: true}); err != nil {
		return nil, plan, err
	}
	music, goneMusic, err := clearSoundFields(tables, out, "ZoneMusic", []string{"Day", "Night"}, "Name", true, id, plan.Name, &plan.Music)
	if err != nil {
		return nil, plan, err
	}
	ambience, goneAmbience, err := clearSoundFields(tables, out, "SoundAmbience", []string{"Day", "Night"}, "", true, id, plan.Name, &plan.Ambience)
	if err != nil {
		return nil, plan, err
	}
	intro, _, err := clearSoundFields(tables, out, "ZoneIntroMusicTable", []string{"Sound"}, "Name", false, id, plan.Name, &plan.Intro)
	if err != nil {
		return nil, plan, err
	}
	if b, ok := tables["AreaTable"]; ok && (len(music) > 0 || len(ambience) > 0 || len(intro) > 0) {
		at, ac, err := areaTable(b)
		if err != nil {
			return nil, plan, err
		}
		var rows [][]uint32
		for i := 0; i < at.records; i++ {
			rec := at.record(i)
			if !music[rec[ac.music]] && !ambience[rec[ac.ambience]] && !intro[rec[ac.intro]] {
				continue
			}
			plan.Zones = append(plan.Zones, SoundOption{ID: rec[ac.id], Name: at.str(i, ac.name)})
			if goneMusic[rec[ac.music]] || goneAmbience[rec[ac.ambience]] {
				if goneMusic[rec[ac.music]] {
					rec[ac.music] = 0
				}
				if goneAmbience[rec[ac.ambience]] {
					rec[ac.ambience] = 0
				}
				rows = append(rows, rec)
			}
		}
		if len(rows) > 0 {
			// The records keep their strings' offsets, which setRecords leaves as they are.
			if out["AreaTable"], err = setRecords(b, rows); err != nil {
				return nil, plan, err
			}
		}
	}
	if b, ok := tables["GameObjectDisplayInfo"]; ok {
		d, err := parseExact(b, dbcObjectDisplay)
		if err != nil {
			return nil, plan, err
		}
		first, n := d.at("Sound", 0), d.l.count("Sound")
		var rows [][]uint32
		for i := 0; i < d.records; i++ {
			rec := d.record(i)
			hit := false
			for s := first; s < first+n; s++ {
				if rec[s] == id {
					rec[s], hit = 0, true
				}
			}
			if hit {
				plan.Displays = append(plan.Displays, rec[0])
				rows = append(rows, rec)
			}
		}
		if len(rows) > 0 {
			if out["GameObjectDisplayInfo"], err = setRecords(b, rows); err != nil {
				return nil, plan, err
			}
		}
	}
	return out, plan, nil
}

// soleFiles are the files SoundEntries row r names that no other row names (client paths, each once).
func soleFiles(se *dbcTable, r int) []string {
	c := seColsOf(se.l)
	named := map[string]int{}
	for i := 0; i < se.records; i++ {
		d := strings.ToLower(strings.TrimSuffix(se.str(i, c.dir), `\`))
		for f := c.file; f < c.file+c.files; f++ {
			if file := se.str(i, f); file != "" {
				named[d+`\`+strings.ToLower(file)]++
			}
		}
	}
	dir := strings.TrimSuffix(se.str(r, c.dir), `\`)
	seen := map[string]bool{}
	out := []string{}
	for f := c.file; f < c.file+c.files; f++ {
		file := se.str(r, f)
		path := dir + `\` + file
		k := strings.ToLower(path)
		if file != "" && !seen[k] && named[k] == 1 {
			seen[k] = true
			out = append(out, path)
		}
	}
	return out
}

// clearSoundFields sets the fields of tables[name] that name id to 0 and puts the table into out when
// any did. With drop, a row whose fields are then all 0 is removed. Each row it touched goes into
// into, named by its string field label (or by sound when label is ""). Returns the IDs of the rows it
// touched and of the ones it removed.
func clearSoundFields(tables, out map[string][]byte, name string, names []string, label string, drop bool, id uint32, sound string, into *[]SoundOption) (touched, gone map[uint32]bool, err error) {
	touched, gone = map[uint32]bool{}, map[uint32]bool{}
	b, ok := tables[name]
	if !ok {
		return touched, gone, nil
	}
	t, err := parseExact(b, soundTables[name])
	if err != nil {
		return nil, nil, err
	}
	fields := make([]int, len(names))
	for i, n := range names {
		fields[i] = t.col(n)
	}
	var rows [][]uint32
	for i := 0; i < t.records; i++ {
		rec := t.record(i)
		hit, left := false, false
		for _, f := range fields {
			if rec[f] == id {
				rec[f], hit = 0, true
			}
			left = left || rec[f] != 0
		}
		if !hit {
			continue
		}
		touched[rec[0]] = true
		opt := SoundOption{ID: rec[0], Name: sound}
		if label != "" {
			opt.Name = t.str(i, t.col(label))
		}
		*into = append(*into, opt)
		if drop && !left {
			gone[rec[0]] = true
		} else {
			rows = append(rows, rec)
		}
	}
	if len(touched) == 0 {
		return touched, gone, nil
	}
	if len(rows) > 0 {
		// The records keep their strings' offsets, which setRecords leaves as they are.
		if b, err = setRecords(b, rows); err != nil {
			return nil, nil, err
		}
	}
	if len(gone) > 0 {
		if b, err = removeRecords(b, gone); err != nil {
			return nil, nil, err
		}
	}
	out[name] = b
	return touched, gone, nil
}

// PlanSoundDelete reads what deleting the imported sound id would remove and clear, as the game will
// have the tables, and returns the changed tables as patch files with the plan. Nothing is written.
func PlanSoundDelete(dataDir string, id uint32) ([]mpq.File, SoundDeletePlan, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, SoundDeletePlan{}, err
	}
	defer set.Close()
	paths := soundDeletePaths()
	tables := make(map[string][]byte, len(paths))
	for name, path := range paths {
		b, err := readOverlay(set, dataDir, path)
		if err != nil {
			return nil, SoundDeletePlan{}, fmt.Errorf("%s.dbc: %w", name, err)
		}
		tables[name] = b
	}
	changed, plan, err := deleteSoundRows(tables, id)
	if err != nil {
		return nil, plan, err
	}
	names := make([]string, 0, len(changed))
	for name := range changed {
		names = append(names, name)
	}
	sort.Strings(names)
	files := make([]mpq.File, 0, len(names))
	for _, name := range names {
		files = append(files, mpq.File{Name: paths[name], Data: changed[name]})
	}
	return files, plan, nil
}

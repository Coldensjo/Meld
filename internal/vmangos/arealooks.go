package vmangos

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"Meld/internal/mpq"
)

// A zone's own sound and light rows in the Zones dialog's script (#997). An area names its zone music
// (a ZoneMusic row), intro music (ZoneIntroMusicTable), ambience (SoundAmbience) and light (Light) by
// ID only, and those name SoundEntries rows, and a light its LightParams rows with their colour and
// float bands. Music the Sound tool added (#684) or a light World › Lights made is a row of the
// exporting client's Meld patch, which another client lacks or holds another row under, so the export
// carries the rows an area names as "-- meld" lines after its "-- meld area" lines:
//
//	-- meld sound <id> <SoundEntries fields 1 to 28>
//	-- meld zonemusic <id> <ZoneMusic fields 1 to 7>
//	-- meld intromusic <id> <ZoneIntroMusicTable fields 1 to 4>
//	-- meld ambience <id> <day sound> <night sound>
//	-- meld light <id> <Light fields 1 to 11>
//	-- meld lightparams <id> <LightParams fields 1 to 8>
//	-- meld lightint <id> <LightIntBand fields 1 to 33>
//	-- meld lightfloat <id> <LightFloatBand fields 1 to 33>
//
// A text field is quoted (meldLine) and every other field is its 32 bits as an unsigned number, a
// float's too, so it comes back exact. Import finds each row in the client's tables as the spell
// script's looks do (#381, spelllooks.go): the row of that ID when it holds the same, else any row
// that does, else a new row at the end, the rows naming it rewritten first (a sound before the music
// that plays it, a params row and its bands before the light) and the areas' IDs last. A params row
// owns the bands its ID gives (LightBands per params row), so it matches only with the same bands, and
// a new one takes an ID whose bands are free too. The sound files are not carried (the script is
// text): a sound the import adds whose file this client lacks is listed, and the Sound tool's import
// of a file of that name in Sound\Meld then fills the row the script brought (importSoundRows reuses
// it). SoundProviderPreferences, the area's other sound IDs, is never Meld's and is not carried.

// dbcCarry is a client table whose rows a zones script carries: the "-- meld" line's kind, the
// table's name and path, its 1.12 width and its text fields.
type dbcCarry struct {
	kind, name, path string
	fields           int
	strs             []int
}

var (
	carriedSound      = dbcCarry{"sound", "SoundEntries", SoundEntriesPath, 29, []int{seName, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, seDir}}
	carriedMusic      = dbcCarry{"zonemusic", "ZoneMusic", ZoneMusicPath, 8, []int{1}}
	carriedIntro      = dbcCarry{"intromusic", "ZoneIntroMusicTable", ZoneIntroPath, 5, []int{1}}
	carriedAmbience   = dbcCarry{"ambience", "SoundAmbience", SoundAmbiencePath, 3, nil}
	carriedLight      = dbcCarry{"light", "Light", lightTablePath("Light"), 12, nil}
	carriedParams     = dbcCarry{"lightparams", "LightParams", lightTablePath("LightParams"), 9, nil}
	carriedIntBand    = dbcCarry{"lightint", "LightIntBand", lightTablePath("LightIntBand"), 34, nil}
	carriedFloatBand  = dbcCarry{"lightfloat", "LightFloatBand", lightTablePath("LightFloatBand"), 34, nil}
	carriedAreaTables = []dbcCarry{carriedSound, carriedMusic, carriedIntro, carriedAmbience, carriedLight, carriedParams, carriedIntBand, carriedFloatBand}
)

// Light.dbc's first LightParams field (five follow: clear, clear underwater, storm, storm underwater,
// death), and the sound fields of the zone sound tables.
const (
	lightParamsAt = 7
	lightParamsN  = 5
	musicDay      = 6
	musicNight    = 7
	introSound    = 2
	ambienceDay   = 1
	ambienceNight = 2
)

func (c dbcCarry) isStr(f int) bool { return slices.Contains(c.strs, f) }

// dbcCarryRow is a carried record: every field (the ID first; a text field's slot unused) and its texts.
type dbcCarryRow struct {
	rec  []uint32
	strs map[int]string
}

// rowOf is row r of table t as a carried row.
func (c dbcCarry) rowOf(t *dbcTable, r int) dbcCarryRow {
	row := dbcCarryRow{rec: t.record(r), strs: map[int]string{}}
	for _, f := range c.strs {
		row.strs[f] = t.str(r, f)
		row.rec[f] = 0
	}
	return row
}

// line is a carried row's "-- meld" line.
func (c dbcCarry) line(row dbcCarryRow) string {
	fields := make([]any, len(row.rec))
	for f, v := range row.rec {
		if c.isStr(f) {
			fields[f] = row.strs[f]
		} else {
			fields[f] = v
		}
	}
	return meldLine(c.kind, fields...)
}

// read reads a script's lines of this table, by ID.
func (c dbcCarry) read(script string) (map[uint32]dbcCarryRow, error) {
	lines, err := readMeldLines(script, c.kind)
	if err != nil {
		return nil, err
	}
	out := map[uint32]dbcCarryRow{}
	for _, l := range lines {
		if len(l.fields) != c.fields {
			return nil, fmt.Errorf("line %d (-- meld %s): has %d fields, not %d", l.line, c.kind, len(l.fields), c.fields)
		}
		row := dbcCarryRow{rec: make([]uint32, c.fields), strs: map[int]string{}}
		for f, text := range l.fields {
			if c.isStr(f) {
				row.strs[f] = text
				continue
			}
			n, err := strconv.ParseUint(text, 10, 32)
			if err != nil {
				return nil, fmt.Errorf("line %d (-- meld %s): field %d %q is not a whole number", l.line, c.kind, f+1, text)
			}
			row.rec[f] = uint32(n)
		}
		if row.rec[0] == 0 {
			return nil, fmt.Errorf("line %d (-- meld %s): has no ID", l.line, c.kind)
		}
		out[row.rec[0]] = row
	}
	return out, nil
}

// same says whether row r of t holds row's fields, the ID aside (texts compared as client paths are).
func (c dbcCarry) same(t *dbcTable, r int, row dbcCarryRow) bool {
	for f := 1; f < c.fields; f++ {
		if c.isStr(f) {
			if !strings.EqualFold(t.str(r, f), row.strs[f]) {
				return false
			}
		} else if t.u32(r, f) != row.rec[f] {
			return false
		}
	}
	return true
}

// findOrAdd is the ID row comes to in table b: its own ID's when that row holds the same, else the
// first row that does, else a new row past the largest ID (the table then returned, added true).
func (c dbcCarry) findOrAdd(b []byte, row dbcCarryRow) (id uint32, out []byte, added bool, err error) {
	t, err := parseSized(b, c.name+".dbc", c.fields)
	if err != nil {
		return 0, nil, false, err
	}
	if r, ok := t.row(row.rec[0]); ok && c.same(t, r, row) {
		return row.rec[0], nil, false, nil
	}
	for r := 0; r < t.records; r++ {
		if c.same(t, r, row) {
			return t.u32(r, 0), nil, false, nil
		}
	}
	rec := slices.Clone(row.rec)
	rec[0] = maxID(t) + 1
	out, err = putRecord(b, rec, row.strs)
	return rec[0], out, err == nil, err
}

// AreaLooks are the client's tables an area's sounds and light are in, by dbcCarry name (a table
// the client lacks is left out, and its rows neither carried nor added), and HasFile says whether the
// client has a file, for the sounds an import adds.
type AreaLooks struct {
	Tables  map[string][]byte
	HasFile func(path string) bool
}

// LoadAreaLooks reads the tables of AreaLooks from the client as the game will have them (readOverlay).
// close releases the archives HasFile reads.
func LoadAreaLooks(dataDir string) (looks *AreaLooks, close func(), err error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, nil, err
	}
	looks = &AreaLooks{Tables: map[string][]byte{}}
	for _, c := range carriedAreaTables {
		if b, err := readOverlay(set, dataDir, c.path); err == nil {
			looks.Tables[c.name] = b
		}
	}
	looks.HasFile = func(path string) bool {
		if _, drop, ok := pendingEntry(dataDir, path); ok {
			return !drop
		}
		return set.Has(path)
	}
	return looks, set.Close, nil
}

// table parses one of the tables at its 1.12 width (nil when missing or of another width).
func (l *AreaLooks) table(c dbcCarry) *dbcTable {
	if l == nil {
		return nil
	}
	b, ok := l.Tables[c.name]
	if !ok {
		return nil
	}
	t, err := parseSized(b, c.name, c.fields)
	if err != nil {
		return nil
	}
	return t
}

// bandIDs are the IDs of a params row's colour bands (LightIntBand) or float bands (LightFloatBand).
func bandIDs(params uint32, float bool) []uint32 {
	n := uint32(LightBands)
	if float {
		n = LightFloats
	}
	out := make([]uint32, n)
	for i := range out {
		out[i] = params*n - (n - 1) + uint32(i)
	}
	return out
}

// sortedIDs is a set's IDs in order, 0 left out.
func sortedIDs(m map[uint32]bool) []uint32 {
	out := make([]uint32, 0, len(m))
	for id := range m {
		if id != 0 {
			out = append(out, id)
		}
	}
	slices.Sort(out)
	return out
}

// areaLooksComment is the "-- meld" lines of the music, intro music, ambience and light rows the
// areas name, with the SoundEntries rows those play and the light's params rows and bands, read from
// the client's tables (an ID a table lacks is left out).
func areaLooksComment(rows []AreaRow, looks *AreaLooks) string {
	if looks == nil {
		return ""
	}
	music, intro, ambience, lights := map[uint32]bool{}, map[uint32]bool{}, map[uint32]bool{}, map[uint32]bool{}
	for _, a := range rows {
		music[a.Music], intro[a.IntroMusic], ambience[a.Ambience], lights[a.Light] = true, true, true, true
	}
	var b strings.Builder
	sounds := map[uint32]bool{}
	carry := func(c dbcCarry, ids map[uint32]bool, soundFields ...int) {
		t := looks.table(c)
		if t == nil {
			return
		}
		for _, id := range sortedIDs(ids) {
			if r, ok := t.row(id); ok {
				b.WriteString(c.line(c.rowOf(t, r)))
				for _, f := range soundFields {
					sounds[t.u32(r, f)] = true
				}
			}
		}
	}
	carry(carriedMusic, music, musicDay, musicNight)
	carry(carriedIntro, intro, introSound)
	carry(carriedAmbience, ambience, ambienceDay, ambienceNight)
	carry(carriedSound, sounds)
	params := map[uint32]bool{}
	if lt := looks.table(carriedLight); lt != nil {
		for _, id := range sortedIDs(lights) {
			if r, ok := lt.row(id); ok {
				b.WriteString(carriedLight.line(carriedLight.rowOf(lt, r)))
				for f := lightParamsAt; f < lightParamsAt+lightParamsN; f++ {
					params[lt.u32(r, f)] = true
				}
			}
		}
	}
	pt, it, ft := looks.table(carriedParams), looks.table(carriedIntBand), looks.table(carriedFloatBand)
	if pt != nil && it != nil && ft != nil {
		for _, id := range sortedIDs(params) {
			r, ok := pt.row(id)
			if !ok {
				continue
			}
			b.WriteString(carriedParams.line(carriedParams.rowOf(pt, r)))
			for _, band := range []struct {
				c     dbcCarry
				t     *dbcTable
				float bool
			}{{carriedIntBand, it, false}, {carriedFloatBand, ft, true}} {
				for _, bid := range bandIDs(id, band.float) {
					if br, ok := band.t.row(bid); ok {
						b.WriteString(band.c.line(band.c.rowOf(band.t, br)))
					}
				}
			}
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return "-- The meld lines below carry the zones' music, ambience and light rows, so Import on another client finds or adds them.\n" + b.String()
}

// areaLookPlan is what importing a script's carried rows comes to in a client: the ID each carried
// music, intro music, ambience and light row gets there, the tables with the rows it adds, what the
// plan lists of it, and the sound files of added sounds the client lacks.
type areaLookPlan struct {
	music, intro, ambience, light map[uint32]uint32
	files                         []mpq.File
	carried, missingFiles         []string
}

// planAreaLooks works out the rows a script carries for the areas in the client's tables (looks; nil
// plans nothing). Only the IDs the areas name are touched.
func planAreaLooks(script string, rows []AreaRow, looks *AreaLooks) (areaLookPlan, error) {
	p := areaLookPlan{music: map[uint32]uint32{}, intro: map[uint32]uint32{}, ambience: map[uint32]uint32{}, light: map[uint32]uint32{}}
	if looks == nil {
		return p, nil
	}
	carried := map[string]map[uint32]dbcCarryRow{}
	carries := false
	for _, c := range carriedAreaTables {
		m, err := c.read(script)
		if err != nil {
			return areaLookPlan{}, err
		}
		carried[c.name] = m
		carries = carries || len(m) > 0
	}
	if !carries {
		return p, nil
	}
	cur := map[string][]byte{}
	for name, b := range looks.Tables {
		cur[name] = b
	}
	changed := map[string]bool{}
	// put resolves one carried row of c in the client's current table, nil when the client lacks it.
	put := func(c dbcCarry, row dbcCarryRow) (uint32, bool, error) {
		b, ok := cur[c.name]
		if !ok {
			return 0, false, nil
		}
		id, out, added, err := c.findOrAdd(b, row)
		if err != nil {
			return 0, false, err
		}
		if out != nil {
			cur[c.name], changed[c.name] = out, true
		}
		return id, added, nil
	}
	sounds := map[uint32]uint32{}
	sound := func(id uint32) (uint32, error) {
		if n, done := sounds[id]; done {
			return n, nil
		}
		row, ok := carried[carriedSound.name][id]
		if !ok {
			return id, nil
		}
		n, added, err := put(carriedSound, row)
		if err != nil || n == 0 {
			return id, err
		}
		if added && looks.HasFile != nil {
			dir := strings.TrimSuffix(row.strs[seDir], `\`)
			for f := seFile; f < seFile+soundFiles; f++ {
				if file := row.strs[f]; file != "" && !looks.HasFile(dir+`\`+file) {
					p.missingFiles = append(p.missingFiles, fmt.Sprintf(`%s\%s (%s)`, dir, file, row.strs[seName]))
				}
			}
		}
		sounds[id] = n
		return n, nil
	}
	used := func(id func(AreaRow) uint32) []uint32 {
		m := map[uint32]bool{}
		for _, a := range rows {
			m[id(a)] = true
		}
		return sortedIDs(m)
	}
	note := func(what string, id, n uint32, name string, added bool) {
		if n == id && !added {
			return
		}
		what = fmt.Sprintf("%s %d", what, id)
		if name != "" {
			what += " (" + name + ")"
		}
		if added {
			p.carried = append(p.carried, fmt.Sprintf("%s added as %d", what, n))
		} else {
			p.carried = append(p.carried, fmt.Sprintf("%s is this client's %d", what, n))
		}
	}
	zoneSounds := []struct {
		c      dbcCarry
		what   string
		id     func(AreaRow) uint32
		to     map[uint32]uint32
		sounds []int
		name   func(dbcCarryRow) string
	}{
		{carriedMusic, "zone music", func(a AreaRow) uint32 { return a.Music }, p.music, []int{musicDay, musicNight}, func(r dbcCarryRow) string { return r.strs[1] }},
		{carriedIntro, "intro music", func(a AreaRow) uint32 { return a.IntroMusic }, p.intro, []int{introSound}, func(r dbcCarryRow) string { return r.strs[1] }},
		{carriedAmbience, "ambience", func(a AreaRow) uint32 { return a.Ambience }, p.ambience, []int{ambienceDay, ambienceNight}, func(r dbcCarryRow) string {
			return carried[carriedSound.name][r.rec[ambienceDay]].strs[seName]
		}},
	}
	for _, z := range zoneSounds {
		for _, id := range used(z.id) {
			row, ok := carried[z.c.name][id]
			if !ok {
				continue
			}
			name := z.name(row)
			row = dbcCarryRow{rec: slices.Clone(row.rec), strs: row.strs}
			for _, f := range z.sounds {
				n, err := sound(row.rec[f])
				if err != nil {
					return areaLookPlan{}, err
				}
				row.rec[f] = n
			}
			n, added, err := put(z.c, row)
			if err != nil {
				return areaLookPlan{}, err
			}
			if n != 0 {
				z.to[id] = n
				note(z.what, id, n, name, added)
			}
		}
	}
	params := map[uint32]uint32{}
	for _, id := range used(func(a AreaRow) uint32 { return a.Light }) {
		row, ok := carried[carriedLight.name][id]
		if !ok {
			continue
		}
		row = dbcCarryRow{rec: slices.Clone(row.rec), strs: row.strs}
		for f := lightParamsAt; f < lightParamsAt+lightParamsN; f++ {
			pid := row.rec[f]
			if pid == 0 {
				continue
			}
			n, done := params[pid]
			if !done {
				var err error
				if n, err = planLightParams(pid, carried, cur, changed); err != nil {
					return areaLookPlan{}, err
				}
				params[pid] = n
			}
			row.rec[f] = n
		}
		n, added, err := put(carriedLight, row)
		if err != nil {
			return areaLookPlan{}, err
		}
		if n != 0 {
			p.light[id] = n
			note("light", id, n, "", added)
		}
	}
	for _, c := range carriedAreaTables {
		if changed[c.name] {
			p.files = append(p.files, mpq.File{Name: c.path, Data: cur[c.name]})
		}
	}
	return p, nil
}

// planLightParams is the ID a carried params row (pid) and its bands come to in the client's tables
// (cur, by name, updated with what it adds): pid's own when that row and its bands hold the same,
// else the first row that does, else a new row whose bands' IDs are free too. A params row the script
// doesn't carry, or tables the client lacks, keep pid.
func planLightParams(pid uint32, carried map[string]map[uint32]dbcCarryRow, cur map[string][]byte, changed map[string]bool) (uint32, error) {
	row, ok := carried[carriedParams.name][pid]
	if !ok {
		return pid, nil
	}
	var tables [3]*dbcTable
	for i, c := range []dbcCarry{carriedParams, carriedIntBand, carriedFloatBand} {
		b, ok := cur[c.name]
		if !ok {
			return pid, nil
		}
		t, err := parseSized(b, c.name+".dbc", c.fields)
		if err != nil {
			return 0, err
		}
		tables[i] = t
	}
	pt, it, ft := tables[0], tables[1], tables[2]
	type band struct {
		c     dbcCarry
		t     *dbcTable
		float bool
		at    int
		row   dbcCarryRow
	}
	var bands []band
	for _, x := range []struct {
		c     dbcCarry
		t     *dbcTable
		float bool
	}{{carriedIntBand, it, false}, {carriedFloatBand, ft, true}} {
		for i, bid := range bandIDs(pid, x.float) {
			if br, ok := carried[x.c.name][bid]; ok {
				bands = append(bands, band{x.c, x.t, x.float, i, br})
			}
		}
	}
	// sameAt says whether params row q and its bands hold the carried ones.
	sameAt := func(q uint32) bool {
		r, ok := pt.row(q)
		if !ok || !carriedParams.same(pt, r, row) {
			return false
		}
		for _, b := range bands {
			br, ok := b.t.row(bandIDs(q, b.float)[b.at])
			if !ok || !b.c.same(b.t, br, b.row) {
				return false
			}
		}
		return true
	}
	if sameAt(pid) {
		return pid, nil
	}
	for r := 0; r < pt.records; r++ {
		if q := pt.u32(r, 0); sameAt(q) {
			return q, nil
		}
	}
	q := max(maxID(pt), (maxID(it)+LightBands-1)/LightBands, (maxID(ft)+LightFloats-1)/LightFloats) + 1
	rec := slices.Clone(row.rec)
	rec[0] = q
	out, err := setRecords(cur[carriedParams.name], [][]uint32{rec})
	if err != nil {
		return 0, fmt.Errorf("LightParams.dbc: %w", err)
	}
	cur[carriedParams.name], changed[carriedParams.name] = out, true
	for _, float := range []bool{false, true} {
		c := carriedIntBand
		if float {
			c = carriedFloatBand
		}
		var recs [][]uint32
		for _, b := range bands {
			if b.float == float {
				r := slices.Clone(b.row.rec)
				r[0] = bandIDs(q, float)[b.at]
				recs = append(recs, r)
			}
		}
		if len(recs) == 0 {
			continue
		}
		out, err := setRecords(cur[c.name], recs)
		if err != nil {
			return 0, fmt.Errorf("%s.dbc: %w", c.name, err)
		}
		cur[c.name], changed[c.name] = out, true
	}
	return q, nil
}

// rewrite sets an area's music, intro music, ambience and light to the IDs the plan gives them.
func (p areaLookPlan) rewrite(a *AreaRow) {
	for _, x := range []struct {
		to map[uint32]uint32
		id *uint32
	}{{p.music, &a.Music}, {p.intro, &a.IntroMusic}, {p.ambience, &a.Ambience}, {p.light, &a.Light}} {
		if n, ok := x.to[*x.id]; ok {
			*x.id = n
		}
	}
}

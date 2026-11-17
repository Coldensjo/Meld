package vmangos

import (
	"encoding/binary"
	"sort"
	"strings"
	"testing"

	"Meld/internal/clientbuild"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestParseDBCLayout(t *testing.T) {
	l, err := parseDBCLayout("Test", clientbuild.Vanilla, "ID MapID Pos:f[3] Name:loc _[2] Path:s Texture:s[2] Count:i")
	if err != nil {
		t.Fatal(err)
	}
	// ID 0, MapID 1, Pos 2-4, Name 5-12 and its mask 13, two unnamed, Path 16, Texture 17-18, Count 19.
	if l.columns != 20 {
		t.Fatalf("%d columns, want 20", l.columns)
	}
	for _, c := range []struct {
		got, want int
		what      string
	}{
		{l.col("MapID"), 1, "MapID"}, {l.at("Pos", 0), 2, "Pos[0]"}, {l.at("Pos", 2), 4, "Pos[2]"}, {l.col("Name"), 5, "Name"},
		{l.mask("Name"), 13, "Name's mask"}, {l.col("Path"), 16, "Path"}, {l.at("Texture", 1), 18, "Texture[1]"},
		{l.col("Count"), 19, "Count"}, {l.count("Texture"), 2, "Texture's count"},
	} {
		if c.got != c.want {
			t.Errorf("%s is %d, want %d", c.what, c.got, c.want)
		}
	}
	if locs := l.locs("Name"); len(locs) != 8 || locs[0] != 5 || locs[7] != 12 {
		t.Errorf("Name's locale columns %v", locs)
	}
	if got := l.strs; len(got) != 3 || got[0] != 16 || got[2] != 18 || !l.isStr[17] || l.isStr[5] {
		t.Errorf("string columns %v", got)
	}
	if !l.has("Path") || l.has("Missing") {
		t.Error("has")
	}
	// A later build's localized string is 16 locales and a mask.
	wl, err := parseDBCLayout("Test", clientbuild.WotLK, "ID Name:loc Flags")
	if err != nil {
		t.Fatal(err)
	}
	if wl.columns != 19 || wl.mask("Name") != 17 || wl.col("Flags") != 18 {
		t.Errorf("3.3.5a: %d columns, mask %d, flags %d", wl.columns, wl.mask("Name"), wl.col("Flags"))
	}
	for _, bad := range []string{"", "_ ID", "ID ID", "ID Pos[x]", "ID Pos[0]", "ID Pos:q", "ID :f", "ID Pos[3"} {
		if _, err := parseDBCLayout("Test", clientbuild.Vanilla, bad); err == nil {
			t.Errorf("%q: no error", bad)
		}
	}
}

func TestDBCLayoutPanicsOnAMissingField(t *testing.T) {
	l, _ := parseDBCLayout("Test", clientbuild.Vanilla, "ID Pos:f[3] Flags")
	for name, f := range map[string]func(){
		"a missing field":    func() { l.col("Missing") },
		"an array with col":  func() { l.col("Pos") },
		"past an array":      func() { l.at("Pos", 3) },
		"a mask of a number": func() { l.mask("Flags") },
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s: no panic", name)
				}
			}()
			f()
		}()
	}
}

// TestDBCSchemaPicksTheLayoutByWidth reads a table with the layout of its width, and one of no
// known width with the 1.12 layout.
func TestDBCSchemaPicksTheLayoutByWidth(t *testing.T) {
	v, _ := parseDBCLayout("Test", clientbuild.Vanilla, "ID Name:loc Flags")
	w, _ := parseDBCLayout("Test", clientbuild.WotLK, "ID Name:loc Flags")
	s := &dbcSchema{name: "Test", layouts: []*dbcLayout{v, w}}
	for _, c := range []struct {
		fields int
		want   *dbcLayout
	}{{11, v}, {19, w}, {5, v}, {40, v}} {
		if got := s.layout(c.fields); got != c.want {
			t.Errorf("%d fields: the %s layout", c.fields, got.build.Version())
		}
	}
	if s.forBuild(clientbuild.WotLK) != w || s.forBuild(clientbuild.TBC) != v || s.forBuild(clientbuild.Unknown) != v {
		t.Error("forBuild")
	}
	b := dbcBytes(19, [][]uint32{{1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7}}, "\x00")
	tb, err := parseTable(b, s)
	if err != nil || tb.l != w || tb.u32(0, tb.col("Flags")) != 7 {
		t.Fatalf("a 3.3.5a-wide table: %v", err)
	}
	if _, err := parseExact(dbcBytes(5, nil, "\x00"), s); err == nil {
		t.Error("parseExact took a table of no known width")
	}
}

// wotlkSameWidth are the tables the 3.3.5a client holds in 1.12's width with other columns, whose
// readers pass the client's build (parseTableFor).
var wotlkSameWidth = map[string]bool{"GroundEffectDoodad": true, "CharSections": true}

// TestDBCSchemasAreSound checks every table's layouts: a 1.12 one, the ID first, and distinct widths
// but for the tables known to need the build.
func TestDBCSchemasAreSound(t *testing.T) {
	if len(dbcSchemas) < 50 {
		t.Fatalf("only %d schemas", len(dbcSchemas))
	}
	for name, s := range dbcSchemas {
		if s.layouts[0].build != clientbuild.Vanilla {
			t.Errorf("%s has no 1.12 layout first", name)
		}
		if s.ambiguous() != wotlkSameWidth[name] {
			t.Errorf("%s: two layouts of one width: %v, want %v (a reader of such a table passes the build)", name, s.ambiguous(), wotlkSameWidth[name])
		}
		// A 3.3.5a layout keeps the 1.12 names, but for the fields that client dropped.
		w := s.forBuild(clientbuild.WotLK)
		if w.build != clientbuild.WotLK {
			if len(wotlkDropped[name]) > 0 {
				t.Errorf("%s has dropped fields listed but no 3.3.5a layout", name)
			}
			continue
		}
		dropped := map[string]bool{}
		for _, f := range wotlkDropped[name] {
			dropped[f] = true
			if w.has(f) || !s.layouts[0].has(f) {
				t.Errorf("%s.%s is listed as dropped in 3.3.5a, but the 3.3.5a layout has it or the 1.12 one lacks it", name, f)
			}
		}
		for _, f := range s.layouts[0].fields {
			switch wf, ok := w.byName[f.name]; {
			case !ok && !dropped[f.name]:
				t.Errorf("%s: the 3.3.5a layout lacks %s, which is not listed in wotlkDropped", name, f.name)
			case ok && w.fields[wf].kind != f.kind:
				t.Errorf("%s.%s is another type in the 3.3.5a layout", name, f.name)
			case ok && w.fields[wf].count < f.count:
				t.Errorf("%s.%s has %d elements in 1.12 and %d in 3.3.5a: a reader of the last would panic", name, f.name, f.count, w.fields[wf].count)
			}
		}
	}
	for name := range wotlkDropped {
		if dbcSchemas[name] == nil {
			t.Errorf("wotlkDropped names %s, which is no schema", name)
		}
	}
}

// TestDBCLayoutsMatchClient reads every table Meld has a layout for from the client: its 1.12
// layout must be the table's width, and every string column must point at the start of a string in
// the table's string block (a number taken for a string, or the reverse, shows there).
func TestDBCLayoutsMatchClient(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	if set.Build() != clientbuild.Vanilla {
		t.Skipf("the test client is %s; this test reads a 1.12 one", set.Build())
	}
	checkLayouts(t, set, nil)
}

// wotlkNoLayout are the tables Meld has no 3.3.5a layout for yet, so that client's are read with the
// 1.12 columns and what reads them is wrong there: the spell editor's own (#1067's rest).
var wotlkNoLayout = map[string]bool{"Spell": true, "SpellVisual": true, "SpellVisualKit": true}

// TestDBCLayoutsMatchWotLKClient is TestDBCLayoutsMatchClient for the 3.3.5a client (#1067): every
// table but wotlkNoLayout's is read with a layout of its own width, and the layout's strings are
// strings. Then some rows every 3.3.5a client has, read through the names the readers use.
func TestDBCLayoutsMatchWotLKClient(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.WotLKDir(t))
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	checkLayouts(t, set, wotlkNoLayout)
	for name := range wotlkNoLayout {
		if dbcSchemas[name] == nil {
			t.Errorf("wotlkNoLayout names %s, which is no schema", name)
		} else if dbcSchemas[name].forBuild(clientbuild.WotLK).build == clientbuild.WotLK {
			t.Errorf("%s has a 3.3.5a layout now: take it out of wotlkNoLayout", name)
		}
	}

	table := func(s *dbcSchema) *dbcTable {
		b, err := set.ReadFile(s.file())
		if err != nil {
			t.Fatalf("%s: %v", s.name, err)
		}
		tb, err := parseTableFor(b, s, set.Build())
		if err != nil {
			t.Fatalf("%s: %v", s.name, err)
		}
		return tb
	}
	str := func(tb *dbcTable, id uint32, field string) string {
		r, ok := tb.row(id)
		if !ok {
			t.Errorf("%s.dbc has no row %d", tb.l.table, id)
			return ""
		}
		return tb.str(r, tb.col(field))
	}
	num := func(tb *dbcTable, id uint32, field string) uint32 {
		r, ok := tb.row(id)
		if !ok {
			t.Errorf("%s.dbc has no row %d", tb.l.table, id)
			return 0
		}
		return tb.u32(r, tb.col(field))
	}
	maps := table(dbcMap)
	if dir, name := str(maps, 571, "Directory"), str(maps, 571, "Name"); dir != "Northrend" || name != "Northrend" {
		t.Errorf("map 571 is %q in the folder %q, want Northrend", name, dir)
	}
	if kind, expansion := num(maps, 533, "InstanceType"), num(maps, 533, "Expansion"); kind != 2 || expansion != 2 {
		t.Errorf("map 533 (Naxxramas) has instance type %d and expansion %d, want 2 (a raid) and 2", kind, expansion)
	}
	areas := table(dbcAreaTable)
	if name, m := str(areas, 4395, "Name"), num(areas, 4395, "MapID"); name != "Dalaran" || m != 571 {
		t.Errorf("area 4395 is %q on map %d, want Dalaran on 571", name, m)
	}
	if name, parent := str(areas, 4197, "Name"), num(areas, 4197, "ParentID"); name != "Wintergrasp" || parent != 0 {
		t.Errorf("area 4197 is %q under %d, want Wintergrasp, a zone", name, parent)
	}
	liquids := table(dbcLiquidType)
	for id, want := range map[uint32][2]any{1: {"Water", uint32(0)}, 2: {"Ocean", uint32(1)}, 3: {"Magma", uint32(2)}, 4: {"Slime", uint32(3)}} {
		if name, kind := str(liquids, id, "Name"), num(liquids, id, "Kind"); name != want[0] || kind != want[1] {
			t.Errorf("liquid type %d is %q of kind %d, want %v", id, name, kind, want)
		}
	}
	if r, ok := liquids.row(1); !ok || !strings.Contains(strings.ToLower(liquids.str(r, liquids.at("Texture", 0))), "xtextures") {
		t.Errorf("liquid type 1's first texture is not under XTextures")
	}
	// The page takes a liquid's kind in 1.12's numbers, which a lake must not read as lava in.
	types, err := LoadLiquidTypes(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range types {
		if want, ok := map[int]int{1: 3, 2: 3, 3: 0, 4: 2, 5: 3, 15: 0, 21: 2}[e.ID]; ok && e.Kind != want {
			t.Errorf("liquid type %d (%s) has kind %d in 1.12's numbers, want %d", e.ID, e.Name, e.Kind, want)
		}
	}
	if len(types) < 20 {
		t.Errorf("%d liquid types", len(types))
	}
	nodes := table(dbcTaxiNodes)
	if name, m := str(nodes, 310, "Name"), num(nodes, 310, "MapID"); name != "Dalaran" || m != 571 {
		t.Errorf("taxi node 310 is %q on map %d, want Dalaran on 571", name, m)
	}
	// The two tables as wide as 1.12's, read as this client's.
	doodads := table(dbcGroundDoodad)
	if doodads.l.build != clientbuild.WotLK || !strings.HasSuffix(strings.ToLower(doodads.str(0, doodads.col("Path"))), ".mdl") {
		t.Errorf("GroundEffectDoodad's first path is %q, read with the %s layout", doodads.str(0, doodads.col("Path")), doodads.l.build.Version())
	}
	sections := table(dbcCharSections)
	skins := 0
	for r := 0; r < sections.records; r++ {
		if sections.u32(r, sections.col("Section")) == 0 && strings.HasSuffix(strings.ToLower(sections.str(r, sections.at("Texture", 0))), ".blp") {
			skins++
		}
	}
	if sections.l.build != clientbuild.WotLK || skins < 100 {
		t.Errorf("CharSections has %d skin rows with a texture, read with the %s layout", skins, sections.l.build.Version())
	}
	models := table(dbcCreatureModel)
	paths := 0
	for r := 0; r < models.records; r++ {
		if p := strings.ToLower(models.str(r, models.col("Path"))); strings.HasSuffix(p, ".mdx") || strings.HasSuffix(p, ".m2") || strings.HasSuffix(p, ".mdl") {
			paths++
		}
	}
	if paths*10 < models.records*9 {
		t.Errorf("CreatureModelData: %d of %d rows name a model", paths, models.records)
	}
}

// checkLayouts reads every table Meld has a layout for from the client set is of, but the ones in
// skip: its layout for that client's build must be the table's width, and every string column must
// point at the start of a string in the table's string block.
func checkLayouts(t *testing.T, set *mpq.Set, skip map[string]bool) {
	t.Helper()
	build := set.Build()
	names := make([]string, 0, len(dbcSchemas))
	for name := range dbcSchemas {
		if !skip[name] {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		s := dbcSchemas[name]
		b, err := set.ReadFile(s.file())
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		tb, err := parseTableFor(b, s, build)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		l := tb.l
		if tb.fields != l.columns || tb.recSize != tb.fields*4 {
			t.Errorf("%s.dbc has %d fields of %d bytes, the layout Meld reads a %s client's with %d", name, tb.fields, tb.recSize, build.Version(), l.columns)
			continue
		}
		if want := s.forBuild(build); want.build == build && l != want {
			t.Errorf("%s.dbc is read with the %s layout, not its %s one", name, l.build.Version(), build.Version())
		}
		block := b[tb.strsAt:]
		check := func(col int, what string) {
			for r := 0; r < tb.records; r++ {
				off := int(binary.LittleEndian.Uint32(b[20+r*tb.recSize+col*4:]))
				if off >= len(block) || off > 0 && block[off-1] != 0 {
					t.Errorf("%s.dbc %s (column %d): row %d's %d is not a string's start in a block of %d", name, what, col, r, off, len(block))
					return
				}
			}
		}
		for _, c := range l.strs {
			check(c, "string")
		}
		for _, f := range l.fields {
			if f.kind == dbcLoc {
				for i := 0; i < f.count; i++ {
					for _, c := range l.locs(f.name) {
						check(c+i*(l.locales+1), f.name)
					}
				}
			}
		}
	}
}

// TestDBCWritesKeepTheClientsBytes writes rows of the client's own tables back as they are, through
// the editors' writers, which must leave each table byte for byte as the client has it.
func TestDBCWritesKeepTheClientsBytes(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	read := func(s *dbcSchema) []byte {
		b, err := set.ReadFile(s.file())
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	same := func(what string, before, after []byte, err error) {
		t.Helper()
		if err != nil {
			t.Errorf("%s: %v", what, err)
		} else if string(before) != string(after) {
			t.Errorf("%s: writing the client's own rows back changed the table", what)
		}
	}
	tbl := func(b []byte, s *dbcSchema) *dbcTable {
		tb, err := parseTable(b, s)
		if err != nil {
			t.Fatal(err)
		}
		return tb
	}

	// Every record of these tables put back by ID through setRecords.
	for _, s := range []*dbcSchema{dbcLight, dbcLightParams, dbcLightIntBand, dbcLightFloatBand, dbcTransportAnim, dbcGroundTexture, dbcSoundAmbience} {
		b := read(s)
		tb := tbl(b, s)
		rows := make([][]uint32, tb.records)
		for r := range rows {
			rows[r] = tb.record(r)
		}
		out, err := setRecords(b, rows)
		same(s.name+" through setRecords", b, out, err)
	}

	// The area triggers of a map, read and saved.
	b := read(dbcAreaTrigger)
	triggers, err := ReadAreaTriggers(b, 0)
	if err != nil || len(triggers) == 0 {
		t.Fatalf("Eastern Kingdoms' triggers: %d, %v", len(triggers), err)
	}
	out, err := SetAreaTriggers(b, triggers, nil)
	same("AreaTrigger", b, out, err)

	// A map's lights, read and written.
	lights := [4][]byte{read(dbcLight), read(dbcLightParams), read(dbcLightIntBand), read(dbcLightFloatBand)}
	ml, err := ReadMapLights(lights[0], lights[1], lights[2], lights[3], 1)
	if err != nil {
		t.Fatal(err)
	}
	edit := LightsEdit{MapID: 1}
	for _, l := range ml.Lights {
		if !l.Borrowed {
			edit.Lights = append(edit.Lights, l)
		}
	}
	written, err := WriteLights(lights, edit)
	for i := range lights {
		same("Kalimdor's "+lightTables[i], lights[i], written[i], err)
	}

	// Elwynn's world map row.
	b = read(dbcWorldMapArea)
	row, err := FindWorldMapRow(b, 0, 12)
	if err != nil || row == nil {
		t.Fatalf("Elwynn's world map: %v", err)
	}
	out, _, err = SetWorldMapRow(b, *row)
	same("WorldMapArea", b, out, err)

	// A lift's frames.
	b = read(dbcTransportAnim)
	motions, err := ReadLiftMotions(b)
	if err != nil || len(motions) == 0 {
		t.Fatalf("lifts: %v", err)
	}
	out, err = SetLiftFrames(b, motions[0].Entry, motions[0].Frames)
	same("TransportAnimation", b, out, err)

	// The graveyards and flight stops of Kalimdor, whose names are kept as they are.
	b = read(dbcWorldSafeLocs)
	yards, err := ReadGraveyards(b, 1)
	if err != nil || len(yards) == 0 {
		t.Fatalf("graveyards: %v", err)
	}
	out, err = SetGraveyards(b, yards, nil)
	same("WorldSafeLocs", b, out, err)

	// A game object display's own sound slots.
	d, se := read(dbcObjectDisplay), read(dbcSoundEntries)
	sounds, err := objectDisplaySounds(d, 197)
	if err != nil {
		t.Fatal(err)
	}
	if _, changed, err := setObjectDisplaySounds(d, se, 197, sounds.Sounds); err != nil || changed {
		t.Errorf("the Forge's own sounds: changed %v, %v", changed, err)
	}

	// The zones of a map, written back unchanged but for the names' strings, which a write adds only
	// when a name changed.
	b = read(dbcAreaTable)
	areas, err := ReadAreaRows(b, 0)
	if err != nil {
		t.Fatal(err)
	}
	out, err = SetAreaRows(b, areas)
	same("AreaTable", b, out, err)
	if !strings.HasPrefix(string(out[:4]), "WDBC") {
		t.Fatal("not a table")
	}
}

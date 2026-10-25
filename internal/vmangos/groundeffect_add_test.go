package vmangos

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestAddGroundEffectSynthetic is the client-free check of AddGroundEffect: the new GroundEffectTexture
// row takes the next ID, names its models by GroundEffectDoodad's internal IDs (field 1, not the row
// ID; 0 is a model, empty slots 0xFFFFFFFF), matches a path in any case and takes a model listed twice
// by its lower ID; the old rows and the string block stay byte-identical. The doodad table is only
// read. Bad input is refused.
func TestAddGroundEffectSynthetic(t *testing.T) {
	// Row IDs one past the internal IDs, as most of the client's are; ElwGra01 is listed twice.
	block := "\x00ElwFlo01.mdl\x00ElwGra01.mdl\x00DurBush01.MDX\x00ElwGra01.mdl\x00"
	doodads := dbcBytes(3, [][]uint32{{1, 0, 1}, {2, 1, 14}, {3, 2, 27}, {8, 7, 41}}, block)
	textures := dbcBytes(7, [][]uint32{
		{1, 0, 1, noDoodad, noDoodad, 8, 0},
		{5, 2, noDoodad, noDoodad, noDoodad, 4, 1},
	}, "\x00")
	models := []string{detailDir + `elwgra01.m2`, detailDir + `ElwFlo01.m2`, detailDir + `DurBush01.m2`}
	out, id, err := AddGroundEffect(doodads, textures, models, 12, 3)
	if err != nil {
		t.Fatal(err)
	}
	if id != 6 {
		t.Fatalf("the new effect's ID is %d, want 6", id)
	}
	tt, err := parseDBC(out)
	if err != nil {
		t.Fatal(err)
	}
	r, ok := tt.row(id)
	if !ok || tt.records != 3 || r != 2 {
		t.Fatalf("%d rows, the new one at %d", tt.records, r)
	}
	want := []uint32{6, 1, 0, 2, noDoodad, 12, 3}
	for f, v := range want {
		if tt.u32(r, f) != v {
			t.Fatalf("the new row's field %d = %#x, want %#x", f, tt.u32(r, f), v)
		}
	}
	old := fieldAt(7, 2, 0)
	if !bytes.Equal(out[20:old], textures[20:old]) || !bytes.Equal(out[fieldAt(7, 3, 0):], textures[old:]) {
		t.Fatal("the old rows or the string block changed")
	}
	if binary.LittleEndian.Uint32(out[4:]) != 3 || !bytes.Equal(out[8:20], textures[8:20]) {
		t.Fatal("the header is wrong")
	}
	// Read back as the editor does, the slots name the same models.
	paths := detailPaths(mustDBC(t, doodads))
	for i, m := range models {
		if got := paths[tt.u32(r, 1+i)]; !strings.EqualFold(got, m) {
			t.Fatalf("slot %d reads back as %q, not %q", i, got, m)
		}
	}

	for _, c := range []struct {
		models  []string
		density uint32
	}{
		{nil, 8},
		{[]string{models[0], models[0], models[0], models[0], models[0]}, 8},
		{models[:1], 0},
		{models[:1], 65},
		{[]string{detailDir + `NotAModel.m2`}, 8},
	} {
		if _, _, err := AddGroundEffect(doodads, textures, c.models, c.density, 0); err == nil {
			t.Fatalf("%d models at density %d were accepted", len(c.models), c.density)
		}
	}
	if _, _, err := AddGroundEffect(doodads, dbcBytes(6, nil, "\x00"), models[:1], 8, 0); err == nil {
		t.Fatal("a GroundEffectTexture table of 6 fields was accepted")
	}
}

func mustDBC(t *testing.T, b []byte) *dbcTable {
	t.Helper()
	d, err := parseDBC(b)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// TestClientAddGroundEffect adds a ground effect growing two of the client's own detail models: the new
// row takes the next ID with the models' GroundEffectDoodad IDs, density and terrain, and every other
// row is unchanged. It needs WOW_DIR.
func TestClientAddGroundEffect(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	effects, err := readGroundEffectDBCs(set)
	if err != nil {
		t.Fatal(err)
	}
	doodadDBC, _ := set.ReadFile(`DBFilesClient\GroundEffectDoodad.dbc`)
	textureDBC, _ := set.ReadFile(`DBFilesClient\GroundEffectTexture.dbc`)
	set.Close()
	var models []string
	for _, e := range effects {
		if len(e.Doodads) >= 2 {
			models = e.Doodads[:2]
			break
		}
	}
	out, id, err := AddGroundEffect(doodadDBC, textureDBC, models, 12, 3)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := parseDBC(textureDBC)
	after, err := parseDBC(out)
	if err != nil {
		t.Fatal(err)
	}
	if after.records != before.records+1 {
		t.Fatalf("%d rows after adding one to %d", after.records, before.records)
	}
	r, ok := after.row(id)
	if !ok || after.u32(r, 5) != 12 || after.u32(r, 6) != 3 || after.u32(r, 3) != noDoodad || after.u32(r, 4) != noDoodad {
		t.Fatalf("the new effect %d's row is wrong", id)
	}
	// The slots name the models by the IDs the client looks them up by, so they read back as the same models.
	dt, _ := parseDBC(doodadDBC)
	paths := detailPaths(dt)
	for i, m := range models {
		if got := paths[after.u32(r, 1+i)]; !strings.EqualFold(got, m) {
			t.Fatalf("slot %d reads back as %q, not %q", i, got, m)
		}
	}
	for k := 0; k < before.records; k++ {
		for f := 0; f < before.fields; f++ {
			if before.u32(k, f) != after.u32(k, f) {
				t.Fatalf("row %d changed", k)
			}
		}
	}
	if _, _, err := AddGroundEffect(doodadDBC, textureDBC, []string{`World\NoDXT\Detail\NotAModel.m2`}, 8, 0); err == nil {
		t.Fatal("a model that isn't a ground effect model was accepted")
	}
}

// TestClientGroundEffectModels reads the client's effects by the doodads' internal IDs, as the client
// does: an effect's models then come from one zone's set (Elwynn's grass, Durotar's bushes), where the
// row IDs would hand most effects the neighbouring row's model. It needs WOW_DIR.
func TestClientGroundEffectModels(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	effects, err := readGroundEffectDBCs(set)
	if err != nil {
		t.Fatal(err)
	}
	mixed := 0
	for id, e := range effects {
		// Every model is named by a slot, in order, and every slot names a model or none.
		next := 0
		for _, s := range e.Slots {
			if s >= 0 {
				if s != next {
					t.Fatalf("effect %d's slots %v don't follow its %d models", id, e.Slots, len(e.Doodads))
				}
				next++
			}
		}
		if next != len(e.Doodads) {
			t.Fatalf("effect %d's slots %v name %d of its %d models", id, e.Slots, next, len(e.Doodads))
		}
		zones := map[string]bool{}
		for _, d := range e.Doodads {
			name := strings.ToLower(d[len(detailDir):])
			zones[name[:3]] = true
		}
		if len(zones) > 1 {
			mixed++
		}
	}
	// 29 with the internal IDs, 264 with the row IDs.
	if mixed > 60 {
		t.Fatalf("%d of %d effects mix models of different zones", mixed, len(effects))
	}
}

// TestClientTerrainTypes reads TerrainType.dbc as Benilla's footsteps.rs describes it: 11 rows, named,
// with footprints on snow and sand only. It needs WOW_DIR.
func TestClientTerrainTypes(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	tt, err := readTerrainTypes(set)
	if err != nil {
		t.Fatal(err)
	}
	if len(tt) != 11 {
		t.Fatalf("%d terrain types, want 11", len(tt))
	}
	var prints []int
	for _, r := range tt {
		if r.Name == "" {
			t.Fatalf("terrain type %d has no name", r.ID)
		}
		if r.Footprints {
			prints = append(prints, r.ID)
		}
		t.Logf("%d %s footprints=%v", r.ID, r.Name, r.Footprints)
	}
	if len(prints) != 2 || prints[0] != 3 || prints[1] != 7 {
		t.Fatalf("footprints on %v, want snow (3) and sand (7)", prints)
	}
}

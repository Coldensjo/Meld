package vmangos

import (
	"os"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// TestClientAddGroundEffect adds a ground effect growing two of the client's own detail models: the new
// row takes the next ID with the models' GroundEffectDoodad IDs, density and terrain, and every other
// row is unchanged. It needs WOW_DIR.
func TestClientAddGroundEffect(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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

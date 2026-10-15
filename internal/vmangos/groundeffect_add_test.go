package vmangos

import (
	"os"
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
	if !ok || after.u32(r, 5) != 12 || after.u32(r, 6) != 3 || after.u32(r, 1) == 0 || after.u32(r, 2) == 0 || after.u32(r, 3) != 0 {
		t.Fatalf("the new effect %d's row is wrong", id)
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

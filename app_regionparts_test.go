package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/vmangos"
)

// A region edit sent in parts joins back into the edit sent whole, and parts out of order, or a
// take with none sent, are refused.
func TestRegionEditParts(t *testing.T) {
	var s regionPartStore
	edit := vmangos.RegionEdit{
		MapName: "Azeroth", X: 30, Y: 48, Size: 7,
		Heights:    strings.Repeat("AAAA", 1000),
		Objects:    []vmangos.ObjectView{{UID: 7, Type: "m2:World\\Tree.m2", X: 1, Y: 2, Z: 3, Scale: 1}},
		Paint:      []vmangos.RegionPaint{{Chunk: 12, Textures: []string{"Tileset\\Elwynn\\ElwynnGrassBase.blp"}, Weights: strings.Repeat("/w==", 500)}},
		HasLiquids: true,
		Liquids:    []adt.Liquid{{IndexX: 3, IndexY: 4, Type: adt.LiquidWater}},
		Skip:       []string{"31_49"},
	}
	whole, err := json.Marshal(edit)
	if err != nil {
		t.Fatal(err)
	}
	send := func(id string) {
		for i, at := 0, 0; at < len(whole); i, at = i+1, at+997 {
			if err := s.add(id, i, string(whole[at:min(at+997, len(whole))])); err != nil {
				t.Fatal(err)
			}
		}
	}
	// An edit given up halfway is replaced by the next one under its id.
	if err := s.add("r1", 0, "{\"mapName\":"); err != nil {
		t.Fatal(err)
	}
	send("r1")
	got, err := s.take("r1")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, edit) {
		t.Fatalf("joined edit %+v, want %+v", got, edit)
	}
	if _, err := s.take("r1"); err == nil {
		t.Fatal("a second take of the same edit was not refused")
	}

	send("r2")
	if err := s.add("r2", 99, "x"); err == nil {
		t.Fatal("a part out of order was not refused")
	}
	if _, err := s.take("r2"); err == nil {
		t.Fatal("an edit whose parts came out of order was taken")
	}

	send("r3")
	s.drop("r3")
	if _, err := s.take("r3"); err == nil {
		t.Fatal("a dropped edit was taken")
	}
}

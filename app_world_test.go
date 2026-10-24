package main

import (
	"bytes"
	"encoding/base64"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"Meld/internal/worldfile"
)

// The bridge form of a world (WorldData) carries the fixture through unchanged.
func TestWorldDataRoundTrip(t *testing.T) {
	w, err := worldfile.Load(filepath.Join("..", "crates", "world", "tests", "fixtures", "small.world"))
	if err != nil {
		t.Fatal(err)
	}
	d := worldToData(w)
	if d.ChunksX != 2 || len(d.Chunks) != 6 {
		t.Fatalf("data %+v", d)
	}
	back, err := worldFromData(*d)
	if err != nil {
		t.Fatal(err)
	}
	painted := 0
	for i, c := range back.Chunks {
		if string(c.Cubes) != string(w.Chunks[i].Cubes) || !slices.Equal(c.Paint, w.Chunks[i].Paint) || c.CX != w.Chunks[i].CX || c.Layer != w.Chunks[i].Layer {
			t.Errorf("chunk %d changed", i)
		}
		if (c.Paint == nil) != (d.Chunks[i].Paint == "") {
			t.Errorf("chunk %d: paint %d bytes, data %q", i, len(c.Paint), d.Chunks[i].Paint)
		}
		if c.Paint != nil {
			painted++
		}
	}
	// The fixture paints three of its chunks (docs/world-format.md, The fixture).
	if painted != 3 {
		t.Errorf("%d painted chunks, want 3", painted)
	}
}

// The spawn point survives the bridge both ways, and a world without one stays without.
func TestWorldDataSpawn(t *testing.T) {
	w, err := worldfile.Load(filepath.Join("..", "crates", "world", "tests", "fixtures", "small.world"))
	if err != nil {
		t.Fatal(err)
	}
	w.Spawn = &worldfile.CubePos{X: 4, Z: 5, Layer: 9}
	d := worldToData(w)
	if d.Spawn == nil || *d.Spawn != (WorldSpawnData{X: 4, Z: 5, Layer: 9}) {
		t.Fatalf("spawn %+v", d.Spawn)
	}
	back, err := worldFromData(*d)
	if err != nil {
		t.Fatal(err)
	}
	if back.Spawn == nil || *back.Spawn != *w.Spawn {
		t.Errorf("spawn came back as %+v", back.Spawn)
	}
	d.Spawn = nil
	if back, err = worldFromData(*d); err != nil || back.Spawn != nil {
		t.Errorf("no spawn came back as %+v, %v", back.Spawn, err)
	}
	for _, bad := range []WorldSpawnData{{X: -1}, {X: d.ChunksX * worldfile.ChunkSize}, {Z: d.ChunksZ * worldfile.ChunkSize}, {Layer: 31}} {
		d.Spawn = &bad
		if _, err := worldFromData(*d); err == nil {
			t.Errorf("spawn %+v accepted", bad)
		}
	}
}

// The fixture's monster spawn points survive the bridge both ways, in order, and one outside the
// world is refused.
func TestWorldDataMonsters(t *testing.T) {
	w, err := worldfile.Load(filepath.Join("..", "crates", "world", "tests", "fixtures", "small.world"))
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Monsters) != 2 {
		t.Fatalf("the fixture has %d monster spawn points, want 2", len(w.Monsters))
	}
	d := worldToData(w)
	want := []WorldMonsterData{{Kind: "wolf", Pos: WorldSpawnData{X: 20, Z: 25, Layer: 9}}, {Kind: "höhlenbär", Pos: WorldSpawnData{X: 3, Z: 30, Layer: 25}}}
	if len(d.Monsters) != 2 || d.Monsters[0] != want[0] || d.Monsters[1] != want[1] {
		t.Fatalf("monsters %+v, want %+v", d.Monsters, want)
	}
	back, err := worldFromData(*d)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.Monsters) != 2 || back.Monsters[0] != w.Monsters[0] || back.Monsters[1] != w.Monsters[1] {
		t.Errorf("monsters came back as %+v", back.Monsters)
	}
	d.Monsters = nil
	if back, err = worldFromData(*d); err != nil || back.Monsters != nil {
		t.Errorf("no monsters came back as %+v, %v", back.Monsters, err)
	}
	for _, bad := range []WorldSpawnData{{X: -1}, {Z: d.ChunksZ * worldfile.ChunkSize}, {Layer: 31}} {
		d.Monsters = []WorldMonsterData{{Kind: "wolf", Pos: bad}}
		if _, err := worldFromData(*d); err == nil {
			t.Errorf("monster at %+v accepted", bad)
		}
	}
}

// The fixture's NPCs survive the bridge both ways, in order with their routes, and one standing or
// walking outside the world is refused.
func TestWorldDataNpcs(t *testing.T) {
	w, err := worldfile.Load(filepath.Join("..", "crates", "world", "tests", "fixtures", "small.world"))
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Npcs) != 2 {
		t.Fatalf("the fixture has %d NPCs, want 2", len(w.Npcs))
	}
	d := worldToData(w)
	want := []WorldNpcData{
		{Name: "Warden Hask", Pos: WorldSpawnData{X: 12, Z: 20, Layer: 9}, Route: []WorldSpawnData{{X: 14, Z: 20, Layer: 9}, {X: 14, Z: 28, Layer: 8}}},
		{Name: "Þóra", Pos: WorldSpawnData{X: 6, Z: 9, Layer: 10}, Route: []WorldSpawnData{}},
	}
	if !reflect.DeepEqual(d.Npcs, want) {
		t.Fatalf("NPCs %+v, want %+v", d.Npcs, want)
	}
	back, err := worldFromData(*d)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(back.Npcs, w.Npcs) {
		t.Errorf("NPCs came back as %+v", back.Npcs)
	}
	d.Npcs = nil
	if back, err = worldFromData(*d); err != nil || back.Npcs != nil {
		t.Errorf("no NPCs came back as %+v, %v", back.Npcs, err)
	}
	for _, bad := range []WorldSpawnData{{X: -1}, {Z: d.ChunksZ * worldfile.ChunkSize}, {Layer: 31}} {
		d.Npcs = []WorldNpcData{{Name: "Hask", Pos: bad}}
		if _, err := worldFromData(*d); err == nil {
			t.Errorf("NPC at %+v accepted", bad)
		}
		d.Npcs = []WorldNpcData{{Name: "Hask", Pos: WorldSpawnData{Layer: 9}, Route: []WorldSpawnData{{Layer: 9}, bad}}}
		if _, err := worldFromData(*d); err == nil {
			t.Errorf("NPC walking to %+v accepted", bad)
		}
	}
}

// The fixture's joined cubes and objects survive the bridge both ways, and bad ones are refused.
func TestWorldDataJoinsAndObjects(t *testing.T) {
	w, err := worldfile.Load(filepath.Join("..", "crates", "world", "tests", "fixtures", "small.world"))
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Joins) == 0 || len(w.Objects) == 0 {
		t.Fatal("the fixture has no joins or objects")
	}
	d := worldToData(w)
	if len(d.Joins) != len(w.Joins) || len(d.Objects) != len(w.Objects) || d.Objects[1].Targets[0] != w.Objects[1].Targets[0] || d.Objects[0].State != 1 {
		t.Fatalf("joins %+v, objects %+v", d.Joins, d.Objects)
	}
	back, err := worldFromData(*d)
	if err != nil {
		t.Fatal(err)
	}
	var a, b bytes.Buffer
	if err := worldfile.Write(&a, w); err != nil {
		t.Fatal(err)
	}
	if err := worldfile.Write(&b, back); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a.Bytes(), b.Bytes()) {
		t.Error("the world changed through the bridge")
	}
	obj := d.Objects[0]
	for _, bad := range []WorldObjectData{
		{Pos: WorldSpawnData{X: -1}},
		{Pos: WorldSpawnData{Layer: 31}},
		{Kind: worldfile.ObjectKindCount},
		{Face: worldfile.FaceCount},
		{State: worldfile.StateCount},
	} {
		d.Objects[0] = bad
		if _, err := worldFromData(*d); err == nil {
			t.Errorf("object %+v accepted", bad)
		}
	}
	d.Objects[0] = obj
	d.Joins[0].Cubes[0] = WorldSpawnData{X: d.ChunksX * worldfile.ChunkSize}
	if _, err := worldFromData(*d); err == nil {
		t.Error("a joined cube outside the world accepted")
	}
}

func TestWorldDataRefusesBadChunks(t *testing.T) {
	cubes := base64.StdEncoding.EncodeToString(make([]byte, worldfile.PlanesLen))
	bad := []WorldData{
		{ChunksX: 1, ChunksZ: 1, Chunks: []WorldChunkData{{CX: 1, Cubes: cubes}}},
		{ChunksX: 1, ChunksZ: 1, Chunks: []WorldChunkData{{Layer: 31, Cubes: cubes}}},
		{ChunksX: 1, ChunksZ: 1, Chunks: []WorldChunkData{{Cubes: "not base64!"}}},
		{ChunksX: 1, ChunksZ: 1, Chunks: []WorldChunkData{{Cubes: cubes, Paint: "not base64!"}}},
		{ChunksX: -1, ChunksZ: 1},
	}
	for i, d := range bad {
		if _, err := worldFromData(d); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}

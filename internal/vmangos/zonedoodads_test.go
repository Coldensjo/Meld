package vmangos

import (
	"testing"

	"Meld/internal/adt"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// A placement finds the chunk under it only in the tile that has that chunk, and the cell within it.
func TestPlacementCell(t *testing.T) {
	// Tile 30,40, chunk 3,5: its corner in the server's space.
	tx, ty, cx, cy := 30, 40, 3, 5
	ch := adt.Chunk{IndexX: cx, IndexY: cy}
	ch.Position[0] = float32(adt.ZeroPoint - float64(ty)*adt.TileSize - float64(cy)*chunkWidth)
	ch.Position[1] = float32(adt.ZeroPoint - float64(tx)*adt.TileSize - float64(cx)*chunkWidth)
	terrain := &adt.Terrain{Chunks: []adt.Chunk{ch}}
	left := float64(tx)*adt.TileSize + float64(cx)*chunkWidth
	top := float64(ty)*adt.TileSize + float64(cy)*chunkWidth
	// Two cells in and six down.
	got, cell := placementCell(terrain, [3]float32{float32(left + 2.5*cellWidth), 50, float32(top + 6.5*cellWidth)})
	if got == nil || cell != 6*adt.CellsPerChunk+2 {
		t.Fatalf("placementCell = %v, %d; want the chunk, cell %d", got, cell, 6*adt.CellsPerChunk+2)
	}
	// The same chunk index in the next tile is not this tile's.
	if got, _ := placementCell(terrain, [3]float32{float32(left + adt.TileSize + 1), 50, float32(top + 1)}); got != nil {
		t.Fatal("a placement in the next tile found this tile's chunk")
	}
}

func TestDoodadList(t *testing.T) {
	uses := map[string]*DoodadUse{}
	for _, s := range []float64{1, 0.8, 1.3} {
		addDoodadUse(uses, "tree", s)
	}
	addDoodadUse(uses, "rock", 1)
	got := doodadList(uses)
	if len(got) != 2 || got[0].Path != "tree" || got[0].Count != 3 || got[0].ScaleMin != 0.8 || got[0].ScaleMax != 1.3 {
		t.Fatalf("doodadList = %+v", got)
	}
}

// TestRealZoneDoodads reads Duskwood's and Tanaris's placed models: each has a few hundred on its dry
// ground, and the most placed are logged (its trees among them).
// WOW_DIR=/path/to/client go test ./internal/vmangos/ -run RealZoneDoodads -v
func TestRealZoneDoodads(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	zones, err := LoadZones(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	dirs := map[uint32]string{0: "Azeroth", 1: "Kalimdor"}
	for _, name := range []string{"Duskwood", "Tanaris", "Elwynn Forest"} {
		var z *Zone
		for i := range zones {
			if zones[i].Name == name {
				z = &zones[i]
			}
		}
		if z == nil {
			t.Fatalf("%s not among the zones", name)
		}
		list, err := ReadZoneDoodads(dataDir, dirs[z.MapID], *z)
		if err != nil {
			t.Fatal(err)
		}
		total := 0
		for i, u := range list.Doodads {
			total += u.Count
			if i < 25 {
				t.Logf("%s %5d %.2f-%.2f %s", name, u.Count, u.ScaleMin, u.ScaleMax, u.Path)
			}
		}
		t.Logf("%s: %d models of %d kinds on %.0f square yards (%.1f per 100x100 yd)", name, total, len(list.Doodads), list.LandArea, float64(total)/list.LandArea*1e4)
		if total < 300 || list.LandArea < 1e6 {
			t.Fatalf("%s: %d models on %.0f square yards", name, total, list.LandArea)
		}
	}
}

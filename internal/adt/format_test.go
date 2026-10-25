package adt

import (
	"encoding/json"
	"flag"
	"math"
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/mapfile"
)

var update = flag.Bool("update", false, "write the frontend's format fixture (frontend/tests/fixtures/format.json)")

// formatFixture is frontend/tests/fixtures/format.json: the 1.12 format's sizes and a few points
// through the editor-to-server axis swap, which tests/format.test.ts checks the frontend's
// lib/wow/format.ts against (#538).
type formatFixture struct {
	TileYards         float64       `json:"TILE_YARDS"`
	ZeroPoint         float64       `json:"ZERO_POINT"`
	TileChunks        int           `json:"TILE_CHUNKS"`
	ChunkCells        int           `json:"CHUNK_CELLS"`
	TileCells         int           `json:"TILE_CELLS"`
	TileVerts         int           `json:"TILE_VERTS"`
	Slots             int           `json:"SLOTS"`
	AlphaSize         int           `json:"ALPHA_SIZE"`
	LiquidRecordBytes int           `json:"LIQUID_RECORD_BYTES"`
	ChunkShadowBytes  int           `json:"CHUNK_SHADOW_BYTES"`
	Points            []formatPoint `json:"points"`
}

// formatPoint is an editor point (X, Z) of the block at tile (TileX, TileY) and its server (SX, SY).
type formatPoint struct {
	X     float64 `json:"x"`
	Z     float64 `json:"z"`
	TileX int     `json:"tileX"`
	TileY int     `json:"tileY"`
	SX    float64 `json:"sx"`
	SY    float64 `json:"sy"`
}

func buildFormatFixture() formatFixture {
	f := formatFixture{
		TileYards:         TileSize,
		ZeroPoint:         ZeroPoint,
		TileChunks:        ChunksPerTile,
		ChunkCells:        CellsPerChunk,
		TileCells:         ChunksPerTile * CellsPerChunk,
		TileVerts:         ChunksPerTile*CellsPerChunk + 1,
		Slots:             mapfile.SlotsPerChunk,
		AlphaSize:         AlphaSize,
		LiquidRecordBytes: mapfile.LiquidRecordSize,
		ChunkShadowBytes:  ShadowBytes,
	}
	for _, p := range [][4]float64{{0, 0, 0, 0}, {100, 250, 0, 0}, {533.25, 12.5, 31, 47}, {1000, 2000, 63, 0}, {-5, 70000, 10, 20}} {
		sx, sy := ToServer(p[0], p[1], int(p[2]), int(p[3]))
		f.Points = append(f.Points, formatPoint{X: p[0], Z: p[1], TileX: int(p[2]), TileY: int(p[3]), SX: sx, SY: sy})
	}
	return f
}

// TestFormatFixture checks the committed fixture against the Go constants and ToServer, and
// FromServer against ToServer. -update rewrites the fixture instead.
func TestFormatFixture(t *testing.T) {
	path := filepath.Join("..", "..", "frontend", "tests", "fixtures", "format.json")
	want := buildFormatFixture()
	if mapfile.ChunkCells != CellsPerChunk {
		t.Fatalf("mapfile.ChunkCells %d, adt.CellsPerChunk %d", mapfile.ChunkCells, CellsPerChunk)
	}
	for _, p := range want.Points {
		x, z := FromServer(p.SX, p.SY, p.TileX, p.TileY)
		if math.Abs(x-p.X) > 1e-9 || math.Abs(z-p.Z) > 1e-9 {
			t.Errorf("FromServer(ToServer(%v, %v)) = %v, %v", p.X, p.Z, x, z)
		}
	}
	if *update {
		b, err := json.MarshalIndent(want, "", "\t")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(b, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run with -update to write it)", err)
	}
	var got formatFixture
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	near := func(a, b float64) bool { return math.Abs(a-b) <= 1e-6 }
	if !near(got.TileYards, want.TileYards) || !near(got.ZeroPoint, want.ZeroPoint) {
		t.Errorf("fixture yards %v %v, Go %v %v", got.TileYards, got.ZeroPoint, want.TileYards, want.ZeroPoint)
	}
	gotSizes := [8]int{got.TileChunks, got.ChunkCells, got.TileCells, got.TileVerts, got.Slots, got.AlphaSize, got.LiquidRecordBytes, got.ChunkShadowBytes}
	wantSizes := [8]int{want.TileChunks, want.ChunkCells, want.TileCells, want.TileVerts, want.Slots, want.AlphaSize, want.LiquidRecordBytes, want.ChunkShadowBytes}
	if gotSizes != wantSizes {
		t.Errorf("fixture sizes %v, Go %v (run with -update)", gotSizes, wantSizes)
	}
	if len(got.Points) != len(want.Points) {
		t.Fatalf("fixture has %d points, Go %d", len(got.Points), len(want.Points))
	}
	for i, p := range want.Points {
		g := got.Points[i]
		if g.X != p.X || g.Z != p.Z || g.TileX != p.TileX || g.TileY != p.TileY || !near(g.SX, p.SX) || !near(g.SY, p.SY) {
			t.Errorf("point %d: fixture %+v, Go %+v", i, g, p)
		}
	}
}

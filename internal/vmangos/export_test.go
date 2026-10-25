package vmangos

import (
	"encoding/base64"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func flatTile(h float32) []float32 {
	out := make([]float32, LatticeSize*LatticeSize)
	for i := range out {
		out[i] = h
	}
	return out
}

// TestExportMapWritesTilesAndTable exports a one-tile map into a temp patch and server folder, then
// reads the patch back: WOW_DIR=/path/to/client go test ./internal/vmangos/
func TestExportMapWritesTilesAndTable(t *testing.T) {
	dir := testclient.DataDir(t)
	readDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	patchDir := t.TempDir()
	server := t.TempDir()
	os.MkdirAll(filepath.Join(server, "run"), 0o755)
	os.MkdirAll(filepath.Join(server, "data", "5875", "dbc"), 0o755)
	os.WriteFile(filepath.Join(server, "run", "mangosd.conf"), []byte("x"), 0o644)

	// Heights: a gentle slope. Paint: chunk 3 with grass and dirt over half of it.
	outer := make([]float32, LatticeSize*LatticeSize)
	for i := range outer {
		outer[i] = float32(i%LatticeSize) * 0.5
	}
	weights := make([]byte, 32*32*4)
	for texel := 0; texel < 32*32; texel++ {
		weights[texel*4] = 128
		weights[texel*4+1] = 127
	}
	spec := MapSpec{
		Dir:   "MeldTest",
		MapID: 1901,
		Tiles: []TileSpec{{
			X: 5, Y: 6,
			Outer:   outer,
			Paint:   []PaintSpec{{Chunk: 3, Textures: []string{`Tileset\Elwynn\ElwynnGrassBase.blp`, `Tileset\Elwynn\ElwynnDirtBase2.blp`}, Weights: base64.StdEncoding.EncodeToString(weights)}},
			Objects: []ObjectSpec{{Type: `m2:World\Test\Rock.m2`, X: 50, Y: 20, Z: 60, RotY: math.Pi / 2, Scale: 1}},
		}},
	}
	res, err := ExportMap(readDir, patchDir, server, spec)
	if err != nil {
		t.Fatal(err)
	}
	if res.Tiles != 1 || res.Server == "" {
		t.Fatalf("result = %+v", res)
	}

	arch, err := mpq.Open(res.Patch)
	if err != nil {
		t.Fatal(err)
	}
	tile, err := arch.ReadFile(adt.TilePath("MeldTest", 5, 6, ""))
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := adt.ParseTerrain(tile)
	if err != nil {
		t.Fatal(err)
	}
	textures, err := adt.ParseTextures(tile, false, terrain)
	if err != nil {
		t.Fatal(err)
	}
	if got := textures.Chunks[3].Layers; len(got) != 2 || !strings.EqualFold(got[1].Texture, `Tileset\Elwynn\ElwynnDirtBase2.blp`) {
		t.Fatalf("chunk 3 layers = %+v", got)
	}
	placed, err := adt.ParsePlacements(tile)
	if err != nil {
		t.Fatal(err)
	}
	if len(placed) != 1 || placed[0].Name != `World\Test\Rock.m2` {
		t.Fatalf("placements = %+v", placed)
	}
	// The tile's ground is where the editor put it: the first corner of the tile.
	if d := terrain.Chunks[0].Heights[0] - outer[0]; d > 0.01 || d < -0.01 {
		t.Fatalf("height %v, want %v", terrain.Chunks[0].Heights[0], outer[0])
	}

	wdt, err := arch.ReadFile(`World\Maps\MeldTest\MeldTest.wdt`)
	if err != nil {
		t.Fatal(err)
	}
	if len(wdt) == 0 {
		t.Fatal("empty WDT")
	}
	wdl, err := arch.ReadFile(`World\Maps\MeldTest\MeldTest.wdl`)
	if err != nil {
		t.Fatal(err)
	}
	horizon, err := ParseWDL(wdl)
	if err != nil {
		t.Fatal(err)
	}
	// The slope rises half a yard a column, so the tile's last corner stands 64 yards up.
	if h := horizon[6*MapTiles+5]; len(horizon) != 1 || h == nil || h[WDLOuter-1] != 64 {
		t.Fatalf("the WDL's tiles = %v", horizon)
	}
	dbc, err := arch.ReadFile(`DBFilesClient\Map.dbc`)
	if err != nil {
		t.Fatal(err)
	}
	if MapRowDir(dbc, 1901) != "MeldTest" {
		t.Fatal("the patch's Map.dbc has no row for the map")
	}
	serverDBC, err := os.ReadFile(res.Server)
	if err != nil {
		t.Fatal(err)
	}
	if MapRowDir(serverDBC, 1901) != "MeldTest" {
		t.Fatal("the server's Map.dbc has no row for the map")
	}

	arch.Close() // Windows won't replace a patch that is open

	// Exporting again is allowed, and with nothing edited it writes nothing; an edited tile is written.
	again, err := ExportMap(readDir, patchDir, "", spec)
	if err != nil {
		t.Fatalf("re-export: %v", err)
	}
	if again.Patch != "" || again.Changed != 0 || again.Tiles != 1 {
		t.Fatalf("an unedited re-export = %+v, want nothing written", again)
	}
	edited := spec
	edited.Tiles = []TileSpec{spec.Tiles[0]}
	edited.Tiles[0].Outer = flatTile(3)
	if again, err = ExportMap(readDir, patchDir, "", edited); err != nil || again.Changed != 1 || again.Patch == "" {
		t.Fatalf("an edited re-export = %+v, %v; want its tile written", again, err)
	}
	// A map ID the client already names for another folder is refused.
	clash := spec
	clash.MapID = 1 // Kalimdor, in every client
	if _, err := ExportMap(readDir, patchDir, "", clash); err == nil {
		t.Fatal("a map ID the client already uses was accepted")
	}
}

// Upright models carry only their yaw, in the middle rotation value (as the client's own placements do).
func TestObjectRotationIsYawOnly(t *testing.T) {
	o, err := objectIn(0, 0, ObjectSpec{Type: `m2:World\Test\Tree.m2`, X: 1, Y: 2, Z: 3, RotY: 0, Scale: 1})
	if err != nil {
		t.Fatal(err)
	}
	if o.Rotation[0] != 0 || o.Rotation[2] != 0 {
		t.Fatalf("an upright model is tilted: %v", o.Rotation)
	}
}

// A tilt is written into the placement's outer rotations, as degrees, and the yaw stays in the middle.
func TestObjectTiltIsWritten(t *testing.T) {
	o, err := objectIn(0, 0, ObjectSpec{Type: `m2:World\Test\Tree.m2`, X: 1, Y: 2, Z: 3, RotY: 0, Scale: 1,
		TiltX: float32(10 * math.Pi / 180), TiltZ: float32(-5 * math.Pi / 180)})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(float64(o.Rotation[0])-10) > 0.01 || math.Abs(float64(o.Rotation[2])+5) > 0.01 {
		t.Fatalf("tilt not written: %v", o.Rotation)
	}
	if o.Rotation[1] != 90 {
		t.Fatalf("yaw 0 should be 90 in the file, got %v", o.Rotation[1])
	}
}

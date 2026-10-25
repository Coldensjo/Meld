package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mapfile"
	"Meld/internal/mpq"
)

// call runs the command and returns its exit status and output.
func call(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := run(args, &out, &errOut)
	return code, out.String(), errOut.String()
}

// buildTile writes a synthetic tile (no client data): rolling ground, two layers on chunk 5, a
// model, and sea at level when water is set.
func buildTile(t *testing.T, lift float32, uid uint32) []byte {
	t.Helper()
	const lattice = adt.ChunksPerTile*adt.CellsPerChunk + 1
	outer := make([]float32, lattice*lattice)
	for i := range outer {
		outer[i] = float32(10 * math.Sin(float64(i)/50))
	}
	outer[0] += lift
	alpha := make([]byte, 64*64)
	for i := range alpha[:100] {
		alpha[i] = 200
	}
	root, err := adt.BuildTile(outer, adt.Ring{}, adt.Changes{
		TileX: 3, TileY: 4,
		Paint: map[int]adt.ChunkPaint{5: {Layers: []adt.Layer{{Texture: `Tileset\Test\Grass.blp`}, {Texture: `Tileset\Test\Dirt.blp`, Alpha: alpha}}}},
		Add:   []adt.Object{{Kind: adt.M2, Name: `World\Test\Tree.m2`, UID: uid, Position: [3]float32{100, 30, 120}, Scale: 1}},
		Water: &adt.Water{Level: 0},
	})
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func writeFile(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAdtDump(t *testing.T) {
	p := writeFile(t, t.TempDir(), "Test_3_4.adt", buildTile(t, 0, 7))
	code, out, errOut := call(t, "adt", "dump", p, "--placements")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	var d tileDump
	if err := json.Unmarshal([]byte(out), &d); err != nil {
		t.Fatal(err)
	}
	if len(d.Chunks) != adt.ChunkCount || d.M2 != 1 || len(d.Placements) != 1 || d.Placements[0].UID != 7 {
		t.Fatalf("dump: %d chunks, %d m2, placements %+v", len(d.Chunks), d.M2, d.Placements)
	}
	var c5 chunkDump
	for _, c := range d.Chunks {
		if c.Index == "5,0" {
			c5 = c
		}
	}
	if len(c5.Layers) != 2 || c5.Layers[1].Texture != `Tileset\Test\Dirt.blp` || c5.Layers[1].Covered != 100 {
		t.Fatalf("chunk 5,0 layers %+v", c5.Layers)
	}
	if len(c5.Heights) != 0 {
		t.Fatal("heights given without --chunk")
	}
	code, out, errOut = call(t, "adt", "dump", "--chunk", "5,0", p)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	d = tileDump{}
	if err := json.Unmarshal([]byte(out), &d); err != nil {
		t.Fatal(err)
	}
	if len(d.Chunks) != 1 || len(d.Chunks[0].Heights) != adt.HeightCount {
		t.Fatalf("--chunk gave %d chunks", len(d.Chunks))
	}
	if code, _, _ := call(t, "adt", "dump", "--chunk", "16,0", p); code != 2 {
		t.Fatalf("a chunk off the tile exits %d", code)
	}
}

func TestAdtDiff(t *testing.T) {
	dir := t.TempDir()
	a := writeFile(t, dir, "a.adt", buildTile(t, 0, 7))
	same := writeFile(t, dir, "same.adt", buildTile(t, 0, 7))
	b := writeFile(t, dir, "b.adt", buildTile(t, 5, 8))
	if code, out, errOut := call(t, "adt", "diff", a, same); code != 0 || !strings.Contains(out, "same") {
		t.Fatalf("identical tiles: exit %d, %q %q", code, out, errOut)
	}
	code, out, _ := call(t, "adt", "diff", a, b)
	if code != 1 {
		t.Fatalf("differing tiles exit %d", code)
	}
	for _, want := range []string{"chunk 0,0: 2 heights differ, most 5 at sample 0", "m2 7 (World\\Test\\Tree.m2): only in a", "m2 8 (World\\Test\\Tree.m2): only in b"} {
		if !strings.Contains(out, want) {
			t.Errorf("diff lacks %q:\n%s", want, out)
		}
	}
}

func TestMpqLsCatAndClientTile(t *testing.T) {
	dir := t.TempDir()
	tile := buildTile(t, 0, 7)
	const name = `World\Maps\Test\Test_3_4.adt`
	archive := writeFile(t, dir, "patch-3.MPQ", mpq.Write([]mpq.File{{Name: name, Data: tile}, {Name: `Interface\Test.txt`, Data: []byte("hello")}}))
	code, out, errOut := call(t, "mpq", "ls", "--client", archive, "maps/test")
	if code != 0 || strings.TrimSpace(out) != name {
		t.Fatalf("ls: exit %d, %q %q", code, out, errOut)
	}
	if code, out, _ := call(t, "mpq", "cat", "--client", dir, `interface/test.txt`); code != 0 || out != "hello" {
		t.Fatalf("cat through the Data folder: exit %d, %q", code, out)
	}
	if code, _, _ := call(t, "mpq", "cat", "--client", archive, `Interface\Missing.txt`); code != 2 {
		t.Fatalf("a missing file exits %d", code)
	}
	code, out, errOut = call(t, "adt", "dump", "--client", archive, name)
	if code != 0 || !strings.Contains(out, `"m2": 1`) {
		t.Fatalf("dump from the archive: exit %d, %s", code, errOut)
	}
}

func TestWmapInfo(t *testing.T) {
	const size = 16
	enc := base64.StdEncoding.EncodeToString
	heights := make([]byte, (size+1)*(size+1)*4)
	binary.LittleEndian.PutUint32(heights[4:], math.Float32bits(12.5))
	holes := make([]byte, size*size)
	holes[3] = 1
	m := &mapfile.MapData{
		Header: mapfile.Header{
			Name: "Test", Size: size, CellSize: 1, SplatRes: 16, Palette: []string{`Tileset\Test\Grass.blp`},
			Objects: []mapfile.PlacedObject{{ID: 1, Type: `m2:World\Test\Tree.m2`, Scale: 1}, {ID: 2, Parent: 1, Type: "helper:cube", Scale: 1}},
		},
		Heights:    enc(heights),
		Weights:    enc(make([]byte, 16*16*4)),
		ChunkSlots: enc(make([]byte, 4*mapfile.SlotsPerChunk)),
		Holes:      enc(holes),
	}
	p := filepath.Join(t.TempDir(), "test.wmap")
	if err := mapfile.Save(p, m); err != nil {
		t.Fatal(err)
	}
	code, out, errOut := call(t, "wmap", "info", p)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	var s wmapSummary
	if err := json.Unmarshal([]byte(out), &s); err != nil {
		t.Fatal(err)
	}
	if s.Version != mapfile.Version || s.Size != size || s.HoleCells != 1 || s.HeightMax != 12.5 || s.Objects["m2"] != 1 || s.Objects["helper"] != 1 || s.AttachedCount != 1 {
		t.Fatalf("info %+v", s)
	}
}

func TestBindings(t *testing.T) {
	code, out, errOut := call(t, "bindings", "../..")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	if !strings.Contains(out, "SaveMap(") || !strings.Contains(out, "LoadMap(") {
		t.Fatalf("bindings lack SaveMap and LoadMap:\n%s", out)
	}
	if code, _, _ := call(t, "bindings", t.TempDir()); code != 2 {
		t.Fatalf("a folder without the app exits %d", code)
	}
}

func TestUsage(t *testing.T) {
	if code, _, errOut := call(t, "adt", "nope"); code != 2 || !strings.Contains(errOut, "meldtool wmap info") {
		t.Fatalf("unknown command: exit %d, %q", code, errOut)
	}
	if got := wdtPath(`World\Maps\Azeroth\Azeroth_32_48.adt`); got != `World\Maps\Azeroth\Azeroth.wdt` {
		t.Fatalf("wdtPath = %q", got)
	}
}

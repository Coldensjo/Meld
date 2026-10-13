package adt

import (
	"encoding/binary"
	"math"
	"os"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// chunkBytes frames a payload as an IFF chunk, with its id stored byte-reversed as on disk.
func chunkBytes(id string, payload []byte) []byte {
	out := make([]byte, 8+len(payload))
	out[0], out[1], out[2], out[3] = id[3], id[2], id[1], id[0]
	binary.LittleEndian.PutUint32(out[4:], uint32(len(payload)))
	copy(out[8:], payload)
	return out
}

func f32bytes(v float32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, math.Float32bits(v))
	return b
}

// mcnk builds one MCNK holding a flat MCVT of 0..144 above base height z.
func mcnk(ix, iy uint32, z float32, lowHoles uint16) []byte {
	header := make([]byte, mcnkHeaderSize)
	binary.LittleEndian.PutUint32(header[0x14:], 8+mcnkHeaderSize) // from the chunk start, MCVT follows the header
	binary.LittleEndian.PutUint32(header[0x04:], ix)
	binary.LittleEndian.PutUint32(header[0x08:], iy)
	binary.LittleEndian.PutUint32(header[0x34:], 42)
	binary.LittleEndian.PutUint16(header[0x3c:], lowHoles)
	copy(header[0x68:], f32bytes(0))
	copy(header[0x6c:], f32bytes(0))
	copy(header[0x70:], f32bytes(z))
	var mcvt []byte
	for i := 0; i < HeightCount; i++ {
		mcvt = append(mcvt, f32bytes(float32(i))...)
	}
	body := append(header, chunkBytes("MCVT", mcvt)...)
	return chunkBytes("MCNK", body)
}

func TestDecodeRLE(t *testing.T) {
	// A run of three 7s, then two literal bytes.
	src := []byte{0x83, 0x07, 0x02, 0x01, 0x02}
	out := make([]byte, 6)
	decodeRLE(src, out)
	want := []byte{7, 7, 7, 1, 2, 0}
	for i := range want {
		if out[i] != want[i] {
			t.Fatalf("decodeRLE = %v, want %v", out, want)
		}
	}
}

func TestDecode4BitFixRepeatsEdges(t *testing.T) {
	src := make([]byte, AlphaSize*AlphaSize/2)
	for i := range src {
		src[i] = 0x21 // low nibble 1, high nibble 2
	}
	out := make([]byte, AlphaSize*AlphaSize)
	decode4Bit(src, out, true)
	if out[62] != 17 || out[63] != 17 || out[63*AlphaSize+63] != 17 {
		t.Fatalf("edges not repeated: %d %d %d", out[62], out[63], out[63*AlphaSize+63])
	}
	if out[0] != 17 || out[1] != 34 {
		t.Fatalf("nibbles wrong: %d %d", out[0], out[1])
	}
}

func TestParseTerrainSynthetic(t *testing.T) {
	root := chunkBytes("MVER", []byte{18, 0, 0, 0})
	root = append(root, mcnk(3, 5, 10, 0x0001)...)
	terrain, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	c := terrain.At(3, 5)
	if c == nil {
		t.Fatal("chunk (3,5) missing")
	}
	if c.AreaID != 42 {
		t.Errorf("area id = %d", c.AreaID)
	}
	if c.Heights[0] != 10 || c.Heights[144] != 154 {
		t.Errorf("heights = %v .. %v, want 10 .. 154", c.Heights[0], c.Heights[144])
	}
	// Bit 0 of the 4x4 map covers cells 0-1 in rows 0-1.
	if c.Holes[0]&0x3 != 0x3 || c.Holes[1]&0x3 != 0x3 || c.Holes[2]&0x3 != 0 {
		t.Errorf("holes = %v", c.Holes)
	}
}

func TestParsePlacementsSynthetic(t *testing.T) {
	mmdx := []byte("a.m2\x00b.m2\x00")
	mmid := make([]byte, 8)
	binary.LittleEndian.PutUint32(mmid[0:], 0)
	binary.LittleEndian.PutUint32(mmid[4:], 5)
	mddf := make([]byte, 36)
	binary.LittleEndian.PutUint32(mddf[0:], 1)     // name ID 1 -> b.m2
	binary.LittleEndian.PutUint32(mddf[4:], 77)    // unique ID
	copy(mddf[8:], f32bytes(1))                    // x
	copy(mddf[12:], f32bytes(2))                   // y
	copy(mddf[16:], f32bytes(3))                   // z
	binary.LittleEndian.PutUint16(mddf[32:], 1024) // scale 1.0

	obj := append(chunkBytes("MMDX", mmdx), chunkBytes("MMID", mmid)...)
	obj = append(obj, chunkBytes("MDDF", mddf)...)
	placements, err := ParsePlacements(obj)
	if err != nil {
		t.Fatal(err)
	}
	if len(placements) != 1 {
		t.Fatalf("got %d placements", len(placements))
	}
	p := placements[0]
	if p.Name != "b.m2" || p.UID != 77 || p.Kind != M2 || p.Scale != 1 || p.Position != [3]float32{1, 2, 3} {
		t.Errorf("placement = %+v", p)
	}
}

// TestTileIntegration reads a real Azeroth tile from the client: WOW_DIR=/path/to/client go test ./internal/adt/
func TestTileIntegration(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.12 client to run")
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

	const x, y = 32, 48
	root, err := set.ReadFile(TilePath("Azeroth", x, y, ""))
	if err != nil {
		t.Fatal(err)
	}
	wdt, err := set.ReadFile(`World\Maps\Azeroth\Azeroth.wdt`)
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(terrain.Chunks) != ChunkCount {
		t.Fatalf("%d chunks, want %d", len(terrain.Chunks), ChunkCount)
	}
	// 1.12 keeps a tile's textures and placements in its root file.
	textures, err := ParseTextures(root, ReadBigAlpha(wdt), terrain)
	if err != nil {
		t.Fatal(err)
	}
	if len(textures.Chunks) != len(terrain.Chunks) {
		t.Fatalf("%d texture chunks for %d terrain chunks", len(textures.Chunks), len(terrain.Chunks))
	}
	layers := 0
	for _, c := range textures.Chunks {
		layers += len(c.Layers)
	}
	if layers == 0 {
		t.Error("no texture layers")
	}
	for _, c := range terrain.Chunks {
		for _, h := range c.Heights {
			if h < -5000 || h > 5000 || math.IsNaN(float64(h)) {
				t.Fatalf("chunk %d,%d has implausible height %v", c.IndexX, c.IndexY, h)
			}
		}
	}
	placements, err := ParsePlacements(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%d chunks, %d texture layers, %d placements", len(terrain.Chunks), layers, len(placements))
	for _, p := range placements {
		if p.Name == "" {
			t.Fatalf("placement %d has no name", p.UID)
		}
	}
}

func TestWriteHeightsSynthetic(t *testing.T) {
	root := chunkBytes("MVER", []byte{18, 0, 0, 0})
	root = append(root, mcnk(0, 0, 10, 0)...)
	terrain, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	same, err := WriteHeights(root, terrain)
	if err != nil {
		t.Fatal(err)
	}
	if !bytesEqual(same, root) {
		t.Fatal("writing unchanged heights changed the file")
	}

	terrain.Chunks[0].Heights[5] += 2.5
	out, err := WriteHeights(root, terrain)
	if err != nil {
		t.Fatal(err)
	}
	back, err := ParseTerrain(out)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := back.Chunks[0].Heights[5], float32(5+10)+2.5; got != want {
		t.Errorf("edited height = %v, want %v", got, want)
	}
	if back.Chunks[0].Heights[4] != 14 {
		t.Errorf("neighbouring height changed to %v", back.Chunks[0].Heights[4])
	}
	if back.Chunks[0].Position[2] != 10 {
		t.Errorf("base height changed to %v", back.Chunks[0].Position[2])
	}
}

// TestWriteHeightsIntegration edits one sample of a real tile and reads it back:
// WOW_DIR=/path/to/client go test ./internal/adt/
func TestWriteHeightsIntegration(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.12 client to run")
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
	root, err := set.ReadFile(TilePath("Azeroth", 32, 48, ""))
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	same, err := WriteHeights(root, terrain)
	if err != nil {
		t.Fatal(err)
	}
	if !bytesEqual(same, root) {
		t.Fatal("writing an unedited tile changed it")
	}

	c := &terrain.Chunks[100]
	before := c.Heights[40]
	c.Heights[40] = before + 4
	out, err := WriteHeights(root, terrain)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != len(root) {
		t.Fatalf("file size changed: %d -> %d", len(root), len(out))
	}
	back, err := ParseTerrain(out)
	if err != nil {
		t.Fatal(err)
	}
	for i := range back.Chunks {
		for s := 0; s < HeightCount; s++ {
			want := terrain.Chunks[i].Heights[s]
			if d := back.Chunks[i].Heights[s] - want; d > 0.01 || d < -0.01 {
				t.Fatalf("chunk %d sample %d reads back %v, want %v", i, s, back.Chunks[i].Heights[s], want)
			}
		}
	}
	t.Logf("sample moved from %.3f to %.3f", before, back.Chunks[100].Heights[40])
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestNormalsMatchFile recomputes a real chunk's normals from its heights and compares them with
// the ones the file stores: WOW_DIR=/path/to/client go test ./internal/adt/
func TestNormalsMatchFile(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.12 client to run")
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
	root, err := set.ReadFile(TilePath("Azeroth", 32, 48, ""))
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	grid := make([]float32, lattice*lattice)
	for _, c := range terrain.Chunks {
		for r := 0; r < CellsPerChunk+1; r++ {
			for col := 0; col < CellsPerChunk+1; col++ {
				grid[(c.IndexY*CellsPerChunk+r)*lattice+c.IndexX*CellsPerChunk+col] = c.Heights[r*17+col]
			}
		}
	}
	starts, err := mcnkStarts(root)
	if err != nil {
		t.Fatal(err)
	}
	const chunk = 100
	mcnr, ok := subChunk(root, starts[chunk], len(root), u32(root, starts[chunk]+0x18), "MCNR")
	if !ok {
		t.Fatal("no MCNR")
	}
	bad, worst := 0, 0
	for s := 0; s < HeightCount; s++ {
		n := normalAt(grid, terrain.Chunks[chunk], s)
		for k := 0; k < 3; k++ {
			want := int(int8(root[mcnr.start+s*3+k]))
			got := int(math.Round(float64(n[k]) * 127))
			d := got - want
			if d < 0 {
				d = -d
			}
			if d > worst {
				worst = d
			}
			if d > 3 {
				bad++
			}
		}
	}
	t.Logf("worst byte difference %d, %d off by more than 3", worst, bad)
	if bad > HeightCount/10 {
		t.Errorf("recomputed normals disagree with the file (%d bytes off)", bad)
	}
}

func TestSplitNames(t *testing.T) {
	got := splitNames([]byte("a.blp\x00b\\c.blp\x00"))
	if len(got) != 2 || got[0] != "a.blp" || got[1] != `b\c.blp` {
		t.Fatalf("splitNames = %q", got)
	}
}

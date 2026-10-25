package adt

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

// resolveDataDir is the client's Data folder, or dir itself when it has none. Not wow.ResolveDataDir,
// since wow imports this package.
func resolveDataDir(dir string) (string, error) {
	if st, err := os.Stat(filepath.Join(dir, "Data")); err == nil && st.IsDir() {
		return filepath.Join(dir, "Data"), nil
	}
	return dir, nil
}

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

// TestTileIntegration reads a whole tile: the synthetic one, and a real Azeroth tile from the client
// (WOW_DIR=/path/to/client go test ./internal/adt/, else it skips).
func TestTileIntegration(t *testing.T) {
	eachTile(t, func(t *testing.T, root []byte) {
		// 1.12 keeps a tile's textures and placements in its root file. The client's Azeroth and the
		// synthetic tile both use 4-bit alpha (ReadBigAlpha of Azeroth.wdt is false).
		terrain, err := ParseTerrain(root)
		if err != nil {
			t.Fatal(err)
		}
		if len(terrain.Chunks) != ChunkCount {
			t.Fatalf("%d chunks, want %d", len(terrain.Chunks), ChunkCount)
		}
		textures, err := ParseTextures(root, false, terrain)
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
		if len(placements) == 0 {
			t.Error("no placements")
		}
		for _, p := range placements {
			if p.Name == "" {
				t.Fatalf("placement %d has no name", p.UID)
			}
		}
	})
	t.Run("client wdt", func(t *testing.T) {
		if ReadBigAlpha(clientFile(t, `World\Maps\Azeroth\Azeroth.wdt`)) {
			t.Fatal("Azeroth.wdt says big alpha; the tile tests read its tiles as 4-bit")
		}
	})
}

func TestWriteHeightsSynthetic(t *testing.T) {
	root := chunkBytes("MVER", []byte{18, 0, 0, 0})
	root = append(root, mcnk(0, 0, 10, 0)...)
	terrain, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	same, err := WriteHeights(root, terrain, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytesEqual(same, root) {
		t.Fatal("writing unchanged heights changed the file")
	}

	terrain.Chunks[0].Heights[5] += 2.5
	out, err := WriteHeights(root, terrain, nil)
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

// TestWriteHeightsIntegration edits one sample of a whole tile and reads it back, on the synthetic
// tile and on the client's (WOW_DIR=/path/to/client go test ./internal/adt/, else it skips).
func TestWriteHeightsIntegration(t *testing.T) {
	eachTile(t, func(t *testing.T, root []byte) {
		terrain, err := ParseTerrain(root)
		if err != nil {
			t.Fatal(err)
		}
		same, err := WriteHeights(root, terrain, nil)
		if err != nil {
			t.Fatal(err)
		}
		if !bytesEqual(same, root) {
			t.Fatal("writing an unedited tile changed it")
		}

		c := &terrain.Chunks[100]
		before := c.Heights[40]
		c.Heights[40] = before + 4
		out, err := WriteHeights(root, terrain, nil)
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
	})
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

// TestNormalsMatchFile recomputes real tiles' normals from their heights and compares them with the
// ones the files store: inside Azeroth_32_48 and Azeroth_31_49, on steep ground and gentle, where they
// must match the file's to a byte (#668), and along the border of Azeroth_30_40, whose border samples
// read the neighbouring tiles' heights through the ring (#492):
// WOW_DIR=/path/to/client go test ./internal/adt/
func TestNormalsMatchFile(t *testing.T) {
	// The synthetic tile's normals are the writer's own, so this checks that they are stored where
	// ParseNormals reads them, through the rewrites that built the tile, and that a height edit
	// refreshes the samples round it.
	t.Run("synthetic", func(t *testing.T) {
		root := syntheticTile(t)
		terrain := mustTerrain(t, root)
		terrain.Chunks[100].Heights[40] += 6 // an outer sample inside the chunk
		terrain.Chunks[100].Heights[26] -= 3 // an inner one
		out, err := WriteHeights(root, terrain, nil)
		if err != nil {
			t.Fatal(err)
		}
		edited := mustTerrain(t, out)
		normals, err := ParseNormals(out)
		if err != nil {
			t.Fatal(err)
		}
		all := func(row, col int) bool { return true }
		for i := range edited.Chunks {
			if bad, worst, _ := normalsOff(edited, normals, i, Ring{}, all); bad > 0 {
				t.Errorf("chunk %d: stored normals disagree with its heights (%d bytes off, worst %d)", i, bad, worst)
			}
		}
	})
	t.Run("client", func(t *testing.T) {
		dir := testclient.DataDir(t)
		dataDir, err := resolveDataDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		set, err := mpq.OpenDataDir(dataDir)
		if err != nil {
			t.Fatal(err)
		}
		defer set.Close()
		read := func(x, y int) (*Terrain, [][]byte) {
			root, err := set.ReadFile(TilePath("Azeroth", x, y, ""))
			if err != nil {
				t.Fatal(err)
			}
			terrain, err := ParseTerrain(root)
			if err != nil {
				t.Fatal(err)
			}
			normals, err := ParseNormals(root)
			if err != nil {
				t.Fatal(err)
			}
			return terrain, normals
		}
		// Steep chunks (1, 16 to 18 and 33 of 32_48 were up to 30 off with central differences) and gentle
		// ones (100 and 120), in a tile in Elwynn's hills and one on the Westfall coast.
		all := func(row, col int) bool { return true }
		for _, tile := range []struct {
			x, y   int
			chunks []int
		}{
			{32, 48, []int{17, 18, 33, 100, 120}},
			{31, 49, []int{17, 34, 100, 136, 200}},
		} {
			terrain, normals := read(tile.x, tile.y)
			for _, i := range tile.chunks {
				bad, worst, n := normalsOff(terrain, normals, i, Ring{}, all)
				t.Logf("%d_%d chunk %d: worst byte difference %d, %d of %d bytes off", tile.x, tile.y, i, worst, bad, n*3)
				if bad > 0 {
					t.Errorf("%d_%d chunk %d: recomputed normals disagree with the file (%d bytes off, worst %d)", tile.x, tile.y, i, bad, worst)
				}
			}
		}

		// The border of 30_40 (Duskwood's hills), with the ring from its four neighbours.
		const tx, ty = 30, 40
		terrain, normals := read(tx, ty)
		// heights is a neighbour's grid as normalGrid lays it out; at reads it at half-step (R, C).
		heights := func(x, y int) func(R, C int) float32 {
			n, _ := read(x, y)
			g := normalGrid(n, Ring{})
			return func(R, C int) float32 { return g[(R+2)*padded+C+2] }
		}
		north, south, west, east := heights(tx, ty-1), heights(tx, ty+1), heights(tx-1, ty), heights(tx+1, ty)
		last := 2 * (lattice - 1)
		ring := Ring{North: make([]float32, lattice), South: make([]float32, lattice), West: make([]float32, lattice), East: make([]float32, lattice)}
		for k := 0; k < lattice; k++ {
			ring.North[k], ring.South[k] = north(last-2, 2*k), south(2, 2*k)
			ring.West[k], ring.East[k] = west(2*k, last-2), east(2*k, 2)
		}
		outerOnly := ring
		ring.NorthIn, ring.SouthIn = make([]float32, lattice-1), make([]float32, lattice-1)
		ring.WestIn, ring.EastIn = make([]float32, lattice-1), make([]float32, lattice-1)
		for k := 0; k+1 < lattice; k++ {
			ring.NorthIn[k], ring.SouthIn[k] = north(last-1, 2*k+1), south(1, 2*k+1)
			ring.WestIn[k], ring.EastIn[k] = west(2*k+1, last-1), east(2*k+1, 1)
		}
		// The file's north border doesn't follow its heights (22 of its samples differ from the north
		// tile's, which share them), so the test reads the other three sides.
		for _, side := range []struct {
			name   string
			chunks func(k int) int
			keep   func(row, col int) bool
		}{
			{"south", func(k int) int { return (ChunksPerTile-1)*ChunksPerTile + k }, func(row, col int) bool { return col < 9 && row == 8 }},
			{"west", func(k int) int { return k * ChunksPerTile }, func(row, col int) bool { return col == 0 }},
			{"east", func(k int) int { return k*ChunksPerTile + ChunksPerTile - 1 }, func(row, col int) bool { return col == 8 }},
		} {
			var bad, worst, n, oneSided, outer int
			for k := 0; k < ChunksPerTile; k++ {
				b, w, m := normalsOff(terrain, normals, side.chunks(k), ring, side.keep)
				o, _, _ := normalsOff(terrain, normals, side.chunks(k), Ring{}, side.keep)
				a, _, _ := normalsOff(terrain, normals, side.chunks(k), outerOnly, side.keep)
				bad, worst, n, oneSided, outer = bad+b, max(worst, w), n+m, oneSided+o, outer+a
			}
			t.Logf("%s border: worst byte difference %d, %d of %d bytes off (%d one-sided, %d with the inner samples across taken as their corners' mean)", side.name, worst, bad, n*3, oneSided, outer)
			if bad > n*3/20 || bad >= outer || outer >= oneSided {
				t.Errorf("%s border: normals from the ring are off the file's in %d of %d bytes (%d one-sided, %d with the inner samples across as the mean)", side.name, bad, n*3, oneSided, outer)
			}
		}
	})
}

// normalsOff counts the bytes of chunk i's samples that differ from the file's normals, worked out
// against ring, among the samples keep picks.
func normalsOff(terrain *Terrain, normals [][]byte, i int, ring Ring, keep func(row, col int) bool) (bad, worst, n int) {
	c := terrain.Chunks[i]
	grid := normalGrid(terrain, ring)
	for s := 0; s < HeightCount; s++ {
		if !keep(s/17, s%17) {
			continue
		}
		n++
		got := normalAt(grid, c, s)
		for k := 0; k < 3; k++ {
			d := int(got[k]) - int(int8(normals[i][s*3+k]))
			if d < 0 {
				d = -d
			}
			worst = max(worst, d)
			if d > 0 {
				bad++
			}
		}
	}
	return bad, worst, n
}

func TestSplitNames(t *testing.T) {
	got := splitNames([]byte("a.blp\x00b\\c.blp\x00"))
	if len(got) != 2 || got[0] != "a.blp" || got[1] != `b\c.blp` {
		t.Fatalf("splitNames = %q", got)
	}
}

package adt

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"testing"

	"Meld/internal/mpq"
)

// realTile reads Azeroth 32_48 from the client: WOW_DIR=/path/to/client go test ./internal/adt/
func realTile(t *testing.T) []byte {
	t.Helper()
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.12 client to run")
	}
	dataDir, err := resolveDataDir(dir)
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
	return root
}

// chunkRefs returns the model references of chunk i, from its MCRF.
func chunkRefs(t *testing.T, root []byte, i int) []uint32 {
	t.Helper()
	starts, err := mcnkStarts(root)
	if err != nil {
		t.Fatal(err)
	}
	m := root[starts[i] : starts[i]+mcnkHeaderLen]
	n := int(binary.LittleEndian.Uint32(m[mcnkDoodadRefs:]) + binary.LittleEndian.Uint32(m[mcnkMapObjRefs:]))
	sub, ok := subRegion(root[starts[i]:], int(binary.LittleEndian.Uint32(m[0x20:])))
	if !ok {
		return nil
	}
	var out []uint32
	for k := 0; k < n; k++ {
		out = append(out, binary.LittleEndian.Uint32(sub[k*4:]))
	}
	return out
}

func TestRewriteUnchangedKeepsEverything(t *testing.T) {
	root := realTile(t)
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := ParseTerrain(root)
	b, err := ParseTerrain(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Chunks) != len(b.Chunks) {
		t.Fatalf("%d chunks, want %d", len(b.Chunks), len(a.Chunks))
	}
	for i := range a.Chunks {
		if a.Chunks[i].Heights != b.Chunks[i].Heights || a.Chunks[i].AreaID != b.Chunks[i].AreaID || a.Chunks[i].Holes != b.Chunks[i].Holes {
			t.Fatalf("chunk %d changed", i)
		}
	}
	ta, _ := ParseTextures(root, false, a)
	tb, err := ParseTextures(out, false, b)
	if err != nil {
		t.Fatal(err)
	}
	for i := range ta.Chunks {
		if len(ta.Chunks[i].Layers) != len(tb.Chunks[i].Layers) {
			t.Fatalf("chunk %d layer count changed", i)
		}
		for l := range ta.Chunks[i].Layers {
			if ta.Chunks[i].Layers[l] != tb.Chunks[i].Layers[l] {
				t.Fatalf("chunk %d layer %d changed: %+v vs %+v", i, l, ta.Chunks[i].Layers[l], tb.Chunks[i].Layers[l])
			}
		}
		for l := range ta.Chunks[i].Alpha {
			if !bytes.Equal(ta.Chunks[i].Alpha[l], tb.Chunks[i].Alpha[l]) {
				t.Fatalf("chunk %d alpha %d changed", i, l)
			}
		}
	}
	pa, _ := ParsePlacements(root)
	pb, err := ParsePlacements(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(pa) != len(pb) {
		t.Fatalf("%d placements, want %d", len(pb), len(pa))
	}
	for i := range pa {
		if pa[i].Name != pb[i].Name || pa[i].UID != pb[i].UID || pa[i].Position != pb[i].Position || pa[i].Rotation != pb[i].Rotation {
			t.Fatalf("placement %d changed: %+v vs %+v", i, pa[i], pb[i])
		}
	}
}

func TestRewritePaintReadsBack(t *testing.T) {
	root := realTile(t)
	const idx = 100
	orig, _ := ParseTextures(root, false, mustTerrain(t, root))
	base := orig.Chunks[idx].Layers[0].Texture
	alpha := bytes.Repeat([]byte{128}, 64*64)
	out, err := Rewrite(root, Changes{
		TileX: 32, TileY: 48,
		Paint: map[int]ChunkPaint{idx: {Layers: []Layer{{Texture: base}, {Texture: `Tileset\Test\Painted.blp`, Alpha: alpha}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	tex, err := ParseTextures(out, false, mustTerrain(t, out))
	if err != nil {
		t.Fatal(err)
	}
	c := tex.Chunks[idx]
	if len(c.Layers) != 2 || c.Layers[0].Texture != base || c.Layers[1].Texture != `Tileset\Test\Painted.blp` {
		t.Fatalf("layers = %+v", c.Layers)
	}
	// 4-bit alpha quantises to steps of 17.
	for _, v := range c.Alpha[0] {
		if d := int(v) - 128; d > 9 || d < -9 {
			t.Fatalf("alpha %d, want about 128", v)
		}
	}
	// Other chunks keep their layers.
	for i := range orig.Chunks {
		if i == idx {
			continue
		}
		if len(tex.Chunks[i].Layers) != len(orig.Chunks[i].Layers) {
			t.Fatalf("chunk %d layers changed", i)
		}
	}
}

func TestRewriteAddsAndRemovesPlacements(t *testing.T) {
	root := realTile(t)
	before, _ := ParsePlacements(root)
	gone := before[0].UID
	const x, z = 100.0, 100.0 // local to the tile, in yards
	at := [3]float32{float32(32*TileSize) + x, 150, float32(48*TileSize) + z}
	out, err := Rewrite(root, Changes{
		TileX: 32, TileY: 48,
		Remove: map[uint32]bool{gone: true},
		Add:    []Object{{Kind: M2, Name: `World\Test\Rock.m2`, UID: 900001, Position: at, Scale: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	after, err := ParsePlacements(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("%d placements, want %d (one out, one in)", len(after), len(before))
	}
	var added *Placement
	for i := range after {
		if after[i].UID == gone {
			t.Fatal("the removed placement is still there")
		}
		if after[i].UID == 900001 {
			added = &after[i]
		}
	}
	if added == nil || added.Name != `World\Test\Rock.m2` || added.Position != at {
		t.Fatalf("added placement = %+v", added)
	}
	// The chunk under the new model lists it.
	idx := int(z/chunkWidth)*ChunksPerTile + int(x/chunkWidth)
	newIndex := -1
	for i, p := range after {
		if p.UID == 900001 {
			newIndex = i
		}
	}
	found := false
	for _, r := range chunkRefs(t, out, idx) {
		if int(r) == newIndex {
			found = true
		}
	}
	if !found {
		t.Fatalf("chunk %d does not list the new model (index %d); refs %v", idx, newIndex, chunkRefs(t, out, idx))
	}
}

func TestRewriteWithHeightsKeepsBoth(t *testing.T) {
	root := realTile(t)
	terrain := mustTerrain(t, root)
	terrain.Chunks[7].Heights[40] += 2
	withHeights, err := WriteHeights(root, terrain)
	if err != nil {
		t.Fatal(err)
	}
	out, err := Rewrite(withHeights, Changes{TileX: 32, TileY: 48, Paint: map[int]ChunkPaint{7: {Layers: []Layer{{Texture: `Tileset\Elwynn\ElwynnGrassBase.blp`}}}}})
	if err != nil {
		t.Fatal(err)
	}
	back := mustTerrain(t, out)
	if d := back.Chunks[7].Heights[40] - terrain.Chunks[7].Heights[40]; math.Abs(float64(d)) > 0.01 {
		t.Fatalf("height lost after the rewrite: %v", d)
	}
}

func TestSequentialAlpha(t *testing.T) {
	one := bytes.Repeat([]byte{128}, 4)
	zero := bytes.Repeat([]byte{0}, 4)
	// Layer 1 half, layer 2 nothing: layer 1 shows its half, and layer 2 shows nothing.
	seq := SequentialAlpha([][]byte{one, zero})
	if seq[0][0] != 128 || seq[1][0] != 0 {
		t.Fatalf("sequential = %v %v", seq[0], seq[1])
	}
	// Layer 2 covers all: layer 1 is hidden under it.
	full := bytes.Repeat([]byte{255}, 4)
	seq = SequentialAlpha([][]byte{one, full})
	if seq[1][0] != 255 || seq[0][0] != 0 {
		t.Fatalf("sequential = %v %v", seq[0], seq[1])
	}
}

func TestEncode4BitRoundTrip(t *testing.T) {
	alpha := make([]byte, 64*64)
	for i := range alpha {
		alpha[i] = byte(i * 3)
	}
	packed := encode4Bit(alpha)
	back := make([]byte, 64*64)
	decode4Bit(packed, back, false)
	for i := range alpha {
		if d := int(back[i]) - int(alpha[i]); d > 9 || d < -9 {
			t.Fatalf("texel %d: %d came back as %d", i, alpha[i], back[i])
		}
	}
}

func mustTerrain(t *testing.T, root []byte) *Terrain {
	t.Helper()
	terrain, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	return terrain
}

// TestRewriteOffsetsPointAtChunks checks MCIN and MHDR, which the game reads, against the file.
func TestRewriteOffsetsPointAtChunks(t *testing.T) {
	root := realTile(t)
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Add: []Object{{Kind: WMO, Name: `World\Test\Hut.wmo`, Position: [3]float32{17100, 150, 25700}}}})
	if err != nil {
		t.Fatal(err)
	}
	idOf := func(at int) string {
		return string([]byte{out[at+3], out[at+2], out[at+1], out[at]})
	}
	mhdrAt := 12 // MVER is 12 bytes, MHDR's header follows it
	if idOf(mhdrAt) != "MHDR" {
		t.Fatalf("MHDR not at %d", mhdrAt)
	}
	mhdr := mhdrAt + 8
	mcinAt := mhdr + int(binary.LittleEndian.Uint32(out[mhdr+4:])) // MCIN's offset, from MHDR's data
	if idOf(mcinAt) != "MCIN" {
		t.Fatalf("MCIN offset points at %q", idOf(mcinAt))
	}
	mcin := mcinAt + 8
	for i := 0; i < ChunkCount; i++ {
		at := int(binary.LittleEndian.Uint32(out[mcin+i*16:]))
		size := int(binary.LittleEndian.Uint32(out[mcin+i*16+4:]))
		if idOf(at) != "MCNK" {
			t.Fatalf("MCIN entry %d points at %q", i, idOf(at))
		}
		if int(binary.LittleEndian.Uint32(out[at+4:])) != size-8 {
			t.Fatalf("MCIN entry %d size %d does not match its chunk", i, size)
		}
	}
	// The other offsets in MHDR, from its data, land on their chunks.
	for k, id := range []string{"MCIN", "MTEX", "MMDX", "MMID", "MWMO", "MWID", "MDDF", "MODF"} {
		at := mhdr + int(binary.LittleEndian.Uint32(out[mhdr+4+k*4:]))
		if idOf(at) != id {
			t.Fatalf("MHDR %s offset points at %q", id, idOf(at))
		}
	}
}

// TestRewriteClientShadowsUnchanged sends every chunk of a client tile its own baked shadows back:
// the tile reads back with the same maps and the same header flags.
func TestRewriteClientShadowsUnchanged(t *testing.T) {
	root := realTile(t)
	before, err := ParseTerrain(root)
	if err != nil {
		t.Fatal(err)
	}
	headers := map[int]ChunkHeader{}
	for i, c := range before.Chunks {
		impassable := c.Impassable()
		h := ChunkHeader{AreaID: c.AreaID, Impassable: &impassable, Shadow: c.Shadow}
		headers[i] = h
	}
	out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Headers: headers})
	if err != nil {
		t.Fatal(err)
	}
	after, err := ParseTerrain(out)
	if err != nil {
		t.Fatal(err)
	}
	for i := range before.Chunks {
		b, a := before.Chunks[i], after.Chunks[i]
		if !bytes.Equal(a.Shadow, b.Shadow) || a.Flags != b.Flags {
			t.Fatalf("chunk %d: flags %#x -> %#x, shadow equal %v", i, b.Flags, a.Flags, bytes.Equal(a.Shadow, b.Shadow))
		}
	}
}

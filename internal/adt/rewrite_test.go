package adt

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

// clientFile reads a file from the client's archives, or skips the test without a client
// (testclient.DataDir): WOW_DIR=/path/to/client go test ./internal/adt/
func clientFile(t *testing.T, path string) []byte {
	t.Helper()
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
	data, err := set.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// realTile reads Azeroth 32_48 from the client, or skips the test without one.
func realTile(t *testing.T) []byte {
	t.Helper()
	return clientFile(t, TilePath("Azeroth", 32, 48, ""))
}

// eachTile runs test on the synthetic tile, which needs no client, and on the client's Azeroth
// 32_48, which skips without one (#497). Both sit at tile 32_48, so a test can place models in
// either by the same coordinates.
func eachTile(t *testing.T, test func(t *testing.T, root []byte)) {
	t.Run("synthetic", func(t *testing.T) { test(t, syntheticTile(t)) })
	t.Run("client", func(t *testing.T) { test(t, realTile(t)) })
}

// syntheticTile is a whole tile at 32_48 made by the package's own writer, with every kind of
// piece a client tile carries, so the tests that read a client tile run without one (#497): hilly
// heights and their normals, one to four texture layers a chunk with alpha, two M2 and one WMO
// placement and their MCRF references, river, magma and sea liquids, baked shadows, area IDs, holes,
// impassable chunks, and sound emitters (MCSE), which Meld never writes and so are spliced in raw.
func syntheticTile(t *testing.T) []byte {
	t.Helper()
	textures := []string{`Tileset\Test\Grass.blp`, `Tileset\Test\Dirt.blp`, `Tileset\Test\Rock.blp`, `Tileset\Test\Moss.blp`}
	paint := map[int]ChunkPaint{}
	headers := map[int]ChunkHeader{}
	for i := 0; i < ChunkCount; i++ {
		layers := []Layer{{Texture: textures[i%4]}}
		for l := 1; l < 1+i%4; l++ {
			alpha := make([]byte, 64*64)
			for k := range alpha {
				alpha[k] = byte(k%64*4 + l*40 + i) // a ramp across the chunk, different a layer
			}
			layers = append(layers, Layer{Texture: textures[(i+l)%4], Alpha: alpha})
		}
		paint[i] = ChunkPaint{Layers: layers}
		h := ChunkHeader{AreaID: uint32(12 + i%3)}
		if i%5 == 0 {
			h.Shadow = make([]byte, ShadowBytes)
			for k := range h.Shadow {
				h.Shadow[k] = byte(k*7 + i)
			}
		}
		if i%11 == 0 {
			holes := uint16(1<<(i%16) | 0x0400)
			h.Holes = &holes
		}
		if i%13 == 0 {
			impassable := true
			h.Impassable = &impassable
		}
		headers[i] = h
	}
	lake := Liquid{Type: LiquidWater}
	lava := Liquid{Type: LiquidMagma}
	for v := range lake.Heights {
		lake.Heights[v] = 25 + float32(v%9)*0.25
		lake.Depth[v] = byte(v * 3)
		lava.Heights[v] = 30
	}
	for c := range lake.Cells {
		lake.Cells[c] = c < 40
		lava.Cells[c] = c >= 48
	}
	x0, z0 := float32(32*TileSize), float32(48*TileSize)
	root, err := BuildTile(hills(), Ring{}, Changes{
		TileX: 32, TileY: 48,
		Paint:   paint,
		Headers: headers,
		Liquids: map[int][]Liquid{17: {lake}, 18: {lake, lava}, 200: {lava}},
		Water:   &Water{Level: -12},
		Add: []Object{
			{Kind: M2, Name: `World\Test\Tree.m2`, UID: 11, Position: [3]float32{x0 + 50, 20, z0 + 60}, Rotation: [3]float32{0, 90, 0}, Scale: 1},
			{Kind: M2, Name: `World\Test\Bush.m2`, UID: 12, Position: [3]float32{x0 + 400, 10, z0 + 300}, Scale: 1.5},
			{Kind: WMO, Name: `World\Test\Farm.wmo`, UID: 13, Position: [3]float32{x0 + 250, 15, z0 + 250}, Rotation: [3]float32{0, 45, 0}, DoodadSet: 1},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	root = withSoundEmitters(t, root, 34, 2)
	return withSoundEmitters(t, root, 120, 1)
}

// soundEntry is the size of a 1.12 sound emitter record in MCSE.
const soundEntry = 0x34

// withSoundEmitters appends an MCSE of n made-up records to chunk idx, points its header at them and
// moves MCIN's entries to match, without going through Rewrite, so a writer that drops MCSE fails
// the tests instead of passing them a fixture that already lost it.
func withSoundEmitters(t *testing.T, root []byte, idx, n int) []byte {
	t.Helper()
	starts, err := mcnkStarts(root)
	if err != nil {
		t.Fatal(err)
	}
	start := starts[idx]
	end := start + int(binary.LittleEndian.Uint32(root[start-4:]))
	m := append([]byte(nil), root[start:end]...)
	binary.LittleEndian.PutUint32(m[mcnkSoundOfs:], uint32(len(m)+8)) // from the MCNK's own header, at the sub-chunk's
	binary.LittleEndian.PutUint32(m[mcnkSoundCount:], uint32(n))
	data := make([]byte, n*soundEntry)
	for k := range data {
		data[k] = byte(k + idx)
	}
	m = appendSub(m, "MCSE", data, len(data))
	out := append([]byte(nil), root[:start-8]...)
	out = append(out, chunkBytes("MCNK", m)...)
	out = append(out, root[end:]...)
	grown := uint32(len(m) - (end - start))
	err = eachChunk(out, 0, len(out), func(c chunk) error {
		if c.id != "MCIN" {
			return nil
		}
		for e := c.start; e+16 <= c.end; e += 16 {
			switch at := binary.LittleEndian.Uint32(out[e:]); {
			case at == uint32(start-8):
				binary.LittleEndian.PutUint32(out[e+4:], binary.LittleEndian.Uint32(out[e+4:])+grown)
			case at > uint32(start-8):
				binary.LittleEndian.PutUint32(out[e:], at+grown)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// soundEmitters returns chunk i's MCSE records, as its header points at them.
func soundEmitters(t *testing.T, root []byte, i int) []byte {
	t.Helper()
	starts, err := mcnkStarts(root)
	if err != nil {
		t.Fatal(err)
	}
	m := root[starts[i]:]
	n := int(binary.LittleEndian.Uint32(m[mcnkSoundCount:]))
	sub, ok := subRegion(m, int(binary.LittleEndian.Uint32(m[mcnkSoundOfs:])))
	if !ok || n == 0 {
		return nil
	}
	return sub
}

// TestSyntheticTileHasEveryPiece checks that syntheticTile carries what it claims, so the tests run
// on it exercise every sub-chunk kind the writer must keep.
func TestSyntheticTileHasEveryPiece(t *testing.T) {
	root := syntheticTile(t)
	checkOffsets(t, root)
	terrain := mustTerrain(t, root)
	tex, err := ParseTextures(root, false, terrain)
	if err != nil {
		t.Fatal(err)
	}
	var layerCounts [5]int
	shadows, holes, impassable, sounds := 0, 0, 0, 0
	for i, c := range terrain.Chunks {
		layerCounts[len(tex.Chunks[i].Layers)]++
		if c.Shadow != nil {
			shadows++
		}
		if c.Holes != ([8]uint8{}) {
			holes++
		}
		if c.Impassable() {
			impassable++
		}
		if len(soundEmitters(t, root, i)) > 0 {
			sounds++
		}
	}
	if layerCounts[0] != 0 || layerCounts[1] == 0 || layerCounts[2] == 0 || layerCounts[3] == 0 || layerCounts[4] == 0 {
		t.Errorf("chunks by layer count = %v, want every chunk painted with one to four", layerCounts)
	}
	if shadows == 0 || holes == 0 || impassable == 0 || sounds != 2 {
		t.Errorf("%d shadowed, %d holed, %d impassable, %d with sound emitters", shadows, holes, impassable, sounds)
	}
	if got := len(soundEmitters(t, root, 34)); got != 2*soundEntry {
		t.Errorf("chunk 34 has %d bytes of sound emitters, want %d", got, 2*soundEntry)
	}
	placements, err := ParsePlacements(root)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[Kind]int{}
	for _, p := range placements {
		kinds[p.Kind]++
	}
	if kinds[M2] != 2 || kinds[WMO] != 1 {
		t.Errorf("placements = %+v", placements)
	}
	if refs := chunkRefs(t, root, 1*ChunksPerTile+1); len(refs) == 0 {
		t.Error("the chunk under the tree lists no models")
	}
	liquids, err := ParseLiquids(root)
	if err != nil {
		t.Fatal(err)
	}
	types := map[int]int{}
	for _, l := range liquids {
		types[l.Type]++
	}
	if types[LiquidWater] == 0 || types[LiquidMagma] == 0 || types[LiquidOcean] == 0 {
		t.Errorf("liquid layers by type = %v, want river, magma and sea", types)
	}
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
	eachTile(t, func(t *testing.T, root []byte) {
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
			if a.Chunks[i].Flags != b.Chunks[i].Flags || !bytes.Equal(a.Chunks[i].Shadow, b.Chunks[i].Shadow) {
				t.Fatalf("chunk %d: flags %#x -> %#x, shadow kept %v", i, a.Chunks[i].Flags, b.Chunks[i].Flags, bytes.Equal(a.Chunks[i].Shadow, b.Chunks[i].Shadow))
			}
			if !bytes.Equal(soundEmitters(t, root, i), soundEmitters(t, out, i)) {
				t.Fatalf("chunk %d: sound emitters changed", i)
			}
		}
		la, _ := ParseLiquids(root)
		lb, err := ParseLiquids(out)
		if err != nil {
			t.Fatal(err)
		}
		if len(la) != len(lb) {
			t.Fatalf("%d liquid layers, want %d", len(lb), len(la))
		}
		for i := range la {
			if la[i] != lb[i] {
				t.Fatalf("liquid layer %d changed: %+v vs %+v", i, la[i], lb[i])
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
	})
}

func TestRewritePaintReadsBack(t *testing.T) {
	eachTile(t, func(t *testing.T, root []byte) {
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
	})
}

// TestRewriteZeroesFieldsOfMissingPieces repaints a two-layer chunk to one layer, which writes no
// MCAL, and rewrites a chunk whose header claims a shadow map and sound emitters it doesn't have:
// the header's offset, size and count fields and the flags for those pieces must be cleared rather
// than kept from the old chunk (#496), while a chunk with a shadow map keeps them.
func TestRewriteZeroesFieldsOfMissingPieces(t *testing.T) {
	two := ChunkPaint{Layers: []Layer{{Texture: `Tileset\Test\A.blp`}, {Texture: `Tileset\Test\B.blp`, Alpha: bytes.Repeat([]byte{128}, 64*64)}}}
	root, err := BuildTile(hills(), Ring{}, Changes{TileX: 3, TileY: 4, Paint: map[int]ChunkPaint{5: two}})
	if err != nil {
		t.Fatal(err)
	}
	header := func(root []byte, idx int) []byte {
		t.Helper()
		starts, err := mcnkStarts(root)
		if err != nil {
			t.Fatal(err)
		}
		return root[starts[idx] : starts[idx]+mcnkHeaderLen]
	}
	u32 := func(h []byte, at int) uint32 { return binary.LittleEndian.Uint32(h[at:]) }
	if h := header(root, 5); u32(h, 0x24) == 0 || u32(h, 0)&mcnkFlagNoFix == 0 {
		t.Fatalf("two layers: ofsAlpha %#x flags %#x, want an MCAL and the 0x8000 flag", u32(h, 0x24), u32(h, 0))
	}
	// A stale shadow size and flag and a sound emitter count with no MCSH or MCSE behind them.
	stale := header(root, 6)
	binary.LittleEndian.PutUint32(stale[0:], u32(stale, 0)|mcnkFlagShadow)
	binary.LittleEndian.PutUint32(stale[mcnkShadowSize:], ShadowBytes)
	binary.LittleEndian.PutUint32(stale[mcnkSoundCount:], 3)

	one := ChunkPaint{Layers: []Layer{{Texture: `Tileset\Test\A.blp`}}}
	shadow := make([]byte, ShadowBytes)
	shadow[0] = 1
	out, err := Rewrite(root, Changes{TileX: 3, TileY: 4, Paint: map[int]ChunkPaint{5: one}, Headers: map[int]ChunkHeader{7: {Shadow: shadow}}})
	if err != nil {
		t.Fatal(err)
	}
	h := header(out, 5)
	if u32(h, 0x24) != 0 || u32(h, 0x28) != 0 || u32(h, 0)&mcnkFlagNoFix != 0 {
		t.Fatalf("one layer: ofsAlpha %#x sizeAlpha %d flags %#x, want none", u32(h, 0x24), u32(h, 0x28), u32(h, 0))
	}
	h = header(out, 6)
	if u32(h, 0x2c) != 0 || u32(h, mcnkShadowSize) != 0 || u32(h, 0)&mcnkFlagShadow != 0 || u32(h, mcnkSoundOfs) != 0 || u32(h, mcnkSoundCount) != 0 {
		t.Fatalf("no shadow or sounds: ofsShadow %#x sizeShadow %d flags %#x ofsSound %#x nSound %d", u32(h, 0x2c), u32(h, mcnkShadowSize), u32(h, 0), u32(h, mcnkSoundOfs), u32(h, mcnkSoundCount))
	}
	// The shadow written for chunk 7 keeps its offset, size and flag, through a second rewrite too.
	for _, tile := range [][]byte{out, mustRewrite(t, out)} {
		starts, err := mcnkStarts(tile)
		if err != nil {
			t.Fatal(err)
		}
		h = tile[starts[7] : starts[7]+mcnkHeaderLen]
		at := starts[7] + int(u32(h, 0x2c)) - 8
		if u32(h, 0x2c) == 0 || string([]byte{tile[at+3], tile[at+2], tile[at+1], tile[at]}) != "MCSH" || u32(h, mcnkShadowSize) != ShadowBytes || u32(h, 0)&mcnkFlagShadow == 0 {
			t.Fatalf("shadow: ofsShadow %#x sizeShadow %d flags %#x", u32(h, 0x2c), u32(h, mcnkShadowSize), u32(h, 0))
		}
	}
}

func mustRewrite(t *testing.T, root []byte) []byte {
	t.Helper()
	out, err := Rewrite(root, Changes{TileX: 3, TileY: 4})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestRewriteAddsAndRemovesPlacements(t *testing.T) {
	eachTile(t, func(t *testing.T, root []byte) {
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
	})
}

func TestRewriteWithHeightsKeepsBoth(t *testing.T) {
	eachTile(t, func(t *testing.T, root []byte) {
		terrain := mustTerrain(t, root)
		terrain.Chunks[7].Heights[40] += 2
		withHeights, err := WriteHeights(root, terrain, nil)
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
	})
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
	eachTile(t, func(t *testing.T, root []byte) {
		out, err := Rewrite(root, Changes{TileX: 32, TileY: 48, Add: []Object{{Kind: WMO, Name: `World\Test\Hut.wmo`, Position: [3]float32{17100, 150, 25700}}}})
		if err != nil {
			t.Fatal(err)
		}
		checkOffsets(t, out)
	})
}

// TestRewriteClientShadowsUnchanged sends every chunk of a client tile its own baked shadows back:
// the tile reads back with the same maps and the same header flags.
func TestRewriteClientShadowsUnchanged(t *testing.T) {
	eachTile(t, func(t *testing.T, root []byte) {
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
	})
}

// checkOffsets checks MCIN and MHDR, which the game reads, against the file's chunks.
func checkOffsets(t *testing.T, out []byte) {
	t.Helper()
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

package adt

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"Meld/internal/mpq"
	"Meld/internal/testclient"
)

// The 3.3.5a client's own tiles through the writer (#1068 to #1070), read-only:
//
//	WOW335_DIR=/path/to/a/3.3.5a/client go test ./internal/adt/ -run WotLK -v

// wotlkTiles are the tiles the tests read: Northrend's have vertex colours, flight bounds, 8-bit
// alpha maps and MH2O liquids (Dalaran's crater, Wintergrasp with its two waters, the coast of the
// Howling Fjord, Icecrown); Azeroth's have 4-bit alpha and MH2O (the Burning Steppes' lava among
// them); Outland's keep their liquids in MCLQ.
var wotlkTiles = []struct {
	name     string
	x, y     int
	bigAlpha bool
}{
	{"Northrend", 30, 21, true}, {"Northrend", 30, 20, true}, {"Northrend", 22, 22, true}, {"Northrend", 27, 21, true},
	{"Northrend", 36, 25, true}, {"Northrend", 29, 17, true}, {"Northrend", 23, 17, true}, {"Northrend", 31, 19, true},
	{"Azeroth", 32, 48, false}, {"Azeroth", 33, 46, false}, {"Azeroth", 34, 46, false},
	{"Kalimdor", 34, 45, false},
	{"Expansion01", 22, 34, false}, {"Expansion01", 26, 30, false},
}

// eachWotLKTile runs test on each of wotlkTiles the client has.
func eachWotLKTile(t *testing.T, test func(t *testing.T, root []byte, bigAlpha bool, x, y int)) {
	dataDir, err := resolveDataDir(testclient.WotLKDir(t))
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	n := 0
	for _, tile := range wotlkTiles {
		root, err := set.ReadFile(TilePath(tile.name, tile.x, tile.y, ""))
		if err != nil {
			t.Logf("%s %d_%d: %v", tile.name, tile.x, tile.y, err)
			continue
		}
		n++
		t.Run(fmt.Sprintf("%s_%d_%d", tile.name, tile.x, tile.y), func(t *testing.T) {
			test(t, root, tile.bigAlpha, tile.x, tile.y)
		})
	}
	if n < 8 {
		t.Errorf("the client has %d of the %d tiles", n, len(wotlkTiles))
	}
}

// subChunksOf is an MCNK's sub-chunks by name, read by walking them rather than by the header's
// offsets: each one's bytes are as long as its size field says, but for the three the client's
// files size otherwise (the alpha maps and the liquid by the header's lengths, the normals with
// their 13 bytes of padding).
func subChunksOf(t *testing.T, m []byte) map[string][]byte {
	t.Helper()
	out := map[string][]byte{}
	for o := mcnkHeaderLen; o+8 <= len(m); {
		id := string([]byte{m[o+3], m[o+2], m[o+1], m[o]})
		size := int(binary.LittleEndian.Uint32(m[o+4:]))
		switch id {
		case "MCAL":
			size = int(binary.LittleEndian.Uint32(m[0x28:])) - 8
		case "MCNR":
			size = 448
		case "MCLQ":
			size = max(0, int(binary.LittleEndian.Uint32(m[mcnkLiquidSize:]))-8)
		}
		if size < 0 || o+8+size > len(m) || id[0] != 'M' || id[1] != 'C' {
			t.Fatalf("sub-chunk %q of %d bytes at %d does not fit the chunk's %d", id, size, o, len(m))
		}
		if _, twice := out[id]; twice {
			t.Fatalf("two %s in one chunk", id)
		}
		out[id] = m[o+8 : o+8+size]
		o += 8 + size
	}
	return out
}

// mcnkOffsets are the header fields that hold where a sub-chunk is, which a rewrite may move.
var mcnkOffsets = []int{0x14, 0x18, 0x1c, 0x20, 0x24, 0x2c, mcnkSoundOfs, mcnkLiquidOfs, mcnkVertexColor}

// sameTile fails the test where tile b is not tile a with its chunks laid out anew: the same
// top-level chunks in the same order with the same bytes, MHDR's and MCIN's offsets right, and every
// MCNK with the same header but for its offsets and the same sub-chunks, each found through its
// offset. skip names top-level chunks left out of the comparison.
func sameTile(t *testing.T, a, b []byte, skip ...string) {
	t.Helper()
	type top struct {
		id   string
		data []byte
	}
	read := func(root []byte) (out []top, order string) {
		var ids []string
		err := eachChunk(root, 0, len(root), func(c chunk) error {
			out = append(out, top{c.id, root[c.start:c.end]})
			if len(ids) == 0 || ids[len(ids)-1] != c.id {
				ids = append(ids, c.id)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return out, strings.Join(ids, " ")
	}
	ta, oa := read(a)
	tb, ob := read(b)
	if oa != ob || len(ta) != len(tb) {
		t.Fatalf("the chunks are\n%s\nwere\n%s", ob, oa)
	}
	checkLaterOffsets(t, b)
	n := 0
	for i := range ta {
		x, y := ta[i], tb[i]
		switch {
		case strings.Contains(strings.Join(skip, " "), x.id), x.id == "MCIN":
		case x.id == "MHDR":
			// The flags, and what is past the offsets, stay.
			if !bytes.Equal(x.data[:4], y.data[:4]) || !bytes.Equal(x.data[0x30:], y.data[0x30:]) {
				t.Errorf("MHDR's flags or tail changed")
			}
		case x.id == "MCNK":
			ha, hb := append([]byte(nil), x.data[:mcnkHeaderLen]...), append([]byte(nil), y.data[:mcnkHeaderLen]...)
			sa, sb := subChunksOf(t, x.data), subChunksOf(t, y.data)
			for _, f := range mcnkOffsets {
				// Each offset the header had still points at its sub-chunk.
				if was, is := int(binary.LittleEndian.Uint32(ha[f:])), int(binary.LittleEndian.Uint32(hb[f:])); (was == 0) != (is == 0) {
					t.Fatalf("chunk %d: the offset at %#x was %d, is %d", n, f, was, is)
				} else if is != 0 && (is < mcnkHeaderLen+8 || is > len(y.data) || !bytes.Equal(y.data[is-8:is-4], x.data[was-8:was-4])) {
					t.Fatalf("chunk %d: the offset at %#x points at %q", n, f, y.data[is-8:is-4])
				}
				binary.LittleEndian.PutUint32(ha[f:], 0)
				binary.LittleEndian.PutUint32(hb[f:], 0)
			}
			if !bytes.Equal(ha, hb) {
				t.Fatalf("chunk %d: the header changed:\n%x\n%x", n, ha, hb)
			}
			if len(sa) != len(sb) {
				t.Fatalf("chunk %d: %d sub-chunks, were %d", n, len(sb), len(sa))
			}
			for id, data := range sa {
				if got, ok := sb[id]; !ok || !bytes.Equal(got, data) {
					t.Fatalf("chunk %d: %s is not as it was (%d bytes, were %d; there %v)", n, id, len(got), len(data), ok)
				}
			}
			n++
		case !bytes.Equal(x.data, y.data):
			t.Errorf("%s changed (%d bytes, were %d)", x.id, len(y.data), len(x.data))
		}
	}
}

// A save that changes nothing in a tile of the 3.3.5a client writes the tile it read: every chunk
// and sub-chunk with the bytes it had, the vertex colours, flight bounds and liquids among them,
// under offsets that find them (#1070).
func TestWotLKRewriteKeepsTheTile(t *testing.T) {
	eachWotLKTile(t, func(t *testing.T, root []byte, bigAlpha bool, x, y int) {
		out, err := Rewrite(root, Changes{TileX: x, TileY: y, Format: Format{MH2O: true, BigAlpha: bigAlpha}})
		if err != nil {
			t.Fatal(err)
		}
		sameTile(t, root, out)
		if len(out) != len(root) {
			t.Errorf("the tile is %d bytes, was %d", len(out), len(root))
		}
		// And as the readers see it.
		for name, read := range map[string]func([]byte) (any, error){
			"terrain":    func(b []byte) (any, error) { return ParseTerrain(b) },
			"placements": func(b []byte) (any, error) { return ParsePlacements(b) },
			"liquids":    func(b []byte) (any, error) { return ParseLiquids(b) },
			"textures": func(b []byte) (any, error) {
				terrain, err := ParseTerrain(b)
				if err != nil {
					return nil, err
				}
				return ParseTextures(b, bigAlpha, terrain)
			},
		} {
			was, err := read(root)
			if err != nil {
				t.Fatal(err)
			}
			if is, err := read(out); err != nil || !reflect.DeepEqual(was, is) {
				t.Errorf("the %s read otherwise after the save (%v)", name, err)
			}
		}
	})
}

// byChunk groups a tile's layers by chunk index.
func byChunk(ls []Liquid) map[int][]Liquid {
	out := map[int][]Liquid{}
	for _, l := range ls {
		out[l.IndexY*ChunksPerTile+l.IndexX] = append(out[l.IndexY*ChunksPerTile+l.IndexX], l)
	}
	return out
}

// Every liquid of a 3.3.5a tile written anew from what the reader gave: the tile reads back with
// the same layers, each in the form and under the LiquidType.dbc row the client's own layer had,
// whether the editor names the row or only the kind (#1068). The other chunks' bytes stay.
func TestWotLKLiquidsWrittenAsTheClients(t *testing.T) {
	stats := map[string]int{}
	eachWotLKTile(t, func(t *testing.T, root []byte, bigAlpha bool, x, y int) {
		if topChunkAt(t, root, "MH2O") < 0 {
			t.Skip("the tile has no MH2O")
		}
		was, err := ParseLiquids(root)
		if err != nil {
			t.Fatal(err)
		}
		own := mustMH2O(t, root)
		for _, named := range []bool{true, false} {
			all := map[int][]Liquid{}
			for i := 0; i < ChunkCount; i++ {
				all[i] = nil
			}
			for k, ls := range byChunk(was) {
				for _, l := range ls {
					if !named {
						l.LiquidID = 0
					}
					all[k] = append(all[k], l)
				}
			}
			out, err := Rewrite(root, Changes{TileX: x, TileY: y, Format: Format{MH2O: true, BigAlpha: bigAlpha}, Liquids: all})
			if err != nil {
				t.Fatal(err)
			}
			sameTile(t, root, out, "MH2O")
			is, err := ParseLiquids(out)
			if err != nil {
				t.Fatal(err)
			}
			got, want := byChunk(is), byChunk(was)
			written := mustMH2O(t, out)
			for k := 0; k < ChunkCount; k++ {
				w := MergeLiquids(want[k])
				sort.SliceStable(w, func(i, j int) bool { return liquidKinds[w[i].Type].flag < liquidKinds[w[j].Type].flag })
				g := got[k]
				if len(g) != len(w) {
					t.Fatalf("chunk %d reads %d layers, were %d", k, len(g), len(w))
				}
				for i := range w {
					if g[i].Type != w[i].Type || !sameSurface(&w[i], &g[i]) {
						t.Fatalf("chunk %d layer %d (kind %d) does not read back as it was", k, i, w[i].Type)
					}
				}
				// The form of each layer, against the client's own, where the chunk has one a kind.
				if len(own[k].layers) != len(written[k].layers) {
					stats["chunks with two layers of a kind"]++
					continue
				}
				forms := func(c waterChunk) []string {
					var out []string
					for _, l := range c.layers {
						out = append(out, fmt.Sprintf("row %d format %d", l.id, l.format))
					}
					sort.Strings(out)
					return out
				}
				if a, b := forms(own[k]), forms(written[k]); !reflect.DeepEqual(a, b) {
					t.Fatalf("chunk %d is written as %v, the client has %v (rows named: %v)", k, b, a, named)
				}
				if len(own[k].layers) == 0 {
					continue
				}
				// How the writer's choices compare with the client's, for the log.
				stats["chunks"]++
				if (own[k].attrs == nil) != (written[k].attrs == nil) {
					stats[fmt.Sprintf("attributes there %v, client's %v", written[k].attrs != nil, own[k].attrs != nil)]++
				} else if own[k].attrs != nil && !bytes.Equal(own[k].attrs[8:], written[k].attrs[8:]) {
					stats["deep cells differ"]++
				} else if own[k].attrs != nil && !bytes.Equal(own[k].attrs[:8], written[k].attrs[:8]) {
					stats["fishable cells differ"]++
				}
				for i, l := range own[k].layers {
					if (l.verts == nil) != (written[k].layers[i].verts == nil) {
						stats[fmt.Sprintf("vertex data there %v, client's %v", written[k].layers[i].verts != nil, l.verts != nil)]++
					}
				}
			}
		}
	})
	t.Logf("against the client's own layers: %v", stats)
}

// Every chunk of a 3.3.5a tile painted with its own layers, as the editor sends a chunk it has
// painted: the tile reads back with the same mix at every texel, to within a step of a byte, in
// the map's kind of alpha map (#1069), and everything else stays.
func TestWotLKPaintWrittenAsTheMaps(t *testing.T) {
	eachWotLKTile(t, func(t *testing.T, root []byte, bigAlpha bool, x, y int) {
		terrain := mustTerrain(t, root)
		was, err := ParseTextures(root, bigAlpha, terrain)
		if err != nil {
			t.Fatal(err)
		}
		paint := map[int]ChunkPaint{}
		for i, c := range was.Chunks {
			if len(c.Layers) == 0 || len(c.Layers) > 4 {
				continue
			}
			var layers []Layer
			for l, layer := range c.Layers {
				flags := layer.Flags & LayerLookFlags
				out := Layer{Texture: layer.Texture, Effect: layer.Effect, Flags: &flags}
				if l > 0 {
					out.Alpha = c.Alpha[l-1]
				}
				layers = append(layers, out)
			}
			paint[terrain.Chunks[i].IndexY*ChunksPerTile+terrain.Chunks[i].IndexX] = ChunkPaint{Layers: layers}
		}
		out, err := Rewrite(root, Changes{TileX: x, TileY: y, Format: Format{MH2O: true, BigAlpha: bigAlpha}, Paint: paint})
		if err != nil {
			t.Fatal(err)
		}
		checkLaterOffsets(t, out)
		is, err := ParseTextures(out, bigAlpha, mustTerrain(t, out))
		if err != nil {
			t.Fatal(err)
		}
		step := 1
		if !bigAlpha {
			step = 17 // a 4-bit map's
		}
		worst := 0
		for i, c := range was.Chunks {
			g := is.Chunks[i]
			if len(g.Layers) != len(c.Layers) {
				t.Fatalf("chunk %d has %d layers, had %d", i, len(g.Layers), len(c.Layers))
			}
			for l := range c.Layers {
				if g.Layers[l].Texture != c.Layers[l].Texture || g.Layers[l].Effect != c.Layers[l].Effect ||
					g.Layers[l].Flags&LayerLookFlags != c.Layers[l].Flags&LayerLookFlags {
					t.Fatalf("chunk %d layer %d: %+v, was %+v", i, l, g.Layers[l], c.Layers[l])
				}
			}
			a, b := WeightAlpha(c.Alpha), WeightAlpha(g.Alpha)
			for l := range a {
				for k := range a[l] {
					if terrain.Chunks[i].Flags&mcnkFlagNoFix == 0 && (k%64 == 63 || k/64 == 63) {
						continue // a 63x63 map's repeated edge, which a rewritten chunk holds as texels
					}
					d := int(a[l][k]) - int(b[l][k])
					worst = max(worst, d, -d)
				}
			}
		}
		if worst > step+1 {
			t.Errorf("a texel's share of a layer moved by %d of 255", worst)
		}
		// The rest of each chunk came through.
		sa, _ := mcnkStarts(root)
		sb, _ := mcnkStarts(out)
		for i := range sa {
			ma := root[sa[i] : sa[i]+int(binary.LittleEndian.Uint32(root[sa[i]-4:]))]
			mb := out[sb[i] : sb[i]+int(binary.LittleEndian.Uint32(out[sb[i]-4:]))]
			a, b := subChunksOf(t, ma), subChunksOf(t, mb)
			for _, id := range []string{"MCVT", "MCCV", "MCNR", "MCRF", "MCSH", "MCSE", "MCLQ"} {
				if !bytes.Equal(a[id], b[id]) {
					t.Fatalf("chunk %d: %s changed with the paint", i, id)
				}
			}
		}
	})
}

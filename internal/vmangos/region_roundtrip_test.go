package vmangos

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// The region save's two writes an author triggers most, paint and liquids, read back from the tiles
// BuildRegion writes (#404). The client is a made-up 2x2 map in a temp archive, so no WOW_DIR is needed.

// roundTripMap is the made-up map's name.
const roundTripMap = "RoundTrip"

// roundTripLake is a full-chunk liquid layer of type typ at the given height, depth 128, for chunk
// (x, y) of its tile.
func roundTripLake(x, y, typ int, height float32) adt.Liquid {
	l := adt.Liquid{IndexX: x, IndexY: y, Type: typ}
	for v := range l.Heights {
		l.Heights[v] = height
		l.Depth[v] = 128
	}
	for i := range l.Cells {
		l.Cells[i] = true
	}
	return l
}

// roundTripClient writes the made-up map into a temp data folder: a WDT with 4-bit alpha, and four
// flat, unpainted tiles, with a water lake in chunks (2,3) and (8,8) of tile 0_0 and magma in chunk
// (0,0) of tile 1_1.
func roundTripClient(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	mphd := binary.LittleEndian.AppendUint32([]byte("DHPM"), 32)
	wdt, err := BuildWDT(append(mphd, make([]byte, 32)...), func(x, y int) bool { return x < 2 && y < 2 })
	if err != nil {
		t.Fatal(err)
	}
	liquids := map[[2]int]map[int][]adt.Liquid{
		{0, 0}: {3*16 + 2: {roundTripLake(2, 3, adt.LiquidWater, 10)}, 8*16 + 8: {roundTripLake(8, 8, adt.LiquidWater, 5)}},
		{1, 1}: {0: {roundTripLake(0, 0, adt.LiquidMagma, 20)}},
	}
	files := []mpq.File{{Name: `World\Maps\` + roundTripMap + `\` + roundTripMap + `.wdt`, Data: wdt}}
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			root, err := adt.BuildTile(flatTile(0), adt.Ring{}, adt.Changes{TileX: x, TileY: y, Liquids: liquids[[2]int{x, y}]})
			if err != nil {
				t.Fatal(err)
			}
			files = append(files, mpq.File{Name: adt.TilePath(roundTripMap, x, y, ""), Data: root})
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "terrain.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// roundTripEdit is an edit of the whole block that changes nothing: flat heights, no models.
func roundTripEdit() RegionEdit {
	side := 2*tileCells + 1
	return RegionEdit{MapName: roundTripMap, X: 0, Y: 0, Size: 2, Heights: EncodeHeights(make([]float32, side*side))}
}

// roundTripTiles builds e and returns the block's written tiles by tile (x, y).
func roundTripTiles(t *testing.T, dir string, e RegionEdit) map[[2]int][]byte {
	t.Helper()
	files, err := BuildRegion(dir, e)
	if err != nil {
		t.Fatal(err)
	}
	out := map[[2]int][]byte{}
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			name := adt.TilePath(roundTripMap, x, y, "")
			for _, f := range files {
				if strings.EqualFold(f.Name, name) {
					out[[2]int{x, y}] = f.Data
				}
			}
			if out[[2]int{x, y}] == nil {
				t.Fatalf("the save wrote no %s", name)
			}
		}
	}
	return out
}

// tileTextures reads a written tile's layers and alpha by chunk index (y*16 + x), as the region
// reader does.
func tileTextures(t *testing.T, root []byte) map[int]adt.TexChunk {
	t.Helper()
	own, err := ownTextures(root, false)
	if err != nil {
		t.Fatal(err)
	}
	return own
}

// gridWeights is a chunk's texel weights (32 a side, four a texel, summing to 255) for n textures
// whose blend alphas lie on the 4-bit grid the 1.12 alpha maps store (multiples of 17), varying from
// texel to texel, so the write loses nothing to the format and the weights read back within a unit.
// The upper layers stay at or under 204 (four textures: 136) so the alpha of the layers under them,
// which SequentialAlpha divides by what the upper ones leave, rounds to the same 4-bit step.
func gridWeights(n int) []byte {
	const perSide = adt.AlphaSize / 2
	w := make([]byte, perSide*perSide*4)
	for v := 0; v < perSide; v++ {
		for u := 0; u < perSide; u++ {
			var a [4]float64
			a[1] = float64(17*((3*u+v)%16)) / 255
			if n == 3 {
				a[2] = float64(17*((u+2*v)%13)) / 255
			} else {
				a[2] = float64(17*((u+2*v)%9)) / 255
				a[3] = float64(17*((3*u+v+4)%9)) / 255
			}
			t := (v*perSide + u) * 4
			rest, sum := 1.0, 0
			for k := n - 1; k >= 1; k-- {
				w[t+k] = byte(math.Round(a[k] * rest * 255))
				rest *= 1 - a[k]
				sum += int(w[t+k])
			}
			w[t] = byte(255 - sum)
		}
	}
	return w
}

// scatterWeights is three textures' weights off the 4-bit grid, from a fixed sequence: any texel
// summing to 255, as a brush leaves them.
func scatterWeights() []byte {
	const perSide = adt.AlphaSize / 2
	w := make([]byte, perSide*perSide*4)
	seed := uint32(404)
	next := func(n int) int {
		seed = seed*1664525 + 1013904223
		return int(seed>>8) % n
	}
	for t := 0; t < perSide*perSide; t++ {
		a := next(256)
		b := next(256 - a)
		w[t*4], w[t*4+1], w[t*4+2] = byte(255-a-b), byte(a), byte(b)
	}
	return w
}

// TestRegionPaintRoundTrip paints three chunks of a 2x2 block, in three of its tiles, saves it and
// reads the written tiles' layers and alpha back with adt.ParseTextures (#404): the textures in slot
// order, the weights within a unit of 255 where the blend sits on the 4-bit grid (three and four
// textures), and each layer's alpha within half a 4-bit step of the weights' where it doesn't. Every
// other chunk reads as a save of the same block with no paint does: a save itself changes some chunks'
// bytes (the 0x8000 flag), so the comparison is against that save and not the archive's tiles.
func TestRegionPaintRoundTrip(t *testing.T) {
	dir := roundTripClient(t)
	base := roundTripTiles(t, dir, roundTripEdit())

	three := []string{`Tileset\Test\Grass.blp`, `Tileset\Test\Dirt.blp`, `Tileset\Test\Rock.blp`}
	four := append(append([]string{}, three...), `Tileset\Test\Moss.blp`)
	type painted struct {
		tile     [2]int
		local    int
		textures []string
		weights  []byte
		grid     bool
	}
	const perRow = 2 * adt.ChunksPerTile
	// Block chunk (gx, gy) is chunk (gx%16, gy%16) of tile (gx/16, gy/16).
	chunks := map[int]painted{
		2*perRow + 3:   {tile: [2]int{0, 0}, local: 2*16 + 3, textures: three, weights: gridWeights(3), grid: true},
		25*perRow + 23: {tile: [2]int{1, 1}, local: 9*16 + 7, textures: four, weights: gridWeights(4), grid: true},
		1*perRow + 20:  {tile: [2]int{1, 0}, local: 1*16 + 4, textures: three, weights: scatterWeights()},
	}
	e := roundTripEdit()
	for c, p := range chunks {
		e.Paint = append(e.Paint, RegionPaint{Chunk: c, Textures: p.textures, Weights: base64.StdEncoding.EncodeToString(p.weights)})
	}
	got := roundTripTiles(t, dir, e)

	paintedAt := map[[2]int]map[int]painted{}
	for _, p := range chunks {
		if paintedAt[p.tile] == nil {
			paintedAt[p.tile] = map[int]painted{}
		}
		paintedAt[p.tile][p.local] = p
	}
	const perSide = adt.AlphaSize / 2
	for tile, root := range got {
		want := tileTextures(t, base[tile])
		have := tileTextures(t, root)
		if len(have) != adt.ChunksPerTile*adt.ChunksPerTile {
			t.Fatalf("tile %v: %d chunks read back", tile, len(have))
		}
		for local, c := range have {
			p, ok := paintedAt[tile][local]
			if !ok {
				if !reflect.DeepEqual(c, want[local]) {
					t.Errorf("tile %v chunk %d was not painted but reads %+v, not the unpainted save's %+v", tile, local, c.Layers, want[local].Layers)
				}
				continue
			}
			if len(c.Layers) != len(p.textures) {
				t.Fatalf("tile %v chunk %d has %d layers, want %d", tile, local, len(c.Layers), len(p.textures))
			}
			for k, l := range c.Layers {
				if l.Texture != p.textures[k] {
					t.Errorf("tile %v chunk %d layer %d is %q, want %q", tile, local, k, l.Texture, p.textures[k])
				}
			}
			if p.grid {
				w := adt.ClientWeights(c, perSide)
				worst := 0
				for i := 0; i < perSide*perSide; i++ {
					for k := range p.textures {
						d := int(w[i*4+k]) - int(p.weights[i*4+k])
						worst = max(worst, d, -d)
						if d > 1 || d < -1 {
							t.Fatalf("tile %v chunk %d texel %d: weights %v read back, %v painted", tile, local, i, w[i*4:i*4+4], p.weights[i*4:i*4+4])
						}
					}
				}
				t.Logf("tile %v chunk %d (%d textures): weights within %d/255", tile, local, len(p.textures), worst)
				continue
			}
			// Off the grid: each layer's stored alpha is the weights' blend alpha rounded to a 4-bit step
			// (17), so it is within half a step, and SequentialAlpha's own rounding, of the exact one.
			worst := 0.0
			for y := 0; y < adt.AlphaSize; y++ {
				for x := 0; x < adt.AlphaSize; x++ {
					i := ((y/2)*perSide + x/2) * 4
					w1, w2 := float64(p.weights[i+1]), float64(p.weights[i+2])
					exact := [2]float64{-1, w2}
					if left := 255 - w2; left > 0.255 {
						exact[0] = math.Min(1, w1/left) * 255
					}
					for l := 0; l < 2; l++ {
						if exact[l] < 0 {
							continue
						}
						d := math.Abs(float64(c.Alpha[l][y*adt.AlphaSize+x]) - exact[l])
						worst = math.Max(worst, d)
						if d > 9 {
							t.Fatalf("tile %v chunk %d layer %d alpha texel %d,%d reads %d, the weights' blend is %.1f", tile, local, l+1, x, y, c.Alpha[l][y*adt.AlphaSize+x], exact[l])
						}
					}
				}
			}
			t.Logf("tile %v chunk %d (off the grid): alpha within %.1f/255", tile, local, worst)
		}
	}
}

// liquidsAt reads a written tile's liquid layers by chunk index (y*16 + x).
func liquidsAt(t *testing.T, root []byte) map[int][]adt.Liquid {
	t.Helper()
	ls, err := adt.ParseLiquids(root)
	if err != nil {
		t.Fatal(err)
	}
	out := map[int][]adt.Liquid{}
	for _, l := range ls {
		k := l.IndexY*adt.ChunksPerTile + l.IndexX
		out[k] = append(out[k], l)
	}
	return out
}

// layerNames is a chunk's layers in short, for a failure: each one's type and covered cells.
func layerNames(ls []adt.Liquid) string {
	var parts []string
	for _, l := range ls {
		n := 0
		for _, on := range l.Cells {
			if on {
				n++
			}
		}
		parts = append(parts, fmt.Sprintf("type %d over %d cells", l.Type, n))
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// sameLayers says whether two chunks' layers match exactly, in any order, but for the depth of magma
// and slime, which store texture coordinates there and read as 255.
func sameLayers(a, b []adt.Liquid) bool {
	if len(a) != len(b) {
		return false
	}
	for _, x := range a {
		found := false
		for _, y := range b {
			if x.Type != y.Type || x.Cells != y.Cells || x.Heights != y.Heights {
				continue
			}
			if x.Type == adt.LiquidMagma || x.Type == adt.LiquidSlime || x.Depth == y.Depth {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// TestRegionLiquidsRoundTrip edits a 2x2 block's liquids, saves it and reads the MCLQ back with
// adt.ParseLiquids (#404). Tile 0_0's lake in chunk (2,3) becomes ocean over its top half, at sloping
// heights and varied depths, with magma over its bottom half as a second layer; its lake in (8,8) is
// removed; tile 1_0 gets new slime over part of chunk (5,2); tile 1_1's magma is handed back as read.
// Every layer reads back with its type, cells, heights and depths, the untouched magma as an unedited
// save writes it, and no other chunk gains a liquid. A partial save (a map saved before maps kept
// liquids) of the slime alone adds it and keeps the rest as the client has them.
func TestRegionLiquidsRoundTrip(t *testing.T) {
	dir := roundTripClient(t)
	view, err := ReadRegion(dir, roundTripMap, 0, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Liquids) != 3 {
		t.Fatalf("the block reads %d liquid layers, want the fixture's 3", len(view.Liquids))
	}
	base := roundTripTiles(t, dir, roundTripEdit())

	ocean := adt.Liquid{IndexX: 2, IndexY: 3, Type: adt.LiquidOcean}
	magma := adt.Liquid{IndexX: 2, IndexY: 3, Type: adt.LiquidMagma}
	for v := range ocean.Heights {
		ocean.Heights[v] = 10 + 0.25*float32(v)
		ocean.Depth[v] = uint8(v * 3)
		magma.Heights[v] = -2 - 0.5*float32(v%9)
		magma.Depth[v] = 255
	}
	for i := range ocean.Cells {
		ocean.Cells[i] = i < 32
		magma.Cells[i] = i >= 32
	}
	slime := adt.Liquid{IndexX: 16 + 5, IndexY: 2, Type: adt.LiquidSlime}
	for v := range slime.Heights {
		slime.Heights[v] = 7 + float32(v/9)*0.1
		slime.Depth[v] = 255
	}
	for i := range slime.Cells {
		slime.Cells[i] = (i/8+i%8)%3 == 0
	}
	var kept adt.Liquid
	for _, l := range view.Liquids {
		if l.IndexX == 16 && l.IndexY == 16 {
			kept = l
		}
	}
	if kept.Type != adt.LiquidMagma {
		t.Fatalf("tile 1_1 chunk (0,0) reads as %+v, not the fixture's magma", kept)
	}

	e := roundTripEdit()
	e.HasLiquids = true
	e.Liquids = []adt.Liquid{ocean, magma, slime, kept}
	got := roundTripTiles(t, dir, e)
	local := func(l adt.Liquid) adt.Liquid {
		l.IndexX %= adt.ChunksPerTile
		l.IndexY %= adt.ChunksPerTile
		return l
	}
	want := map[[2]int]map[int][]adt.Liquid{
		{0, 0}: {3*16 + 2: {local(ocean), local(magma)}},
		{1, 0}: {2*16 + 5: {local(slime)}},
		{1, 1}: liquidsAt(t, base[[2]int{1, 1}]),
	}
	if len(want[[2]int{1, 1}][0]) != 1 {
		t.Fatalf("the unedited save of tile 1_1 has %d layers in chunk (0,0), want the magma", len(want[[2]int{1, 1}][0]))
	}
	for tile, root := range got {
		have := liquidsAt(t, root)
		for k, ls := range have {
			if _, ok := want[tile][k]; !ok {
				t.Errorf("tile %v chunk %d has liquid %s it was not given", tile, k, layerNames(ls))
			}
		}
		for k, ls := range want[tile] {
			if !sameLayers(have[k], ls) {
				t.Errorf("tile %v chunk %d reads back %s, want %s (or their heights or depths differ)", tile, k, layerNames(have[k]), layerNames(ls))
			}
		}
	}

	// A partial save lists only the chunks it has layers for; the rest keep the client's own.
	e = roundTripEdit()
	e.HasLiquids, e.PartialLiquids = true, true
	e.Liquids = []adt.Liquid{slime}
	got = roundTripTiles(t, dir, e)
	for tile, root := range got {
		have := liquidsAt(t, root)
		own := liquidsAt(t, base[tile])
		if tile == [2]int{1, 0} {
			own[2*16+5] = []adt.Liquid{local(slime)}
		}
		if len(have) != len(own) {
			t.Errorf("tile %v: the partial save has liquids in %d chunks, want %d", tile, len(have), len(own))
		}
		for k, ls := range own {
			if !sameLayers(have[k], ls) {
				t.Errorf("tile %v chunk %d reads back %s after the partial save, want %s (or their heights or depths differ)", tile, k, layerNames(have[k]), layerNames(ls))
			}
		}
	}
}

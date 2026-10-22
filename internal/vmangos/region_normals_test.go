package vmangos

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
)

// hillAt is hilly ground over a made-up map's lattice samples, gx east and gy south.
func hillAt(gx, gy int) float32 {
	return float32(20*math.Sin(float64(gy)/9) + 15*math.Cos(float64(gx)/13))
}

// latticeNormal is the stored normal at outer sample (r, c) of a tile, from adt.ParseNormals.
func latticeNormal(normals [][]byte, r, c int) [3]int8 {
	cx, cy := min(c/adt.CellsPerChunk, ChunksPerTileSide-1), min(r/adt.CellsPerChunk, ChunksPerTileSide-1)
	n := normals[cy*ChunksPerTileSide+cx][((r-cy*adt.CellsPerChunk)*17+c-cx*adt.CellsPerChunk)*3:]
	return [3]int8{int8(n[0]), int8(n[1]), int8(n[2])}
}

// TestRegionNormalsMeetAcrossTiles saves hilly ground over the 2x2 block at 0_0 of a made-up map
// whose client tiles 2_0 and 2_1, east of the block, carry the same hills. The tiles store the same
// normals on both sides of every border inside the block, and the block's east edge matches the
// client tiles' west edges, its normals worked out from the client's tiles across it (#492).
func TestRegionNormalsMeetAcrossTiles(t *testing.T) {
	dir := t.TempDir()
	cut := func(tx, ty int) []float32 {
		out := make([]float32, LatticeSize*LatticeSize)
		for r := 0; r < LatticeSize; r++ {
			for c := 0; c < LatticeSize; c++ {
				out[r*LatticeSize+c] = hillAt(tx*tileCells+c, ty*tileCells+r)
			}
		}
		return out
	}
	// The map is tiles 0 to 2 east and 0 to 1 south. The tiles east of the block as a client would
	// have them: their normals across a border toward another tile of the map read the hills there.
	onMap := func(x, y int) bool { return x >= 0 && y >= 0 && x < 3 && y < 2 }
	hills := func(tx, ty int) []byte {
		x0, y0 := tx*tileCells, ty*tileCells
		var ring adt.Ring
		for _, s := range []struct {
			dx, dy int
			line   *[]float32
			at     func(k int) float32
		}{
			{0, -1, &ring.North, func(k int) float32 { return hillAt(x0+k, y0-1) }},
			{0, 1, &ring.South, func(k int) float32 { return hillAt(x0+k, y0+tileCells+1) }},
			{-1, 0, &ring.West, func(k int) float32 { return hillAt(x0-1, y0+k) }},
			{1, 0, &ring.East, func(k int) float32 { return hillAt(x0+tileCells+1, y0+k) }},
		} {
			if !onMap(tx+s.dx, ty+s.dy) {
				continue
			}
			*s.line = make([]float32, LatticeSize)
			for k := range *s.line {
				(*s.line)[k] = s.at(k)
			}
		}
		root, err := adt.BuildTile(cut(tx, ty), ring, adt.Changes{TileX: tx, TileY: ty})
		if err != nil {
			t.Fatal(err)
		}
		return root
	}
	east := map[string][]byte{"2_0": hills(2, 0), "2_1": hills(2, 1)}
	tile := func(x, y int) mpq.File {
		root, err := adt.BuildTile(flatTile(0), adt.Ring{}, adt.Changes{TileX: x, TileY: y})
		if err != nil {
			t.Fatal(err)
		}
		return mpq.File{Name: adt.TilePath("Hills", x, y, ""), Data: root}
	}
	mphd := binary.LittleEndian.AppendUint32([]byte("DHPM"), 32)
	wdt, err := BuildWDT(append(mphd, make([]byte, 32)...), onMap)
	if err != nil {
		t.Fatal(err)
	}
	files := []mpq.File{
		{Name: `World\Maps\Hills\Hills.wdt`, Data: wdt},
		tile(0, 0), tile(1, 0), tile(0, 1), tile(1, 1),
		{Name: adt.TilePath("Hills", 2, 0, ""), Data: east["2_0"]},
		{Name: adt.TilePath("Hills", 2, 1, ""), Data: east["2_1"]},
	}
	if err := os.WriteFile(filepath.Join(dir, "terrain.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}

	side := 2*tileCells + 1
	heights := make([]float32, side*side)
	for r := 0; r < side; r++ {
		for c := 0; c < side; c++ {
			heights[r*side+c] = hillAt(c, r)
		}
	}
	out, err := BuildRegion(dir, RegionEdit{MapName: "Hills", X: 0, Y: 0, Size: 2, Heights: EncodeHeights(heights)})
	if err != nil {
		t.Fatal(err)
	}
	normals := map[string][][]byte{}
	for _, f := range out {
		if name := fileTileName(f.Name); name != "" {
			if normals[name], err = adt.ParseNormals(f.Data); err != nil {
				t.Fatalf("%s: %v", f.Name, err)
			}
		}
	}
	for name, root := range east {
		if normals[name], err = adt.ParseNormals(root); err != nil {
			t.Fatal(err)
		}
	}
	last := LatticeSize - 1
	for _, b := range []struct{ a, b string }{{"0_0", "1_0"}, {"0_1", "1_1"}, {"1_0", "2_0"}, {"1_1", "2_1"}} {
		apart := 0
		for k := 0; k < LatticeSize; k++ {
			if latticeNormal(normals[b.a], k, last) != latticeNormal(normals[b.b], k, 0) {
				apart++
			}
		}
		if apart > 0 {
			t.Errorf("%d of %d samples on the border of %s and %s store different normals", apart, LatticeSize, b.a, b.b)
		}
	}
	for _, b := range []struct{ a, b string }{{"0_0", "0_1"}, {"1_0", "1_1"}} {
		apart := 0
		for k := 0; k < LatticeSize; k++ {
			if latticeNormal(normals[b.a], last, k) != latticeNormal(normals[b.b], 0, k) {
				apart++
			}
		}
		if apart > 0 {
			t.Errorf("%d of %d samples on the border of %s and %s store different normals", apart, LatticeSize, b.a, b.b)
		}
	}
}

// TestRegionNormalsReadTheInnerSamplesAcrossTiles saves a 2x2 block whose client tiles carry detail in
// their inner samples (off their corners' mean), sculpting a strip of the column just west of the
// border between 0_0 and 1_0. The cells across the border keep their detail in 1_0 and go to the mean
// in 0_0's sculpted strip, and the border's normals take in both, so the two tiles store the same
// normals along it only if each reads the other's inner samples as they will be written (#668).
func TestRegionNormalsReadTheInnerSamplesAcrossTiles(t *testing.T) {
	dir := t.TempDir()
	cut := func(tx, ty int) []float32 {
		out := make([]float32, LatticeSize*LatticeSize)
		for r := 0; r < LatticeSize; r++ {
			for c := 0; c < LatticeSize; c++ {
				out[r*LatticeSize+c] = hillAt(tx*tileCells+c, ty*tileCells+r)
			}
		}
		return out
	}
	onMap := func(x, y int) bool { return x >= 0 && y >= 0 && x < 2 && y < 2 }
	tile := func(x, y int) mpq.File {
		root, err := adt.BuildTile(cut(x, y), adt.Ring{}, adt.Changes{TileX: x, TileY: y})
		if err != nil {
			t.Fatal(err)
		}
		terrain, err := adt.ParseTerrain(root)
		if err != nil {
			t.Fatal(err)
		}
		for i := range terrain.Chunks {
			c := &terrain.Chunks[i]
			for r := 0; r < adt.CellsPerChunk; r++ {
				for col := 0; col < adt.CellsPerChunk; col++ {
					c.Heights[r*17+9+col] += float32(2 * math.Sin(float64(c.IndexY*8+r)+float64(c.IndexX*8+col)*1.7))
				}
			}
		}
		if root, err = adt.WriteHeights(root, terrain, nil); err != nil {
			t.Fatal(err)
		}
		return mpq.File{Name: adt.TilePath("Hills", x, y, ""), Data: root}
	}
	mphd := binary.LittleEndian.AppendUint32([]byte("DHPM"), 32)
	wdt, err := BuildWDT(append(mphd, make([]byte, 32)...), onMap)
	if err != nil {
		t.Fatal(err)
	}
	files := []mpq.File{{Name: `World\Maps\Hills\Hills.wdt`, Data: wdt}, tile(0, 0), tile(1, 0), tile(0, 1), tile(1, 1)}
	if err := os.WriteFile(filepath.Join(dir, "terrain.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}

	side := 2*tileCells + 1
	heights := make([]float32, side*side)
	for r := 0; r < side; r++ {
		for c := 0; c < side; c++ {
			heights[r*side+c] = hillAt(c, r)
		}
	}
	for r := 20; r < 60; r++ {
		heights[r*side+tileCells-1] += 3
	}
	out, err := BuildRegion(dir, RegionEdit{MapName: "Hills", X: 0, Y: 0, Size: 2, Heights: EncodeHeights(heights)})
	if err != nil {
		t.Fatal(err)
	}
	normals := map[string][][]byte{}
	for _, f := range out {
		if name := fileTileName(f.Name); name != "" {
			if normals[name], err = adt.ParseNormals(f.Data); err != nil {
				t.Fatalf("%s: %v", f.Name, err)
			}
		}
	}
	if normals["0_0"] == nil || normals["1_0"] == nil {
		t.Fatalf("the save wrote %d tiles, not 0_0 and 1_0", len(normals))
	}
	// The client tiles' own border normals are one-sided, so only the chunks the save redoes on both
	// sides are compared: rows 16 to 63, chunks 2 to 7, around the strip.
	last := LatticeSize - 1
	apart := 0
	for k := 16; k < 64; k++ {
		if latticeNormal(normals["0_0"], k, last) != latticeNormal(normals["1_0"], k, 0) {
			apart++
		}
	}
	if apart > 0 {
		t.Errorf("%d of 48 samples on the border of 0_0 and 1_0 store different normals", apart)
	}
}

// TestRegionNormalsReachTheTilesBeside saves the 2x2 block at 0_0 of a made-up map of hills whose
// client tiles 2_0 and 2_1 lie east of it (#666). An unedited save writes neither. Sculpting the
// block's column one in from its east edge (255) redoes their west border normals to match the
// block's east edge, keeping their heights and their other normals; a model added by the edge makes
// 2_0 written once, with both. Compiled into the patch, the same edit writes no tile outside again.
func TestRegionNormalsReachTheTilesBeside(t *testing.T) {
	dir := t.TempDir()
	onMap := func(x, y int) bool { return x >= 0 && y >= 0 && x < 3 && y < 2 }
	// hills is a tile as a client would have it, its border normals read from the map's other tiles.
	hills := func(tx, ty int) mpq.File {
		x0, y0 := tx*tileCells, ty*tileCells
		outer := make([]float32, LatticeSize*LatticeSize)
		for r := 0; r < LatticeSize; r++ {
			for c := 0; c < LatticeSize; c++ {
				outer[r*LatticeSize+c] = hillAt(x0+c, y0+r)
			}
		}
		var ring adt.Ring
		for _, s := range []struct {
			dx, dy int
			line   *[]float32
			at     func(k int) float32
		}{
			{0, -1, &ring.North, func(k int) float32 { return hillAt(x0+k, y0-1) }},
			{0, 1, &ring.South, func(k int) float32 { return hillAt(x0+k, y0+tileCells+1) }},
			{-1, 0, &ring.West, func(k int) float32 { return hillAt(x0-1, y0+k) }},
			{1, 0, &ring.East, func(k int) float32 { return hillAt(x0+tileCells+1, y0+k) }},
		} {
			if !onMap(tx+s.dx, ty+s.dy) {
				continue
			}
			*s.line = make([]float32, LatticeSize)
			for k := range *s.line {
				(*s.line)[k] = s.at(k)
			}
		}
		root, err := adt.BuildTile(outer, ring, adt.Changes{TileX: tx, TileY: ty})
		if err != nil {
			t.Fatal(err)
		}
		return mpq.File{Name: adt.TilePath("Hills", tx, ty, ""), Data: root}
	}
	mphd := binary.LittleEndian.AppendUint32([]byte("DHPM"), 32)
	wdt, err := BuildWDT(append(mphd, make([]byte, 32)...), onMap)
	if err != nil {
		t.Fatal(err)
	}
	files := []mpq.File{{Name: `World\Maps\Hills\Hills.wdt`, Data: wdt}}
	client := map[string][]byte{}
	for ty := 0; ty < 2; ty++ {
		for tx := 0; tx < 3; tx++ {
			f := hills(tx, ty)
			files = append(files, f)
			client[fileTileName(f.Name)] = f.Data
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "terrain.MPQ"), mpq.Write(files), 0o644); err != nil {
		t.Fatal(err)
	}

	side := 2*tileCells + 1
	heights := make([]float32, side*side)
	for r := 0; r < side; r++ {
		for c := 0; c < side; c++ {
			heights[r*side+c] = hillAt(c, r)
		}
	}
	byName := func(out []mpq.File) map[string][]byte {
		m := map[string][]byte{}
		for _, f := range out {
			if name := fileTileName(f.Name); name != "" {
				if _, twice := m[name]; twice {
					t.Fatalf("the save wrote %s twice", name)
				}
				m[name] = f.Data
			}
		}
		return m
	}
	edit := RegionEdit{MapName: "Hills", X: 0, Y: 0, Size: 2, Heights: EncodeHeights(heights)}
	out, err := BuildRegion(dir, edit)
	if err != nil {
		t.Fatal(err)
	}
	if got := byName(out); got["2_0"] != nil || got["2_1"] != nil {
		t.Fatal("an unedited save wrote a tile outside the block")
	}

	for r := 1; r < side-1; r++ {
		heights[r*side+side-2] += 3
	}
	edit.Heights = EncodeHeights(heights)
	edit.Objects = []ObjectView{{Type: `m2:World\Test\Rock.m2`, X: 2*adt.TileSize - 4, Z: 100, Scale: 1}}
	out, err = BuildRegion(dir, edit)
	if err != nil {
		t.Fatal(err)
	}
	got := byName(out)
	last := LatticeSize - 1
	for _, b := range []struct{ in, beside string }{{"1_0", "2_0"}, {"1_1", "2_1"}} {
		root := got[b.beside]
		if root == nil {
			t.Fatalf("the save didn't write %s, beside the sculpted column", b.beside)
		}
		inside, err := adt.ParseNormals(got[b.in])
		if err != nil {
			t.Fatal(err)
		}
		normals, err := adt.ParseNormals(root)
		if err != nil {
			t.Fatal(err)
		}
		apart := 0
		for k := 0; k < LatticeSize; k++ {
			if latticeNormal(inside, k, last) != latticeNormal(normals, k, 0) {
				apart++
			}
		}
		if apart > 0 {
			t.Errorf("%d of %d samples on the border of %s and %s store different normals", apart, LatticeSize, b.in, b.beside)
		}
		was, err := adt.ParseNormals(client[b.beside])
		if err != nil {
			t.Fatal(err)
		}
		before, err := adt.ParseTerrain(client[b.beside])
		if err != nil {
			t.Fatal(err)
		}
		after, err := adt.ParseTerrain(root)
		if err != nil {
			t.Fatal(err)
		}
		redone := 0
		for i, c := range after.Chunks {
			if c.Heights != before.Chunks[i].Heights {
				t.Fatalf("%s chunk %d's heights changed", b.beside, i)
			}
			if string(normals[i]) == string(was[i]) {
				continue
			}
			if c.IndexX != 0 {
				t.Fatalf("%s chunk %d,%d off the block's border changed its normals", b.beside, c.IndexX, c.IndexY)
			}
			redone++
		}
		if redone == 0 {
			t.Fatalf("%s kept every normal", b.beside)
		}
	}
	placed, err := adt.ParsePlacements(got["2_0"])
	if err != nil {
		t.Fatal(err)
	}
	if len(placed) != 1 {
		t.Fatalf("2_0 lists %d models, want the one added by its edge", len(placed))
	}

	if _, err := InstallPatch(dir, out); err != nil {
		t.Fatal(err)
	}
	if _, res, err := RegionChanges(dir, edit); err != nil || res.Files != 0 {
		t.Fatalf("the same edit again changes %d files (%v, err %v), want none", res.Files, res.ChangedTiles, err)
	}
	out, err = BuildRegion(dir, edit)
	if err != nil {
		t.Fatal(err)
	}
	if got := byName(out); got["2_1"] != nil {
		t.Fatal("the same edit from the patch wrote 2_1 again")
	}
}

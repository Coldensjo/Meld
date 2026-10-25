package vmangos

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"math"
	"path/filepath"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

func TestPlacementRoundTrip(t *testing.T) {
	p := adt.Placement{
		Kind:     adt.M2,
		Name:     `World\Azeroth\Tree.m2`,
		UID:      7,
		Position: [3]float32{33*adt.TileSize + 40, 120, 48*adt.TileSize + 90},
		Rotation: [3]float32{0, 120, 0},
		Scale:    1.5,
	}
	const x, y = 32, 47
	e := RegionEdit{X: x, Y: y, Size: 2}
	o, ok := objectView(p, x, y)
	if !ok {
		t.Fatal("an M2 placement must convert")
	}
	if math.Abs(float64(o.RotY)-30*math.Pi/180) > 1e-5 {
		t.Fatalf("yaw 120 should read as 30 degrees, got %v radians", o.RotY)
	}
	if !unchanged(o, e, p) {
		t.Fatal("a placement read from a file must be unchanged")
	}
	back, err := placementFromView(o, e, &p)
	if err != nil {
		t.Fatal(err)
	}
	if back.Position != p.Position || back.Rotation != p.Rotation || back.Scale != p.Scale || back.Name != `World\Azeroth\Tree.m2` {
		t.Fatalf("round trip changed the placement: %+v", back)
	}
}

func TestEditedPlacementKeepsTilt(t *testing.T) {
	orig := adt.Placement{
		Kind:     adt.WMO,
		Name:     `World\wmo\House.wmo`,
		UID:      9,
		Position: [3]float32{100, 50, 200},
		Rotation: [3]float32{10, 90, 5},
		Scale:    1,
		NameSet:  2,
	}
	e := RegionEdit{Size: 1}
	o, _ := objectView(orig, 0, 0)
	o.RotY = float32(180 * math.Pi / 180)
	if unchanged(o, e, orig) {
		t.Fatal("a turned model is an edit")
	}
	obj, err := placementFromView(o, e, &orig)
	if err != nil {
		t.Fatal(err)
	}
	if obj.Rotation[0] != 10 || obj.Rotation[2] != 5 {
		t.Fatalf("tilt was lost: rotation %v", obj.Rotation)
	}
	if obj.Rotation[1] != 270 {
		t.Fatalf("yaw should be 180+90, got %v", obj.Rotation[1])
	}
	if obj.NameSet != 2 {
		t.Fatalf("WMO name set was lost: %d", obj.NameSet)
	}
}

func TestMovedPlacementIsEdited(t *testing.T) {
	orig := adt.Placement{Kind: adt.M2, Name: `World\Tree.m2`, Position: [3]float32{10, 20, 30}, Rotation: [3]float32{0, 90, 0}, Scale: 1}
	o, _ := objectView(orig, 0, 0)
	o.X += 1
	if unchanged(o, RegionEdit{Size: 1}, orig) {
		t.Fatal("a moved model is an edit")
	}
}

func TestNewObjectGoesToItsTile(t *testing.T) {
	e := RegionEdit{Size: 3}
	o := ObjectView{Type: "m2:x.m2", X: 2.5 * adt.TileSize, Z: 0.5 * adt.TileSize}
	if got := tileOf(o, e.Size); got != 0*3+2 {
		t.Fatalf("tile index %d, want column 2 of row 0", got)
	}
	o.X = -50
	if got := tileOf(o, e.Size); got != 0 {
		t.Fatalf("an object left of the block belongs to its first tile, got %d", got)
	}
}

// TestRegionPending is what Launch asks before it starts the game for a region opened from a file
// (#214): one raised vertex makes its tile differ from the client's. (An unedited block can differ too,
// when the client has never had the tile compiled, since the builder orders an MCNK's subchunks its own
// way; TestClientWMOOnlyRegion has the unchanged case.) It needs WOW_DIR.
func TestRegionPending(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 29, 51, 1)
	if err != nil {
		t.Fatal(err)
	}
	raised := append([]float32(nil), view.Heights...)
	raised[len(raised)/2] += 5
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(raised), Objects: view.Objects}
	_, res, err := RegionChanges(dataDir, edit)
	if err != nil || res.Files < 1 || res.Changed != 1 || len(res.ChangedTiles) != 1 || res.ChangedTiles[0] != "29_51" || res.MapID != 0 {
		t.Fatalf("raised: %+v, %v", res, err)
	}
}

// TestRegionNoEditRoundTrip reads a real region of the client and writes it back unedited. The
// placements and heights must come out as they went in. It needs WOW_DIR set to the client.
func TestRegionNoEditRoundTrip(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 2)
	if err != nil {
		t.Fatal(err)
	}
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights), Objects: view.Objects}
	files, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	// The block's tiles come first and the WDL last. Between them sit the tiles outside the block that
	// list a model an earlier compile moved (#647), so their number depends on the client's patch.
	if len(files) < 5 || files[len(files)-1].Name != wdlPath("Azeroth") {
		t.Fatalf("a 2x2 region writes 4 tiles and the WDL, got %d files", len(files))
	}
	for k, f := range files[:len(files)-1] {
		inBlock := k < view.Size*view.Size
		isBlockTile := false
		for j := 0; j < view.Size; j++ {
			for i := 0; i < view.Size; i++ {
				isBlockTile = isBlockTile || strings.EqualFold(f.Name, adt.TilePath("Azeroth", view.X+i, view.Y+j, ""))
			}
		}
		if inBlock != isBlockTile || !strings.EqualFold(filepath.Ext(f.Name), ".adt") {
			t.Fatalf("file %d is %s: the block's 4 tiles come first, then only tiles outside it", k, f.Name)
		}
	}
	wdl := files[len(files)-1]
	// The same edit builds the same bytes, so a save with nothing edited finds every file unchanged.
	twice, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	for k := range files {
		if !bytes.Equal(files[k].Data, twice[k].Data) {
			t.Fatalf("%s differs between two builds of the same edit", files[k].Name)
		}
	}
	// The block's horizon is sampled from its heights, and the rest of the map's is the client's.
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	before, err := set.ReadFile(wdlPath("Azeroth"))
	set.Close()
	if err != nil {
		t.Fatal(err)
	}
	was, err := ParseWDL(before)
	if err != nil {
		t.Fatal(err)
	}
	now, err := ParseWDL(wdl.Data)
	if err != nil {
		t.Fatal(err)
	}
	if len(now) != len(was) {
		t.Fatalf("the WDL has %d tiles, the client's %d", len(now), len(was))
	}
	for k, h := range was {
		x, y := k%MapTiles-view.X, k/MapTiles-view.Y
		want := *h
		if x >= 0 && y >= 0 && x < view.Size && y < view.Size {
			stride := view.Size*tileCells + 1
			want = *WDLTileOf(view.Heights[y*tileCells*stride+x*tileCells:], stride)
		}
		if *now[k] != want {
			t.Fatalf("tile %d's horizon is not the one expected", k)
		}
	}
	// Each tile's heights must sit at its place in the stitched block, checked against a tile read on its own.
	side := view.Size*tileCells + 1
	for k := 0; k < view.Size*view.Size; k++ {
		i, j := k%view.Size, k/view.Size
		tile, _, err := ReadTile(dataDir, "Azeroth", view.X+i, view.Y+j)
		if err != nil {
			t.Fatal(err)
		}
		for r := 0; r < LatticeSize; r++ {
			for c := 0; c < LatticeSize; c++ {
				got := view.Heights[(j*tileCells+r)*side+i*tileCells+c]
				if got != tile.Heights[r*LatticeSize+c] {
					t.Fatalf("tile %d,%d sample %d,%d: block has %v, tile has %v", i, j, r, c, got, tile.Heights[r*LatticeSize+c])
				}
			}
		}
	}
	for k, f := range files[:view.Size*view.Size] {
		i, j := k%view.Size, k/view.Size
		tx, ty := view.X+i, view.Y+j
		original, err := BaseTileRoot(dataDir, "Azeroth", tx, ty)
		if err != nil {
			t.Fatal(err)
		}
		after, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatal(err)
		}
		// Each model written must be one the editor showed, at the same place and turn. A tile's
		// patch can hold models the original lacks (an earlier export), so the editor's view is the
		// reference, not the original file.
		for _, p := range after {
			found := false
			for _, o := range view.Objects {
				if o.Type == adt.ModelType(p.Kind, p.Name, p.DoodadSet) {
					if math.Abs(float64(o.X+float32(view.X)*adt.TileSize-p.Position[0])) < 0.05 &&
						math.Abs(float64(o.Z+float32(view.Y)*adt.TileSize-p.Position[2])) < 0.05 {
						found = true
						break
					}
				}
			}
			if !found {
				t.Fatalf("tile %d_%d: model %d at %v was not in the editor's view", tx, ty, p.UID, p.Position)
			}
		}
		// The write's outer heights are the editor's, and each inner sample moves by the average
		// change of the four outer samples around it, from the original tile. A cell whose corners
		// the editor's view moved off the original (an edit Meld's patch already holds, #631) is a
		// sculpted cell, and its inner sample sits at its corners' mean (#380).
		base, err := adt.ParseTerrain(original)
		if err != nil {
			t.Fatal(err)
		}
		written, err := adt.ParseTerrain(f.Data)
		if err != nil {
			t.Fatal(err)
		}
		side := view.Size*tileCells + 1
		for c := range base.Chunks {
			cb, cw := base.Chunks[c], written.Chunks[c]
			var delta [adt.CellsPerChunk + 1][adt.CellsPerChunk + 1]float64
			for r := 0; r <= adt.CellsPerChunk; r++ {
				for col := 0; col <= adt.CellsPerChunk; col++ {
					gr := j*tileCells + cb.IndexY*adt.CellsPerChunk + r
					gc := i*tileCells + cb.IndexX*adt.CellsPerChunk + col
					want := float64(view.Heights[gr*side+gc])
					got := float64(cw.Heights[r*17+col])
					if math.Abs(got-want) > 1e-3 {
						t.Fatalf("tile %d_%d chunk %d outer %d,%d: wrote %v, editor has %v", tx, ty, c, r, col, got, want)
					}
					delta[r][col] = want - float64(cb.Heights[r*17+col])
				}
			}
			for r := 0; r < adt.CellsPerChunk; r++ {
				for col := 0; col < adt.CellsPerChunk; col++ {
					avg := (delta[r][col] + delta[r][col+1] + delta[r+1][col] + delta[r+1][col+1]) / 4
					want := float64(cb.Heights[r*17+9+col]) + avg
					for _, d := range [4]float64{delta[r][col], delta[r][col+1], delta[r+1][col], delta[r+1][col+1]} {
						if sculpted(float32(d)) {
							h := &cw.Heights
							want = float64((h[r*17+col] + h[r*17+col+1] + h[(r+1)*17+col] + h[(r+1)*17+col+1]) / 4)
							break
						}
					}
					if math.Abs(float64(cw.Heights[r*17+9+col])-want) > 1e-3 {
						t.Fatalf("tile %d_%d chunk %d inner %d,%d: wrote %v, want %v", tx, ty, c, r, col, cw.Heights[r*17+9+col], want)
					}
				}
			}
		}
	}
	// A model the tiles list by a border is one model in the editor (#646).
	written := map[uint32]bool{}
	for _, f := range files[:view.Size*view.Size] {
		placements, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range placements {
			written[p.UID] = true
		}
	}
	if len(written) != len(view.Objects) {
		t.Fatalf("models written: %d, shown in the editor: %d", len(written), len(view.Objects))
	}
}

// TestRegionMoveRoundTrip moves one model of a real region and checks that the write puts it at
// the new place, under the same unique ID and with its tilt kept. It needs WOW_DIR set.
func TestRegionMoveRoundTrip(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Objects) == 0 {
		t.Skip("no models in the region")
	}
	moved := view.Objects[0]
	moved.X += 5
	objects := append([]ObjectView{moved}, view.Objects[1:]...)
	files, err := BuildRegion(dataDir, RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights), Objects: objects})
	if err != nil {
		t.Fatal(err)
	}
	placements, err := adt.ParsePlacements(files[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range placements {
		if p.UID != moved.UID {
			continue
		}
		want := view.Objects[0].X + 5 + float32(view.X)*adt.TileSize
		if math.Abs(float64(p.Position[0]-want)) > 0.01 {
			t.Fatalf("model %d at x %v, want %v", p.UID, p.Position[0], want)
		}
		_, original, err := ReadTile(dataDir, "Azeroth", view.X, view.Y)
		if err != nil {
			t.Fatal(err)
		}
		before, err := adt.ParsePlacements(original)
		if err != nil {
			t.Fatal(err)
		}
		for _, q := range before {
			if q.UID == moved.UID && (q.Rotation[0] != p.Rotation[0] || q.Rotation[2] != p.Rotation[2]) {
				t.Fatalf("model %d lost its tilt: %v became %v", p.UID, q.Rotation, p.Rotation)
			}
		}
		return
	}
	t.Fatalf("model %d is missing after the move", moved.UID)
}

// TestRegionReadsWater reads a client tile with ocean (tile 29_44 of Azeroth) and checks its water
// comes through in the block's chunk indexes. It needs WOW_DIR set to the client.
func TestRegionReadsWater(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 29, 44, 1)
	if err != nil {
		t.Fatal(err)
	}
	ocean := 0
	for _, l := range view.Liquids {
		if l.IndexX < 0 || l.IndexX >= 16 || l.IndexY < 0 || l.IndexY >= 16 {
			t.Fatalf("liquid chunk %d,%d is outside the block", l.IndexX, l.IndexY)
		}
		if l.Type == adt.LiquidOcean {
			ocean++
		}
	}
	if ocean < 100 {
		t.Fatalf("expected the ocean's chunks, got %d of %d liquid chunks", ocean, len(view.Liquids))
	}
}

// TestRegionPaintWritten paints the first chunk of a real tile with one texture and checks the
// written tile names it. It needs WOW_DIR set to the client.
func TestRegionPaintWritten(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	const texture = `Tileset\Elwynn\ElwynnGrass01.blp`
	weights := make([]byte, 32*32*4)
	for i := 0; i < len(weights); i += 4 {
		weights[i] = 255
	}
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights), Objects: view.Objects,
		Paint: []RegionPaint{{Chunk: 0, Textures: []string{texture}, Weights: base64.StdEncoding.EncodeToString(weights)}}}
	files, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := adt.ParseTerrain(files[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	tex, err := adt.ParseTextures(files[0].Data, adt.ReadBigAlpha(nil), terrain)
	if err != nil {
		t.Fatal(err)
	}
	if got := tex.Chunks[0].Layers[0].Texture; got != texture {
		t.Fatalf("chunk 0 base texture %q, want %q", got, texture)
	}
}

// TestBaseRegionPaintSkipsMeldsPatch reads a 2x2 block's paint without Meld's patch: each tile's
// layers and alpha maps must be the ones BaseTileRoot's file has, placed in the block as ReadRegion
// places them (#645). It needs WOW_DIR set to the client.
func TestBaseRegionPaintSkipsMeldsPatch(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	const x, y, size = 32, 48, 2
	view, err := ReadBaseRegionPaint(dataDir, "Azeroth", x, y, size)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Chunks) != size*size*adt.ChunkCount {
		t.Fatalf("%d chunks, want %d", len(view.Chunks), size*size*adt.ChunkCount)
	}
	at, c := 0, 0
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			root, err := BaseTileRoot(dataDir, "Azeroth", x+i, y+j)
			if err != nil {
				t.Fatal(err)
			}
			tile, err := viewOf(root, false)
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range tile.Chunks {
				got := view.Chunks[c]
				c++
				if got.IndexX != want.IndexX+i*adt.ChunksPerTile || got.IndexY != want.IndexY+j*adt.ChunksPerTile {
					t.Fatalf("tile %d,%d chunk %d,%d placed at %d,%d", i, j, want.IndexX, want.IndexY, got.IndexX, got.IndexY)
				}
				if len(got.Layers) != len(want.Layers) {
					t.Fatalf("tile %d,%d chunk %d,%d: %d layers, the base tile has %d", i, j, want.IndexX, want.IndexY, len(got.Layers), len(want.Layers))
				}
				for k := range want.Layers {
					if got.Layers[k] != want.Layers[k] {
						t.Fatalf("tile %d,%d chunk %d,%d layer %d: %+v, the base tile has %+v", i, j, want.IndexX, want.IndexY, k, got.Layers[k], want.Layers[k])
					}
				}
			}
			if !bytes.Equal(view.Alpha[at:at+len(tile.Alpha)], tile.Alpha) {
				t.Fatalf("tile %d,%d: the alpha maps are not the base tile's", i, j)
			}
			at += len(tile.Alpha)
		}
	}
	if at != len(view.Alpha) {
		t.Fatalf("the view has %d alpha bytes, its tiles %d", len(view.Alpha), at)
	}
}

// TestRegionUnpaintedChunksKeepClientAlpha sends every chunk of a real tile back with the weights the
// editor reads from it (ClientWeights, which tileImport.test.ts pins to tilePaint), as Compile does:
// the tile must come out as the same save without paint writes it, byte for byte, where before #526
// every chunk's alpha came back at half resolution. It needs WOW_DIR set to the client.
func TestRegionUnpaintedChunksKeepClientAlpha(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	// The save starts from the tile without Meld's patch, which the editor's weights are compared to.
	root, err := BaseTileRoot(dataDir, "Azeroth", 32, 48)
	if err != nil {
		t.Fatal(err)
	}
	own, err := ownTextures(root, false)
	if err != nil {
		t.Fatal(err)
	}
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights), Objects: view.Objects}
	plain, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	layered := 0
	for i := 0; i < adt.ChunkCount; i++ {
		c := own[i]
		var textures []string
		var effects []uint32
		for _, l := range c.Layers {
			textures = append(textures, l.Texture)
			effects = append(effects, l.Effect)
		}
		if len(textures) > 1 {
			layered++
		}
		weights := adt.ClientWeights(c, 32)
		edit.Paint = append(edit.Paint, RegionPaint{Chunk: i/16*16 + i%16, Textures: textures, Effects: effects, Weights: base64.StdEncoding.EncodeToString(weights)})
	}
	if layered < 100 {
		t.Fatalf("only %d chunks of the tile have more than one layer", layered)
	}
	files, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(files[0].Data, plain[0].Data) {
		t.Fatal("unpainted chunks changed the tile")
	}
}

// TestRegionHeadersWritten sets a real chunk's zone, impassable flag, no-effect bits and holes through a region save: they
// must read back, and every other chunk keep the zone, flags and heights the same save without them
// writes. It needs WOW_DIR set to
// the client.
func TestRegionHeadersWritten(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	// The same save without headers, which the one with them is compared against.
	plain, err := BuildRegion(dataDir, RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights), Objects: view.Objects})
	if err != nil {
		t.Fatal(err)
	}
	before, err := adt.ParseTerrain(plain[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	// Block chunk 17 is the tile's chunk (1, 1).
	impassable := true
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights), Objects: view.Objects,
		Headers: []HeaderSpec{{Chunk: 17, AreaID: 40, Impassable: &impassable, NoEffect: []int{3, 0, 0, 0, 0, 0, 0, 0x80}, Holes: []int{0, 0, 0, 0, 0, 0, 1, 0}}}}
	files, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	after, err := adt.ParseTerrain(files[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	for i, c := range after.Chunks {
		b := before.Chunks[i]
		if c.Heights != b.Heights {
			t.Fatalf("chunk %d heights changed", i)
		}
		if i == 17 {
			if c.AreaID != 40 || !c.Impassable() || c.Flags&^0x2 != b.Flags&^0x2 {
				t.Fatalf("chunk 17: area %d, flags %#x (was %#x)", c.AreaID, c.Flags, b.Flags)
			}
			if c.NoEffect != [adt.CellsPerChunk]uint8{3, 0, 0, 0, 0, 0, 0, 0x80} {
				t.Fatalf("chunk 17 no-effect rows %v", c.NoEffect)
			}
			// Cell (0, 6) cuts its whole 2x2 block, as the client keeps holes.
			if c.Holes != [adt.CellsPerChunk]uint8{0, 0, 0, 0, 0, 0, 3, 3} {
				t.Fatalf("chunk 17 holes %v", c.Holes)
			}
			continue
		}
		if c.AreaID != b.AreaID || c.Flags != b.Flags || c.NoEffect != b.NoEffect || c.Holes != b.Holes {
			t.Fatalf("chunk %d: area %d flags %#x, was %d %#x", i, c.AreaID, c.Flags, b.AreaID, b.Flags)
		}
	}
}

// TestRegionHolesRoundTrip sends a real region's holes back as the editor does (every chunk's cell
// rows in its header): every chunk must keep the hole bits the client has. It needs WOW_DIR set.
func TestRegionHolesRoundTrip(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Westfall around the Deadmines, which has cave mouths.
	view, err := ReadRegion(dataDir, "Azeroth", 31, 49, 2)
	if err != nil {
		t.Fatal(err)
	}
	perRow := ChunksPerTileSide * view.Size
	var headers []HeaderSpec
	holed := 0
	for _, c := range view.Chunks {
		rows := c.Holes
		if rows == nil {
			rows = make([]int, adt.CellsPerChunk)
		} else {
			holed++
		}
		headers = append(headers, HeaderSpec{Chunk: c.IndexY*perRow + c.IndexX, Holes: rows})
	}
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: EncodeHeights(view.Heights), Objects: view.Objects, Headers: headers}
	files, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	// The same save without headers: headers with holes alone, as a map without chunk data of its own
	// sends them (#644), must leave every chunk's zone, flags and no-tuft cells as that one has them.
	edit.Headers = nil
	plain, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	for k, f := range files[:view.Size*view.Size] {
		after, err := adt.ParseTerrain(f.Data)
		if err != nil {
			t.Fatal(err)
		}
		_, root, err := ReadTile(dataDir, "Azeroth", view.X+k%view.Size, view.Y+k/view.Size)
		if err != nil {
			t.Fatal(err)
		}
		before, err := adt.ParseTerrain(root)
		if err != nil {
			t.Fatal(err)
		}
		without, err := adt.ParseTerrain(plain[k].Data)
		if err != nil {
			t.Fatal(err)
		}
		for i := range after.Chunks {
			a, b, w := after.Chunks[i], before.Chunks[i], without.Chunks[i]
			if a.Holes != b.Holes {
				t.Fatalf("tile %d chunk %d holes %v, client %v", k, i, a.Holes, b.Holes)
			}
			if a.AreaID != w.AreaID || a.Flags != w.Flags || a.NoEffect != w.NoEffect {
				t.Fatalf("tile %d chunk %d: area %d flags %#x no-tufts %v, without headers %d %#x %v", k, i, a.AreaID, a.Flags, a.NoEffect, w.AreaID, w.Flags, w.NoEffect)
			}
		}
	}
	t.Logf("%d chunks with holes kept", holed)
}

// TestRegionLiquidsUnchanged reads a real tile's liquids, as a region opens them, and hands them back:
// no chunk may count as changed, so a save keeps the client's own liquid bytes. It needs WOW_DIR set
// to the client.
func TestRegionLiquidsUnchanged(t *testing.T) {
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	root, err := set.ReadFile(adt.TilePath("Azeroth", 32, 48, ""))
	if err != nil {
		t.Fatal(err)
	}
	want, err := liquidsByChunk(view.Liquids, adt.ChunksPerTile)
	if err != nil {
		t.Fatal(err)
	}
	var ch adt.Changes
	if err := changeLiquids(&ch, root, want, 0, 0, adt.ChunksPerTile, false); err != nil {
		t.Fatal(err)
	}
	if len(view.Liquids) == 0 {
		t.Fatal("Elwynn's tile 32_48 has no liquids; pick a tile with a lake")
	}
	if len(ch.Liquids) != 0 {
		t.Fatalf("%d chunks count as changed though nothing was edited", len(ch.Liquids))
	}
	// Dropping every liquid changes exactly the chunks that had one.
	ch = adt.Changes{}
	if err := changeLiquids(&ch, root, nil, 0, 0, adt.ChunksPerTile, false); err != nil {
		t.Fatal(err)
	}
	if len(ch.Liquids) != len(want) {
		t.Fatalf("removing the liquids changed %d chunks, want %d", len(ch.Liquids), len(want))
	}
	// A partial save without layers changes nothing.
	ch = adt.Changes{}
	if err := changeLiquids(&ch, root, nil, 0, 0, adt.ChunksPerTile, true); err != nil {
		t.Fatal(err)
	}
	if len(ch.Liquids) != 0 {
		t.Fatalf("a partial save with no layers changed %d chunks", len(ch.Liquids))
	}
}

func TestFileTileName(t *testing.T) {
	for in, want := range map[string]string{
		`World\Maps\Azeroth\Azeroth_32_48.adt`: "32_48",
		`World\Maps\Azeroth\Azeroth.wdt`:       "",
		`World\Maps\Azeroth\Azeroth.wdl`:       "",
	} {
		if got := fileTileName(in); got != want {
			t.Errorf("fileTileName(%q) = %q, want %q", in, got, want)
		}
	}
	entries := []MapEntry{{ID: 0, Dir: "Azeroth"}, {ID: 30, Dir: "PVPZone01"}}
	if id, ok := mapIDByDir(entries, "pvpzone01"); !ok || id != 30 {
		t.Errorf("mapIDByDir(pvpzone01) = %d, %v", id, ok)
	}
	if _, ok := mapIDByDir(entries, "MyMap"); ok {
		t.Error("mapIDByDir(MyMap) found a map")
	}
}

// TestHeightsBase64 round-trips RegionEdit's heights through their bridge encoding, the one the
// editor's bytesToBase64 of a Float32Array gives (#531), and rejects a cut-off one.
func TestHeightsBase64(t *testing.T) {
	h := []float32{0, -1.5, 123.25, float32(math.Inf(1)), 1e-7}
	got, err := DecodeHeights(EncodeHeights(h))
	if err != nil || len(got) != len(h) {
		t.Fatalf("decoded %v, %v", got, err)
	}
	for i := range h {
		if got[i] != h[i] {
			t.Fatalf("height %d: %v, want %v", i, got[i], h[i])
		}
	}
	// 1.0 as a little-endian float32 is 00 00 80 3f.
	if s := EncodeHeights([]float32{1}); s != base64.StdEncoding.EncodeToString([]byte{0, 0, 0x80, 0x3f}) {
		t.Fatalf("1.0 encodes as %q", s)
	}
	if _, err := DecodeHeights(base64.StdEncoding.EncodeToString([]byte{1, 2, 3})); err == nil {
		t.Fatal("3 bytes decoded as heights")
	}
}

// TestHeightGridJSON checks RegionView's heights and a TileSpec's Outer cross the bridge as a base64
// string, not as an array of numbers, and read back the same (#632).
func TestHeightGridJSON(t *testing.T) {
	view := RegionView{Heights: HeightGrid{1, -2.5}}
	b, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	want := `"heights":"` + EncodeHeights([]float32{1, -2.5}) + `"`
	if !bytes.Contains(b, []byte(want)) {
		t.Fatalf("view JSON %s lacks %s", b, want)
	}
	var spec MapSpec
	in := `{"Tiles":[{"X":1,"Y":2,"Outer":"` + EncodeHeights([]float32{3, 4.75}) + `"},{"X":0,"Y":0,"Outer":null}]}`
	if err := json.Unmarshal([]byte(in), &spec); err != nil {
		t.Fatal(err)
	}
	if o := spec.Tiles[0].Outer; len(o) != 2 || o[0] != 3 || o[1] != 4.75 {
		t.Fatalf("Outer read as %v", o)
	}
	if spec.Tiles[1].Outer != nil {
		t.Fatalf("null Outer read as %v", spec.Tiles[1].Outer)
	}
	if err := json.Unmarshal([]byte(`{"Tiles":[{"Outer":[1,2]}]}`), &spec); err == nil {
		t.Fatal("an array of numbers read as Outer")
	}
}

// TestHeaderSpecImpassableOptional checks that a header without "impassable" (a map without chunk
// data of its own, which sends only holes and shadows, #644) keeps the chunk's flag, while false
// clears it.
func TestHeaderSpecImpassableOptional(t *testing.T) {
	var specs []HeaderSpec
	if err := json.Unmarshal([]byte(`[{"chunk":1,"areaId":0,"holes":[1,0,0,0,0,0,0,0]},{"chunk":2,"areaId":0,"holes":[1,0,0,0,0,0,0,0],"holesAdd":true},{"chunk":2,"areaId":5,"impassable":false},{"chunk":3,"areaId":5,"impassable":true}]`), &specs); err != nil {
		t.Fatal(err)
	}
	if h := specs[0].chunkHeader(); h.Impassable != nil || h.AreaID != 0 || h.Holes == nil || h.HolesAdd {
		t.Fatalf("holes-only header: %+v", h)
	}
	// A map that doesn't know the client's holes adds its own to them (#663).
	if h := specs[1].chunkHeader(); h.Holes == nil || !h.HolesAdd {
		t.Fatalf("added holes: %+v", h)
	}
	specs = specs[1:]
	if h := specs[1].chunkHeader(); h.Impassable == nil || *h.Impassable {
		t.Fatalf("impassable false read as %v", h.Impassable)
	}
	if h := specs[2].chunkHeader(); h.Impassable == nil || !*h.Impassable {
		t.Fatalf("impassable true read as %v", h.Impassable)
	}
	b, err := json.Marshal(HeaderSpec{Chunk: 1})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(b, []byte("impassable")) || bytes.Contains(b, []byte("holesAdd")) {
		t.Fatalf("an unset impassable or holesAdd written: %s", b)
	}
}

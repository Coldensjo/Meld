package vmangos

import (
	"bytes"
	"encoding/base64"
	"math"
	"os"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
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

// TestRegionNoEditRoundTrip reads a real region of the client and writes it back unedited. The
// placements and heights must come out as they went in. It needs WOW_DIR set to the client.
func TestRegionNoEditRoundTrip(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 2)
	if err != nil {
		t.Fatal(err)
	}
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: view.Heights, Objects: view.Objects}
	files, err := BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 5 || files[4].Name != wdlPath("Azeroth") {
		t.Fatalf("a 2x2 region writes 4 tiles and the WDL, got %d files", len(files))
	}
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
	now, err := ParseWDL(files[4].Data)
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
				if o.Type == modelType(p.Kind, p.Name, p.DoodadSet) {
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
		// change of the four outer samples around it, from the original tile.
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
					if math.Abs(float64(cw.Heights[r*17+9+col])-want) > 1e-3 {
						t.Fatalf("tile %d_%d chunk %d inner %d,%d: wrote %v, want %v", tx, ty, c, r, col, cw.Heights[r*17+9+col], want)
					}
				}
			}
		}
	}
	written := 0
	for _, f := range files[:view.Size*view.Size] {
		placements, err := adt.ParsePlacements(f.Data)
		if err != nil {
			t.Fatal(err)
		}
		written += len(placements)
	}
	if written != len(view.Objects) {
		t.Fatalf("models written: %d, shown in the editor: %d", written, len(view.Objects))
	}
}

// TestRegionMoveRoundTrip moves one model of a real region and checks that the write puts it at
// the new place, under the same unique ID and with its tilt kept. It needs WOW_DIR set.
func TestRegionMoveRoundTrip(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	files, err := BuildRegion(dataDir, RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: view.Heights, Objects: objects})
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
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: view.Heights, Objects: view.Objects,
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

// TestRegionHeadersWritten sets a real chunk's zone, impassable flag, no-effect bits and holes through a region save: they
// must read back, and every other chunk keep the zone, flags and heights the same save without them
// writes. It needs WOW_DIR set to
// the client.
func TestRegionHeadersWritten(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := ReadRegion(dataDir, "Azeroth", 32, 48, 1)
	if err != nil {
		t.Fatal(err)
	}
	// The same save without headers, which the one with them is compared against.
	plain, err := BuildRegion(dataDir, RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: view.Heights, Objects: view.Objects})
	if err != nil {
		t.Fatal(err)
	}
	before, err := adt.ParseTerrain(plain[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	// Block chunk 17 is the tile's chunk (1, 1).
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: view.Heights, Objects: view.Objects,
		Headers: []HeaderSpec{{Chunk: 17, AreaID: 40, Impassable: true, NoEffect: []int{3, 0, 0, 0, 0, 0, 0, 0x80}, Holes: []int{0, 0, 0, 0, 0, 0, 1, 0}}}}
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
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	edit := RegionEdit{MapName: view.MapName, X: view.X, Y: view.Y, Size: view.Size, Heights: view.Heights, Objects: view.Objects, Headers: headers}
	files, err := BuildRegion(dataDir, edit)
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
		for i := range after.Chunks {
			if after.Chunks[i].Holes != before.Chunks[i].Holes {
				t.Fatalf("tile %d chunk %d holes %v, client %v", k, i, after.Chunks[i].Holes, before.Chunks[i].Holes)
			}
		}
	}
	t.Logf("%d chunks with holes kept", holed)
}

// TestRegionLiquidsUnchanged reads a real tile's liquids, as a region opens them, and hands them back:
// no chunk may count as changed, so a save keeps the client's own liquid bytes. It needs WOW_DIR set
// to the client.
func TestRegionLiquidsUnchanged(t *testing.T) {
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("WOW_DIR not set")
	}
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
	if id, ok := ClientMapID("kalimdor"); !ok || id != 1 {
		t.Errorf("ClientMapID(kalimdor) = %d, %v", id, ok)
	}
	if _, ok := ClientMapID("MyMap"); ok {
		t.Error("ClientMapID(MyMap) found a map")
	}
}

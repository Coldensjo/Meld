package vmangos

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"math"
	"reflect"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// wotlkChunks walks a tile's top-level chunks: their names (as the file spells them read forward)
// and where their data starts and ends.
func wotlkChunks(t *testing.T, root []byte) []struct {
	id         string
	start, end int
} {
	t.Helper()
	var out []struct {
		id         string
		start, end int
	}
	for at := 0; at+8 <= len(root); {
		id := string([]byte{root[at+3], root[at+2], root[at+1], root[at]})
		size := int(binary.LittleEndian.Uint32(root[at+4:]))
		if at+8+size > len(root) {
			t.Fatalf("%s at %d runs past the tile", id, at)
		}
		out = append(out, struct {
			id         string
			start, end int
		}{id, at + 8, at + 8 + size})
		at += 8 + size
	}
	return out
}

// vertexColorsOf is each chunk's MCCV payload (nil for a chunk without one), by chunk index.
func vertexColorsOf(t *testing.T, root []byte) map[int][]byte {
	t.Helper()
	out := map[int][]byte{}
	for _, c := range wotlkChunks(t, root) {
		if c.id != "MCNK" {
			continue
		}
		m := root[c.start:c.end]
		idx := int(binary.LittleEndian.Uint32(m[0x08:]))*adt.ChunksPerTile + int(binary.LittleEndian.Uint32(m[0x04:]))
		ofs := int(binary.LittleEndian.Uint32(m[0x74:]))
		if ofs == 0 || ofs > len(m) || string(m[ofs-8:ofs-4]) != "VCCM" {
			out[idx] = nil
			continue
		}
		out[idx] = append([]byte(nil), m[ofs:ofs+int(binary.LittleEndian.Uint32(m[ofs-4:]))]...)
	}
	return out
}

// topChunk is the data of the tile's top-level chunk id, checked against the MHDR field at ofs
// (relative to MHDR's data) that must point at its header; nil when the tile has none.
func topChunkVia(t *testing.T, root []byte, id string, ofs int) []byte {
	t.Helper()
	var mhdr int
	var data []byte
	at := -1
	for _, c := range wotlkChunks(t, root) {
		switch c.id {
		case "MHDR":
			mhdr = c.start
		case id:
			if at < 0 {
				at, data = c.start-8, root[c.start:c.end]
			}
		}
	}
	field := int(binary.LittleEndian.Uint32(root[mhdr+ofs:]))
	if at < 0 {
		if field != 0 {
			t.Errorf("MHDR points at a %s the tile doesn't have", id)
		}
		return nil
	}
	if mhdr+field != at {
		t.Errorf("MHDR's %s offset is %d, the chunk sits at %d", id, field, at-mhdr)
	}
	return data
}

// A save of a Northrend tile into the 3.3.5a client: with nothing edited it writes the client's own
// tile, and with a hill raised, a chunk repainted and a pond added it keeps the tile's vertex
// colours and flight bounds, writes the pond into MH2O beside the client's own liquids, and the paint
// as the map's 8-bit alpha maps (#1068 to #1070). This is phase 2's "done when" as far as the files
// go; the game's own look at them is the author's.
func TestWotLKRegionSave(t *testing.T) {
	dataDir, err := wow.ResolveDataDir(testclient.WotLKDir(t))
	if err != nil {
		t.Fatal(err)
	}
	const mapName, tx, ty = "Northrend", 30, 21
	view, err := ReadRegion(dataDir, mapName, tx, ty, 1)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	own, err := set.ReadFile(adt.TilePath(mapName, tx, ty, ""))
	set.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := checkWritable(dataDir, []mpq.File{{Name: adt.TilePath(mapName, tx, ty, ""), Data: own}}); err != nil {
		t.Errorf("the guard refuses a Northrend tile: %v", err)
	}
	tileOf := func(files []mpq.File) []byte {
		t.Helper()
		for _, f := range files {
			if strings.EqualFold(f.Name, adt.TilePath(mapName, tx, ty, "")) {
				return f.Data
			}
		}
		t.Fatal("the save wrote no tile")
		return nil
	}
	base := RegionEdit{MapName: mapName, X: tx, Y: ty, Size: 1, Heights: EncodeHeights(view.Heights), Objects: view.Objects,
		HasLiquids: true, Liquids: view.Liquids}

	// Nothing edited: the client's own tile.
	files, err := BuildRegion(dataDir, base)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(tileOf(files), own) {
		t.Error("a save with nothing edited changed the tile")
	}

	// A hill: 30 yards up at chunk (8, 8)'s middle, falling off over 40 yards.
	const side = tileCells + 1
	heights := append([]float32(nil), view.Heights...)
	cx, cy := 8*adt.CellsPerChunk+4, 8*adt.CellsPerChunk+4
	cell := float64(adt.TileSize) / tileCells
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			d := math.Hypot(float64(x-cx), float64(y-cy)) * cell
			if d < 40 {
				heights[y*side+x] += float32(30 * (1 + math.Cos(math.Pi*d/40)) / 2)
			}
		}
	}
	// A repaint: chunk 0 half its first texture, half its second (or the first alone).
	c0 := view.Chunks[0]
	textures := []string{c0.Layers[0].Texture}
	if len(c0.Layers) > 1 {
		textures = append(textures, c0.Layers[1].Texture)
	}
	weights := make([]byte, 32*32*4)
	for i := 0; i < len(weights); i += 4 {
		if len(textures) == 2 {
			weights[i], weights[i+1] = 128, 127
		} else {
			weights[i] = 255
		}
	}
	// A pond in the first chunk without liquid, two yards over its highest ground.
	wet := map[int]bool{}
	for _, l := range view.Liquids {
		wet[l.IndexY*adt.ChunksPerTile+l.IndexX] = true
	}
	pondAt := -1
	for i := 0; i < adt.ChunkCount && pondAt < 0; i++ {
		if !wet[i] && i != 8*adt.ChunksPerTile+8 && i != 0 {
			pondAt = i
		}
	}
	if pondAt < 0 {
		t.Fatal("every chunk of the tile has liquid")
	}
	px, py := pondAt%adt.ChunksPerTile, pondAt/adt.ChunksPerTile
	top := float32(-math.MaxFloat32)
	for y := 0; y <= adt.CellsPerChunk; y++ {
		for x := 0; x <= adt.CellsPerChunk; x++ {
			top = max(top, heights[(py*adt.CellsPerChunk+y)*side+px*adt.CellsPerChunk+x])
		}
	}
	pond := adt.Liquid{IndexX: px, IndexY: py, Type: adt.LiquidWater}
	for v := range pond.Heights {
		pond.Heights[v], pond.Depth[v] = top+2, 128
	}
	for i := range pond.Cells {
		pond.Cells[i] = true
	}
	edit := base
	edit.Heights = EncodeHeights(heights)
	edit.Paint = []RegionPaint{{Chunk: 0, Textures: textures, Weights: base64.StdEncoding.EncodeToString(weights)}}
	edit.Liquids = append(append([]adt.Liquid(nil), view.Liquids...), pond)
	files, err = BuildRegion(dataDir, edit)
	if err != nil {
		t.Fatal(err)
	}
	out := tileOf(files)
	if err := checkWritable(dataDir, files); err != nil {
		t.Errorf("the guard refuses the save's files: %v", err)
	}

	// The hill.
	terrain, err := adt.ParseTerrain(out)
	if err != nil {
		t.Fatal(err)
	}
	was, err := adt.ParseTerrain(own)
	if err != nil {
		t.Fatal(err)
	}
	mid := adt.HeightCount / 2 // chunk (8, 8)'s middle sample, outer row 4, column 4
	if h, w := terrain.At(8, 8).Heights[mid], was.At(8, 8).Heights[mid]; h-w < 25 {
		t.Errorf("the hill's top stands %.1f yards over the ground, want about 30", h-w)
	}
	// The vertex colours of every chunk, as the client has them.
	if a, b := vertexColorsOf(t, own), vertexColorsOf(t, out); !reflect.DeepEqual(a, b) {
		n := 0
		for i := range a {
			if !bytes.Equal(a[i], b[i]) {
				n++
			}
		}
		t.Errorf("the vertex colours of %d chunks changed", n)
	}
	// The flight bounds, where MHDR says.
	if a, b := topChunkVia(t, own, "MFBO", 0x24), topChunkVia(t, out, "MFBO", 0x24); a == nil || !bytes.Equal(a, b) {
		t.Errorf("the flight bounds: %d bytes, the client's %d", len(b), len(a))
	}
	// The liquids: the client's own, and the pond, all in MH2O.
	if topChunkVia(t, out, "MH2O", 0x28) == nil {
		t.Fatal("the tile has no MH2O")
	}
	for _, c := range wotlkChunks(t, out) {
		if c.id == "MCNK" && binary.LittleEndian.Uint32(out[c.start+0x64:]) > 8 {
			t.Error("a chunk holds liquid in an MCLQ")
			break
		}
	}
	ownLiquids, err := adt.ParseLiquids(own)
	if err != nil {
		t.Fatal(err)
	}
	liquids, err := adt.ParseLiquids(out)
	if err != nil {
		t.Fatal(err)
	}
	var kept, pondLayers []adt.Liquid
	for _, l := range liquids {
		if l.IndexX == px && l.IndexY == py {
			pondLayers = append(pondLayers, l)
		} else {
			kept = append(kept, l)
		}
	}
	if !reflect.DeepEqual(kept, ownLiquids) {
		t.Errorf("the client's own liquids read otherwise after the save: %d layers, were %d", len(kept), len(ownLiquids))
	}
	if len(pondLayers) != 1 || pondLayers[0].Type != adt.LiquidWater || pondLayers[0].LiquidID == 0 || pondLayers[0].Heights[40] != top+2 {
		t.Errorf("the pond reads %+v", pondLayers)
	} else if kind, ok := adt.LiquidKind(pondLayers[0].LiquidID); !ok || kind != adt.LiquidWater {
		t.Errorf("the pond's LiquidType row %d is not water", pondLayers[0].LiquidID)
	}
	// The paint, as 8-bit alpha maps: chunk 0's second layer about half the texel.
	tex, err := adt.ParseTextures(out, true, terrain)
	if err != nil {
		t.Fatal(err)
	}
	layers := tex.Chunks[0].Layers
	if len(layers) != len(textures) {
		t.Fatalf("chunk 0 has %d layers, want %d", len(layers), len(textures))
	}
	for i, l := range layers {
		if l.Texture != textures[i] {
			t.Errorf("chunk 0 layer %d is %s, want %s", i, l.Texture, textures[i])
		}
	}
	if len(textures) == 2 {
		alpha := tex.Chunks[0].Alpha[0]
		sum := 0
		for _, a := range alpha {
			sum += int(a)
		}
		if mean := sum / len(alpha); mean < 110 || mean > 145 {
			t.Errorf("chunk 0's second layer shows %d of 255 on average, want about 127", mean)
		}
		for _, c := range wotlkChunks(t, out) {
			m := out[c.start:c.end]
			if c.id != "MCNK" || binary.LittleEndian.Uint32(m[0x04:]) != 0 || binary.LittleEndian.Uint32(m[0x08:]) != 0 {
				continue
			}
			if n := binary.LittleEndian.Uint32(m[0x28:]) - 8; n != 4096 {
				t.Errorf("chunk 0's alpha maps take %d bytes, want one 8-bit map's 4096", n)
			}
		}
	}
}

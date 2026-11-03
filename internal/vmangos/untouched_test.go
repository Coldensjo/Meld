package vmangos

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/sandbox"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestClientUntouchedRegionChangesNothing compiles a block of the client's own Azeroth as ReadRegion gave
// it, in a copy of the client without Meld's patch, with every chunk's paint and header sent as the page
// sends them: no file is listed, though the rebuilt tiles' heights at chunk edges come back with float
// noise, Rewrite lays every chunk out anew and the patch has no copy of them (#990). A 1.5 mm edit lists
// its tile alone; once installed, the untouched block lists that tile again, to put it back.
func TestClientUntouchedRegionChangesNothing(t *testing.T) {
	realData, err := wow.ResolveDataDir(testclient.DataDir(t))
	if err != nil {
		t.Fatal(err)
	}
	data, err := sandbox.Prepare(realData, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(data, PatchName)); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	const x0, y0, size = 28, 50, 2
	view, err := ReadRegion(data, "Azeroth", x0, y0, size)
	if err != nil {
		t.Fatal(err)
	}
	edit := RegionEdit{MapName: view.MapName, X: x0, Y: y0, Size: size, Heights: EncodeHeights(view.Heights), Objects: view.Objects}
	edit.Paint, edit.Headers = ownChunks(t, data, view.MapName, x0, y0, size)
	files, res, err := RegionChanges(data, edit)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Errorf("an untouched block lists %d files (tiles %v), want none", len(files), res.ChangedTiles)
	}

	// The page sends a texture's usual effect, not the chunk's, marked as only that: each chunk keeps
	// its own (#1033).
	usual := edit
	usual.Paint = make([]RegionPaint, len(edit.Paint))
	for i, p := range edit.Paint {
		p.Effects = make([]uint32, len(p.Textures))
		p.OwnEffects = make([]bool, len(p.Textures))
		for k := range p.Effects {
			p.Effects[k], p.OwnEffects[k] = 1, true
		}
		usual.Paint[i] = p
	}
	if files, res, err = RegionChanges(data, usual); err != nil || len(files) != 0 {
		t.Errorf("an untouched block sent its textures' usual effects lists %d files (tiles %v, %v), want none", len(files), res.ChangedTiles, err)
	}

	// One sample in the middle of tile 29_51 raised by 1.5 mm, above SculptedEps: that tile is written.
	side := size*tileCells + 1
	heights := slices.Clone(view.Heights)
	heights[(tileCells+tileCells/2)*side+tileCells+tileCells/2+3] += 1.5e-3
	edited := edit
	edited.Heights = EncodeHeights(heights)
	files, res, err = RegionChanges(data, edited)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(res.ChangedTiles, []string{"29_51"}) {
		t.Fatalf("a 1.5 mm edit in 29_51 lists tiles %v, want [29_51]", res.ChangedTiles)
	}
	if _, err := InstallPatch(data, files); err != nil {
		t.Fatal(err)
	}
	if files, res, err = RegionChanges(data, edited); err != nil || len(files) != 0 {
		t.Errorf("the installed edit lists %d files (tiles %v, %v), want none", len(files), res.ChangedTiles, err)
	}
	if _, res, err = RegionChanges(data, edit); err != nil || !slices.Equal(res.ChangedTiles, []string{"29_51"}) {
		t.Errorf("undoing the installed edit lists tiles %v (%v), want [29_51]", res.ChangedTiles, err)
	}
}

// ownChunks is every chunk's paint and header of a block as the client has them, as the page sends a
// region it did not repaint: each chunk's textures, effects and weights (adt.ClientWeights at the page's
// half resolution), and its zone, impassable flag, no-tuft rows and holes.
func ownChunks(t *testing.T, data, mapName string, x, y, size int) ([]RegionPaint, []HeaderSpec) {
	t.Helper()
	set, err := mpq.OpenDataDir(data)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	perRow := size * adt.ChunksPerTile
	var paint []RegionPaint
	var headers []HeaderSpec
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			root, err := set.ReadFile(adt.TilePath(mapName, x+i, y+j, ""))
			if err != nil {
				t.Fatal(err)
			}
			own, err := ownTextures(root, false)
			if err != nil {
				t.Fatal(err)
			}
			terrain, err := adt.ParseTerrain(root)
			if err != nil {
				t.Fatal(err)
			}
			for _, c := range terrain.Chunks {
				tc := own[c.IndexY*adt.ChunksPerTile+c.IndexX]
				chunk := (j*adt.ChunksPerTile+c.IndexY)*perRow + i*adt.ChunksPerTile + c.IndexX
				p := RegionPaint{Chunk: chunk, Weights: base64.StdEncoding.EncodeToString(adt.ClientWeights(tc, adt.AlphaSize/2))}
				for _, l := range tc.Layers {
					p.Textures = append(p.Textures, l.Texture)
					p.Effects = append(p.Effects, l.Effect)
				}
				paint = append(paint, p)
				impassable := c.Impassable()
				h := HeaderSpec{Chunk: chunk, AreaID: c.AreaID, Impassable: &impassable}
				for r := range c.NoEffect {
					h.NoEffect = append(h.NoEffect, int(c.NoEffect[r]))
					h.Holes = append(h.Holes, int(c.Holes[r]))
				}
				headers = append(headers, h)
			}
		}
	}
	return paint, headers
}

package vmangos

import (
	"testing"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/testclient"
	"Meld/internal/wow"
)

// TestClientAnimatedLayersKept finds a chunk of the client whose texture layer is animated (Searing
// Gorge's and Burning Steppes' lava), rewrites it with new paint of the same textures as a region save
// does (no flags of the editor's own), and checks the layer keeps the client's animation flags. It
// needs WOW_DIR.
func TestClientAnimatedLayersKept(t *testing.T) {
	if testing.Short() {
		t.Skip("heavy client scan; run make test-full")
	}
	dir := testclient.DataDir(t)
	dataDir, err := wow.ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	for ty := 30; ty < 46; ty++ {
		for tx := 30; tx < 40; tx++ {
			root, err := set.ReadFile(adt.TilePath("Azeroth", tx, ty, ""))
			if err != nil {
				continue
			}
			terrain, err := adt.ParseTerrain(root)
			if err != nil {
				continue
			}
			tex, err := adt.ParseTextures(root, false, terrain)
			if err != nil {
				continue
			}
			for c, ch := range tex.Chunks {
				for l, layer := range ch.Layers {
					if l == 0 || layer.Flags&0x40 == 0 || len(ch.Alpha) < len(ch.Layers)-1 {
						continue
					}
					var paint adt.ChunkPaint
					for k, own := range ch.Layers {
						lay := adt.Layer{Texture: own.Texture}
						if k > 0 {
							lay.Alpha = ch.Alpha[k-1]
						}
						paint.Layers = append(paint.Layers, lay)
					}
					out, err := adt.Rewrite(root, adt.Changes{TileX: tx, TileY: ty, Paint: map[int]adt.ChunkPaint{c: paint}})
					if err != nil {
						t.Fatal(err)
					}
					after, err := adt.ParseTerrain(out)
					if err != nil {
						t.Fatal(err)
					}
					got, err := adt.ParseTextures(out, false, after)
					if err != nil {
						t.Fatal(err)
					}
					want := layer.Flags & adt.LayerLookFlags
					if f := got.Chunks[c].Layers[l].Flags & adt.LayerLookFlags; f != want {
						t.Fatalf("tile %d_%d chunk %d layer %d (%s): look flags %#x after the rewrite, the client's %#x", tx, ty, c, l, layer.Texture, f, want)
					}
					t.Logf("tile %d_%d chunk %d: %s keeps %#x", tx, ty, c, layer.Texture, want)
					return
				}
			}
		}
	}
	t.Skip("no animated layer found in the tiles looked at")
}

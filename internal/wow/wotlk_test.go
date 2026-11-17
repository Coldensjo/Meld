package wow

import (
	"encoding/binary"
	"errors"
	"math"
	"strings"
	"testing"

	"Meld/internal/adt"
	"Meld/internal/clientbuild"
	"Meld/internal/testclient"
)

// The 3.3.5a client opens as one (#1066): its build is told, its locale folder's archives are among
// the ones read (the tables are only there), and Meld's patch is the one that client leaves free.
// The rest pins what the readers of the later parts start from: a table of that client's width, a
// map whose WDT asks for 8-bit alpha maps beside one that does not, and a tile whose terrain and
// texture layers the 1.12 reader already reads.
//
//	WOW335_DIR=/path/to/a/3.3.5a/client go test ./internal/wow/ -run WotLK -v
func TestWotLKClientOpens(t *testing.T) {
	dir := testclient.WotLKDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	st := c.Status()
	t.Logf("status: %+v", st)
	if st.Build != int(clientbuild.WotLK) || st.Version != "3.3.5a" || st.BuildWarning != "" {
		t.Fatalf("build %d, version %q, warning %q; want 12340, 3.3.5a and none", st.Build, st.Version, st.BuildWarning)
	}
	data, err := ResolveDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := clientbuild.PatchFor(data); got != "patch-4.MPQ" {
		t.Errorf("Meld's patch is %s, want patch-4.MPQ: the client ships its own patch-3.MPQ", got)
	}
	if clientbuild.Locale(data) == "" {
		t.Error("no locale folder found in the Data folder")
	}

	// Map.dbc is in the locale archives only. Its header: WDBC, records, fields, record size, strings.
	table, err := c.ReadFile(`DBFilesClient\Map.dbc`)
	if err != nil {
		t.Fatalf("Map.dbc, which the locale archives hold: %v", err)
	}
	if len(table) < 20 || string(table[:4]) != "WDBC" {
		t.Fatalf("Map.dbc is not a DBC table (%d bytes)", len(table))
	}
	records, fields := binary.LittleEndian.Uint32(table[4:]), binary.LittleEndian.Uint32(table[8:])
	if fields != 66 || records < 100 {
		t.Errorf("Map.dbc has %d records of %d fields; the 3.3.5a table has 66 fields and over 100 maps", records, fields)
	}

	// Northrend's WDT asks for 8-bit alpha maps; the old world's does not, in the same client, so the
	// alpha format follows the map and not the client's build (#1069).
	for name, want := range map[string]bool{`World\Maps\Northrend\Northrend.wdt`: true, `World\Maps\Azeroth\Azeroth.wdt`: false} {
		wdt, err := c.ReadFile(name)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got := adt.ReadBigAlpha(wdt); got != want {
			t.Errorf("%s: 8-bit alpha maps %v, want %v", name, got, want)
		}
	}

	// A Northrend tile's terrain and texture layers read with the 1.12 reader, 8-bit alpha included.
	root, err := c.ReadFile(`World\Maps\Northrend\Northrend_30_20.adt`)
	if err != nil {
		t.Fatal(err)
	}
	terrain, err := adt.ParseTerrain(root)
	if err != nil {
		t.Fatalf("the tile's terrain: %v", err)
	}
	textures, err := adt.ParseTextures(root, true, terrain)
	if err != nil {
		t.Fatalf("the tile's textures: %v", err)
	}
	// Every layer over a chunk's first has a map, and nearly all of them paint something down to
	// their last rows: the maps are as long as the MCNK header says, where the tile's MCAL claims 512
	// bytes (adt.alphaChunk), which left most layers unpainted.
	layers, alpha, painted, lastRows := 0, 0, 0, 0
	for _, tc := range textures.Chunks {
		layers += len(tc.Layers)
		for _, a := range tc.Alpha {
			if len(a) != 64*64 {
				continue
			}
			alpha++
			any, low := false, false
			for i, v := range a {
				if v != 0 {
					any = true
					low = low || i >= 32*64
				}
			}
			if any {
				painted++
			}
			if low {
				lastRows++
			}
		}
	}
	t.Logf("%d layers, %d alpha maps: %d paint something, %d in their lower half", layers, alpha, painted, lastRows)
	if len(terrain.Chunks) != 256 || len(textures.Chunks) != 256 || layers < 256 || alpha == 0 {
		t.Errorf("%d terrain chunks, %d texture chunks, %d layers, %d alpha maps of 64x64; want 256, 256, at least 256 and some", len(terrain.Chunks), len(textures.Chunks), layers, alpha)
	}
	if painted*10 < alpha*7 || lastRows*10 < alpha*6 {
		t.Errorf("of %d alpha maps only %d paint something and %d reach their lower half", alpha, painted, lastRows)
	}
}

// The 3.3.5a client's models (version 264, #1071) read through LegacyM2: a sample of every model in
// the client decodes, and some known ones have their mesh, their textures, their bones and their
// particles.
//
//	WOW335_DIR=/path/to/a/3.3.5a/client go test ./internal/wow/ -run WotLKModels -v
func TestWotLKModels(t *testing.T) {
	dir := testclient.WotLKDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	list := c.List("m2")
	if len(list) < 10000 {
		t.Fatalf("the client lists %d models", len(list))
	}
	limit := 1500
	if testing.Short() {
		limit = 200
	}
	step := max(1, len(list)/limit)
	fails, nothing, n := 0, 0, 0
	kinds := map[string]int{}
	for i := 0; i < len(list); i += step {
		n++
		raw, err := c.readM2(list[i])
		if err == nil {
			_, err = ParseM2(raw, list[i])
		}
		switch {
		case err == nil:
		case errors.Is(err, ErrNothingToDraw):
			nothing++
		default:
			fails++
			msg := err.Error()
			if j := strings.LastIndex(msg, ": "); j >= 0 {
				msg = msg[j+2:]
			}
			kinds[msg]++
			if fails <= 8 {
				t.Logf("  FAIL %s: %v", list[i], err)
			}
		}
	}
	t.Logf("%d models listed, %d read: %d failed, %d with nothing to draw; failures by kind: %v", len(list), n, fails, nothing, kinds)
	if fails*50 > n {
		t.Errorf("%d of %d models failed", fails, n)
	}

	mesh := func(path string) *Mesh {
		t.Helper()
		m, err := c.m2Mesh(path, nil)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		t.Logf("%s: %d vertices, %d triangles, %d groups, bones %v, %d effects, %d emitters, %d ribbons",
			path, len(m.Pos)/3, len(m.Index)/3, len(m.Groups), m.Anim != nil, len(m.Effects), len(m.Emitters), len(m.Ribbons))
		return m
	}
	// A still doodad: a mesh, and a texture the client has for each group.
	table := mesh(`World\Expansion02\Doodads\Generic\Tuskarr\Tables\TS_Long_Table_01.m2`)
	if len(table.Pos) < 9 || len(table.Index) < 3 || len(table.Groups) == 0 {
		t.Errorf("the table has %d vertices, %d indices, %d groups", len(table.Pos)/3, len(table.Index), len(table.Groups))
	}
	for _, g := range table.Groups {
		if _, err := c.Texture(g.Texture); err != nil {
			t.Errorf("the table's texture %q: %v", g.Texture, err)
		}
	}
	for _, i := range table.Index {
		if int(i)*3+2 >= len(table.Pos) {
			t.Fatalf("the table's index %d is past its %d vertices", i, len(table.Pos)/3)
		}
	}
	// A creature: bones that move in its Stand loop, whose keys are in the model or a .anim file.
	wolf := mesh(`Creature\Wolf\Wolf.m2`)
	if wolf.Anim == nil || len(wolf.Anim.Bones) < 10 {
		t.Fatalf("the wolf has no moving bones")
	}
	moving := 0
	for _, b := range wolf.Anim.Bones {
		if b.R != nil && len(b.R.Times) > 1 && b.R.Loop > 0 {
			moving++
			for k := 0; k+3 < len(b.R.Values); k += 4 {
				if x, y, z, w := b.R.Values[k], b.R.Values[k+1], b.R.Values[k+2], b.R.Values[k+3]; !unitQuat(x, y, z, w) {
					t.Fatalf("a wolf bone's rotation key (%g, %g, %g, %g) is no unit quaternion", x, y, z, w)
				}
			}
			if last := b.R.Times[len(b.R.Times)-1]; last > b.R.Loop {
				t.Fatalf("a wolf bone's last key is at %d ms of a %d ms loop", last, b.R.Loop)
			}
		}
	}
	if moving < 5 {
		t.Errorf("%d of the wolf's %d bones turn in its Stand loop", moving, len(wolf.Anim.Bones))
	}
	// A character model reads with its geosets (a look picks among them).
	raw, err := c.readM2(`Character\Human\Male\HumanMale.m2`)
	if err != nil {
		t.Fatal(err)
	}
	subs, err := M2Submeshes(raw)
	if err != nil || len(subs) < 20 {
		t.Errorf("the human male has %d geosets, %v", len(subs), err)
	}
	if anims, err := M2Animations(raw); err != nil || len(anims) < 100 || anims[0] != 0 {
		t.Errorf("the human male has %d animations, %v", len(anims), err)
	}
	if hull, err := m2HullFaces(raw); err != nil {
		t.Errorf("the human male's collision hull: %v", err)
	} else {
		t.Logf("the human male: %d geosets, %d collision triangles", len(subs), len(hull)/9)
	}
}

// A model with particle emitters or ribbons reads them, among a sample of the client's.
func TestWotLKParticles(t *testing.T) {
	dir := testclient.WotLKDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	emitters, ribbons, lights, with := 0, 0, 0, 0
	list := c.List("m2")
	step := max(1, len(list)/800)
	for i := 0; i < len(list); i += step {
		raw, err := c.readM2(list[i])
		if err != nil {
			continue
		}
		m, err := ParseM2(raw, list[i])
		if err != nil {
			continue
		}
		if len(m.Emitters) > 0 || len(m.Ribbons) > 0 {
			with++
		}
		emitters += len(m.Emitters)
		ribbons += len(m.Ribbons)
		for _, e := range m.Effects {
			if e.Kind == "light" {
				lights++
			}
		}
		for _, e := range m.Emitters {
			if e.Mid <= 0 || e.Mid >= 1 || !finite(e.Sizes[0], e.Sizes[1], e.Sizes[2]) || e.Rows < 1 || e.Cols < 1 {
				t.Errorf("%s: an emitter with mid %g, sizes %v, %dx%d cells", list[i], e.Mid, e.Sizes, e.Rows, e.Cols)
			}
			for _, col := range e.Colors {
				for _, v := range col {
					if v < 0 || v > 1 {
						t.Errorf("%s: an emitter colour %v", list[i], col)
					}
				}
			}
		}
	}
	t.Logf("%d emitters, %d ribbons and %d lights in %d of the sampled models", emitters, ribbons, lights, with)
	if emitters < 50 || ribbons < 1 || lights < 1 {
		t.Errorf("too few: %d emitters, %d ribbons, %d lights", emitters, ribbons, lights)
	}
}

// The 3.3.5a client's tiles keep their liquids in MH2O (#1068): a Northrend tile and an old-world
// one, which that client stores the same way, read into layers with surfaces near their ground.
func TestWotLKLiquids(t *testing.T) {
	dir := testclient.WotLKDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{`World\Maps\Northrend\Northrend_30_20.adt`, `World\Maps\Azeroth\Azeroth_32_48.adt`, `World\Maps\Northrend\Northrend_22_22.adt`} {
		root, err := c.ReadFile(name)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		layers, err := adt.ParseLiquids(root)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		terrain, err := adt.ParseTerrain(root)
		if err != nil {
			t.Fatal(err)
		}
		kinds, ids := map[int]int{}, map[int]int{}
		lo, hi := float32(math.Inf(1)), float32(math.Inf(-1))
		for _, l := range layers {
			kinds[l.Type]++
			ids[l.LiquidID]++
			if l.LiquidID == 0 || l.Type < adt.LiquidWater || l.Type > adt.LiquidSlime {
				t.Fatalf("%s: a layer of type %d, liquid %d", name, l.Type, l.LiquidID)
			}
			covered := false
			for i, on := range l.Cells {
				if !on {
					continue
				}
				covered = true
				// The corners of a covered cell hold real heights.
				row, col := i/adt.CellsPerChunk, i%adt.CellsPerChunk
				for _, v := range []int{row*9 + col, row*9 + col + 1, (row+1)*9 + col, (row+1)*9 + col + 1} {
					h := l.Heights[v]
					if math.IsNaN(float64(h)) || h < -2000 || h > 5000 {
						t.Fatalf("%s: chunk %d,%d has a surface at %g", name, l.IndexX, l.IndexY, h)
					}
					lo, hi = min(lo, h), max(hi, h)
				}
			}
			if !covered {
				t.Fatalf("%s: a layer that covers no cell", name)
			}
			if l.Type == adt.LiquidOcean && l.Heights[0] != 0 {
				t.Errorf("%s: the sea in chunk %d,%d is at %g, not 0", name, l.IndexX, l.IndexY, l.Heights[0])
			}
		}
		gmin, gmax := float32(math.Inf(1)), float32(math.Inf(-1))
		for _, ch := range terrain.Chunks {
			for _, h := range ch.Heights {
				gmin, gmax = min(gmin, h), max(gmax, h)
			}
		}
		t.Logf("%s: %d layers by kind %v, by liquid %v, surfaces %g to %g, ground %g to %g", name, len(layers), kinds, ids, lo, hi, gmin, gmax)
		if len(layers) == 0 {
			t.Errorf("%s: no liquid layers, though the tile has an MH2O chunk", name)
		} else if lo < gmin-50 || hi > gmax+50 {
			t.Errorf("%s: liquid surfaces %g to %g are far from the ground's %g to %g", name, lo, hi, gmin, gmax)
		}
	}
}

// The 3.3.5a client's buildings read (WMO version 17, as 1.12's), and the liquids of the ones whose
// root names LiquidType.dbc rows draw as those rows' kind: Dalaran has water, and no lava.
func TestWotLKBuildings(t *testing.T) {
	dir := testclient.WotLKDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	list := c.List("wmo")
	step := max(1, len(list)/150)
	fails, n, flagged, wet := 0, 0, 0, 0
	classes := map[byte]int{}
	for i := 0; i < len(list); i += step {
		n++
		b, err := c.read(list[i])
		if err != nil {
			fails++
			continue
		}
		root, err := ParseWMORoot(b)
		if err != nil {
			fails++
			t.Logf("  FAIL %s: %v", list[i], err)
			continue
		}
		if root.Flags&4 != 0 {
			flagged++
		}
		m, err := c.wmoMesh(list[i], -1)
		if err != nil {
			fails++
			t.Logf("  FAIL %s: %v", list[i], err)
			continue
		}
		if m.Liquid != nil && len(m.Liquid.Index) > 0 {
			wet++
			for k := 0; k+3 < len(m.Liquid.Info); k += 4 {
				classes[m.Liquid.Info[k]]++
			}
		}
	}
	t.Logf("%d buildings listed, %d read: %d failed, %d whose root names liquid types, %d with a liquid; liquid vertices by class %v", len(list), n, fails, flagged, wet, classes)
	if fails*20 > n {
		t.Errorf("%d of %d buildings failed", fails, n)
	}
	if flagged == 0 {
		t.Error("no building's root has flag 4, which most of this client's have")
	}

	dalaran, err := c.wmoMesh(`World\wmo\Northrend\Dalaran\ND_Dalaran.wmo`, -1)
	if err != nil {
		t.Fatal(err)
	}
	if dalaran.Liquid == nil || len(dalaran.Liquid.Index) == 0 {
		t.Fatal("Dalaran has no liquid")
	}
	got := map[byte]int{}
	for k := 0; k+3 < len(dalaran.Liquid.Info); k += 4 {
		got[dalaran.Liquid.Info[k]]++
	}
	t.Logf("Dalaran: %d vertices, %d liquid triangles, liquid vertices by class %v", len(dalaran.Pos)/3, len(dalaran.Liquid.Index)/3, got)
	if got[LiquidRiver] == 0 || got[LiquidMagma] > 0 || got[LiquidSlime] > 0 {
		t.Errorf("Dalaran's liquids by class: %v; want water and neither lava nor slime", got)
	}
}

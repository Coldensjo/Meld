package wow

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"testing"

	"Meld/internal/testclient"
)

// signedVolume is six times the volume a closed triangle set encloses: positive when the faces are
// wound with their normals outward.
func signedVolume(f []float32) float64 {
	v := 0.0
	for i := 0; i+8 < len(f); i += 9 {
		ax, ay, az := float64(f[i]), float64(f[i+1]), float64(f[i+2])
		bx, by, bz := float64(f[i+3]), float64(f[i+4]), float64(f[i+5])
		cx, cy, cz := float64(f[i+6]), float64(f[i+7]), float64(f[i+8])
		v += ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx)
	}
	return v
}

func TestM2HullFaces(t *testing.T) {
	b := make([]byte, 0x200)
	copy(b, "MD20")
	le := binary.LittleEndian
	// Three indices at 0x120, three vertices at 0x140.
	le.PutUint32(b[0xEC:], 3)
	le.PutUint32(b[0xF0:], 0x120)
	le.PutUint32(b[0xF4:], 3)
	le.PutUint32(b[0xF8:], 0x140)
	for i, v := range []uint16{0, 1, 2} {
		le.PutUint16(b[0x120+i*2:], v)
	}
	verts := [][3]float32{{0, 0, 1}, {1, 0, 1}, {0, 1, 1}}
	for i, v := range verts {
		for k := range 3 {
			le.PutUint32(b[0x140+i*12+k*4:], math.Float32bits(v[k]))
		}
	}
	f, err := m2HullFaces(b)
	if err != nil {
		t.Fatal(err)
	}
	// WoW (x, y, z) is editor (x, z, -y), in the file's order.
	want := []float32{0, 1, 0, 1, 1, 0, 0, 1, -1}
	if len(f) != 9 {
		t.Fatalf("got %d floats, want 9", len(f))
	}
	for i := range want {
		if f[i] != want[i] {
			t.Fatalf("faces %v, want %v", f, want)
		}
	}
	// An index past the vertices drops its triangle.
	le.PutUint16(b[0x124:], 9)
	if f, _ := m2HullFaces(b); len(f) != 0 {
		t.Fatalf("a bad index kept %d floats", len(f))
	}
}

// TestClientCollision reads a crate's hull and Goldshire's inn from the client: the hull must be a
// closed solid wound outward, and the inn must bring its floors and its doodads' hulls.
// WOW_DIR=/path/to/client go test ./internal/wow/ -run ClientCollision -v
func TestClientCollision(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		`World\Azeroth\Westfall\PassiveDoodads\Crate\WestFallCrate.m2`,
		`World\Azeroth\Westfall\PassiveDoodads\Barrel\WestFallBarrel01.m2`,
		`World\Dungeon\GoldshireInn\InnBarrel\InnBarrel.m2`,
	} {
		b, err := c.Collision(p, 0)
		if err != nil {
			t.Fatal(err)
		}
		n := int(binary.LittleEndian.Uint32(b))
		f := make([]float32, n*9)
		for i := range f {
			f[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[4+i*4:]))
		}
		if n < 4 {
			t.Fatalf("%s: the hull has %d triangles", p, n)
		}
		if v := signedVolume(f); v <= 0 {
			t.Fatalf("%s: the hull is wound inward (signed volume %.2f)", p, v)
		}
		t.Logf("%s: %d triangles, volume %.2f yd³", p, n, signedVolume(f)/6)
	}

	col, err := c.wmoCollision(`World\wmo\Azeroth\Buildings\GoldshireInn\GoldshireInn.wmo`, 0)
	if err != nil {
		t.Fatal(err)
	}
	inn, groups := col.faces, col.groups
	sum := 0
	for _, n := range groups {
		sum += int(n)
	}
	if sum != len(inn)/9 || len(groups) < 2 {
		t.Fatalf("the inn's %d groups hold %d triangles of %d", len(groups), sum, len(inn)/9)
	}
	up := 0
	for i := 0; i+8 < len(inn); i += 9 {
		// The face's normal, by the editor's winding: a floor's points up (+Y).
		ux, uy, uz := inn[i+3]-inn[i], inn[i+4]-inn[i+1], inn[i+5]-inn[i+2]
		vx, vy, vz := inn[i+6]-inn[i], inn[i+7]-inn[i+1], inn[i+8]-inn[i+2]
		ny := uz*vx - ux*vz
		l := math.Sqrt(float64((uy*vz-uz*vy)*(uy*vz-uz*vy) + ny*ny + (ux*vy-uy*vx)*(ux*vy-uy*vx)))
		if l > 0 && float64(ny)/l > 0.9 {
			up++
		}
	}
	t.Logf("Goldshire inn: %d faces, %d facing up", len(inn)/9, up)
	if up < 50 {
		t.Fatalf("the inn has %d upward faces; its floors are missing or wound down", up)
	}

	// The liquids inside a WMO (#281): Ironforge's forge lava is magma (3), Stormwind's canals water (1).
	for _, w := range []struct {
		path string
		typ  uint32
	}{
		{`World\wmo\KhazModan\Cities\Ironforge\ironforge.wmo`, 3},
		{`World\wmo\Azeroth\Buildings\Stormwind\Stormwind.wmo`, 1},
	} {
		col, err := c.wmoCollision(w.path, 0)
		if err != nil {
			t.Fatal(err)
		}
		l := col.liquid
		n := 0
		for _, ty := range l.types {
			if ty == w.typ {
				n++
			}
		}
		t.Logf("%s: %d liquid vertices, %d triangles, %d of type %d", w.path, len(l.verts)/3, len(l.types), n, w.typ)
		if n < 100 || len(l.tris) != 3*len(l.types) {
			t.Fatalf("%s: %d liquid triangles of type %d (%d indices for %d types)", w.path, n, w.typ, len(l.tris), len(l.types))
		}
		for _, i := range l.tris {
			if int(i) >= len(l.verts)/3 {
				t.Fatalf("%s: liquid index %d past %d vertices", w.path, i, len(l.verts)/3)
			}
		}
	}
}

// TestClientNothingToDraw reads an open door's collision blocker, an M2 the client draws nothing of
// (#333): ParseM2 says so with ErrNothingToDraw, and Model answers it with its hull and no groups
// instead of failing. WOW_DIR=/path/to/client go test ./internal/wow/ -run NothingToDraw -v
func TestClientNothingToDraw(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	p := `World\KhazModan\Blackrock\PassiveDoodads\Doors\BlackRockHugeDoorsOpenDoorCollision.m2`
	raw, err := c.readM2(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseM2(raw, p); !errors.Is(err, ErrNothingToDraw) {
		t.Fatalf("ParseM2: %v, want ErrNothingToDraw", err)
	}
	b, err := c.Model(p, Look{})
	if err != nil {
		t.Fatal(err)
	}
	n := binary.LittleEndian.Uint32(b)
	var h meshHeader
	if err := json.Unmarshal(b[4:4+n], &h); err != nil {
		t.Fatal(err)
	}
	if len(h.Groups) != 0 || len(h.Effects) != 0 || len(h.Emitters) != 0 || len(h.Ribbons) != 0 {
		t.Fatalf("%d groups, %d effects, %d emitters, %d ribbons; want none", len(h.Groups), len(h.Effects), len(h.Emitters), len(h.Ribbons))
	}
	if h.Verts < 3 || h.Indices != h.Verts || h.BBox[3] <= h.BBox[0] {
		t.Fatalf("the hull: %d vertices, %d indices, bounds %v", h.Verts, h.Indices, h.BBox)
	}
	t.Logf("%s: a hull of %d triangles, bounds %v", p, h.Verts/3, h.BBox)
}

// TestServerLiquidType follows the vmap extractor's liquid types: groupLiquid plus one, the first wet
// tile's nibble without one, the root's flag 4 taking it as it is, and the low bits folding the rest.
func TestServerLiquidType(t *testing.T) {
	dry := []byte{0xf, 0xf}
	for _, c := range []struct {
		groupLiquid, groupFlags, rootFlags int
		tiles                              []byte
		want                               int
	}{
		{0, 0, 0, dry, 1},                          // still water
		{0, 0x80000, 0, dry, 2},                    // water in a group flagged 0x80000 is ocean
		{1, 0, 0, dry, 2},                          // ocean
		{2, 0, 0, dry, 3},                          // magma
		{3, 0, 0, dry, 4},                          // slime
		{6, 0, 0, dry, 3},                          // magma (7 folds to 3)
		{noGroupLiquid, 0, 0, dry, 0},              // no liquid, no wet tile
		{noGroupLiquid, 0, 0, []byte{0xf, 0x2}, 3}, // the first wet tile's magma
		{3, 0, 4, dry, 3},                          // the root's flag 4: groupLiquid is the ID itself
		{21, 0, 4, dry, 21},                        // an ID past 20 stays
	} {
		if got := serverLiquidType(c.groupLiquid, c.groupFlags, c.rootFlags, c.tiles); got != c.want {
			t.Errorf("serverLiquidType(%d, %#x, %d, %v) = %d, want %d", c.groupLiquid, c.groupFlags, c.rootFlags, c.tiles, got, c.want)
		}
	}
}

// TestCollisionLiquidGrid checks a group liquid's grid: every vertex sent, two triangles a wet tile.
func TestCollisionLiquidGrid(t *testing.T) {
	l := &WMOLiquid{XVerts: 3, YVerts: 2, XTiles: 2, YTiles: 1, Base: [3]float32{10, 20, 0}, Heights: []float32{1, 2, 3, 4, 5, 6}, Tiles: []byte{0x0, 0xf}}
	var o collisionLiquids
	o.add(l, 1)
	if len(o.verts) != 18 || len(o.tris) != 6 || len(o.types) != 2 {
		t.Fatalf("%d vertex floats, %d indices, %d types; want 18, 6, 2", len(o.verts), len(o.tris), len(o.types))
	}
	// Vertex (1, 1): WoW (10 + step, 20 + step, 5) is editor (x, 5, -y).
	x, y, z := o.verts[12], o.verts[13], o.verts[14]
	if x != 10+mliqStep || y != 5 || z != -(20+mliqStep) {
		t.Fatalf("vertex (1, 1) at %v %v %v", x, y, z)
	}
	for _, i := range o.tris {
		if i == 2 || i == 5 {
			t.Fatalf("the dry tile's far corner %d is in a triangle: %v", i, o.tris)
		}
	}
}

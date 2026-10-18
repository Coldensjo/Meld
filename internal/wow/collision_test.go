package wow

import (
	"encoding/binary"
	"math"
	"os"
	"testing"
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
	dir := os.Getenv("WOW_DIR")
	if dir == "" {
		t.Skip("set WOW_DIR to a WoW 1.x client to run")
	}
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

	inn, groups, err := c.wmoCollision(`World\wmo\Azeroth\Buildings\GoldshireInn\GoldshireInn.wmo`, 0)
	if err != nil {
		t.Fatal(err)
	}
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
}

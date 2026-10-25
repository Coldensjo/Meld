package wow

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

// The binary replies of /wow/model, /wow/collision and /wow/wmonav, encoded from small generated
// meshes (no client data) into frontend/tests/fixtures, which frontend/tests/wire.test.ts decodes
// with the frontend's parsers (#520). A change to an encoder's layout fails here until the fixtures
// are written again, and then fails the Bun test until the parser follows:
// go test ./internal/wow/ -run TestWireFixtures -update
var update = flag.Bool("update", false, "write the frontend's wire fixtures (frontend/tests/fixtures)")

const fixtureDir = "../../frontend/tests/fixtures"

// checkFixture compares b with the fixture name, or writes it with -update.
func checkFixture(t *testing.T, name string, b []byte) {
	t.Helper()
	path := filepath.Join(fixtureDir, name)
	if *update {
		if err := os.WriteFile(path, b, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (write it: go test ./internal/wow/ -run TestWireFixtures -update)", err)
	}
	if !bytes.Equal(b, want) {
		t.Fatalf("%s: the encoder's bytes changed; if the layout changed on purpose, write the fixture again (-update) and make the frontend's parser and frontend/tests/wire.test.ts follow", name)
	}
}

// wireMesh is a 2 x 3 x 4 box, its eight corners in two groups of six triangles, with every optional
// section: colours, one bone, rooms, and a liquid quad. Each array has its own pattern, which the
// Bun test checks.
func wireMesh() *Mesh {
	m := &Mesh{Anim: &Anim{Bones: []Bone{{Parent: -1, Pivot: [3]float32{1, 1.5, 2}}}}}
	for i := 0; i < 8; i++ {
		x, y, z := float32(i&1)*2, float32(i>>1&1)*3, float32(i>>2&1)*4
		m.Pos = append(m.Pos, x, y, z)
		m.Normal = append(m.Normal, 0, 1, float32(i))
		m.UV = append(m.UV, float32(i)/8, 1-float32(i)/8)
		m.Color = append(m.Color, byte(i*10), byte(i*10+1), byte(i*10+2), 255)
		m.Anim.BoneIdx = append(m.Anim.BoneIdx, 0, 0, 0, 0)
		m.Anim.BoneW = append(m.Anim.BoneW, 255, 0, 0, byte(i))
		m.Room = append(m.Room, uint16(1+i/4), uint16(i))
	}
	// The six faces, two triangles each.
	quads := [][4]uint32{{0, 1, 3, 2}, {4, 6, 7, 5}, {0, 4, 5, 1}, {2, 3, 7, 6}, {0, 2, 6, 4}, {1, 5, 7, 3}}
	for _, q := range quads {
		m.Index = append(m.Index, q[0], q[1], q[2], q[0], q[2], q[3])
	}
	m.Groups = []Group{
		{Start: 0, Count: 18, Texture: `fixture\a.blp`, Blend: BlendOpaque},
		{Start: 18, Count: 18, Texture: `fixture\b.blp`, Blend: BlendAlpha, TwoSided: true, Interior: true},
	}
	m.Effects = []Effect{{Kind: "light", Pos: [3]float32{1, 2, 3}, Color: [3]float32{1, 0.5, 0}, Intensity: 2, Radius: 6}}
	m.Liquid = &LiquidMesh{
		Pos:   []float32{0, 1, 0, 2, 1, 0, 0, 1, 4, 2, 1, 4},
		UV:    []float32{0, 0, 1, 0, 0, 1, 1, 1},
		Info:  []byte{1, 2, 0, 200, 1, 2, 0, 201, 1, 2, 0, 202, 1, 2, 0, 203},
		Body:  []byte{9, 8, 7, 255, 9, 8, 7, 255, 9, 8, 7, 255, 9, 8, 7, 255},
		Room:  []uint16{2, 0, 2, 0, 2, 0, 2, 0},
		Index: []uint32{0, 2, 1, 1, 2, 3},
	}
	return m
}

// wireCollision is two faces in two groups and a liquid quad of two triangles.
func wireCollision() *collision {
	return &collision{
		faces:  []float32{0, 0, 0, 1, 0, 0, 0, 0, 1, 5, 5, 5, 6, 5, 5, 5, 5, 6},
		groups: []uint32{1, 1},
		liquid: collisionLiquids{
			verts: []float32{0, 2, 0, 3, 2, 0, 0, 2, 3, 3, 2, 3},
			tris:  []uint32{0, 2, 1, 1, 2, 3},
			types: []uint32{1, 3},
		},
	}
}

// wireNav is two rooms joined by one portal, with walking and camera faces of different counts.
func wireNav() *WMONav {
	tri := func(z float32) []float32 { return []float32{0, 0, z, 1, 0, z, 0, 1, z} }
	return &WMONav{
		Groups: []WMONavGroup{
			{Flags: 0x2000, Min: [3]float32{-5, -5, 0}, Max: [3]float32{5, 5, 11}, RefStart: 0, RefCount: 1, Fogs: [4]uint8{1, 0, 0, 0}, Name: "hall", Walk: 1, Camera: 1},
			{Flags: 0x8, Min: [3]float32{-20, -20, 10}, Max: [3]float32{20, 20, 20}, RefStart: 1, RefCount: 1, Walk: 2},
		},
		PortalVerts: []float32{-5, -5, 10, 5, -5, 10, 5, 5, 10, -5, 5, 10},
		Portals:     []WMOPortal{{Start: 0, Count: 4, Plane: [4]float32{0, 0, 1, -10}}},
		Refs:        []WMOPortalRef{{Portal: 0, Group: 1, Side: -1}, {Portal: 0, Group: 0, Side: 1}},
		Fogs:        []WMOFog{{}, {Flags: 1, Pos: [3]float32{1, 2, 3}, RadiusInner: 4, RadiusOuter: 9, End: 80, StartScalar: 0.5, Color: 0xff445566}},
		walk:        [][]float32{tri(1), append(tri(2), tri(3)...)},
		camera:      [][]float32{tri(4), nil},
	}
}

func TestWireFixtures(t *testing.T) {
	checkFixture(t, "mesh.bin", wireMesh().Encode())
	checkFixture(t, "collision.bin", wireCollision().encode())
	checkFixture(t, "wmonav.bin", wireNav().Encode())
}

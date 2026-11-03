package wow

import (
	"encoding/binary"
	"math"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

// cubeGLB is a unit cube's six faces as a GLB, two materials (a red texture and a plain grey one),
// written by Meld's own exporter.
func cubeGLB(t *testing.T) []byte {
	t.Helper()
	m := &Mesh{}
	faces := [6][3]float32{{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}}
	for _, n := range faces {
		// Two axes across the face, so that u × v = n (counter-clockwise from outside).
		var u, v [3]float32
		switch {
		case n[0] != 0:
			u, v = [3]float32{0, n[0], 0}, [3]float32{0, 0, 1}
		case n[1] != 0:
			u, v = [3]float32{0, 0, n[1]}, [3]float32{1, 0, 0}
		default:
			u, v = [3]float32{n[2], 0, 0}, [3]float32{0, 1, 0}
		}
		base := uint32(len(m.Pos) / 3)
		for _, c := range [4][2]float32{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}} {
			for k := 0; k < 3; k++ {
				m.Pos = append(m.Pos, n[k]+c[0]*u[k]+c[1]*v[k])
				m.Normal = append(m.Normal, n[k])
			}
			m.UV = append(m.UV, (c[0]+1)/2, (c[1]+1)/2)
		}
		m.Index = append(m.Index, base, base+1, base+2, base, base+2, base+3)
	}
	m.Groups = []Group{{Start: 0, Count: 18, Texture: "red"}, {Start: 18, Count: 18, Texture: "grey", TwoSided: true}}
	b, err := EncodeGLB(m, "Cube", func(p string) *Image {
		if p != "red" {
			return nil
		}
		return &Image{W: 3, H: 5, Pix: []byte(strings.Repeat("\xff\x00\x00\xff", 15))}
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestBuildM2FromGLB(t *testing.T) {
	built, err := BuildM2FromGLB(cubeGLB(t), `World\Meld\Cube-abc123`, "Cube")
	if err != nil {
		t.Fatal(err)
	}
	if built.Path != `World\Meld\Cube-abc123\Cube.m2` || built.Triangles != 12 || built.Textures != 2 || len(built.Files) != 3 {
		t.Fatalf("built %s, %d triangles, %d textures, %d files", built.Path, built.Triangles, built.Textures, len(built.Files))
	}
	m2 := built.Files[0].Data
	if len(m2)%16 != 0 {
		t.Errorf("the file is %d bytes, not a multiple of 16", len(m2))
	}
	m, err := ParseM2(m2, built.Path)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Groups) != 2 || m.Groups[0].Texture != `World\Meld\Cube-abc123\Cube_0.blp` || m.Groups[1].Texture != `World\Meld\Cube-abc123\Cube_1.blp` {
		t.Fatalf("groups %+v", m.Groups)
	}
	if m.Groups[0].TwoSided || !m.Groups[1].TwoSided || m.Groups[0].Blend != BlendOpaque {
		t.Errorf("render flags %+v", m.Groups)
	}
	if len(m.Index) != 36 || len(m.Pos) != 24*3 {
		t.Fatalf("%d indices, %d vertices", len(m.Index), len(m.Pos)/3)
	}
	// The editor reads back the cube where it was, each triangle turned the way its normal points.
	for i := 0; i < len(m.Pos); i++ {
		if v := m.Pos[i]; math.Abs(math.Abs(float64(v))-1) > 1e-6 {
			t.Fatalf("vertex %d is at %v", i/3, m.Pos[3*(i/3):3*(i/3)+3])
		}
	}
	for t3 := 0; t3 < len(m.Index); t3 += 3 {
		a, b, c := 3*int(m.Index[t3]), 3*int(m.Index[t3+1]), 3*int(m.Index[t3+2])
		ux, uy, uz := m.Pos[b]-m.Pos[a], m.Pos[b+1]-m.Pos[a+1], m.Pos[b+2]-m.Pos[a+2]
		vx, vy, vz := m.Pos[c]-m.Pos[a], m.Pos[c+1]-m.Pos[a+1], m.Pos[c+2]-m.Pos[a+2]
		nx, ny, nz := uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
		if nx*m.Normal[a]+ny*m.Normal[a+1]+nz*m.Normal[a+2] <= 0 {
			t.Fatalf("triangle %d faces away from its normal", t3/3)
		}
	}
	// The textures: a power of two each way, the red one red.
	img, err := DecodeBLP(built.Files[1].Data)
	if err != nil {
		t.Fatal(err)
	}
	if img.W != 4 || img.H != 4 || img.Pix[0] < 240 || img.Pix[1] > 16 {
		t.Errorf("texture %dx%d, first pixel %v", img.W, img.H, img.Pix[:4])
	}
	// The collision hull is the box, every face turned out of it.
	faces, err := m2HullFaces(m2)
	if err != nil {
		t.Fatal(err)
	}
	if len(faces) != 12*9 {
		t.Fatalf("%d hull triangles", len(faces)/9)
	}
	checkHullOutward(t, faces)
	r := reader{m2}
	if n, _, _ := r.arr(0xFC, 12); n != 12 {
		t.Errorf("%d hull normals", n)
	}
	for k := 0; k < 3; k++ {
		if lo, hi := r.f32(0xB4+4*k), r.f32(0xC0+4*k); lo != -1 || hi != 1 {
			t.Errorf("box axis %d: %v to %v", k, lo, hi)
		}
	}
}

// checkHullOutward fails unless every triangle of faces (nine floats each) turns away from their middle.
func checkHullOutward(t *testing.T, faces []float32) {
	t.Helper()
	var c [3]float32
	for i := 0; i < len(faces); i += 3 {
		for k := 0; k < 3; k++ {
			c[k] += faces[i+k] / float32(len(faces)/3)
		}
	}
	for i := 0; i < len(faces); i += 9 {
		f := faces[i : i+9]
		ux, uy, uz := f[3]-f[0], f[4]-f[1], f[5]-f[2]
		vx, vy, vz := f[6]-f[0], f[7]-f[1], f[8]-f[2]
		nx, ny, nz := uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
		mx, my, mz := (f[0]+f[3]+f[6])/3-c[0], (f[1]+f[4]+f[7])/3-c[1], (f[2]+f[5]+f[8])/3-c[2]
		if nx*mx+ny*my+nz*mz <= 0 {
			t.Fatalf("hull triangle %d turns inward", i/9)
		}
	}
}

func TestReadGLBNodeTransforms(t *testing.T) {
	// A mirroring scale and a quarter turn about Y: positions move, normals stay unit and outward,
	// and the mirrored triangles are wound back.
	m := nodeMatrix(nil, []float64{10, 0, 0}, []float64{0, math.Sqrt2 / 2, 0, math.Sqrt2 / 2}, []float64{-2, 1, 1})
	if det3(m) >= 0 {
		t.Fatal("the mirror has a positive determinant")
	}
	f := &glbFile{}
	p := &GLBPart{}
	// One triangle facing +Z, built straight into the binary chunk.
	pos := []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}
	nrm := []float32{0, 0, 1, 0, 0, 1, 0, 0, 1}
	f.bin = append(floatBytes(pos), floatBytes(nrm)...)
	f.doc.BufferViews = []glbBufferView{{ByteLength: 36}, {ByteOffset: 36, ByteLength: 36}}
	zero, one := 0, 1
	f.doc.Accessors = []glbAccessor{{BufferView: &zero, ComponentType: gltfFloat, Count: 3, Type: "VEC3"}, {BufferView: &one, ComponentType: gltfFloat, Count: 3, Type: "VEC3"}}
	if err := f.addPrimitive(p, map[string]int{"POSITION": 0, "NORMAL": 1}, nil, m); err != nil {
		t.Fatal(err)
	}
	// Mirror x, then turn: (1,0,0) → (-2,0,0) → a quarter turn about Y takes -X to +Z, then +10 x.
	if got := p.Pos[3:6]; math.Abs(float64(got[0]-10)) > 1e-5 || math.Abs(float64(got[2]-2)) > 1e-5 {
		t.Errorf("(1,0,0) went to %v", got)
	}
	// The +Z normal turns to +X; the winding is flipped so the triangle still faces its normal.
	if n := p.Normal[0:3]; math.Abs(float64(n[0]-1)) > 1e-5 {
		t.Errorf("normal %v", n)
	}
	a, b, c := 3*int(p.Index[0]), 3*int(p.Index[1]), 3*int(p.Index[2])
	ux, uy, uz := p.Pos[b]-p.Pos[a], p.Pos[b+1]-p.Pos[a+1], p.Pos[b+2]-p.Pos[a+2]
	vx, vy, vz := p.Pos[c]-p.Pos[a], p.Pos[c+1]-p.Pos[a+1], p.Pos[c+2]-p.Pos[a+2]
	if nx := uy*vz - uz*vy; nx <= 0 {
		t.Errorf("the mirrored triangle faces %v", [3]float32{nx, uz*vx - ux*vz, ux*vy - uy*vx})
	}
}

func TestStaticM2Limits(t *testing.T) {
	if _, err := EncodeStaticM2("x", nil); err == nil {
		t.Error("an empty model was written")
	}
	big := ModelPart{Pos: make([]float32, 3*(MaxM2Vertices+1)), Normal: make([]float32, 3*(MaxM2Vertices+1)), UV: make([]float32, 2*(MaxM2Vertices+1)), Index: []uint32{0, 1, 2}}
	if _, err := EncodeStaticM2("x", []ModelPart{big}); err == nil || !strings.Contains(err.Error(), "Decimate") {
		t.Errorf("too many vertices: %v", err)
	}
	if pow2Side(3) != 4 || pow2Side(300) != 256 || pow2Side(400) != 512 || pow2Side(5000) != maxModelTexture {
		t.Errorf("pow2Side %d %d %d %d", pow2Side(3), pow2Side(300), pow2Side(400), pow2Side(5000))
	}
}

// TestClientDoodadRoundTrip writes a client doodad, exported as Open in Blender exports it, back as an
// M2 and reads it again: the same triangles, and a header laid out as the client's own (every table
// the barrel has, in its counts where they don't depend on the mesh). The client's hull is turned the
// way this writer turns the box's.
func TestClientDoodadRoundTrip(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	const path = `World\Generic\Dwarf\Passive Doodads\Barrels\DwarvenBarrel01.m2`
	orig, err := c.read(path)
	if err != nil {
		t.Skip("no barrel in this client:", err)
	}
	faces, err := m2HullFaces(orig)
	if err != nil || len(faces) == 0 {
		t.Fatalf("the barrel's hull: %v", err)
	}
	checkHullOutward(t, faces)
	glb, err := c.ModelGLB(path)
	if err != nil {
		t.Fatal(err)
	}
	built, err := BuildM2FromGLB(glb, `World\Meld\Barrel-x`, "Barrel")
	if err != nil {
		t.Fatal(err)
	}
	want, err := ParseM2(orig, path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseM2(built.Files[0].Data, built.Path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Index) != len(want.Index) {
		t.Errorf("%d triangles back, the barrel has %d", len(got.Index)/3, len(want.Index)/3)
	}
	// It stands where the barrel stood: the same box in editor space.
	box := func(m *Mesh) [6]float32 {
		b := [6]float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32}
		for i := 0; i < len(m.Pos); i += 3 {
			for k := 0; k < 3; k++ {
				b[k], b[3+k] = min(b[k], m.Pos[i+k]), max(b[3+k], m.Pos[i+k])
			}
		}
		return b
	}
	if bw, bg := box(want), box(got); func() bool {
		for k := range bw {
			if math.Abs(float64(bw[k]-bg[k])) > 1e-4 {
				return true
			}
		}
		return false
	}() {
		t.Errorf("the box moved: %v, the barrel's %v", bg, bw)
	}
	a, b := reader{orig}, reader{built.Files[0].Data}
	for _, h := range []struct {
		at     int
		name   string
		counts bool
	}{{0x1C, "sequences", true}, {0x24, "sequence lookup", true}, {0x2C, "playable animations", true}, {0x34, "bones", true}, {0x3C, "key bones", true}, {0x4C, "views", true}, {0x64, "transparency", true}, {0x7C, "texture replacement", true}, {0x8C, "bone lookup", true}, {0x9C, "texture unit lookup", true}, {0xA4, "transparency lookup", true}, {0xAC, "texture animation lookup", true}, {0xEC, "hull", false}} {
		na, nb := a.u32(h.at), b.u32(h.at)
		if (h.counts && na != nb) || (!h.counts && (na == 0) != (nb == 0)) {
			t.Errorf("%s: %d, the barrel has %d", h.name, nb, na)
		}
	}
	// The playable table and the sequence, byte for byte but the sequence's bounds.
	pa, pb := a.u32(0x30), b.u32(0x30)
	if string(orig[pa:pa+203*4]) != string(built.Files[0].Data[pb:pb+203*4]) {
		t.Error("the playable animation table differs from the barrel's")
	}
	sa, sb := a.u32(0x20), b.u32(0x20)
	if string(orig[sa:sa+36]) != string(built.Files[0].Data[sb:sb+36]) {
		t.Errorf("the sequence differs from the barrel's:\n% x\n% x", orig[sa:sa+36], built.Files[0].Data[sb:sb+36])
	}
	if v := binary.LittleEndian.Uint32(built.Files[0].Data[4:]); v != 256 {
		t.Errorf("version %d", v)
	}
}

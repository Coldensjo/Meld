package wow

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// benchMesh is a mesh with every optional part (colours, bones, rooms, liquid), about the size of
// the Defias male (54k triangles).
func benchMesh() *Mesh {
	const n = 30000
	m := &Mesh{
		Pos: make([]float32, n*3), Normal: make([]float32, n*3), UV: make([]float32, n*2),
		Color: make([]byte, n*4), Index: make([]uint32, 54000*3), Room: make([]uint16, n*2),
		Anim: &Anim{BoneIdx: make([]byte, n*4), BoneW: make([]byte, n*4)},
	}
	for i := range m.Pos {
		m.Pos[i] = float32(i) * 0.25
		m.Normal[i] = -float32(i)
	}
	for i := range m.UV {
		m.UV[i] = float32(i) / 7
	}
	for i := range m.Index {
		m.Index[i] = uint32(i % n)
	}
	for i := range m.Room {
		m.Room[i] = uint16(i)
	}
	const ln = 100
	m.Liquid = &LiquidMesh{
		Pos: make([]float32, ln*3), UV: make([]float32, ln*2), Info: make([]byte, ln*4),
		Body: make([]byte, ln*4), Room: make([]uint16, ln*2), Index: []uint32{0, 1, 2, 2, 1, 3},
	}
	for i := range m.Liquid.Pos {
		m.Liquid.Pos[i] = float32(i) + 0.5
	}
	return m
}

// TestMeshEncodeLayout checks Encode against the layout written with binary.Write, which it
// replaced (#503), and that the buffer was sized exactly.
func TestMeshEncodeLayout(t *testing.T) {
	m := benchMesh()
	b := m.Encode()
	if len(b) != cap(b) {
		t.Fatalf("len %d cap %d: the buffer was not sized exactly", len(b), cap(b))
	}
	n := int(binary.LittleEndian.Uint32(b))
	var want bytes.Buffer
	want.Write(b[:4+n])
	le := binary.LittleEndian
	binary.Write(&want, le, m.Pos)
	binary.Write(&want, le, m.Normal)
	binary.Write(&want, le, m.UV)
	want.Write(m.Color)
	binary.Write(&want, le, m.Index)
	want.Write(m.Anim.BoneIdx)
	want.Write(m.Anim.BoneW)
	binary.Write(&want, le, m.Room)
	lq := m.Liquid
	binary.Write(&want, le, lq.Pos)
	binary.Write(&want, le, lq.UV)
	want.Write(lq.Info)
	want.Write(lq.Body)
	binary.Write(&want, le, lq.Room)
	binary.Write(&want, le, lq.Index)
	if !bytes.Equal(b, want.Bytes()) {
		t.Fatal("Encode differs from the binary.Write layout")
	}
}

func TestCollisionEncodeLayout(t *testing.T) {
	col := collision{
		faces: []float32{1, 2, 3, 4, 5, 6, 7, 8, 9.5}, groups: []uint32{1},
		liquid: collisionLiquids{verts: []float32{1, 2, 3, 4, 5, 6, 7, 8, 9}, tris: []uint32{0, 1, 2}, types: []uint32{14}},
	}
	b := col.encode()
	var want bytes.Buffer
	le := binary.LittleEndian
	binary.Write(&want, le, uint32(1))
	binary.Write(&want, le, col.faces)
	binary.Write(&want, le, uint32(1))
	binary.Write(&want, le, col.groups)
	binary.Write(&want, le, uint32(3))
	binary.Write(&want, le, col.liquid.verts)
	binary.Write(&want, le, uint32(1))
	binary.Write(&want, le, col.liquid.tris)
	binary.Write(&want, le, col.liquid.types)
	if !bytes.Equal(b, want.Bytes()) || len(b) != cap(b) {
		t.Fatalf("encode differs from the binary.Write layout (len %d cap %d)", len(b), cap(b))
	}
}

func BenchmarkMeshEncode(b *testing.B) {
	m := benchMesh()
	b.ReportAllocs()
	for b.Loop() {
		m.Encode()
	}
}

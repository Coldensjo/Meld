package wow

import (
	"encoding/binary"
	"math"
	"strings"
	"testing"
)

func TestInteriorBoxMarksEffects(t *testing.T) {
	// MOGP header: name, desc, flags (interior), bbox min/max in WoW space.
	hdr := make([]byte, 68)
	binary.LittleEndian.PutUint32(hdr[8:], 0x2000)
	for i, v := range []float32{0, 0, 0, 10, 20, 5} {
		binary.LittleEndian.PutUint32(hdr[12+i*4:], math.Float32bits(v))
	}
	file := append([]byte("PGOM"), 68, 0, 0, 0)
	file = append(file, hdr...)
	box, ok := InteriorBox(file)
	if !ok {
		t.Fatal("interior group not detected")
	}
	// WoW (x, y, z) → editor (x, z, -y): y 0..20 becomes z -20..0.
	if box != [6]float32{0, 0, -20, 10, 5, 0} {
		t.Fatalf("box = %v", box)
	}
	fx := []Effect{{Pos: [3]float32{5, 2, -10}}, {Pos: [3]float32{5, 2, 10}}}
	markInterior(fx, [][6]float32{box})
	if !fx[0].Interior || fx[1].Interior {
		t.Fatalf("interior flags = %v, %v", fx[0].Interior, fx[1].Interior)
	}

	binary.LittleEndian.PutUint32(hdr[8:], 0x8)
	file = append(append([]byte("PGOM"), 68, 0, 0, 0), hdr...)
	if _, ok := InteriorBox(file); ok {
		t.Fatal("exterior group reported as interior")
	}
}

// Consolidate keeps an interior group apart from an exterior one with the same texture (#115).
func TestConsolidateKeepsInterior(t *testing.T) {
	m := &Mesh{
		Index: []uint32{0, 1, 2, 0, 2, 3, 1, 2, 3},
		Groups: []Group{
			{Start: 0, Count: 3, Texture: "wall.blp"},
			{Start: 3, Count: 3, Texture: "wall.blp", Interior: true},
			{Start: 6, Count: 3, Texture: "wall.blp", Interior: true},
		},
	}
	m.Consolidate()
	if len(m.Groups) != 2 || m.Groups[0].Interior || !m.Groups[1].Interior || m.Groups[1].Count != 6 {
		t.Fatalf("groups: %+v", m.Groups)
	}
}

// Room tags survive Append next to untagged parts and travel after the rest of the encoded mesh.
func TestMeshRoomsEncoded(t *testing.T) {
	tri := func(room uint16) *Mesh {
		m := &Mesh{Pos: make([]float32, 9), Normal: make([]float32, 9), UV: make([]float32, 6), Index: []uint32{0, 1, 2}}
		if room > 0 {
			m.Room = []uint16{room, 0, room, 0, room, 7}
		}
		return m
	}
	m := &Mesh{}
	m.Append(tri(0))
	m.Append(tri(3))
	m.Append(tri(0))
	if len(m.Room) != 18 || m.Room[0] != 0 || m.Room[6] != 3 || m.Room[11] != 7 || m.Room[17] != 0 {
		t.Fatalf("rooms %v", m.Room)
	}
	b := m.Encode()
	n := int(binary.LittleEndian.Uint32(b))
	if !strings.Contains(string(b[4:4+n]), `"rooms":true`) {
		t.Fatal("header lacks rooms")
	}
	// 9 vertices of pos, normal, uv, 9 indices, then two tags a vertex.
	tail := b[4+n+9*(12+12+8)+9*4:]
	if len(tail) != 36 || binary.LittleEndian.Uint16(tail[12:]) != 3 || binary.LittleEndian.Uint16(tail[22:]) != 7 {
		t.Fatalf("tail %v", tail)
	}
	if strings.Contains(string(tri(0).Encode()), `"rooms"`) {
		t.Fatal("an untagged mesh claims rooms")
	}
}

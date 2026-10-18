package wow

import (
	"encoding/binary"
	"strings"
	"testing"
)

// mliqGroup builds a group file whose MOGP has flags, groupLiquid and an MLIQ of a 3x2-tile grid at
// base (100, 200, 0), heights 5 + the vertex index, the tiles' flags as given.
func mliqGroup(flags, groupLiquid int, tiles []byte) []byte {
	hdr := make([]byte, 68)
	binary.LittleEndian.PutUint32(hdr[8:], uint32(flags))
	binary.LittleEndian.PutUint32(hdr[0x34:], uint32(groupLiquid))
	mliq := le(4, 3, 3, 2, float32(100), float32(200), float32(0), u16(1))
	for k := 0; k < 12; k++ {
		mliq = append(mliq, byte(10+k), 0, 0, 0)
		mliq = append(mliq, le(float32(5+k))...)
	}
	mliq = append(mliq, tiles...)
	return append(iffChunk("MVER", le(17)), iffChunk("MOGP", append(hdr, iffChunk("MLIQ", mliq)...))...)
}

func TestGroupLiquidSurface(t *testing.T) {
	// The first tile a hole, the rest magma (6, which scrolls); an interior group.
	gb := mliqGroup(0x2000, noGroupLiquid, []byte{0x0f, 0x46, 0x06, 0x06, 0x06, 0x0f})
	l, gl, flags := GroupLiquid(gb)
	if l == nil || gl != noGroupLiquid || flags != 0x2000 {
		t.Fatalf("liquid %v, groupLiquid %d, flags %#x", l, gl, flags)
	}
	if l.XVerts != 4 || l.YVerts != 3 || l.Material != 1 || l.Heights[11] != 16 || l.Opacity[2] != 12 {
		t.Fatalf("grid %+v", l)
	}
	mats := []WMOMaterial{{}, {Diffuse: [3]byte{1, 2, 3}}}
	s := LiquidSurface(l, gl, flags, 4, mats)
	if s == nil || len(s.Index) != 4*6 || s.vertCount() != 12 {
		t.Fatalf("surface %+v", s)
	}
	// Vertex (1, 2): WoW (100 + step, 200 + 2·step, 5 + 9) → editor (x, z, -y).
	n := 2*4 + 1
	if s.Pos[n*3] != 100+mliqStep || s.Pos[n*3+1] != 14 || s.Pos[n*3+2] != -(200+2*mliqStep) {
		t.Fatalf("vertex %v", s.Pos[n*3:n*3+3])
	}
	// Magma: no opacity, no body colour, the scroll on; interior.
	if s.Info[0] != LiquidMagma || s.Info[1] != LiquidInterior || s.Info[2] != 1 || s.Info[3] != 0 || s.Body[0] != 255 {
		t.Fatalf("info %v body %v", s.Info[:4], s.Body[:4])
	}
	if s.Room[0] != 4 || s.Room[1] != 0 {
		t.Fatalf("room %v", s.Room[:2])
	}
	// Vertex 0 belongs to the hole alone, so it takes the lowest drawn height (vertex 1's, 6), not its own 5.
	if s.Pos[1] != 6 {
		t.Fatalf("undrawn vertex height %v", s.Pos[1])
	}

	// groupLiquid overrides the tiles: water, exterior, with its opacity and no body colour.
	gb = mliqGroup(0x8, 0, []byte{0x0f, 0x06, 0x06, 0x06, 0x06, 0x0f})
	l, gl, flags = GroupLiquid(gb)
	s = LiquidSurface(l, gl, flags, 1, mats)
	if s.Info[0] != LiquidRiver || s.Info[1] != LiquidExterior || s.Info[2] != 0 || s.Info[3] != 10 || s.Body[0] != 255 {
		t.Fatalf("water info %v body %v", s.Info[:4], s.Body[:4])
	}
	// An interior water pool takes its material's diffuse colour.
	s = LiquidSurface(l, gl, 0x2000, 1, mats)
	if s.Info[1] != LiquidInterior || s.Body[0] != 1 || s.Body[2] != 3 {
		t.Fatalf("interior body %v", s.Body[:4])
	}

	// Every tile a hole: no surface.
	gb = mliqGroup(0x8, noGroupLiquid, []byte{0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f})
	l, gl, flags = GroupLiquid(gb)
	if LiquidSurface(l, gl, flags, 1, mats) != nil {
		t.Fatal("all holes made a surface")
	}
	// A grid longer than its chunk: no liquid.
	short := mliqGroup(0x8, noGroupLiquid, nil)
	if l, _, _ := GroupLiquid(short); l != nil {
		t.Fatal("truncated MLIQ parsed")
	}
}

// The liquid travels after the rest of the encoded mesh, sized in the header.
func TestMeshLiquidEncoded(t *testing.T) {
	gb := mliqGroup(0x8, noGroupLiquid, []byte{0x00, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f})
	l, gl, flags := GroupLiquid(gb)
	m := &Mesh{Pos: make([]float32, 9), Normal: make([]float32, 9), UV: make([]float32, 6), Index: []uint32{0, 1, 2}}
	m.Append(&Mesh{Liquid: LiquidSurface(l, gl, flags, 2, nil)})
	b := m.Encode()
	n := int(binary.LittleEndian.Uint32(b))
	if !strings.Contains(string(b[4:4+n]), `"liquidVerts":12,"liquidIndices":6`) {
		t.Fatalf("header %s", b[4:4+n])
	}
	tail := b[4+n+3*(12+12+8)+3*4:]
	// 12 vertices of pos, uv, info, body and room, then 6 indices.
	if len(tail) != 12*(12+8+4+4+4)+6*4 {
		t.Fatalf("tail is %d bytes", len(tail))
	}
	room := tail[12*(12+8+4+4):]
	if binary.LittleEndian.Uint16(room) != 2 {
		t.Fatalf("room %v", room[:4])
	}
}

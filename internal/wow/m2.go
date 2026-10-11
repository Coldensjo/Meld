package wow

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"strings"
)

type reader struct{ b []byte }

func (r reader) u8(o int) int  { return int(r.b[o]) }
func (r reader) u16(o int) int { return int(binary.LittleEndian.Uint16(r.b[o:])) }
func (r reader) u32(o int) int { return int(binary.LittleEndian.Uint32(r.b[o:])) }
func (r reader) f32(o int) float32 {
	return math.Float32frombits(binary.LittleEndian.Uint32(r.b[o:]))
}

// arr returns (count, offset) of an M2Array at o, validated against stride.
func (r reader) arr(o, stride int) (int, int, error) {
	n, off := r.u32(o), r.u32(o+4)
	if n == 0 {
		return 0, 0, nil
	}
	if off < 0 || n < 0 || off+n*stride > len(r.b) {
		return 0, 0, fmt.Errorf("m2: array at 0x%x out of bounds", o)
	}
	return n, off, nil
}

func (r reader) cstr(off, n int) string {
	if off < 0 || off+n > len(r.b) {
		return ""
	}
	s := r.b[off : off+n]
	if i := strings.IndexByte(string(s), 0); i >= 0 {
		s = s[:i]
	}
	return string(s)
}

// ParseM2 parses a pre-WotLK (version 256-263) M2 model into a static mesh
// using the first (highest detail) view and the bind pose.
func ParseM2(b []byte) (*Mesh, error) {
	if len(b) < 0xB4 || string(b[:4]) != "MD20" {
		return nil, errors.New("m2: bad magic")
	}
	r := reader{b}
	version := r.u32(4)
	if version < 256 || version > 263 {
		return nil, fmt.Errorf("m2: unsupported version %d", version)
	}
	nVerts, ofsVerts, err := r.arr(0x44, 48)
	if err != nil {
		return nil, err
	}
	nViews, ofsViews, err := r.arr(0x4C, 44)
	if err != nil || nViews == 0 {
		return nil, errors.New("m2: no views")
	}
	nTex, ofsTex, err := r.arr(0x5C, 16)
	if err != nil {
		return nil, err
	}
	nMat, ofsMat, err := r.arr(0x84, 4)
	if err != nil {
		return nil, err
	}
	nTexLookup, ofsTexLookup, err := r.arr(0x94, 2)
	if err != nil {
		return nil, err
	}

	textures := make([]string, nTex)
	for i := range textures {
		o := ofsTex + i*16
		if r.u32(o) == 0 { // hardcoded filename; other types are replaceable skins
			n, off := r.u32(o+8), r.u32(o+12)
			textures[i] = r.cstr(off, n)
		}
	}

	v := ofsViews // view 0
	nIdx, ofsIdx, err := r.arr(v, 2)
	if err != nil {
		return nil, err
	}
	nTri, ofsTri, err := r.arr(v+8, 2)
	if err != nil {
		return nil, err
	}

	// Submesh stride grew from 32 to 48 bytes in TBC; verify which fits.
	stride := 32
	if version >= 260 {
		stride = 48
	}
	nSub, ofsSub, err := r.arr(v+24, stride)
	if err != nil || !validSubmeshes(r, ofsSub, nSub, stride, nTri) {
		alt := 80 - stride
		if n2, o2, err2 := r.arr(v+24, alt); err2 == nil && validSubmeshes(r, o2, n2, alt, nTri) {
			nSub, ofsSub, stride = n2, o2, alt
		} else if err != nil {
			return nil, err
		}
	}
	nBatch, ofsBatch, err := r.arr(v+32, 24)
	if err != nil {
		return nil, err
	}

	m := &Mesh{
		Pos:    make([]float32, 0, nIdx*3),
		Normal: make([]float32, 0, nIdx*3),
		UV:     make([]float32, 0, nIdx*2),
	}
	for i := 0; i < nIdx; i++ {
		vi := r.u16(ofsIdx + i*2)
		if vi >= nVerts {
			vi = 0
		}
		o := ofsVerts + vi*48
		x, y, z := toEditor(r.f32(o), r.f32(o+4), r.f32(o+8))
		nx, ny, nz := toEditor(r.f32(o+20), r.f32(o+24), r.f32(o+28))
		m.Pos = append(m.Pos, x, y, z)
		m.Normal = append(m.Normal, nx, ny, nz)
		m.UV = append(m.UV, r.f32(o+32), r.f32(o+36))
	}
	tri := make([]uint32, nTri)
	for i := range tri {
		t := r.u16(ofsTri + i*2)
		if t >= nIdx {
			t = 0
		}
		tri[i] = uint32(t)
	}

	for i := 0; i < nBatch; i++ {
		o := ofsBatch + i*24
		sub := r.u16(o + 4)
		matIdx := r.u16(o + 10)
		texCombo := r.u16(o + 16)
		if sub >= nSub {
			continue
		}
		so := ofsSub + sub*stride
		start := r.u16(so+8) + r.u16(so+2)<<16
		count := r.u16(so + 10)
		if start+count > nTri || count == 0 {
			continue
		}
		g := Group{Start: len(m.Index), Count: count}
		if matIdx < nMat {
			flags := r.u16(ofsMat + matIdx*4)
			g.Blend = r.u16(ofsMat + matIdx*4 + 2)
			g.Unlit = flags&0x01 != 0
			g.TwoSided = flags&0x04 != 0
		}
		if texCombo < nTexLookup {
			if ti := r.u16(ofsTexLookup + texCombo*2); ti < len(textures) {
				g.Texture = textures[ti]
			}
		}
		m.Index = append(m.Index, tri[start:start+count]...)
		m.Groups = append(m.Groups, g)
	}
	if len(m.Groups) == 0 {
		return nil, errors.New("m2: no renderable batches")
	}
	return m, nil
}

func validSubmeshes(r reader, ofs, n, stride, nTri int) bool {
	if ofs+n*stride > len(r.b) {
		return false
	}
	for i := 0; i < n; i++ {
		so := ofs + i*stride
		start := r.u16(so+8) + r.u16(so+2)<<16
		if start+r.u16(so+10) > nTri {
			return false
		}
	}
	return true
}

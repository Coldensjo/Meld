package wow

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sort"
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

// ParseM2 parses a pre-WotLK (version 256-263) M2 model using the first
// (highest detail) view. Geometry is the bind pose; the idle animation,
// lights and flame emitters are returned alongside. path feeds heuristics.
func ParseM2(b []byte, path string) (*Mesh, error) {
	return ParseM2Look(b, path, nil)
}

// ParseM2Look decodes an M2 dressed in a look (nil for none): the look's textures fill the
// model's replaceable slots by texture type, a character model (Character\...) shows only the
// look's geosets (or its default ones), and the look's animation is the loop returned. The
// look's attachments are not added here (see Client.m2Mesh), but the model's attachment points
// are kept for them.
func ParseM2Look(b []byte, path string, look *Look) (*Mesh, error) {
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
	// A batch names its texture transform through this lookup; 0xFFFF there is none.
	nUVLookup, ofsUVLookup, _ := r.arr(0xAC, 2)
	// The colours (an RGB track and an alpha track each) and transparency weights, the latter
	// through their lookup.
	nColors, ofsColors, _ := r.arr(0x54, 2*trackSize)
	nWeights, ofsWeights, _ := r.arr(0x64, trackSize)
	nWeightLookup, ofsWeightLookup, _ := r.arr(0xA4, 2)

	textures := make([]string, nTex)
	for i := range textures {
		o := ofsTex + i*16
		switch typ := r.u32(o); {
		case typ == 0: // hardcoded filename; other types are replaceable skins
			n, off := r.u32(o+8), r.u32(o+12)
			textures[i] = r.cstr(off, n)
		case look != nil:
			textures[i] = look.Textures[typ]
		}
	}
	show := geosetFilter(path, look)
	anim := 0
	if look != nil {
		anim = look.Anim
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
	vertMap := make([]int, nIdx)
	// Each group's texture transform, colour and transparency, -1 for none.
	var refs []batchRefs
	var minY, maxY, minX, maxX float32 = 1e9, -1e9, 1e9, -1e9
	for i := 0; i < nIdx; i++ {
		vi := r.u16(ofsIdx + i*2)
		if vi >= nVerts {
			vi = 0
		}
		vertMap[i] = vi
		o := ofsVerts + vi*48
		x, y, z := toEditor(r.f32(o), r.f32(o+4), r.f32(o+8))
		nx, ny, nz := toEditor(r.f32(o+20), r.f32(o+24), r.f32(o+28))
		m.Pos = append(m.Pos, x, y, z)
		m.Normal = append(m.Normal, nx, ny, nz)
		m.UV = append(m.UV, r.f32(o+32), r.f32(o+36))
		minY, maxY = min(minY, y), max(maxY, y)
		minX, maxX = min(minX, x), max(maxX, x)
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
		uvCombo := r.u16(o + 22)
		colorIdx := r.u16(o + 8)
		texCount := r.u16(o + 14)
		weightCombo := r.u16(o + 20)
		if sub >= nSub {
			continue
		}
		so := ofsSub + sub*stride
		if show != nil && !show(r.u16(so)) {
			continue // another hair style, beard, or a piece of armour
		}
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
		ref := batchRefs{uv: -1, color: -1, weight: -1}
		if uvCombo < nUVLookup {
			if ti := r.u16(ofsUVLookup + uvCombo*2); ti != 0xFFFF {
				ref.uv = ti
			}
		}
		if colorIdx < nColors {
			ref.color = colorIdx
		}
		// A batch without textures has no transparency factor.
		if texCount != 0 && weightCombo < nWeightLookup {
			if ti := r.u16(ofsWeightLookup + weightCombo*2); ti < nWeights {
				ref.weight = ti
			}
		}
		// The client never draws a batch whose colour alpha times transparency weight is a constant
		// 0 or less (0x707b3a, after Benilla's m2_batches.rs): hidden parts of a model.
		ca, cok := float32(1), true
		if ref.color >= 0 {
			ca, cok = constFixed16(r, ofsColors+ref.color*2*trackSize+trackSize)
		}
		wa, wok := float32(1), true
		if ref.weight >= 0 {
			wa, wok = constFixed16(r, ofsWeights+ref.weight*trackSize)
		}
		if cok && wok && ca*wa <= 0 {
			continue
		}
		m.Index = append(m.Index, tri[start:start+count]...)
		m.Groups = append(m.Groups, g)
		refs = append(refs, ref)
	}
	m.Anim, m.Effects, m.Emitters, m.Ribbons = parseM2Extras(r, version, vertMap, textures, path, max(maxY-minY, maxX-minX), anim, m.Groups, refs)
	m.points = parseAttachments(r)
	if len(m.Groups) == 0 && len(m.Effects) == 0 && len(m.Emitters) == 0 && len(m.Ribbons) == 0 {
		return nil, errors.New("m2: no renderable batches")
	}
	return m, nil
}

// M2Animations lists the AnimationData IDs of an M2's sequences, each once, in ID order.
func M2Animations(b []byte) ([]int, error) {
	if len(b) < 0xB4 || string(b[:4]) != "MD20" {
		return nil, errors.New("m2: bad magic")
	}
	r := reader{b}
	n, ofs, err := r.arr(0x1C, seqSize)
	if err != nil {
		return nil, err
	}
	seen := map[int]bool{}
	var out []int
	for i := 0; i < n; i++ {
		if id := r.u16(ofs + i*seqSize); !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	sort.Ints(out)
	return out, nil
}

// attachPoint is where a model holds attached items: a position in editor space on a bone.
type attachPoint struct {
	Bone int
	Pos  [3]float32
}

// parseAttachments reads the model's attachment points (48 bytes each up to TBC: ID, bone, a
// padding word, the position and an animated visibility track), by ID.
func parseAttachments(r reader) map[int]attachPoint {
	n, ofs, err := r.arr(0x104, 48)
	if err != nil || n == 0 {
		return nil
	}
	out := make(map[int]attachPoint, n)
	for i := 0; i < n; i++ {
		o := ofs + i*48
		x, y, z := toEditor(r.f32(o+8), r.f32(o+12), r.f32(o+16))
		if !finite(x, y, z) {
			continue
		}
		out[r.u32(o)] = attachPoint{Bone: r.u16(o + 4), Pos: [3]float32{x, y, z}}
	}
	return out
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

package wow

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// A static doodad written as a 1.12.1 M2 (version 256), for a model made or edited in Blender (#290).
// The layout follows the client's own still doodads (DwarvenBarrel01.m2, ElfBarrel01.m2): one stand
// sequence, one root bone every vertex hangs on, four identical views (the client picks one by its
// detail setting), one batch a part with its own hardcoded texture, an opaque white transparency
// track, and a collision hull, here the model's box. The tables and their order are those of the
// Magic Longsword writer (C:\WoW\models\magiclongsword\tools\m2write.py), which the game draws.

// ModelPart is one material of a model to write: its own vertices in editor space (Y up), its
// triangles as indices into them, its texture's client path and how it is drawn.
type ModelPart struct {
	Pos, Normal, UV []float32
	Index           []uint32
	Texture         string
	// Blend is the M2 blend mode: BlendOpaque, BlendAlphaKey or BlendAlpha.
	Blend    int
	TwoSided bool
	Unlit    bool
}

// m2Playable is the client's fallback table for a model's 203 animation IDs, copied from its
// doodads: every ID falls back to stand (0), and these play it with flags (1 backwards, 3 frozen).
var m2Playable = map[int]uint16{6: 3, 13: 1, 45: 1, 71: 3, 97: 3, 98: 1, 100: 3, 101: 1, 115: 3, 116: 1, 123: 3, 129: 1, 132: 3, 188: 3, 189: 1}

// m2Blob is an M2 file's body: blocks appended at 16-byte alignment after the header, as the
// client's models are laid out.
type m2Blob struct{ b []byte }

func (o *m2Blob) add(data []byte) uint32 {
	for len(o.b)%16 != 0 {
		o.b = append(o.b, 0)
	}
	at := len(o.b)
	o.b = append(o.b, data...)
	return uint32(at)
}

// arr puts an M2Array of n entries at ofs into the header at h.
func (o *m2Blob) arr(h int, n int, ofs uint32) {
	if n == 0 {
		ofs = 0
	}
	binary.LittleEndian.PutUint32(o.b[h:], uint32(n))
	binary.LittleEndian.PutUint32(o.b[h+4:], ofs)
}

// put appends data as an array of n entries and points the header's M2Array at h to it.
func (o *m2Blob) put(h, n int, data []byte) {
	o.arr(h, n, o.add(data))
}

type m2w struct{ b []byte }

func (w *m2w) u8(v uint8)   { w.b = append(w.b, v) }
func (w *m2w) u16(v uint16) { w.b = binary.LittleEndian.AppendUint16(w.b, v) }
func (w *m2w) i16(v int16)  { w.b = binary.LittleEndian.AppendUint16(w.b, uint16(v)) }
func (w *m2w) u32(v uint32) { w.b = binary.LittleEndian.AppendUint32(w.b, v) }
func (w *m2w) i32(v int32)  { w.b = binary.LittleEndian.AppendUint32(w.b, uint32(v)) }
func (w *m2w) f32(v ...float32) {
	for _, f := range v {
		w.b = binary.LittleEndian.AppendUint32(w.b, math.Float32bits(f))
	}
}

// emptyTrack is a vanilla M2Track (interpolation, global sequence, ranges, times, keys) with no keys.
func emptyTrack(w *m2w) {
	w.i16(0)
	w.i16(-1)
	for i := 0; i < 6; i++ {
		w.u32(0)
	}
}

// fromEditor turns an editor-space (Y up) point back into the model's own axes (Z up): toEditor's inverse.
func fromEditor(x, y, z float32) (float32, float32, float32) { return x, -z, y }

// MaxM2Vertices is how many vertices (and triangle corners) a model written by EncodeStaticM2 may
// have: a view's indices are 16-bit.
const MaxM2Vertices = 0xFFFF

// EncodeStaticM2 writes parts as a still 1.12.1 doodad named name. Each part becomes a submesh drawn
// with its texture (a hardcoded file name, wrapped both ways); the collision hull is the model's box.
func EncodeStaticM2(name string, parts []ModelPart) ([]byte, error) {
	var nVerts, nIdx int
	for _, p := range parts {
		nv := len(p.Pos) / 3
		if len(p.Pos) != 3*nv || len(p.Normal) != 3*nv || len(p.UV) != 2*nv {
			return nil, errors.New("m2: a part's normals or texture coordinates don't match its vertices")
		}
		if len(p.Index)%3 != 0 {
			return nil, errors.New("m2: a part's triangles are not in threes")
		}
		for _, i := range p.Index {
			if int(i) >= nv {
				return nil, errors.New("m2: a part's triangles name a vertex it doesn't have")
			}
		}
		nVerts += nv
		nIdx += len(p.Index)
	}
	if nIdx == 0 {
		return nil, errors.New("m2: the model has no triangles")
	}
	if nVerts > MaxM2Vertices || nIdx > MaxM2Vertices {
		return nil, fmt.Errorf("the model has %d vertices and %d triangles: a 1.12 model holds at most %d of each corner, about %d triangles; reduce it in Blender (Decimate)", nVerts, nIdx/3, MaxM2Vertices, MaxM2Vertices/3)
	}

	// Vertices in model space, each part a contiguous range, and the box around them.
	lo := [3]float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32}
	hi := [3]float32{-math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32}
	var verts m2w
	type sub struct {
		v0, nv, i0, ni int
		center         [3]float32
	}
	subs := make([]sub, 0, len(parts))
	tris := make([]uint16, 0, nIdx)
	for _, p := range parts {
		s := sub{v0: len(verts.b) / 48, nv: len(p.Pos) / 3, i0: len(tris), ni: len(p.Index)}
		var c [3]float64
		for i := 0; i < s.nv; i++ {
			x, y, z := fromEditor(p.Pos[3*i], p.Pos[3*i+1], p.Pos[3*i+2])
			nx, ny, nz := fromEditor(p.Normal[3*i], p.Normal[3*i+1], p.Normal[3*i+2])
			for k, v := range [3]float32{x, y, z} {
				lo[k], hi[k] = min(lo[k], v), max(hi[k], v)
				c[k] += float64(v)
			}
			verts.f32(x, y, z)
			verts.b = append(verts.b, 255, 0, 0, 0, 0, 0, 0, 0) // all weight on bone 0
			verts.f32(nx, ny, nz, p.UV[2*i], p.UV[2*i+1], 0, 0)
		}
		if s.nv > 0 {
			for k := range s.center {
				s.center[k] = float32(c[k] / float64(s.nv))
			}
		}
		for _, i := range p.Index {
			tris = append(tris, uint16(s.v0+int(i)))
		}
		subs = append(subs, s)
	}
	var center [3]float32
	for k := range center {
		center[k] = (lo[k] + hi[k]) / 2
	}
	var radius float64
	for i := 0; i < nVerts; i++ {
		var d float64
		for k := 0; k < 3; k++ {
			v := math.Float32frombits(binary.LittleEndian.Uint32(verts.b[i*48+4*k:]))
			d += float64(v-center[k]) * float64(v-center[k])
		}
		radius = max(radius, d)
	}
	boxRadius := float32(math.Sqrt(radius))
	half := math.Sqrt(float64(sq32(hi[0]-lo[0]) + sq32(hi[1]-lo[1]) + sq32(hi[2]-lo[2])))
	colRadius := float32(half / 2)

	o := &m2Blob{b: make([]byte, m2HeaderSize)}
	copy(o.b, "MD20")
	binary.LittleEndian.PutUint32(o.b[4:], 256)

	nm := append([]byte(name), 0)
	o.put(0x08, len(nm), nm)

	// One stand sequence, as the client's doodads have it (0 to 3333 ms, frequency 0x7FFF, blend 150).
	var seq m2w
	seq.u16(0)
	seq.u16(0)
	seq.u32(0)
	seq.u32(3333)
	seq.f32(0)
	seq.u32(0)
	seq.i16(0x7FFF)
	seq.u16(0)
	seq.u32(0)
	seq.u32(0)
	seq.u32(150)
	seq.f32(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], boxRadius)
	seq.i16(-1)
	seq.u16(0)
	o.put(0x1C, 1, seq.b)
	var lookup m2w
	lookup.i16(0)
	o.put(0x24, 1, lookup.b)
	var playable m2w
	for i := 0; i < 203; i++ {
		playable.i16(0)
		playable.u16(m2Playable[i])
	}
	o.put(0x2C, 203, playable.b)

	var bone m2w
	bone.i32(-1)
	bone.u32(0)
	bone.i16(-1)
	bone.u16(0)
	emptyTrack(&bone)
	emptyTrack(&bone)
	emptyTrack(&bone)
	bone.f32(0, 0, 0)
	o.put(0x34, 1, bone.b)
	var keyBone m2w
	keyBone.i16(-1)
	o.put(0x3C, 1, keyBone.b)
	o.put(0x44, nVerts, verts.b)

	// Four views of the same mesh, each with its own copy of the tables, as the client's doodads have.
	var indices, triBytes m2w
	for i := 0; i < nVerts; i++ {
		indices.u16(uint16(i))
	}
	for _, t := range tris {
		triBytes.u16(t)
	}
	views := make([]m2w, 4)
	for v, lod := range [4]uint32{256, 75, 53, 21} {
		iOfs := o.add(indices.b)
		tOfs := o.add(triBytes.b)
		pOfs := o.add(make([]byte, 4*nVerts))
		var sm m2w
		for _, s := range subs {
			sm.u16(0) // geoset id
			sm.u16(uint16(s.i0 >> 16))
			sm.u16(uint16(s.v0))
			sm.u16(uint16(s.nv))
			sm.u16(uint16(s.i0))
			sm.u16(uint16(s.ni))
			sm.u16(1) // bone count
			sm.u16(0) // bone combo index
			sm.u16(1) // bone influences
			sm.u16(0) // centre bone
			sm.f32(s.center[0], s.center[1], s.center[2])
		}
		sOfs := o.add(sm.b)
		var units m2w
		for i := range subs {
			units.u8(0x10)
			units.u8(0)
			units.u16(0)
			units.u16(uint16(i)) // submesh
			units.u16(uint16(i)) // geoset
			units.i16(-1)        // no colour
			units.u16(uint16(i)) // render flags
			units.u16(0)         // layer
			units.u16(1)         // texture count
			units.u16(uint16(i)) // texture lookup
			units.u16(0)         // texture coordinates lookup
			units.u16(0)         // transparency lookup
			units.u16(0)         // texture transform lookup (none)
		}
		uOfs := o.add(units.b)
		w := &views[v]
		for _, a := range [][2]uint32{{uint32(nVerts), iOfs}, {uint32(len(tris)), tOfs}, {uint32(nVerts), pOfs}, {uint32(len(subs)), sOfs}, {uint32(len(subs)), uOfs}} {
			w.u32(a[0])
			w.u32(a[1])
		}
		w.u32(lod)
	}
	var vb []byte
	for _, v := range views {
		vb = append(vb, v.b...)
	}
	o.put(0x4C, 4, vb)

	// Textures: each part's, by name, wrapped both ways. Names come after the table.
	names := make([]uint32, len(parts))
	for i, p := range parts {
		names[i] = o.add(append([]byte(p.Texture), 0))
	}
	var tex m2w
	for i, p := range parts {
		tex.u32(0) // hardcoded
		tex.u32(3) // wrap x and y
		tex.u32(uint32(len(p.Texture) + 1))
		tex.u32(names[i])
	}
	o.put(0x5C, len(parts), tex.b)

	// One transparency track: opaque, one key at 0.
	tOfs := o.add([]byte{0, 0, 0, 0})
	kOfs := o.add([]byte{0xFF, 0x7F})
	var transp m2w
	transp.i16(0)
	transp.i16(-1)
	transp.u32(0)
	transp.u32(0)
	transp.u32(1)
	transp.u32(tOfs)
	transp.u32(1)
	transp.u32(kOfs)
	o.put(0x64, 1, transp.b)

	var replace m2w
	replace.i16(0)
	o.put(0x7C, 1, replace.b)
	var flags m2w
	for _, p := range parts {
		var f uint16
		if p.Unlit {
			f |= 0x01
		}
		if p.TwoSided {
			f |= 0x04
		}
		flags.u16(f)
		flags.u16(uint16(p.Blend))
	}
	o.put(0x84, len(parts), flags.b)
	o.put(0x8C, 4, make([]byte, 8))
	var texLookup m2w
	for i := range parts {
		texLookup.i16(int16(i))
	}
	o.put(0x94, len(parts), texLookup.b)
	o.put(0x9C, 1, []byte{0, 0})
	o.put(0xA4, 1, []byte{0, 0})
	o.put(0xAC, 1, []byte{0xFF, 0xFF})

	// The bounding box, then the collision box as the client's doodads store it (highest corner first).
	var hdr m2w
	hdr.f32(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], boxRadius)
	hdr.f32(hi[0], hi[1], hi[2], lo[0], lo[1], lo[2], colRadius)
	copy(o.b[0xB4:], hdr.b)

	// The collision hull: the box's twelve triangles, each turned out of the box, and their normals.
	corner := func(i int) [3]float32 {
		c := lo
		for k := 0; k < 3; k++ {
			if i&(1<<k) != 0 {
				c[k] = hi[k]
			}
		}
		return c
	}
	var colTris, colVerts, colNormals m2w
	for i := 0; i < 8; i++ {
		c := corner(i)
		colVerts.f32(c[0], c[1], c[2])
	}
	// Each face as four corners counter-clockwise seen from outside (bit 0 x, bit 1 y, bit 2 z).
	faces := [6]struct {
		c [4]uint16
		n [3]float32
	}{
		{[4]uint16{0, 4, 6, 2}, [3]float32{-1, 0, 0}},
		{[4]uint16{1, 3, 7, 5}, [3]float32{1, 0, 0}},
		{[4]uint16{0, 1, 5, 4}, [3]float32{0, -1, 0}},
		{[4]uint16{2, 6, 7, 3}, [3]float32{0, 1, 0}},
		{[4]uint16{0, 2, 3, 1}, [3]float32{0, 0, -1}},
		{[4]uint16{4, 5, 7, 6}, [3]float32{0, 0, 1}},
	}
	for _, f := range faces {
		for _, t := range [2][3]int{{0, 1, 2}, {0, 2, 3}} {
			for _, k := range t {
				colTris.u16(f.c[k])
			}
			colNormals.f32(f.n[0], f.n[1], f.n[2])
		}
	}
	o.put(0xEC, 36, colTris.b)
	o.put(0xF4, 8, colVerts.b)
	o.put(0xFC, 12, colNormals.b)
	for len(o.b)%16 != 0 {
		o.b = append(o.b, 0)
	}
	return o.b, nil
}

func sq32(v float32) float32 { return v * v }

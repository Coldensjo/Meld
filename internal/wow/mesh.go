package wow

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
)

// Blend modes (same numbering as M2 materials).
const (
	BlendOpaque   = 0
	BlendAlphaKey = 1
	BlendAlpha    = 2
	BlendAdd      = 3 // no-alpha add
	BlendAddAlpha = 4
	BlendMod      = 5
	BlendMod2x    = 6
)

// Group is a run of triangles sharing one material.
type Group struct {
	Start    int    `json:"start"`
	Count    int    `json:"count"`
	Texture  string `json:"texture"`
	Blend    int    `json:"blend"`
	TwoSided bool   `json:"twoSided"`
	Unlit    bool   `json:"unlit"`
	// Interior marks a WMO group inside a building or cave: the game lights it from its baked
	// vertex colours, not the sun and sky, so the editor draws it unlit too.
	Interior bool `json:"interior,omitempty"`
	// UV is the group's texture animation (an M2 batch's texture transform), nil for a still one.
	UV *UVAnim `json:"uv,omitempty"`
	// Color is the group's colour and transparency (an M2 batch's colour and texture weight), nil
	// for plain white and opaque.
	Color *ColorAnim `json:"color,omitempty"`
}

// ColorAnim is an M2 batch's colour for the model's clip: the client multiplies its RGB into the
// batch's colour and draws it at alpha times weight, hiding it at 0 (Benilla's mat_anim.rs,
// MIT/Apache). A channel that only holds its identity is nil; a constant is one key.
type ColorAnim struct {
	RGB    *Track `json:"rgb,omitempty"`
	Alpha  *Track `json:"a,omitempty"`
	Weight *Track `json:"w,omitempty"`
}

// UVAnim is an M2 texture transform resolved for the model's clip, in the model's own UV space: the
// client draws uv' = R((uv + T - p) * S) + p about p = (0.5, 0.5) (Benilla's tex_anim.rs, MIT/Apache).
// A channel that never leaves its identity is nil.
type UVAnim struct {
	T *Track `json:"t,omitempty"` // u, v, w (w unused)
	R *Track `json:"r,omitempty"` // a raw quaternion; only its z turn is used
	S *Track `json:"s,omitempty"` // u, v, w (w unused)
}

// Mesh is a static, renderer-ready mesh in editor space (Y up, yards).
type Mesh struct {
	Pos    []float32 // xyz
	Normal []float32 // xyz
	UV     []float32 // uv
	Color  []byte    // rgba, optional (len 0 or 4*verts)
	Index  []uint32
	Groups []Group
	// Anim is set for models with a moving idle animation (bone data per vertex).
	Anim *Anim
	// Effects are lights/flames in model space (editor coordinates).
	Effects []Effect
	// Emitters are an M2's particle emitters, their frames in model space (editor coordinates).
	Emitters []Emitter
	// points are an M2's attachment points by ID, for the items a look attaches. Not encoded.
	points map[int]attachPoint
}

// Attach welds an item model onto m at attachment point id, which the item is modelled around.
// When m animates, the item's vertices follow the point's bone, so a weapon stays in the hand.
// It reports false when m has no such point.
func (m *Mesh) Attach(id int, item *Mesh) bool {
	p, ok := m.points[id]
	if !ok || item == nil {
		return false
	}
	base := m.vertCount()
	cp := &Mesh{
		Pos:    append([]float32(nil), item.Pos...),
		Normal: item.Normal,
		UV:     item.UV,
		Color:  item.Color,
		Index:  item.Index,
		Groups: item.Groups,
	}
	for i := 0; i < len(cp.Pos); i += 3 {
		cp.Pos[i] += p.Pos[0]
		cp.Pos[i+1] += p.Pos[1]
		cp.Pos[i+2] += p.Pos[2]
	}
	for _, e := range item.Effects {
		e.Pos = [3]float32{e.Pos[0] + p.Pos[0], e.Pos[1] + p.Pos[1], e.Pos[2] + p.Pos[2]}
		cp.Effects = append(cp.Effects, e)
	}
	// The item's emitters ride the point's bone, as its vertices do.
	for _, e := range item.Emitters {
		e.Frame[12] += p.Pos[0]
		e.Frame[13] += p.Pos[1]
		e.Frame[14] += p.Pos[2]
		e.Bone = -1
		if m.Anim != nil {
			e.Bone = p.Bone
		}
		cp.Emitters = append(cp.Emitters, e)
	}
	m.Append(cp)
	if m.Anim != nil {
		n := m.vertCount() - base
		bone := byte(0)
		if p.Bone < 256 {
			bone = byte(p.Bone)
		}
		for i := 0; i < n; i++ {
			m.Anim.BoneIdx = append(m.Anim.BoneIdx, bone, 0, 0, 0)
			m.Anim.BoneW = append(m.Anim.BoneW, 255, 0, 0, 0)
		}
	}
	return true
}

func (m *Mesh) vertCount() int { return len(m.Pos) / 3 }

// toEditor converts WoW model space (Z up) to editor space (Y up):
// (x, y, z) → (x, z, -y), a proper rotation so winding is preserved.
func toEditor(x, y, z float32) (float32, float32, float32) { return x, z, -y }

// Append merges o into m, offsetting indices.
func (m *Mesh) Append(o *Mesh) {
	base := uint32(m.vertCount())
	if len(o.Color) > 0 && len(m.Color) == 0 && base > 0 {
		m.Color = whiteColors(int(base))
	}
	m.Pos = append(m.Pos, o.Pos...)
	m.Normal = append(m.Normal, o.Normal...)
	m.UV = append(m.UV, o.UV...)
	if len(o.Color) > 0 {
		m.Color = append(m.Color, o.Color...)
	} else if len(m.Color) > 0 {
		m.Color = append(m.Color, whiteColors(o.vertCount())...)
	}
	start := len(m.Index)
	for _, i := range o.Index {
		m.Index = append(m.Index, i+base)
	}
	for _, g := range o.Groups {
		g.Start += start
		m.Groups = append(m.Groups, g)
	}
	m.Effects = append(m.Effects, o.Effects...)
	m.Emitters = append(m.Emitters, o.Emitters...)
}

func whiteColors(n int) []byte {
	c := make([]byte, n*4)
	for i := range c {
		c[i] = 255
	}
	return c
}

// Consolidate reorders indices so groups with identical materials become one
// contiguous group — fewer draw calls for the renderer.
func (m *Mesh) Consolidate() {
	type key struct {
		tex             string
		blend           int
		twoSided, unlit bool
		uv              *UVAnim
		color           *ColorAnim
	}
	order := []key{}
	buckets := map[key][]uint32{}
	for _, g := range m.Groups {
		k := key{g.Texture, g.Blend, g.TwoSided, g.Unlit, g.UV, g.Color}
		if _, ok := buckets[k]; !ok {
			order = append(order, k)
		}
		buckets[k] = append(buckets[k], m.Index[g.Start:g.Start+g.Count]...)
	}
	idx := make([]uint32, 0, len(m.Index))
	groups := make([]Group, 0, len(order))
	// Opaque first, then alpha-keyed, then blended: helps the renderer.
	for pass := 0; pass < 3; pass++ {
		for _, k := range order {
			p := 2
			if k.blend == BlendOpaque {
				p = 0
			} else if k.blend == BlendAlphaKey {
				p = 1
			}
			if p != pass {
				continue
			}
			b := buckets[k]
			groups = append(groups, Group{Start: len(idx), Count: len(b), Texture: k.tex, Blend: k.blend, TwoSided: k.twoSided, Unlit: k.unlit, UV: k.uv, Color: k.color})
			idx = append(idx, b...)
		}
	}
	m.Index = idx
	m.Groups = groups
}

type meshHeader struct {
	Verts    int       `json:"verts"`
	Indices  int       `json:"indices"`
	Colors   bool      `json:"colors"`
	Groups   []Group   `json:"groups"`
	BBox     []float32 `json:"bbox"`
	Bones    []Bone    `json:"bones,omitempty"`
	Effects  []Effect  `json:"effects,omitempty"`
	Emitters []Emitter `json:"emitters,omitempty"`
}

// Encode serialises the mesh for the frontend:
// u32 headerLen | JSON header | pad to 4 | pos | normal | uv | [color] | index(u32) | [boneIdx u8x4 | boneW u8x4]
func (m *Mesh) Encode() []byte {
	n := m.vertCount()
	mn := [3]float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32}
	mx := [3]float32{-math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32}
	for i := 0; i < n; i++ {
		for k := 0; k < 3; k++ {
			v := m.Pos[i*3+k]
			mn[k] = min(mn[k], v)
			mx[k] = max(mx[k], v)
		}
	}
	if n == 0 {
		mn, mx = [3]float32{}, [3]float32{}
	}
	h := meshHeader{
		Verts: n, Indices: len(m.Index), Colors: len(m.Color) == n*4 && n > 0, Groups: m.Groups,
		BBox: []float32{mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]}, Effects: m.Effects, Emitters: m.Emitters,
	}
	hasAnim := m.Anim != nil && len(m.Anim.BoneIdx) == n*4
	if hasAnim {
		h.Bones = m.Anim.Bones
	}
	hdr, _ := json.Marshal(h)
	for len(hdr)%4 != 0 {
		hdr = append(hdr, ' ')
	}
	var buf bytes.Buffer
	buf.Grow(4 + len(hdr) + n*32 + len(m.Index)*4)
	binary.Write(&buf, binary.LittleEndian, uint32(len(hdr)))
	buf.Write(hdr)
	binary.Write(&buf, binary.LittleEndian, m.Pos)
	binary.Write(&buf, binary.LittleEndian, m.Normal)
	binary.Write(&buf, binary.LittleEndian, m.UV)
	if len(m.Color) == n*4 && n > 0 {
		buf.Write(m.Color)
	}
	binary.Write(&buf, binary.LittleEndian, m.Index)
	if hasAnim {
		buf.Write(m.Anim.BoneIdx)
		buf.Write(m.Anim.BoneW)
	}
	return buf.Bytes()
}

package wow

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
)

// The collision a placed model brings to the walkable-ground preview (View › Walkable ground, #175):
// the faces the server's movement maps are built from. An M2's is its collision hull, the MD20
// header's bounding vertices (0xF4) and triangles (0xEC), far smaller than the render mesh and
// without the leaves and grass that have none; a WMO's is every group's walking faces (all but
// DETAIL, as wmonav.go gathers them) and the hulls of the doodads its placement shows. Ported from
// Benilla's collision.rs (MIT/Apache-2.0). Everything is in editor space (Y up), each triangle
// wound so its normal points out of the solid, as the render meshes are.

// m2HullFaces returns an M2's collision hull, nine floats a triangle in editor space, or nil for a
// model without one.
func m2HullFaces(b []byte) ([]float32, error) {
	if len(b) < 0x104 || string(b[:4]) != "MD20" {
		return nil, errors.New("m2: bad magic")
	}
	r := reader{b}
	nIdx, ofsIdx, err := r.arr(0xEC, 2)
	if err != nil {
		return nil, err
	}
	nv, ofsV, err := r.arr(0xF4, 12)
	if err != nil {
		return nil, err
	}
	out := make([]float32, 0, nIdx/3*9)
	for t := 0; t+2 < nIdx; t += 3 {
		a, bb, c := r.u16(ofsIdx+t*2), r.u16(ofsIdx+t*2+2), r.u16(ofsIdx+t*2+4)
		if a >= nv || bb >= nv || c >= nv {
			continue
		}
		// As read, the hull's faces turn outward in editor space (TestClientCollision checks a
		// crate's). VMaNGOS's mmap builder reverses them only for its own axes.
		for _, v := range [3]int{a, bb, c} {
			o := ofsV + v*12
			x, y, z := toEditor(r.f32(o), r.f32(o+4), r.f32(o+8))
			out = append(out, x, y, z)
		}
	}
	return out, nil
}

// Collision returns a model's collision faces for the /wow/collision endpoint: a u32 triangle
// count, then nine float32 a triangle (editor space, the model's own frame). set is a WMO
// placement's doodad set, as for Model.
func (c *Client) Collision(path string, set int) ([]byte, error) {
	key := fmt.Sprintf("col:%s|%d", strings.ToLower(path), set)
	return c.cached(key, func() ([]byte, error) {
		var faces []float32
		var err error
		if strings.HasSuffix(strings.ToLower(path), ".wmo") {
			faces, err = c.wmoCollision(path, set)
		} else {
			var raw []byte
			if raw, err = c.readM2(path); err == nil {
				faces, err = m2HullFaces(raw)
			}
		}
		if err != nil {
			return nil, err
		}
		return encodeFaces(faces), nil
	})
}

func encodeFaces(faces []float32) []byte {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(len(faces)/9))
	binary.Write(&buf, binary.LittleEndian, faces)
	return buf.Bytes()
}

// wmoCollision gathers a WMO's walking faces and its shown doodads' hulls in editor space.
func (c *Client) wmoCollision(path string, set int) ([]float32, error) {
	raw, err := c.read(path)
	if err != nil {
		return nil, err
	}
	root, err := ParseWMORoot(raw)
	if err != nil {
		return nil, err
	}
	groups := make([][]byte, root.NumGroups)
	for i := range groups {
		groups[i], _ = c.read(GroupPath(path, i))
	}
	nav, err := ParseWMONav(raw, groups)
	if err != nil {
		return nil, err
	}
	var faces []float32
	for _, g := range nav.walk {
		for i := 0; i+2 < len(g); i += 3 {
			x, y, z := toEditor(g[i], g[i+1], g[i+2])
			faces = append(faces, x, y, z)
		}
	}
	hulls := map[string][]float32{}
	for _, di := range root.DoodadIndicesOf(set) {
		d := root.AllDoodads[di]
		key := strings.ToLower(d.Model)
		hull, ok := hulls[key]
		if !ok {
			if b, err := c.readM2(d.Model); err == nil {
				hull, _ = m2HullFaces(b)
			}
			hulls[key] = hull
		}
		if len(hull) == 0 {
			continue
		}
		m := &Mesh{Pos: append([]float32(nil), hull...), Normal: make([]float32, len(hull))}
		m.TransformWoW(d.Pos, d.Rot, d.Scale)
		faces = append(faces, m.Pos...)
	}
	return faces, nil
}

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
// without the leaves and grass that have none; a WMO's is what VMaNGOS's vmap extractor takes
// (#283): each kept group's collision faces (serverCollides, serverSkips in wmonav.go) and the hulls
// of the doodads in the placement's own set that a kept group references. Ported from
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
// count, nine float32 a triangle (editor space, the model's own frame), then a u32 group count and
// each group's triangle count. The groups are the pieces the server's vmaps keep apart, each a
// GroupModel its mmap builder asks whether ground lies under it (#282): an M2's hull is one, a
// WMO's groups and its doodads' hulls one each. set is a WMO placement's doodad set, as for Model.
func (c *Client) Collision(path string, set int) ([]byte, error) {
	key := fmt.Sprintf("col:%s|%d", strings.ToLower(path), set)
	return c.cached(key, func() ([]byte, error) {
		var faces []float32
		var groups []uint32
		var err error
		if strings.HasSuffix(strings.ToLower(path), ".wmo") {
			faces, groups, err = c.wmoCollision(path, set)
		} else {
			var raw []byte
			if raw, err = c.readM2(path); err == nil {
				faces, err = m2HullFaces(raw)
				groups = []uint32{uint32(len(faces) / 9)}
			}
		}
		if err != nil {
			return nil, err
		}
		return encodeFaces(faces, groups), nil
	})
}

func encodeFaces(faces []float32, groups []uint32) []byte {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(len(faces)/9))
	binary.Write(&buf, binary.LittleEndian, faces)
	binary.Write(&buf, binary.LittleEndian, uint32(len(groups)))
	binary.Write(&buf, binary.LittleEndian, groups)
	return buf.Bytes()
}

// wmoCollision gathers a WMO's collision faces and its doodads' hulls in editor space as the
// server's vmap extractor does, with the triangle count of each group and each doodad that brings
// any. The doodads are those of the placement's set alone (Doodad::ExtractSet), not set 0 with it
// as the client draws them, and only those a kept group's MODR names (ExtractSingleWmo).
func (c *Client) wmoCollision(path string, set int) ([]float32, []uint32, error) {
	raw, err := c.read(path)
	if err != nil {
		return nil, nil, err
	}
	root, err := ParseWMORoot(raw)
	if err != nil {
		return nil, nil, err
	}
	groups := make([][]byte, root.NumGroups)
	for i := range groups {
		groups[i], _ = c.read(GroupPath(path, i))
	}
	nav, err := ParseWMONav(raw, groups)
	if err != nil {
		return nil, nil, err
	}
	var faces []float32
	var counts []uint32
	referenced := map[int]bool{}
	for gi, g := range nav.collide {
		if nav.Groups[gi].serverSkips() {
			continue
		}
		if gi < len(groups) && groups[gi] != nil {
			for _, d := range GroupDoodadRefs(groups[gi]) {
				referenced[d] = true
			}
		}
		if len(g) < 9 {
			continue
		}
		for i := 0; i+2 < len(g); i += 3 {
			x, y, z := toEditor(g[i], g[i+1], g[i+2])
			faces = append(faces, x, y, z)
		}
		counts = append(counts, uint32(len(g)/9))
	}
	hulls := map[string][]float32{}
	if set < 0 || set >= len(root.Sets) {
		return faces, counts, nil
	}
	s := root.Sets[set]
	for di := s.Start; di < s.Start+s.Count && di < len(root.AllDoodads); di++ {
		d := root.AllDoodads[di]
		if !referenced[di] || d.Model == "" {
			continue
		}
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
		counts = append(counts, uint32(len(m.Pos)/9))
	}
	return faces, counts, nil
}

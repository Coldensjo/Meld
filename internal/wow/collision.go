package wow

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"strings"
)

// The collision a placed model brings to the walkable-ground preview (Show › Walkable ground, #175):
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
// WMO's groups and its doodads' hulls one each. Then the liquids inside a WMO (#281; none for an
// M2): a u32 vertex count and three float32 a vertex, a u32 triangle count, three u32 vertex
// indices a triangle, and each triangle's liquid type (u32, collisionLiquids). Last, each group's
// box and then the liquids' (six float32 each: the lowest x, y and z, then the highest; +Inf and -Inf
// when empty), the walkable-ground view's TypeIndex (navGeometry.ts), so the page need not pass over
// every vertex for them (#869). set is a WMO placement's doodad set, as for Model.
func (c *Client) Collision(path string, set int) ([]byte, error) {
	key := fmt.Sprintf("col:%s|%d", strings.ToLower(path), set)
	return c.cached(key, func() ([]byte, error) {
		var col collision
		var err error
		if strings.HasSuffix(strings.ToLower(path), ".wmo") {
			col, err = c.wmoCollision(path, set)
		} else {
			var raw []byte
			if raw, err = c.readM2(path); err == nil {
				col.faces, err = m2HullFaces(raw)
				col.groups = []uint32{uint32(len(col.faces) / 9)}
			}
		}
		if err != nil {
			return nil, err
		}
		return col.encode(), nil
	})
}

// collision is what Collision sends: the faces with each group's triangle count, and the liquids.
type collision struct {
	faces  []float32
	groups []uint32
	liquid collisionLiquids
}

// collisionLiquids are a WMO's liquids as the server's vmaps hold them: every vertex of each kept
// group's MLIQ grid at its own height (a dry tile's too, since the mmap builder's height span counts
// them), in editor space; two triangles a wet tile (its nibble not 0xf); and each triangle's liquid
// type as the vmap extractor writes it (serverLiquidType), which the navmesh turns into an area.
type collisionLiquids struct {
	verts []float32
	tris  []uint32
	types []uint32
}

func (col *collision) encode() []byte {
	l := &col.liquid
	le := binary.LittleEndian
	b := make([]byte, 0, 16+4*(len(col.faces)+len(col.groups)+len(l.verts)+len(l.tris)+len(l.types)+6*len(col.groups)+6))
	b = le.AppendUint32(b, uint32(len(col.faces)/9))
	b = appendF32(b, col.faces)
	b = le.AppendUint32(b, uint32(len(col.groups)))
	b = appendU32(b, col.groups)
	b = le.AppendUint32(b, uint32(len(l.verts)/3))
	b = appendF32(b, l.verts)
	b = le.AppendUint32(b, uint32(len(l.types)))
	b = appendU32(b, l.tris)
	b = appendU32(b, l.types)
	start := 0
	for _, n := range col.groups {
		end := min(len(col.faces), start+int(n)*9)
		box := pointsBox(col.faces[min(start, end):end])
		b = appendF32(b, box[:])
		start = end
	}
	box := pointsBox(l.verts)
	return appendF32(b, box[:])
}

// pointsBox is the box of the points pts (three float32 each): the lowest x, y and z, then the
// highest, +Inf and -Inf when there are none. It must match localBox in navGeometry.ts to the bit,
// since the whole box sets a client tile's height span (#282, #866): float32 compared as it is
// there, a NaN passed over.
func pointsBox(pts []float32) [6]float32 {
	inf := float32(math.Inf(1))
	box := [6]float32{inf, inf, inf, -inf, -inf, -inf}
	for i := 0; i+2 < len(pts); i += 3 {
		for k := 0; k < 3; k++ {
			v := pts[i+k]
			if v < box[k] {
				box[k] = v
			}
			if v > box[3+k] {
				box[3+k] = v
			}
		}
	}
	return box
}

// serverLiquidType is the liquid type the vmap extractor gives a group's MLIQ
// (WMOGroup::ConvertToVMAPGroupWmo), a LiquidType.dbc ID: the group's groupLiquid (plus one, unless
// the root's flags have 4; 0xf is none), else the first wet tile's nibble plus one; then by that
// ID's low bits water (1, or 2 in a group with flag 0x80000), ocean (2), magma (3) or slime (4).
// The extractor makes Naxxramas's slime 21, which the navmesh takes as water as it does 4.
func serverLiquidType(groupLiquid, groupFlags, rootFlags int, tiles []byte) int {
	t := groupLiquid
	if rootFlags&4 == 0 {
		if groupLiquid == noGroupLiquid {
			t = 0
		} else {
			t = groupLiquid + 1
		}
	}
	if t == 0 {
		for _, f := range tiles {
			if f&0xf != 0xf {
				t = int(f&0xf) + 1
				break
			}
		}
	}
	if t > 0 && t < 21 {
		switch (t - 1) & 3 {
		case 0:
			t = 1
			if groupFlags&0x80000 != 0 {
				t = 2
			}
		case 1:
			t = 2
		case 2:
			t = 3
		case 3:
			t = 4
		}
	}
	return t
}

// add appends a group's liquid l, of the extractor's type t.
func (o *collisionLiquids) add(l *WMOLiquid, t int) {
	xv, yv, xt, yt := l.XVerts, l.YVerts, l.XTiles, l.YTiles
	if xt+1 != xv || yt+1 != yv || len(l.Heights) < xv*yv || len(l.Tiles) < xt*yt {
		return
	}
	base := uint32(len(o.verts) / 3)
	for j := 0; j < yv; j++ {
		for i := 0; i < xv; i++ {
			x, y, z := toEditor(l.Base[0]+float32(i)*mliqStep, l.Base[1]+float32(j)*mliqStep, l.Heights[j*xv+i])
			o.verts = append(o.verts, x, y, z)
		}
	}
	for ty := 0; ty < yt; ty++ {
		for tx := 0; tx < xt; tx++ {
			if l.Tiles[ty*xt+tx]&0xf == 0xf {
				continue
			}
			tl := base + uint32(ty*xv+tx)
			bl := tl + uint32(xv)
			o.tris = append(o.tris, tl, bl, bl+1, tl, bl+1, tl+1)
			o.types = append(o.types, uint32(t), uint32(t))
		}
	}
}

// wmoCollision gathers a WMO's collision faces and its doodads' hulls in editor space as the
// server's vmap extractor does, with the triangle count of each group and each doodad that brings
// any, and the liquids of the groups it keeps. The doodads are those of the placement's set alone
// (Doodad::ExtractSet), not set 0 with it as the client draws them, and only those a kept group's
// MODR names (ExtractSingleWmo).
func (c *Client) wmoCollision(path string, set int) (collision, error) {
	var col collision
	raw, err := c.read(path)
	if err != nil {
		return col, err
	}
	root, err := ParseWMORoot(raw)
	if err != nil {
		return col, err
	}
	groups := make([][]byte, root.NumGroups)
	for i := range groups {
		groups[i], _ = c.read(GroupPath(path, i))
	}
	nav, err := ParseWMONav(raw, groups)
	if err != nil {
		return col, err
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
			if l, gl, flags := GroupLiquid(groups[gi]); l != nil {
				col.liquid.add(l, serverLiquidType(gl, flags, root.Flags, l.Tiles))
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
	if set < 0 || set >= len(root.Sets) {
		col.faces, col.groups = faces, counts
		return col, nil
	}
	s := root.Sets[set]
	for di := s.Start; di < s.Start+s.Count && di < len(root.AllDoodads); di++ {
		d := root.AllDoodads[di]
		if !referenced[di] || d.Model == "" {
			continue
		}
		hull := c.doodadHull(d.Model)
		if len(hull) == 0 {
			continue
		}
		m := &Mesh{Pos: append([]float32(nil), hull...), Normal: make([]float32, len(hull))}
		m.TransformWoW(d.Pos, d.Rot, d.Scale)
		faces = append(faces, m.Pos...)
		counts = append(counts, uint32(len(m.Pos)/9))
	}
	col.faces, col.groups = faces, counts
	return col, nil
}

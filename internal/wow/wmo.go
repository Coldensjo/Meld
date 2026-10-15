package wow

import (
	"errors"
	"fmt"
	"math"
	"strings"
)

type chunk struct {
	id   string
	data []byte
}

// chunks splits an IFF-style buffer. FourCCs are stored reversed on disk.
func chunks(b []byte) []chunk {
	var out []chunk
	for len(b) >= 8 {
		id := string([]byte{b[3], b[2], b[1], b[0]})
		n := int(uint32(b[4]) | uint32(b[5])<<8 | uint32(b[6])<<16 | uint32(b[7])<<24)
		if n < 0 || 8+n > len(b) {
			break
		}
		out = append(out, chunk{id, b[8 : 8+n]})
		b = b[8+n:]
	}
	return out
}

// WMORoot holds what we need from a root .wmo file.
type WMORoot struct {
	Materials []WMOMaterial
	NumGroups int
	Doodads   []WMODoodad // default doodad set only
	Lights    []Effect    // MOLT lights, editor space
	// Sets are the doodad sets (MODS): set 0 is the global set, always shown; a placement adds one more.
	Sets []WMODoodadSet
	// AllDoodads are every MODD entry, by index (an entry without a model is empty).
	AllDoodads []WMODoodad
}

// WMODoodadSet is a named run of a WMO's doodads.
type WMODoodadSet struct {
	Name         string
	Start, Count int
}

// DoodadsOf are the doodads a placement with doodad set `set` shows: the global set 0, and the set itself.
func (r *WMORoot) DoodadsOf(set int) []WMODoodad {
	idx := r.DoodadIndicesOf(set)
	out := make([]WMODoodad, len(idx))
	for k, i := range idx {
		out[k] = r.AllDoodads[i]
	}
	return out
}

// DoodadIndicesOf are DoodadsOf's doodads as indices into AllDoodads (MODD), the numbers a group's
// MODR names them by.
func (r *WMORoot) DoodadIndicesOf(set int) []int {
	var out []int
	add := func(s int) {
		if s < 0 || s >= len(r.Sets) {
			return
		}
		for i := r.Sets[s].Start; i < r.Sets[s].Start+r.Sets[s].Count && i < len(r.AllDoodads); i++ {
			if r.AllDoodads[i].Model != "" {
				out = append(out, i)
			}
		}
	}
	add(0)
	if set > 0 {
		add(set)
	}
	return out
}

// GroupDoodadRefs reads a group file's MODR: the doodads (MODD indices) the group shows.
func GroupDoodadRefs(b []byte) []int {
	for _, c := range chunks(b) {
		if c.id != "MOGP" || len(c.data) < 68 {
			continue
		}
		for _, s := range chunks(c.data[68:]) {
			if s.id != "MODR" {
				continue
			}
			r := reader{s.data}
			out := make([]int, 0, len(s.data)/2)
			for o := 0; o+2 <= len(s.data); o += 2 {
				out = append(out, r.u16(o))
			}
			return out
		}
	}
	return nil
}

type WMOMaterial struct {
	Texture  string
	Blend    int
	TwoSided bool
	Unlit    bool
}

type WMODoodad struct {
	Model string
	Pos   [3]float32 // WoW space
	Rot   [4]float32 // quaternion x,y,z,w (WoW space)
	Scale float32
}

func ParseWMORoot(b []byte) (*WMORoot, error) {
	cs := chunks(b)
	if len(cs) == 0 || cs[0].id != "MVER" {
		return nil, errors.New("wmo: bad root file")
	}
	root := &WMORoot{}
	var motx, modn []byte
	var mods, modd []byte
	for _, c := range cs {
		switch c.id {
		case "MOHD":
			if len(c.data) >= 8 {
				root.NumGroups = reader{c.data}.u32(4)
			}
		case "MOTX":
			motx = c.data
		case "MOMT":
			r := reader{c.data}
			for o := 0; o+64 <= len(c.data); o += 64 {
				flags := r.u32(o)
				root.Materials = append(root.Materials, WMOMaterial{
					Texture:  cstrAt(motx, r.u32(o+12)),
					Blend:    r.u32(o + 8),
					TwoSided: flags&0x04 != 0,
					Unlit:    flags&0x01 != 0,
				})
			}
		case "MODN":
			modn = c.data
		case "MODS":
			mods = c.data
		case "MODD":
			modd = c.data
		case "MOLT":
			// 48-byte lights: type, atten, pad, BGRA colour, position, intensity, attenStart, attenEnd.
			r := reader{c.data}
			for o := 0; o+48 <= len(c.data) && len(root.Lights) < 32; o += 48 {
				intensity := r.f32(o + 20)
				end := r.f32(o + 28)
				if intensity <= 0 || !finite(intensity, end) {
					continue
				}
				x, y, z := toEditor(r.f32(o+8), r.f32(o+12), r.f32(o+16))
				col := [3]float32{float32(c.data[o+6]) / 255, float32(c.data[o+5]) / 255, float32(c.data[o+4]) / 255}
				root.Lights = append(root.Lights, Effect{Kind: "light", Pos: [3]float32{x, y, z}, Color: col, Intensity: clampF(intensity, 0.2, 2), Radius: clampF(end, 3, 30)})
			}
		}
	}
	// MODS: 32-byte sets, a 20-byte name, then the first doodad and the count.
	r := reader{mods}
	for o := 0; o+32 <= len(mods); o += 32 {
		root.Sets = append(root.Sets, WMODoodadSet{Name: cstrAt(mods[o:o+20], 0), Start: r.u32(o + 20), Count: r.u32(o + 24)})
	}
	d := reader{modd}
	for i := 0; (i+1)*40 <= len(modd); i++ {
		o := i * 40
		name := cstrAt(modn, d.u32(o)&0xFFFFFF)
		// Vanilla references .mdx; the client ships them as .m2.
		if ext := strings.ToLower(name); strings.HasSuffix(ext, ".mdx") || strings.HasSuffix(ext, ".mdl") {
			name = name[:len(name)-4] + ".m2"
		}
		root.AllDoodads = append(root.AllDoodads, WMODoodad{
			Model: name,
			Pos:   [3]float32{d.f32(o + 4), d.f32(o + 8), d.f32(o + 12)},
			Rot:   [4]float32{d.f32(o + 16), d.f32(o + 20), d.f32(o + 24), d.f32(o + 28)},
			Scale: d.f32(o + 32),
		})
	}
	// The default doodad set ("Set_$DefaultGlobal") is set 0.
	root.Doodads = root.DoodadsOf(0)
	return root, nil
}

func cstrAt(blob []byte, off int) string {
	if off < 0 || off >= len(blob) {
		return ""
	}
	end := off
	for end < len(blob) && blob[end] != 0 {
		end++
	}
	return string(blob[off:end])
}

// InteriorBox returns the bounding box (editor space: min xyz, max xyz) of a group file
// flagged interior.
func InteriorBox(b []byte) ([6]float32, bool) {
	for _, c := range chunks(b) {
		if c.id != "MOGP" || len(c.data) < 36 {
			continue
		}
		r := reader{c.data}
		if r.u32(8)&0x2000 == 0 {
			return [6]float32{}, false
		}
		ax, ay, az := toEditor(r.f32(12), r.f32(16), r.f32(20))
		bx, by, bz := toEditor(r.f32(24), r.f32(28), r.f32(32))
		return [6]float32{min(ax, bx), min(ay, by), min(az, bz), max(ax, bx), max(ay, by), max(az, bz)}, true
	}
	return [6]float32{}, false
}

// markInterior flags the effects that lie inside one of the interior boxes.
func markInterior(effects []Effect, boxes [][6]float32) {
	for i := range effects {
		p := effects[i].Pos
		for _, b := range boxes {
			if p[0] >= b[0] && p[1] >= b[1] && p[2] >= b[2] && p[0] <= b[3] && p[1] <= b[4] && p[2] <= b[5] {
				effects[i].Interior = true
				break
			}
		}
	}
}

// ParseWMOGroup parses one group file into a mesh using root materials.
func ParseWMOGroup(b []byte, mats []WMOMaterial) (*Mesh, error) {
	cs := chunks(b)
	var mogp []byte
	for _, c := range cs {
		if c.id == "MOGP" {
			mogp = c.data
		}
	}
	if len(mogp) < 68 {
		return nil, errors.New("wmo: group missing MOGP")
	}
	groupFlags := reader{mogp}.u32(8)
	interior := groupFlags&0x2000 != 0
	var mopy, movi, movt, monr, motv, mocv []byte
	for _, c := range chunks(mogp[68:]) {
		switch c.id {
		case "MOPY":
			mopy = c.data
		case "MOVI":
			movi = c.data
		case "MOVT":
			movt = c.data
		case "MONR":
			monr = c.data
		case "MOTV":
			if motv == nil { // first UV set only
				motv = c.data
			}
		case "MOCV":
			if mocv == nil {
				mocv = c.data
			}
		}
	}
	nv := len(movt) / 12
	if nv == 0 || len(movi) < 6 {
		return &Mesh{}, nil
	}
	m := &Mesh{Pos: make([]float32, 0, nv*3), Normal: make([]float32, 0, nv*3), UV: make([]float32, 0, nv*2)}
	rv, rn, rt := reader{movt}, reader{monr}, reader{motv}
	for i := 0; i < nv; i++ {
		x, y, z := toEditor(rv.f32(i*12), rv.f32(i*12+4), rv.f32(i*12+8))
		m.Pos = append(m.Pos, x, y, z)
		if (i+1)*12 <= len(monr) {
			nx, ny, nz := toEditor(rn.f32(i*12), rn.f32(i*12+4), rn.f32(i*12+8))
			m.Normal = append(m.Normal, nx, ny, nz)
		} else {
			m.Normal = append(m.Normal, 0, 1, 0)
		}
		if (i+1)*8 <= len(motv) {
			m.UV = append(m.UV, rt.f32(i*8), rt.f32(i*8+4))
		} else {
			m.UV = append(m.UV, 0, 0)
		}
	}
	// Interior groups carry baked lighting in MOCV (BGRA).
	if interior && len(mocv) >= nv*4 {
		m.Color = make([]byte, nv*4)
		for i := 0; i < nv; i++ {
			m.Color[i*4] = mocv[i*4+2]
			m.Color[i*4+1] = mocv[i*4+1]
			m.Color[i*4+2] = mocv[i*4]
			m.Color[i*4+3] = 255
		}
	}

	// Bucket triangles by material; material 0xFF is collision-only.
	nTri := min(len(movi)/6, len(mopy)/2)
	ri := reader{movi}
	byMat := map[int][]uint32{}
	var order []int
	for t := 0; t < nTri; t++ {
		mat := int(mopy[t*2+1])
		if mat == 0xFF {
			continue
		}
		a, b2, c := ri.u16(t*6), ri.u16(t*6+2), ri.u16(t*6+4)
		if a >= nv || b2 >= nv || c >= nv {
			continue
		}
		if _, ok := byMat[mat]; !ok {
			order = append(order, mat)
		}
		byMat[mat] = append(byMat[mat], uint32(a), uint32(b2), uint32(c))
	}
	for _, mat := range order {
		g := Group{Start: len(m.Index), Count: len(byMat[mat]), Interior: interior}
		if mat < len(mats) {
			mm := mats[mat]
			g.Texture, g.Blend, g.TwoSided, g.Unlit = mm.Texture, mm.Blend, mm.TwoSided, mm.Unlit
		}
		m.Index = append(m.Index, byMat[mat]...)
		m.Groups = append(m.Groups, g)
	}
	return m, nil
}

// TransformWoW applies a doodad placement (in WoW space) to a mesh that is
// already in editor space.
func (m *Mesh) TransformWoW(pos [3]float32, q [4]float32, scale float32) {
	// Convert the placement into editor space: position via toEditor, and the
	// quaternion's vector part the same way (a rotation conjugated by the
	// basis change keeps w and rotates the axis).
	px, py, pz := toEditor(pos[0], pos[1], pos[2])
	qx, qy, qz := toEditor(q[0], q[1], q[2])
	qw := q[3]
	if scale == 0 {
		scale = 1
	}
	rot := func(x, y, z float32) (float32, float32, float32) {
		// v' = v + 2w(q×v) + 2(q×(q×v))
		cx := qy*z - qz*y
		cy := qz*x - qx*z
		cz := qx*y - qy*x
		ccx := qy*cz - qz*cy
		ccy := qz*cx - qx*cz
		ccz := qx*cy - qy*cx
		return x + 2*(qw*cx+ccx), y + 2*(qw*cy+ccy), z + 2*(qw*cz+ccz)
	}
	for i := range m.Effects {
		e := &m.Effects[i]
		x, y, z := rot(e.Pos[0]*scale, e.Pos[1]*scale, e.Pos[2]*scale)
		e.Pos = [3]float32{x + px, y + py, z + pz}
		e.Radius *= scale
		e.Size *= scale
	}
	for i := range m.Emitters {
		m.Emitters[i].place(rot, scale, [3]float32{px, py, pz})
	}
	for i := range m.Ribbons {
		m.Ribbons[i].place(rot, scale, [3]float32{px, py, pz})
	}
	for i := 0; i+2 < len(m.Pos); i += 3 {
		x, y, z := rot(m.Pos[i]*scale, m.Pos[i+1]*scale, m.Pos[i+2]*scale)
		m.Pos[i], m.Pos[i+1], m.Pos[i+2] = x+px, y+py, z+pz
		nx, ny, nz := rot(m.Normal[i], m.Normal[i+1], m.Normal[i+2])
		l := float32(math.Sqrt(float64(nx*nx + ny*ny + nz*nz)))
		if l > 0 {
			nx, ny, nz = nx/l, ny/l, nz/l
		}
		m.Normal[i], m.Normal[i+1], m.Normal[i+2] = nx, ny, nz
	}
}

// GroupPath returns the file name of group i for a root WMO path.
func GroupPath(root string, i int) string {
	return fmt.Sprintf("%s_%03d.wmo", root[:len(root)-4], i)
}

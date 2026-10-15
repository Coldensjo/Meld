package wow

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
)

// The room data of a WMO: what the client's per-frame probe needs to tell which group (room) the
// camera is in, and the fog records a room's fog comes from. Ported from Benilla's WMO loader
// (benilla-assets/src/wmo.rs, benilla-formats/src/models/{collision.rs,wmo/root.rs,wmo/group.rs};
// MIT/Apache-2.0). Everything stays in the WMO's model space with WoW axes (Z up), so the probe's
// arithmetic is the client's; the frontend moves the eye into it.

// MOPY face flags the collision gathers read: walking skips DETAIL faces, the camera NOCAMCOLLIDE ones.
const (
	mopyNoCamCollide = 0x02
	mopyDetail       = 0x04
)

// WMONavGroup is one group's header data: MOGP flags, the root's MOGI box, its slice of the portal
// references and its four MFOG indices.
type WMONavGroup struct {
	Flags    uint32     `json:"flags"`
	Min      [3]float32 `json:"min"`
	Max      [3]float32 `json:"max"`
	RefStart int        `json:"refStart"`
	RefCount int        `json:"refCount"`
	Fogs     [4]uint8   `json:"fogs"`
	// Name is the group's name in MOGN ("" for none).
	Name string `json:"name"`
	// Walk and Camera are how many triangles of the walking and camera-only faces follow in the
	// encoded blob for this group.
	Walk   int `json:"walk"`
	Camera int `json:"camera"`
}

// WMOPortal is one MOPT portal: a run of the portal vertices and its plane (n·p + d).
type WMOPortal struct {
	Start int        `json:"start"`
	Count int        `json:"count"`
	Plane [4]float32 `json:"plane"`
}

// WMOPortalRef is one MOPR reference: the portal, the group behind it and the side (±1) of the
// portal's plane the referring group lies on.
type WMOPortalRef struct {
	Portal int `json:"portal"`
	Group  int `json:"group"`
	Side   int `json:"side"`
}

// WMOFog is one MFOG record: a sphere and the fog inside it (end in yards, start as a share of end,
// colour as the 0xAARRGGBB dword).
type WMOFog struct {
	Flags       uint32     `json:"flags"`
	Pos         [3]float32 `json:"pos"`
	RadiusInner float32    `json:"inner"`
	RadiusOuter float32    `json:"outer"`
	End         float32    `json:"end"`
	StartScalar float32    `json:"start"`
	Color       uint32     `json:"color"`
}

// WMONav is a WMO's room data.
type WMONav struct {
	Groups      []WMONavGroup  `json:"groups"`
	PortalVerts []float32      `json:"portalVerts"`
	Portals     []WMOPortal    `json:"portals"`
	Refs        []WMOPortalRef `json:"refs"`
	Fogs        []WMOFog       `json:"fogs"`
	// walk and camera are each group's faces, nine floats a triangle.
	walk, camera [][]float32
}

// ParseWMONav reads a root file's portals, group boxes and fogs, and each group file's header and
// collision faces. groups[i] is group i's file, nil when it could not be read.
func ParseWMONav(root []byte, groups [][]byte) (*WMONav, error) {
	cs := chunks(root)
	if len(cs) == 0 || cs[0].id != "MVER" {
		return nil, errors.New("wmo: bad root file")
	}
	nav := &WMONav{PortalVerts: []float32{}, Portals: []WMOPortal{}, Refs: []WMOPortalRef{}, Fogs: []WMOFog{}}
	n := 0
	var mogn []byte
	var nameOffs []int
	for _, c := range cs {
		r := reader{c.data}
		switch c.id {
		case "MOHD":
			if len(c.data) >= 8 {
				n = r.u32(4)
			}
		case "MOGN":
			mogn = c.data
		case "MOGI":
			// 32 bytes a group: flags, the box (min, max), the name offset.
			for o := 0; o+32 <= len(c.data); o += 32 {
				nav.Groups = append(nav.Groups, WMONavGroup{
					Min: [3]float32{r.f32(o + 4), r.f32(o + 8), r.f32(o + 12)},
					Max: [3]float32{r.f32(o + 16), r.f32(o + 20), r.f32(o + 24)},
				})
				nameOffs = append(nameOffs, int(int32(r.u32(o+28))))
			}
		case "MOPV":
			for o := 0; o+4 <= len(c.data); o += 4 {
				nav.PortalVerts = append(nav.PortalVerts, r.f32(o))
			}
		case "MOPT":
			for o := 0; o+20 <= len(c.data); o += 20 {
				nav.Portals = append(nav.Portals, WMOPortal{
					Start: r.u16(o), Count: r.u16(o + 2),
					Plane: [4]float32{r.f32(o + 4), r.f32(o + 8), r.f32(o + 12), r.f32(o + 16)},
				})
			}
		case "MOPR":
			for o := 0; o+8 <= len(c.data); o += 8 {
				nav.Refs = append(nav.Refs, WMOPortalRef{Portal: r.u16(o), Group: r.u16(o + 2), Side: int(int16(r.u16(o + 4)))})
			}
		case "MFOG":
			for o := 0; o+48 <= len(c.data); o += 48 {
				nav.Fogs = append(nav.Fogs, WMOFog{
					Flags:       uint32(r.u32(o)),
					Pos:         [3]float32{r.f32(o + 4), r.f32(o + 8), r.f32(o + 12)},
					RadiusInner: r.f32(o + 16), RadiusOuter: r.f32(o + 20),
					End: r.f32(o + 24), StartScalar: r.f32(o + 28),
					Color: uint32(r.u32(o + 32)),
				})
			}
		}
	}
	for i, o := range nameOffs {
		if o >= 0 && o < len(mogn) {
			nav.Groups[i].Name = cstrAt(mogn, o)
		}
	}
	// One entry a group, so the portal references' group indices line up; a group the root has no
	// box for gets an empty one.
	for len(nav.Groups) < n {
		nav.Groups = append(nav.Groups, WMONavGroup{
			Min: [3]float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32},
			Max: [3]float32{-math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32},
		})
	}
	nav.walk = make([][]float32, len(nav.Groups))
	nav.camera = make([][]float32, len(nav.Groups))
	for i := range nav.Groups {
		if i >= len(groups) || groups[i] == nil {
			continue
		}
		g := &nav.Groups[i]
		var movi, movt, mopy []byte
		for _, c := range chunks(groups[i]) {
			if c.id != "MOGP" || len(c.data) < 68 {
				continue
			}
			r := reader{c.data}
			g.Flags = uint32(r.u32(8))
			g.RefStart, g.RefCount = r.u16(0x24), r.u16(0x26)
			copy(g.Fogs[:], c.data[0x30:0x34])
			for _, s := range chunks(c.data[68:]) {
				switch s.id {
				case "MOPY":
					mopy = s.data
				case "MOVI":
					movi = s.data
				case "MOVT":
					movt = s.data
				}
			}
		}
		// Walking faces: all but DETAIL. Camera-only faces: DETAIL without NOCAMCOLLIDE.
		nav.walk[i] = groupFaces(movi, movt, mopy, mopyDetail, 0)
		nav.camera[i] = groupFaces(movi, movt, mopy, mopyNoCamCollide, mopyDetail)
		g.Walk, g.Camera = len(nav.walk[i])/9, len(nav.camera[i])/9
	}
	return nav, nil
}

// groupFaces gathers the triangles whose MOPY flags miss skip and carry all of require, nine
// floats each (WoW axes).
func groupFaces(movi, movt, mopy []byte, skip, require byte) []float32 {
	nv := len(movt) / 12
	nTri := min(len(movi)/6, len(mopy)/2)
	ri, rv := reader{movi}, reader{movt}
	out := []float32{}
	for t := 0; t < nTri; t++ {
		f := mopy[t*2]
		if f&skip != 0 || f&require != require {
			continue
		}
		a, b, c := ri.u16(t*6), ri.u16(t*6+2), ri.u16(t*6+4)
		if a >= nv || b >= nv || c >= nv {
			continue
		}
		for _, v := range [3]int{a, b, c} {
			out = append(out, rv.f32(v*12), rv.f32(v*12+4), rv.f32(v*12+8))
		}
	}
	return out
}

// Encode is the endpoint's body: a u32 header length, the JSON header (padded to 4 bytes), then
// each group's walking faces and then each group's camera-only faces, as float32.
func (n *WMONav) Encode() []byte {
	hdr, _ := json.Marshal(n)
	for len(hdr)%4 != 0 {
		hdr = append(hdr, ' ')
	}
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(len(hdr)))
	buf.Write(hdr)
	for _, f := range n.walk {
		binary.Write(&buf, binary.LittleEndian, f)
	}
	for _, f := range n.camera {
		binary.Write(&buf, binary.LittleEndian, f)
	}
	return buf.Bytes()
}

// WMONav reads a WMO's room data from the client, encoded for the /wow/wmonav endpoint.
func (c *Client) WMONav(path string) ([]byte, error) {
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
	return nav.Encode(), nil
}

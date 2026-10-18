package wow

import "math"

// A WMO group's liquid (MLIQ): the lava of Blackrock Depths, the water of Stormwind's canals. Ported
// from Benilla (MIT/Apache: benilla-wmo's parse_mliq, benilla-formats' build_wmo_liquid_mesh and
// LiquidKind::from_nibble, benilla-world's liquid surface), which follows the 1.12 client.

// mliqStep is the MLIQ grid spacing in yards, the client's 0x40855555 (533⅓ / 128).
var mliqStep = math.Float32frombits(0x40855555)

// noGroupLiquid is MOGP groupLiquid for a group whose tiles name their own liquid.
const noGroupLiquid = 0xf

// Liquid classes, as the frontend numbers them (liquidMaterial.ts KIND_INDEX).
const (
	LiquidRiver = 0
	LiquidOcean = 1
	LiquidMagma = 2
	LiquidSlime = 3
)

// Liquid paths, the way the client draws a WMO's liquid by its group's flags.
const (
	LiquidExterior = 1 // MOGP flags & 0x48 != 0: lit by the sun, the river's deep colour
	LiquidInterior = 2 // a true interior: unlit, the material's diffuse colour as its body
)

// WMOLiquid is a group's MLIQ grid in WMO model space (WoW axes, yards).
type WMOLiquid struct {
	XVerts, YVerts, XTiles, YTiles int
	// Base is grid vertex (0, 0); vertex (i, j) sits at Base + (i, j)·mliqStep, at Heights[j·XVerts+i].
	Base     [3]float32
	Material int // MOMT index, whose diffuse colour tints an interior pool
	Heights  []float32
	// Opacity is each vertex's first byte: a water vertex's opacity, half a UV pair on magma or slime.
	Opacity []byte
	// Tiles are the tile flags, j·XTiles+i: the low nibble the liquid type (0xf a hole).
	Tiles []byte
}

// parseMLIQ reads an MLIQ payload; nil for an empty, oversized or truncated grid.
func parseMLIQ(s []byte) *WMOLiquid {
	if len(s) < 30 {
		return nil
	}
	r := reader{s}
	l := &WMOLiquid{XVerts: r.u32(0), YVerts: r.u32(4), XTiles: r.u32(8), YTiles: r.u32(12)}
	nv, nt := l.XVerts*l.YVerts, l.XTiles*l.YTiles
	// Real grids are some dozens a side; a corrupt header must not size gigabytes.
	if l.XVerts <= 0 || l.YVerts <= 0 || l.XTiles <= 0 || l.YTiles <= 0 || nv > 1<<20 || nt > 1<<20 {
		return nil
	}
	tbase := 30 + nv*8
	if len(s) < tbase+nt {
		return nil
	}
	l.Base = [3]float32{r.f32(16), r.f32(20), r.f32(24)}
	l.Material = r.u16(28)
	l.Heights = make([]float32, nv)
	l.Opacity = make([]byte, nv)
	for k := 0; k < nv; k++ {
		l.Opacity[k] = s[30+k*8]
		l.Heights[k] = r.f32(30 + k*8 + 4)
	}
	l.Tiles = append([]byte(nil), s[tbase:tbase+nt]...)
	return l
}

// GroupLiquid reads a group file's MLIQ and its MOGP groupLiquid and flags; nil without a liquid.
func GroupLiquid(b []byte) (l *WMOLiquid, groupLiquid int, flags int) {
	for _, c := range chunks(b) {
		if c.id != "MOGP" || len(c.data) < 68 {
			continue
		}
		r := reader{c.data}
		for _, s := range chunks(c.data[68:]) {
			if s.id == "MLIQ" {
				return parseMLIQ(s.data), r.u32(0x34), r.u32(8)
			}
		}
		return nil, r.u32(0x34), r.u32(8)
	}
	return nil, noGroupLiquid, 0
}

// liquidClass is the class a WMO liquid type nibble draws as, false for none (Benilla's from_nibble:
// 0 and 4 still water, 8 rapids, 1 ocean, 2 and 6 magma, 3 and 7 slime).
func liquidClass(nibble int) (int, bool) {
	switch nibble & 0xf {
	case 0, 4, 8:
		return LiquidRiver, true
	case 1:
		return LiquidOcean, true
	case 2, 6:
		return LiquidMagma, true
	case 3, 7:
		return LiquidSlime, true
	}
	return 0, false
}

// LiquidMesh is a model's liquid surfaces in editor space, drawn apart from its geometry: unlit or
// with the water's own light, never casting shadows, and never picked.
type LiquidMesh struct {
	Pos []float32 // xyz
	UV  []float32 // one repeat a grid cell, from the model-space position
	// Info is four bytes a vertex: the class, the path, 1 for magma or slime that scrolls, and the opacity byte.
	Info []byte
	// Body is an interior pool's diffuse colour, rgba a vertex (white elsewhere).
	Body []byte
	// Room is the WMO group plus one, two a vertex as Mesh.Room has it (the second 0).
	Room  []uint16
	Index []uint32
}

func (l *LiquidMesh) vertCount() int { return len(l.Pos) / 3 }

// Append merges o into l, offsetting indices.
func (l *LiquidMesh) Append(o *LiquidMesh) {
	base := uint32(l.vertCount())
	l.Pos = append(l.Pos, o.Pos...)
	l.UV = append(l.UV, o.UV...)
	l.Info = append(l.Info, o.Info...)
	l.Body = append(l.Body, o.Body...)
	l.Room = append(l.Room, o.Room...)
	for _, i := range o.Index {
		l.Index = append(l.Index, i+base)
	}
}

// LiquidSurface builds a group's liquid as the client draws it: two triangles a tile whose nibble
// isn't 0xf, one class for the whole surface (groupLiquid's, or else the first wet tile's), in
// editor space. room is the group plus one; mats are the root's materials. Nil when nothing is wet.
func LiquidSurface(l *WMOLiquid, groupLiquid, groupFlags int, room int, mats []WMOMaterial) *LiquidMesh {
	if l == nil {
		return nil
	}
	xv, yv, xt, yt := l.XVerts, l.YVerts, l.XTiles, l.YTiles
	if xv < 2 || yv < 2 || xt+1 != xv || yt+1 != yv || len(l.Heights) < xv*yv || len(l.Tiles) < xt*yt {
		return nil
	}
	nibble := -1
	if groupLiquid != noGroupLiquid {
		nibble = groupLiquid & 0xf
	} else {
		for _, f := range l.Tiles {
			if f&0xf != 0xf {
				nibble = int(f & 0xf)
				break
			}
		}
	}
	if nibble < 0 {
		return nil
	}
	class, ok := liquidClass(nibble)
	if !ok {
		return nil
	}
	fullbright := class == LiquidMagma || class == LiquidSlime
	path := byte(LiquidExterior)
	if groupFlags&0x48 == 0 {
		path = LiquidInterior
	}
	scroll := byte(0)
	if nibble == 6 || nibble == 7 {
		scroll = 1
	}
	body := [4]byte{255, 255, 255, 255}
	if path == LiquidInterior && !fullbright && l.Material < len(mats) {
		c := mats[l.Material].Diffuse
		body = [4]byte{c[0], c[1], c[2], 255}
	}

	out := &LiquidMesh{}
	drawn := make([]bool, xv*yv)
	for ty := 0; ty < yt; ty++ {
		for tx := 0; tx < xt; tx++ {
			if l.Tiles[ty*xt+tx]&0xf == 0xf {
				continue // a hole
			}
			tl := uint32(ty*xv + tx)
			tr := tl + 1
			bl := uint32((ty+1)*xv + tx)
			br := bl + 1
			out.Index = append(out.Index, tl, bl, br, tl, br, tr)
			drawn[tl], drawn[tr], drawn[bl], drawn[br] = true, true, true, true
		}
	}
	if len(out.Index) == 0 {
		return nil
	}
	// A vertex no wet tile uses takes the lowest drawn height: shipped files leave them at 0, which
	// would stretch the model's bounds.
	fill := float32(math.Inf(1))
	for n, h := range l.Heights[:xv*yv] {
		if drawn[n] && finite(h) {
			fill = min(fill, h)
		}
	}
	if math.IsInf(float64(fill), 1) {
		fill = l.Base[2]
	}
	nv := xv * yv
	out.Pos = make([]float32, 0, nv*3)
	out.UV = make([]float32, 0, nv*2)
	out.Info = make([]byte, 0, nv*4)
	out.Body = make([]byte, 0, nv*4)
	out.Room = make([]uint16, 0, nv*2)
	for j := 0; j < yv; j++ {
		for i := 0; i < xv; i++ {
			n := j*xv + i
			mx := l.Base[0] + float32(i)*mliqStep
			my := l.Base[1] + float32(j)*mliqStep
			h := l.Heights[n]
			if !drawn[n] || !finite(h) {
				h = fill
			}
			x, y, z := toEditor(mx, my, h)
			out.Pos = append(out.Pos, x, y, z)
			out.UV = append(out.UV, mx/mliqStep, my/mliqStep)
			opacity := byte(0)
			if !fullbright {
				opacity = l.Opacity[n]
			}
			out.Info = append(out.Info, byte(class), path, scroll, opacity)
			out.Body = append(out.Body, body[:]...)
			out.Room = append(out.Room, uint16(room), 0)
		}
	}
	return out
}

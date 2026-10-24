package spritemodel

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/png"
	"math"
	"sort"
)

// rect is one quad of the mesh: a rectangle of exposed faces in one plane, and where its texels sit in
// the atlas.
type rect struct {
	dir, layer     int // the face direction and the cells' coordinate along it
	u0, v0, du, dv int // the rectangle on the plane's two other axes
	ax, ay         int // its texels' corner in the atlas, inside a texel of padding
}

// planeAxes are the axes a face direction's plane spans (u, v) and its normal axis.
func planeAxes(dir int) (n, u, v int) {
	switch dir / 2 {
	case 0:
		return 0, 1, 2
	case 1:
		return 1, 0, 2
	}
	return 2, 0, 1
}

// cellOf is the cell whose face is at (u, v) on the plane of layer, for a direction's axes.
func cellOf(n, u, v, layer, a, b int) (c [3]int) {
	c[n], c[u], c[v] = layer, a, b
	return c
}

// quads merges the exposed faces of each plane into rectangles (greedy meshing, regardless of colour:
// the texture carries the colours).
func (m *Model) quads() []rect {
	g := m.g
	size := [3]int{g.nx, g.ny, g.nz}
	var out []rect
	for dir := range 6 {
		n, u, v := planeAxes(dir)
		nu, nv := size[u], size[v]
		mask := make([]bool, nu*nv)
		for layer := range size[n] {
			hasFace := false
			for b := range nv {
				for a := range nu {
					c := cellOf(n, u, v, layer, a, b)
					on := g.at(c[0], c[1], c[2]) && m.exposed(c[0], c[1], c[2], dir)
					mask[b*nu+a] = on
					hasFace = hasFace || on
				}
			}
			if !hasFace {
				continue
			}
			for b := range nv {
				for a := 0; a < nu; {
					if !mask[b*nu+a] {
						a++
						continue
					}
					w := 1
					for a+w < nu && mask[b*nu+a+w] {
						w++
					}
					h := 1
				grow:
					for b+h < nv {
						for k := range w {
							if !mask[(b+h)*nu+a+k] {
								break grow
							}
						}
						h++
					}
					for j := range h {
						for k := range w {
							mask[(b+j)*nu+a+k] = false
						}
					}
					out = append(out, rect{dir: dir, layer: layer, u0: a, v0: b, du: w, dv: h})
					a += w
				}
			}
		}
	}
	return out
}

// atlas packs the quads' texels into one picture, shelf by shelf, each with a texel of padding that
// repeats its edge so filtering never reaches a neighbour's colours.
func (m *Model) atlas(rs []rect) *image.NRGBA {
	order := make([]int, len(rs))
	area := 0
	for i := range rs {
		order[i] = i
		area += (rs[i].du + 2) * (rs[i].dv + 2)
	}
	sort.Slice(order, func(i, j int) bool {
		a, b := rs[order[i]], rs[order[j]]
		if a.dv != b.dv {
			return a.dv > b.dv
		}
		return a.du > b.du
	})
	width := max(16, int(math.Ceil(math.Sqrt(float64(area))*1.1)))
	for _, i := range order {
		width = max(width, rs[i].du+2)
	}
	x, y, shelf := 0, 0, 0
	for _, i := range order {
		r := &rs[i]
		if x+r.du+2 > width {
			x, y, shelf = 0, y+shelf, 0
		}
		r.ax, r.ay = x+1, y+1
		x += r.du + 2
		shelf = max(shelf, r.dv+2)
	}
	// Powers of two, which every renderer takes as they are.
	img := image.NewNRGBA(image.Rect(0, 0, pow2(width), pow2(y+shelf)))
	for _, r := range rs {
		n, u, v := planeAxes(r.dir)
		for j := -1; j <= r.dv; j++ {
			for k := -1; k <= r.du; k++ {
				ck, cj := min(max(k, 0), r.du-1), min(max(j, 0), r.dv-1)
				c := cellOf(n, u, v, r.layer, r.u0+ck, r.v0+cj)
				img.SetNRGBA(r.ax+k, r.ay+j, m.colours[m.faceKey(c[0], c[1], c[2], r.dir)])
			}
		}
	}
	return img
}

func pow2(n int) int {
	p := 1
	for p < n {
		p *= 2
	}
	return p
}

// GLB writes the model as a glTF binary: one mesh, its texture the faces' colours drawn with nearest
// filtering (pixel art), y up, one tile one unit (times the options' scale), its origin where the
// axis meets the ground, under its lowest cell.
func (m *Model) GLB() ([]byte, error) {
	rs := m.quads()
	m.Report.Triangles = 2 * len(rs)
	tex := m.atlas(rs)
	tw, th := float32(tex.Rect.Dx()), float32(tex.Rect.Dy())

	var pos, nrm, uvs []float32
	var idx []uint32
	// world is a cell corner's place in the game's axes: x east, y up, z south.
	world := func(c [3]int) [3]float32 {
		return [3]float32{
			float32(float64(c[0]-m.cx) * m.unit),
			float32(float64(c[2]-m.ground) * m.unit),
			float32(float64(c[1]-m.cy) * m.unit),
		}
	}
	lo := [3]float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32}
	hi := [3]float32{-math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32}
	for _, r := range rs {
		n, u, v := planeAxes(r.dir)
		layer := r.layer
		if r.dir%2 == 0 {
			layer++ // a face towards + lies on the cell's far side
		}
		d := dirs[r.dir]
		normal := [3]float32{float32(d[0]), float32(d[2]), float32(d[1])}
		corners := [4][2]int{{0, 0}, {r.du, 0}, {r.du, r.dv}, {0, r.dv}}
		var p [4][3]float32
		base := uint32(len(pos) / 3)
		for i, k := range corners {
			p[i] = world(cellOf(n, u, v, layer, r.u0+k[0], r.v0+k[1]))
			pos = append(pos, p[i][:]...)
			nrm = append(nrm, normal[:]...)
			uvs = append(uvs, (float32(r.ax+k[0]))/tw, (float32(r.ay+k[1]))/th)
			for a := range 3 {
				lo[a], hi[a] = min(lo[a], p[i][a]), max(hi[a], p[i][a])
			}
		}
		// Counter-clockwise seen from outside, as glTF's front faces are.
		e1 := [3]float32{p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]}
		e2 := [3]float32{p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]}
		cross := [3]float32{e1[1]*e2[2] - e1[2]*e2[1], e1[2]*e2[0] - e1[0]*e2[2], e1[0]*e2[1] - e1[1]*e2[0]}
		if cross[0]*normal[0]+cross[1]*normal[1]+cross[2]*normal[2] > 0 {
			idx = append(idx, base, base+1, base+2, base, base+2, base+3)
		} else {
			idx = append(idx, base, base+2, base+1, base, base+3, base+2)
		}
	}

	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, tex); err != nil {
		return nil, err
	}

	var bin bytes.Buffer
	type view struct {
		Buffer     int `json:"buffer"`
		ByteOffset int `json:"byteOffset"`
		ByteLength int `json:"byteLength"`
		Target     int `json:"target,omitempty"`
	}
	var views []view
	add := func(data any, target int) int {
		for bin.Len()%4 != 0 {
			bin.WriteByte(0)
		}
		off := bin.Len()
		if b, ok := data.([]byte); ok {
			bin.Write(b)
		} else {
			_ = binary.Write(&bin, binary.LittleEndian, data)
		}
		views = append(views, view{0, off, bin.Len() - off, target})
		return len(views) - 1
	}
	const arrayBuffer, elementArrayBuffer = 34962, 34963
	vPos := add(pos, arrayBuffer)
	vNrm := add(nrm, arrayBuffer)
	vUV := add(uvs, arrayBuffer)
	indexType := 5125 // unsigned int
	var vIdx int
	if len(pos)/3 <= math.MaxUint16 {
		small := make([]uint16, len(idx))
		for i, x := range idx {
			small[i] = uint16(x)
		}
		indexType = 5123 // unsigned short
		vIdx = add(small, elementArrayBuffer)
	} else {
		vIdx = add(idx, elementArrayBuffer)
	}
	vImg := add(pngBuf.Bytes(), 0)
	for bin.Len()%4 != 0 {
		bin.WriteByte(0)
	}

	nVerts := len(pos) / 3
	const float = 5126
	doc := map[string]any{
		"asset":  map[string]any{"version": "2.0", "generator": "Meld sprite to model"},
		"scene":  0,
		"scenes": []any{map[string]any{"nodes": []int{0}}},
		"nodes":  []any{map[string]any{"mesh": 0, "name": m.Name}},
		"meshes": []any{map[string]any{"name": m.Name, "primitives": []any{map[string]any{
			"attributes": map[string]int{"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
			"indices":    3,
			"material":   0,
		}}}},
		"materials": []any{map[string]any{
			"name": m.Name,
			"pbrMetallicRoughness": map[string]any{
				"baseColorTexture": map[string]int{"index": 0},
				"metallicFactor":   0,
				"roughnessFactor":  1,
			},
		}},
		"textures": []any{map[string]int{"sampler": 0, "source": 0}},
		// Nearest filtering both ways and no mipmaps, clamped: the sprite's pixels stay sharp.
		"samplers": []any{map[string]int{"magFilter": 9728, "minFilter": 9728, "wrapS": 33071, "wrapT": 33071}},
		"images":   []any{map[string]any{"bufferView": vImg, "mimeType": "image/png"}},
		"accessors": []any{
			map[string]any{"bufferView": vPos, "componentType": float, "count": nVerts, "type": "VEC3", "min": lo[:], "max": hi[:]},
			map[string]any{"bufferView": vNrm, "componentType": float, "count": nVerts, "type": "VEC3"},
			map[string]any{"bufferView": vUV, "componentType": float, "count": nVerts, "type": "VEC2"},
			map[string]any{"bufferView": vIdx, "componentType": indexType, "count": len(idx), "type": "SCALAR"},
		},
		"bufferViews": views,
		"buffers":     []any{map[string]int{"byteLength": bin.Len()}},
	}
	js, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}

	var out bytes.Buffer
	le := func(v uint32) { _ = binary.Write(&out, binary.LittleEndian, v) }
	le(0x46546C67) // "glTF"
	le(2)
	le(uint32(12 + 8 + len(js) + 8 + bin.Len()))
	le(uint32(len(js)))
	le(0x4E4F534A) // "JSON"
	out.Write(js)
	le(uint32(bin.Len()))
	le(0x004E4942) // "BIN\0"
	out.Write(bin.Bytes())
	return out.Bytes(), nil
}

// Preview draws the model as the sprite was drawn, from each of the four sides (the first as the
// sprite; for an outfit, facing south, west, north and east), side by side and each pixel scaled up:
// a check of the conversion without a 3D viewer.
func (m *Model) Preview(scale int) *image.NRGBA {
	v := m.v
	w, h := v.w, v.h
	gap := scale * 4
	out := image.NewNRGBA(image.Rect(0, 0, 4*w*scale+3*gap, h*scale))
	for i := 0; i < len(out.Pix); i += 4 {
		copy(out.Pix[i:], []byte{0x30, 0x30, 0x34, 0xff})
	}
	for k := range 4 {
		r := m.render(v, w, h, k)
		ox := k * (w*scale + gap)
		for py := range h {
			for px := range w {
				i := py*w + px
				if r.depth[i] < 0 {
					continue
				}
				c := m.colours[r.cell[i]*6+r.face[i]]
				for j := range scale {
					for n := range scale {
						out.SetNRGBA(ox+px*scale+n, py*scale+j, c)
					}
				}
			}
		}
	}
	return out
}

package wow

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/jpeg" // glTF's other image format
	"math"
)

// Reading a binary glTF 2.0 file (GLB), the model Blender saves of a model made or edited there (#290),
// so it can be written into the client as an M2 (EncodeStaticM2). Only what a still doodad holds is
// read: each mesh's triangles under its node's place in the scene, their normals and first texture
// coordinates, and each material's base colour texture (or colour), alpha mode, two sides and unlit.
// Skins, morph targets, animation, cameras and lights are left out. glTF is Y up like the editor, and
// Blender's exporter turns its Z up into it, so the positions are taken as editor space.

// GLBPart is one material of a model read from a GLB: a ModelPart without its texture's client path,
// and the texture's pixels (shared between parts that use the same image and colour).
type GLBPart struct {
	ModelPart
	// Name is the material's name ("" for none).
	Name string
	// Image is the part's texture: the material's base colour image times its colour, or a small one
	// of its colour when it has no image.
	Image *Image
}

type glbIn struct {
	Scene  *int `json:"scene"`
	Scenes []struct {
		Nodes []int `json:"nodes"`
	} `json:"scenes"`
	Nodes []struct {
		Mesh        *int      `json:"mesh"`
		Children    []int     `json:"children"`
		Matrix      []float64 `json:"matrix"`
		Translation []float64 `json:"translation"`
		Rotation    []float64 `json:"rotation"`
		Scale       []float64 `json:"scale"`
	} `json:"nodes"`
	Meshes []struct {
		Primitives []struct {
			Attributes map[string]int `json:"attributes"`
			Indices    *int           `json:"indices"`
			Material   *int           `json:"material"`
			Mode       *int           `json:"mode"`
		} `json:"primitives"`
	} `json:"meshes"`
	Materials []struct {
		Name string `json:"name"`
		PBR  struct {
			BaseColorFactor  []float64 `json:"baseColorFactor"`
			BaseColorTexture *struct {
				Index    int `json:"index"`
				TexCoord int `json:"texCoord"`
			} `json:"baseColorTexture"`
		} `json:"pbrMetallicRoughness"`
		AlphaMode   string                     `json:"alphaMode"`
		DoubleSided bool                       `json:"doubleSided"`
		Extensions  map[string]json.RawMessage `json:"extensions"`
	} `json:"materials"`
	Textures []struct {
		Source *int `json:"source"`
	} `json:"textures"`
	Images []struct {
		BufferView *int   `json:"bufferView"`
		URI        string `json:"uri"`
	} `json:"images"`
	Accessors   []glbAccessor   `json:"accessors"`
	BufferViews []glbBufferView `json:"bufferViews"`
}

type glbAccessor struct {
	BufferView    *int            `json:"bufferView"`
	ByteOffset    int             `json:"byteOffset"`
	ComponentType int             `json:"componentType"`
	Normalized    bool            `json:"normalized"`
	Count         int             `json:"count"`
	Type          string          `json:"type"`
	Sparse        json.RawMessage `json:"sparse"`
}

type glbBufferView struct {
	Buffer     int `json:"buffer"`
	ByteOffset int `json:"byteOffset"`
	ByteLength int `json:"byteLength"`
	ByteStride int `json:"byteStride"`
}

// glbFile is a parsed GLB: its JSON and binary chunk.
type glbFile struct {
	doc glbIn
	bin []byte
	// images are the images decoded, by index, so materials that share one share its pixels.
	images map[int]*Image
}

// maxGLBNodes bounds the node tree walked, against a file whose nodes name each other in a loop.
const maxGLBNodes = 1 << 16

// ReadGLB reads a GLB file's meshes as parts, one a material (primitives without one share a white
// part), with every node's transform applied.
func ReadGLB(b []byte) ([]*GLBPart, error) {
	f, err := parseGLB(b)
	if err != nil {
		return nil, err
	}
	d := &f.doc
	// The parts by material index; -1 (no material) is the last.
	parts := map[int]*GLBPart{}
	var order []int
	part := func(mat int) (*GLBPart, error) {
		if p, ok := parts[mat]; ok {
			return p, nil
		}
		p, err := f.material(mat)
		if err != nil {
			return nil, err
		}
		parts[mat] = p
		order = append(order, mat)
		return p, nil
	}
	images := map[string]*Image{}

	var walk func(n int, parent [16]float64, depth int) error
	seen := 0
	walk = func(n int, parent [16]float64, depth int) error {
		if n < 0 || n >= len(d.Nodes) {
			return fmt.Errorf("glTF: node %d doesn't exist", n)
		}
		if seen++; seen > maxGLBNodes || depth > 256 {
			return errors.New("glTF: the node tree is too deep or loops")
		}
		node := d.Nodes[n]
		m := mul4(parent, nodeMatrix(node.Matrix, node.Translation, node.Rotation, node.Scale))
		if node.Mesh != nil {
			if *node.Mesh < 0 || *node.Mesh >= len(d.Meshes) {
				return fmt.Errorf("glTF: mesh %d doesn't exist", *node.Mesh)
			}
			for _, prim := range d.Meshes[*node.Mesh].Primitives {
				if prim.Mode != nil && *prim.Mode != 4 {
					continue // points and lines; Blender writes triangles
				}
				mat := -1
				if prim.Material != nil {
					mat = *prim.Material
				}
				p, err := part(mat)
				if err != nil {
					return err
				}
				if err := f.addPrimitive(p, prim.Attributes, prim.Indices, m); err != nil {
					return err
				}
			}
		}
		for _, c := range node.Children {
			if err := walk(c, m, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	var roots []int
	switch {
	case len(d.Scenes) > 0:
		s := 0
		if d.Scene != nil && *d.Scene >= 0 && *d.Scene < len(d.Scenes) {
			s = *d.Scene
		}
		roots = d.Scenes[s].Nodes
	default:
		// No scene: every node no other names as a child.
		child := make([]bool, len(d.Nodes))
		for _, n := range d.Nodes {
			for _, c := range n.Children {
				if c >= 0 && c < len(child) {
					child[c] = true
				}
			}
		}
		for i, c := range child {
			if !c {
				roots = append(roots, i)
			}
		}
	}
	for _, r := range roots {
		if err := walk(r, identity4(), 0); err != nil {
			return nil, err
		}
	}
	var out []*GLBPart
	for _, mat := range order {
		p := parts[mat]
		if len(p.Index) == 0 {
			continue
		}
		// One image a source and colour, so parts that share them share one texture.
		key := fmt.Sprintf("%p", p.Image)
		if p.Image != nil && len(p.Image.Pix) <= 4*64 {
			key = string(p.Image.Pix)
		}
		if img, ok := images[key]; ok {
			p.Image = img
		} else {
			images[key] = p.Image
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil, errors.New("the model has no triangles")
	}
	return out, nil
}

func parseGLB(b []byte) (*glbFile, error) {
	if len(b) < 20 || string(b[:4]) != "glTF" {
		return nil, errors.New("glTF: not a GLB file")
	}
	if v := binary.LittleEndian.Uint32(b[4:]); v != 2 {
		return nil, fmt.Errorf("glTF: version %d, want 2", v)
	}
	f := &glbFile{}
	var js []byte
	for o := 12; o+8 <= len(b); {
		n := int(binary.LittleEndian.Uint32(b[o:]))
		kind := binary.LittleEndian.Uint32(b[o+4:])
		if n < 0 || o+8+n > len(b) {
			return nil, errors.New("glTF: a chunk runs past the file's end")
		}
		data := b[o+8 : o+8+n]
		switch kind {
		case 0x4E4F534A: // JSON
			if js == nil {
				js = data
			}
		case 0x004E4942: // BIN
			if f.bin == nil {
				f.bin = data
			}
		}
		o += 8 + n
	}
	if js == nil {
		return nil, errors.New("glTF: no JSON chunk")
	}
	if err := json.Unmarshal(js, &f.doc); err != nil {
		return nil, fmt.Errorf("glTF: %w", err)
	}
	return f, nil
}

// view is a buffer view's bytes and stride (0 for packed).
func (f *glbFile) view(i int) ([]byte, int, error) {
	if i < 0 || i >= len(f.doc.BufferViews) {
		return nil, 0, fmt.Errorf("glTF: buffer view %d doesn't exist", i)
	}
	v := f.doc.BufferViews[i]
	if v.Buffer != 0 {
		return nil, 0, errors.New("glTF: a buffer outside the GLB file isn't read")
	}
	if v.ByteOffset < 0 || v.ByteLength < 0 || v.ByteOffset+v.ByteLength > len(f.bin) {
		return nil, 0, fmt.Errorf("glTF: buffer view %d runs past the binary chunk", i)
	}
	return f.bin[v.ByteOffset : v.ByteOffset+v.ByteLength], v.ByteStride, nil
}

// componentSize is a glTF component type's size in bytes, 0 for an unknown one.
func componentSize(t int) int {
	switch t {
	case 5120, 5121:
		return 1
	case 5122, 5123:
		return 2
	case 5125, 5126:
		return 4
	}
	return 0
}

var typeWidth = map[string]int{"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

// accessor reads accessor i as float values, width a vector (want, checked), normalized integers
// turned into 0..1 (or -1..1).
func (f *glbFile) floats(i, want int) ([]float32, error) {
	if i < 0 || i >= len(f.doc.Accessors) {
		return nil, fmt.Errorf("glTF: accessor %d doesn't exist", i)
	}
	a := f.doc.Accessors[i]
	width := typeWidth[a.Type]
	if width != want {
		return nil, fmt.Errorf("glTF: accessor %d is a %s, not %d wide", i, a.Type, want)
	}
	if len(a.Sparse) > 0 {
		return nil, errors.New("glTF: sparse accessors aren't read")
	}
	out := make([]float32, a.Count*width)
	if a.BufferView == nil {
		return out, nil // all zeros
	}
	data, stride, err := f.view(*a.BufferView)
	if err != nil {
		return nil, err
	}
	cs := componentSize(a.ComponentType)
	if cs == 0 {
		return nil, fmt.Errorf("glTF: accessor %d has component type %d", i, a.ComponentType)
	}
	if stride == 0 {
		stride = cs * width
	}
	if a.Count > 0 && (a.ByteOffset < 0 || a.ByteOffset+(a.Count-1)*stride+cs*width > len(data)) {
		return nil, fmt.Errorf("glTF: accessor %d runs past its buffer view", i)
	}
	for n := 0; n < a.Count; n++ {
		o := a.ByteOffset + n*stride
		for k := 0; k < width; k++ {
			p := data[o+k*cs:]
			var v float32
			switch a.ComponentType {
			case 5126:
				v = math.Float32frombits(binary.LittleEndian.Uint32(p))
			case 5121:
				v = float32(p[0])
				if a.Normalized {
					v /= 255
				}
			case 5123:
				v = float32(binary.LittleEndian.Uint16(p))
				if a.Normalized {
					v /= 65535
				}
			case 5120:
				v = float32(int8(p[0]))
				if a.Normalized {
					v = max(v/127, -1)
				}
			case 5122:
				v = float32(int16(binary.LittleEndian.Uint16(p)))
				if a.Normalized {
					v = max(v/32767, -1)
				}
			case 5125:
				v = float32(binary.LittleEndian.Uint32(p))
			}
			out[n*width+k] = v
		}
	}
	return out, nil
}

// indices reads accessor i as vertex indices.
func (f *glbFile) indices(i int) ([]uint32, error) {
	if i < 0 || i >= len(f.doc.Accessors) {
		return nil, fmt.Errorf("glTF: accessor %d doesn't exist", i)
	}
	a := f.doc.Accessors[i]
	if a.Type != "SCALAR" || a.BufferView == nil {
		return nil, errors.New("glTF: the indices aren't a list of numbers")
	}
	data, stride, err := f.view(*a.BufferView)
	if err != nil {
		return nil, err
	}
	cs := componentSize(a.ComponentType)
	if a.ComponentType != 5121 && a.ComponentType != 5123 && a.ComponentType != 5125 {
		return nil, fmt.Errorf("glTF: indices of component type %d", a.ComponentType)
	}
	if stride == 0 {
		stride = cs
	}
	if a.Count > 0 && (a.ByteOffset < 0 || a.ByteOffset+(a.Count-1)*stride+cs > len(data)) {
		return nil, fmt.Errorf("glTF: accessor %d runs past its buffer view", i)
	}
	out := make([]uint32, a.Count)
	for n := range out {
		p := data[a.ByteOffset+n*stride:]
		switch cs {
		case 1:
			out[n] = uint32(p[0])
		case 2:
			out[n] = uint32(binary.LittleEndian.Uint16(p))
		default:
			out[n] = binary.LittleEndian.Uint32(p)
		}
	}
	return out, nil
}

// addPrimitive appends a primitive's triangles to p, its positions and normals moved by m.
func (f *glbFile) addPrimitive(p *GLBPart, attrs map[string]int, idx *int, m [16]float64) error {
	pi, ok := attrs["POSITION"]
	if !ok {
		return nil
	}
	pos, err := f.floats(pi, 3)
	if err != nil {
		return err
	}
	n := len(pos) / 3
	var nrm, uv []float32
	if i, ok := attrs["NORMAL"]; ok {
		if nrm, err = f.floats(i, 3); err != nil {
			return err
		}
	}
	if i, ok := attrs["TEXCOORD_0"]; ok {
		if uv, err = f.floats(i, 2); err != nil {
			return err
		}
	}
	var tri []uint32
	if idx != nil {
		if tri, err = f.indices(*idx); err != nil {
			return err
		}
	} else {
		tri = make([]uint32, n-n%3)
		for i := range tri {
			tri[i] = uint32(i)
		}
	}
	for _, t := range tri {
		if int(t) >= n {
			return errors.New("glTF: a triangle names a vertex its primitive doesn't have")
		}
	}
	if len(nrm) != 3*n {
		nrm = faceNormals(pos, tri)
	}
	if len(uv) != 2*n {
		uv = make([]float32, 2*n)
	}
	nm := normalMatrix(m)
	// A mirroring transform turns the triangles inside out: wind them back.
	flip := det3(m) < 0
	// Only the vertices the triangles use, in their first use's order: primitives may share one
	// vertex buffer (Meld's own export does), and each part keeps its own.
	remap := make([]int32, n)
	for i := range remap {
		remap[i] = -1
	}
	used := make([]int, 0, n)
	tri = tri[:len(tri)-len(tri)%3]
	for _, t := range tri {
		if remap[t] < 0 {
			remap[t] = int32(len(p.Pos)/3 + len(used))
			used = append(used, int(t))
		}
	}
	for _, i := range used {
		x, y, z := float64(pos[3*i]), float64(pos[3*i+1]), float64(pos[3*i+2])
		p.Pos = append(p.Pos,
			float32(m[0]*x+m[4]*y+m[8]*z+m[12]),
			float32(m[1]*x+m[5]*y+m[9]*z+m[13]),
			float32(m[2]*x+m[6]*y+m[10]*z+m[14]))
		nx, ny, nz := float64(nrm[3*i]), float64(nrm[3*i+1]), float64(nrm[3*i+2])
		tx, ty, tz := nm[0]*nx+nm[3]*ny+nm[6]*nz, nm[1]*nx+nm[4]*ny+nm[7]*nz, nm[2]*nx+nm[5]*ny+nm[8]*nz
		l := math.Sqrt(tx*tx + ty*ty + tz*tz)
		if l < 1e-12 {
			tx, ty, tz, l = 0, 1, 0, 1
		}
		p.Normal = append(p.Normal, float32(tx/l), float32(ty/l), float32(tz/l))
		p.UV = append(p.UV, uv[2*i], uv[2*i+1])
	}
	for t := 0; t < len(tri); t += 3 {
		a, b, c := uint32(remap[tri[t]]), uint32(remap[tri[t+1]]), uint32(remap[tri[t+2]])
		if flip {
			b, c = c, b
		}
		p.Index = append(p.Index, a, b, c)
	}
	return nil
}

// faceNormals are vertex normals summed from the faces around each vertex, for a primitive without any.
func faceNormals(pos []float32, tri []uint32) []float32 {
	out := make([]float32, len(pos))
	for t := 0; t+2 < len(tri); t += 3 {
		a, b, c := 3*int(tri[t]), 3*int(tri[t+1]), 3*int(tri[t+2])
		ux, uy, uz := pos[b]-pos[a], pos[b+1]-pos[a+1], pos[b+2]-pos[a+2]
		vx, vy, vz := pos[c]-pos[a], pos[c+1]-pos[a+1], pos[c+2]-pos[a+2]
		nx, ny, nz := uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
		for _, v := range [3]int{a, b, c} {
			out[v] += nx
			out[v+1] += ny
			out[v+2] += nz
		}
	}
	return out
}

// material makes the part for material index mat (-1 for none: plain white).
func (f *glbFile) material(mat int) (*GLBPart, error) {
	p := &GLBPart{}
	color := [4]float64{1, 1, 1, 1}
	if mat < 0 {
		p.Image = solidImage(color)
		return p, nil
	}
	if mat >= len(f.doc.Materials) {
		return nil, fmt.Errorf("glTF: material %d doesn't exist", mat)
	}
	m := f.doc.Materials[mat]
	p.Name = m.Name
	if len(m.PBR.BaseColorFactor) == 4 {
		copy(color[:], m.PBR.BaseColorFactor)
	}
	p.TwoSided = m.DoubleSided
	_, p.Unlit = m.Extensions["KHR_materials_unlit"]
	switch m.AlphaMode {
	case "MASK":
		p.Blend = BlendAlphaKey
	case "BLEND":
		p.Blend = BlendAlpha
	}
	var img *Image
	if t := m.PBR.BaseColorTexture; t != nil && t.TexCoord == 0 && t.Index >= 0 && t.Index < len(f.doc.Textures) {
		if s := f.doc.Textures[t.Index].Source; s != nil {
			img = f.image(*s)
		}
	}
	if img == nil {
		p.Image = solidImage(color)
		return p, nil
	}
	if color != [4]float64{1, 1, 1, 1} {
		pix := make([]byte, len(img.Pix))
		for i := range pix {
			pix[i] = byte(math.Round(float64(img.Pix[i]) * math.Max(0, math.Min(1, color[i%4]))))
		}
		img = &Image{W: img.W, H: img.H, Pix: pix}
	}
	p.Image = img
	return p, nil
}

// image decodes image i (PNG or JPEG inside the file), nil when it can't be read.
func (f *glbFile) image(i int) *Image {
	if img, ok := f.images[i]; ok {
		return img
	}
	img := f.decodeImage(i)
	if f.images == nil {
		f.images = map[int]*Image{}
	}
	f.images[i] = img
	return img
}

func (f *glbFile) decodeImage(i int) *Image {
	if i < 0 || i >= len(f.doc.Images) || f.doc.Images[i].BufferView == nil {
		return nil
	}
	data, _, err := f.view(*f.doc.Images[i].BufferView)
	if err != nil {
		return nil
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	r := src.Bounds()
	if r.Dx() <= 0 || r.Dy() <= 0 || r.Dx() > 16384 || r.Dy() > 16384 {
		return nil
	}
	dst := image.NewNRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
	draw.Draw(dst, dst.Rect, src, r.Min, draw.Src)
	return &Image{W: r.Dx(), H: r.Dy(), Pix: dst.Pix}
}

// solidImage is a small texture of one colour (red, green, blue and alpha, 0 to 1).
func solidImage(c [4]float64) *Image {
	const size = 8
	pix := make([]byte, size*size*4)
	for i := range pix {
		pix[i] = byte(math.Round(255 * math.Max(0, math.Min(1, c[i%4]))))
	}
	return &Image{W: size, H: size, Pix: pix}
}

// The node transforms, as glTF stores them: 4x4 matrices in column-major order.

func identity4() [16]float64 {
	return [16]float64{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}
}

func mul4(a, b [16]float64) [16]float64 {
	var out [16]float64
	for c := 0; c < 4; c++ {
		for r := 0; r < 4; r++ {
			var s float64
			for k := 0; k < 4; k++ {
				s += a[k*4+r] * b[c*4+k]
			}
			out[c*4+r] = s
		}
	}
	return out
}

// nodeMatrix is a node's local transform: its matrix, or translation × rotation × scale.
func nodeMatrix(matrix, t, r, s []float64) [16]float64 {
	if len(matrix) == 16 {
		var m [16]float64
		copy(m[:], matrix)
		return m
	}
	m := identity4()
	if len(r) == 4 {
		x, y, z, w := r[0], r[1], r[2], r[3]
		m = [16]float64{
			1 - 2*(y*y+z*z), 2 * (x*y + z*w), 2 * (x*z - y*w), 0,
			2 * (x*y - z*w), 1 - 2*(x*x+z*z), 2 * (y*z + x*w), 0,
			2 * (x*z + y*w), 2 * (y*z - x*w), 1 - 2*(x*x+y*y), 0,
			0, 0, 0, 1,
		}
	}
	if len(s) == 3 {
		for c := 0; c < 3; c++ {
			for k := 0; k < 3; k++ {
				m[c*4+k] *= s[c]
			}
		}
	}
	if len(t) == 3 {
		m[12], m[13], m[14] = t[0], t[1], t[2]
	}
	return m
}

func det3(m [16]float64) float64 {
	return m[0]*(m[5]*m[10]-m[9]*m[6]) - m[4]*(m[1]*m[10]-m[9]*m[2]) + m[8]*(m[1]*m[6]-m[5]*m[2])
}

// normalMatrix is the 3x3 that moves normals under m (column-major): its upper 3x3's cofactors, which
// is the inverse transpose times the determinant, its sign taken out so normals keep pointing out.
func normalMatrix(m [16]float64) [9]float64 {
	a := [9]float64{m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]}
	// a[c*3+r] is row r, column c. The cofactor of (r, c) goes to the same place.
	at := func(r, c int) float64 { return a[c*3+r] }
	var out [9]float64
	for r := 0; r < 3; r++ {
		for c := 0; c < 3; c++ {
			r1, r2 := (r+1)%3, (r+2)%3
			c1, c2 := (c+1)%3, (c+2)%3
			out[c*3+r] = at(r1, c1)*at(r2, c2) - at(r1, c2)*at(r2, c1)
		}
	}
	if det3(m) < 0 {
		for i := range out {
			out[i] = -out[i]
		}
	}
	return out
}

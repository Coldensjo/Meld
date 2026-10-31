package wow

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"math"
	"net/url"
	"strings"
)

// A model as a binary glTF 2.0 file (GLB), for opening in Blender (#290): the mesh as the editor draws
// it, one primitive a material, its textures as PNGs inside the file. glTF is Y up in metres like the
// editor's space (yards), so a glTF importer (Blender's turns Y up into Z up) sees it as the client's
// model space. Only the still mesh goes in: no bones, animation, particles or lights.

// ModelGLB returns the client model a placed object's type names (the path after "m2:" or "wmo:", with
// a look or WMO doodad set as a query after '?', as the page's types carry them) as a GLB file.
func (c *Client) ModelGLB(path string) ([]byte, error) {
	look := Look{}
	if p, q, ok := strings.Cut(path, "?"); ok {
		path = p
		v, err := url.ParseQuery(q)
		if err != nil {
			return nil, err
		}
		look = ParseLook(v)
	}
	var lp *Look
	if !look.Empty() {
		lp = &look
	}
	m, err := c.mesh(path, lp)
	if errors.Is(err, ErrNothingToDraw) {
		return nil, errors.New("the client draws nothing of this model (a collision blocker or trigger)")
	}
	if err != nil {
		return nil, err
	}
	return EncodeGLB(m, modelName(path), c.textureImage)
}

// textureImage is a client texture (or a composed body texture) decoded, nil when it can't be read.
func (c *Client) textureImage(path string) *Image {
	if path == "" {
		return nil
	}
	if layers, ok := parseComposed(path); ok {
		img, err := c.composeTexture(layers)
		if err != nil {
			return nil
		}
		return img
	}
	raw, err := c.read(path)
	if err != nil {
		return nil
	}
	img, err := DecodeBLP(raw)
	if err != nil {
		return nil
	}
	return img
}

// modelName is a model path's file name without its folder and extension.
func modelName(path string) string {
	p := path[strings.LastIndexAny(path, `\/`)+1:]
	if i := strings.LastIndexByte(p, '.'); i > 0 {
		p = p[:i]
	}
	return p
}

// glTF component types, targets and sampler values.
const (
	gltfFloat        = 5126
	gltfUint32       = 5125
	gltfArrayBuffer  = 34962
	gltfIndexBuffer  = 34963
	gltfRepeat       = 10497
	gltfLinear       = 9729
	gltfLinearMipmap = 9987
)

type gltfDoc struct {
	Asset          map[string]string `json:"asset"`
	Scene          int               `json:"scene"`
	Scenes         []gltfScene       `json:"scenes"`
	Nodes          []gltfNode        `json:"nodes"`
	Meshes         []gltfMesh        `json:"meshes"`
	Materials      []gltfMaterial    `json:"materials,omitempty"`
	Textures       []gltfTexture     `json:"textures,omitempty"`
	Images         []gltfImage       `json:"images,omitempty"`
	Samplers       []map[string]int  `json:"samplers,omitempty"`
	Accessors      []gltfAccessor    `json:"accessors"`
	BufferViews    []gltfBufferView  `json:"bufferViews"`
	Buffers        []map[string]int  `json:"buffers"`
	ExtensionsUsed []string          `json:"extensionsUsed,omitempty"`
}

type gltfScene struct {
	Nodes []int `json:"nodes"`
}

type gltfNode struct {
	Name string `json:"name"`
	Mesh int    `json:"mesh"`
}

type gltfMesh struct {
	Name       string          `json:"name"`
	Primitives []gltfPrimitive `json:"primitives"`
}

type gltfPrimitive struct {
	Attributes map[string]int `json:"attributes"`
	Indices    int            `json:"indices"`
	Material   int            `json:"material"`
}

type gltfMaterial struct {
	Name        string         `json:"name"`
	PBR         gltfPBR        `json:"pbrMetallicRoughness"`
	AlphaMode   string         `json:"alphaMode,omitempty"`
	AlphaCutoff *float64       `json:"alphaCutoff,omitempty"`
	DoubleSided bool           `json:"doubleSided,omitempty"`
	Extensions  map[string]any `json:"extensions,omitempty"`
}

type gltfPBR struct {
	BaseColorTexture *gltfTexRef `json:"baseColorTexture,omitempty"`
	MetallicFactor   float64     `json:"metallicFactor"`
	RoughnessFactor  float64     `json:"roughnessFactor"`
}

type gltfTexRef struct {
	Index int `json:"index"`
}

type gltfTexture struct {
	Sampler int `json:"sampler"`
	Source  int `json:"source"`
}

type gltfImage struct {
	Name       string `json:"name"`
	BufferView int    `json:"bufferView"`
	MimeType   string `json:"mimeType"`
}

type gltfAccessor struct {
	BufferView    int       `json:"bufferView"`
	ByteOffset    int       `json:"byteOffset,omitempty"`
	ComponentType int       `json:"componentType"`
	Count         int       `json:"count"`
	Type          string    `json:"type"`
	Min           []float32 `json:"min,omitempty"`
	Max           []float32 `json:"max,omitempty"`
}

type gltfBufferView struct {
	Buffer     int `json:"buffer"`
	ByteOffset int `json:"byteOffset"`
	ByteLength int `json:"byteLength"`
	Target     int `json:"target,omitempty"`
}

// glbWriter gathers a GLB's binary chunk and the views into it.
type glbWriter struct {
	doc gltfDoc
	bin []byte
}

// view appends b to the binary chunk, 4-byte aligned, and returns its buffer view's index.
func (w *glbWriter) view(b []byte, target int) int {
	for len(w.bin)%4 != 0 {
		w.bin = append(w.bin, 0)
	}
	w.doc.BufferViews = append(w.doc.BufferViews, gltfBufferView{ByteOffset: len(w.bin), ByteLength: len(b), Target: target})
	w.bin = append(w.bin, b...)
	return len(w.doc.BufferViews) - 1
}

func (w *glbWriter) accessor(a gltfAccessor) int {
	w.doc.Accessors = append(w.doc.Accessors, a)
	return len(w.doc.Accessors) - 1
}

func floatBytes(f []float32) []byte {
	b := make([]byte, 4*len(f))
	for i, v := range f {
		binary.LittleEndian.PutUint32(b[4*i:], math.Float32bits(v))
	}
	return b
}

// EncodeGLB writes m as a GLB file named name, its groups' textures read through texture (nil for one
// that can't be read, whose material then has none).
func EncodeGLB(m *Mesh, name string, texture func(path string) *Image) ([]byte, error) {
	n := m.vertCount()
	if n == 0 || len(m.Index) == 0 {
		return nil, errors.New("the model has no triangles")
	}
	if len(m.Normal) != 3*n || len(m.UV) != 2*n {
		return nil, errors.New("the model's normals or texture coordinates don't match its vertices")
	}
	w := &glbWriter{doc: gltfDoc{
		Asset:   map[string]string{"version": "2.0", "generator": "Meld"},
		Scenes:  []gltfScene{{Nodes: []int{0}}},
		Nodes:   []gltfNode{{Name: name, Mesh: 0}},
		Buffers: []map[string]int{{}},
	}}

	// Positions, with the bounds glTF asks of them.
	lo := []float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32}
	hi := []float32{-math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32}
	for i := 0; i < n; i++ {
		for k := 0; k < 3; k++ {
			v := m.Pos[3*i+k]
			lo[k] = min(lo[k], v)
			hi[k] = max(hi[k], v)
		}
	}
	pos := w.accessor(gltfAccessor{BufferView: w.view(floatBytes(m.Pos), gltfArrayBuffer), ComponentType: gltfFloat, Count: n, Type: "VEC3", Min: lo, Max: hi})
	// glTF asks for unit normals: a zero one (a model's hull, a degenerate vertex) points up.
	normals := make([]float32, len(m.Normal))
	for i := 0; i < n; i++ {
		x, y, z := m.Normal[3*i], m.Normal[3*i+1], m.Normal[3*i+2]
		l := float32(math.Sqrt(float64(x*x + y*y + z*z)))
		if l < 1e-6 {
			x, y, z, l = 0, 1, 0, 1
		}
		normals[3*i], normals[3*i+1], normals[3*i+2] = x/l, y/l, z/l
	}
	nrm := w.accessor(gltfAccessor{BufferView: w.view(floatBytes(normals), gltfArrayBuffer), ComponentType: gltfFloat, Count: n, Type: "VEC3"})
	uv := w.accessor(gltfAccessor{BufferView: w.view(floatBytes(m.UV), gltfArrayBuffer), ComponentType: gltfFloat, Count: n, Type: "VEC2"})
	attrs := map[string]int{"POSITION": pos, "NORMAL": nrm, "TEXCOORD_0": uv}

	idx := make([]byte, 4*len(m.Index))
	for i, v := range m.Index {
		if int(v) >= n {
			return nil, errors.New("the model's triangles name a vertex it doesn't have")
		}
		binary.LittleEndian.PutUint32(idx[4*i:], v)
	}
	idxView := w.view(idx, gltfIndexBuffer)

	images := map[string]int{} // texture path → texture index, -1 for one that can't be read
	unlit := false
	gm := gltfMesh{Name: name}
	for _, g := range m.Groups {
		if g.Count <= 0 || g.Start < 0 || g.Start+g.Count > len(m.Index) {
			continue
		}
		tex, ok := images[g.Texture]
		if !ok {
			tex = -1
			if img := texture(g.Texture); img != nil && img.W > 0 && img.H > 0 && len(img.Pix) == 4*img.W*img.H {
				var buf bytes.Buffer
				nrgba := &image.NRGBA{Pix: img.Pix, Stride: 4 * img.W, Rect: image.Rect(0, 0, img.W, img.H)}
				if err := png.Encode(&buf, nrgba); err == nil {
					if len(w.doc.Samplers) == 0 {
						w.doc.Samplers = []map[string]int{{"wrapS": gltfRepeat, "wrapT": gltfRepeat, "magFilter": gltfLinear, "minFilter": gltfLinearMipmap}}
					}
					w.doc.Images = append(w.doc.Images, gltfImage{Name: modelName(g.Texture), BufferView: w.view(buf.Bytes(), 0), MimeType: "image/png"})
					w.doc.Textures = append(w.doc.Textures, gltfTexture{Source: len(w.doc.Images) - 1})
					tex = len(w.doc.Textures) - 1
				}
			}
			images[g.Texture] = tex
		}
		mat := gltfMaterial{Name: materialName(g), PBR: gltfPBR{RoughnessFactor: 1}, DoubleSided: g.TwoSided}
		if tex >= 0 {
			mat.PBR.BaseColorTexture = &gltfTexRef{Index: tex}
		}
		switch g.Blend {
		case BlendOpaque:
		case BlendAlphaKey:
			cut := 0.5
			mat.AlphaMode, mat.AlphaCutoff = "MASK", &cut
		default:
			mat.AlphaMode = "BLEND"
		}
		if g.Unlit {
			mat.Extensions = map[string]any{"KHR_materials_unlit": map[string]any{}}
			unlit = true
		}
		w.doc.Materials = append(w.doc.Materials, mat)
		ia := w.accessor(gltfAccessor{BufferView: idxView, ByteOffset: 4 * g.Start, ComponentType: gltfUint32, Count: g.Count, Type: "SCALAR"})
		gm.Primitives = append(gm.Primitives, gltfPrimitive{Attributes: attrs, Indices: ia, Material: len(w.doc.Materials) - 1})
	}
	if len(gm.Primitives) == 0 {
		return nil, errors.New("the model has no triangles")
	}
	if unlit {
		w.doc.ExtensionsUsed = []string{"KHR_materials_unlit"}
	}
	w.doc.Meshes = []gltfMesh{gm}
	for len(w.bin)%4 != 0 {
		w.bin = append(w.bin, 0)
	}
	w.doc.Buffers[0]["byteLength"] = len(w.bin)

	js, err := json.Marshal(w.doc)
	if err != nil {
		return nil, err
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}
	out := make([]byte, 12, 12+8+len(js)+8+len(w.bin))
	copy(out, "glTF")
	binary.LittleEndian.PutUint32(out[4:], 2)
	binary.LittleEndian.PutUint32(out[8:], uint32(cap(out)))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(js)))
	out = append(out, "JSON"...)
	out = append(out, js...)
	out = binary.LittleEndian.AppendUint32(out, uint32(len(w.bin)))
	out = append(out, 'B', 'I', 'N', 0)
	out = append(out, w.bin...)
	return out, nil
}

// materialName names a group's material after its texture (Blender numbers repeated names).
func materialName(g Group) string {
	if g.Texture == "" {
		return "Material"
	}
	return modelName(g.Texture)
}

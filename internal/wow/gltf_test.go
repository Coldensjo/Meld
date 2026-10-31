package wow

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"image/png"
	"math"
	"testing"

	"Meld/internal/testclient"
)

// readGLB splits a GLB file into its JSON document and binary chunk, failing on a bad header.
func readGLB(t *testing.T, b []byte) (gltfDoc, []byte) {
	t.Helper()
	if len(b) < 20 || string(b[:4]) != "glTF" || binary.LittleEndian.Uint32(b[4:]) != 2 {
		t.Fatalf("not a glTF 2 binary: % x", b[:min(len(b), 12)])
	}
	if int(binary.LittleEndian.Uint32(b[8:])) != len(b) {
		t.Fatalf("header length %d, file %d", binary.LittleEndian.Uint32(b[8:]), len(b))
	}
	jl := int(binary.LittleEndian.Uint32(b[12:]))
	if string(b[16:20]) != "JSON" || jl%4 != 0 {
		t.Fatalf("bad JSON chunk: %q, %d bytes", b[16:20], jl)
	}
	var doc gltfDoc
	if err := json.Unmarshal(b[20:20+jl], &doc); err != nil {
		t.Fatal(err)
	}
	rest := b[20+jl:]
	bl := int(binary.LittleEndian.Uint32(rest))
	if string(rest[4:8]) != "BIN\x00" || bl != len(rest)-8 || bl != doc.Buffers[0]["byteLength"] {
		t.Fatalf("bad BIN chunk: %q, %d bytes of %d, buffer %d", rest[4:8], bl, len(rest)-8, doc.Buffers[0]["byteLength"])
	}
	return doc, rest[8:]
}

func TestEncodeGLB(t *testing.T) {
	// Two triangles: one textured and alpha-keyed, one plain, two-sided and unlit.
	m := &Mesh{
		Pos:    []float32{0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, -3},
		Normal: []float32{0, 0, 2, 0, 0, 1, 0, 0, 1, 0, 0, 0},
		UV:     []float32{0, 0, 1, 0, 0, 1, 1, 1},
		Index:  []uint32{0, 1, 2, 0, 2, 3},
		Groups: []Group{
			{Start: 0, Count: 3, Texture: `World\Tex\Stone.blp`, Blend: BlendAlphaKey},
			{Start: 3, Count: 3, Texture: `Missing.blp`, TwoSided: true, Unlit: true},
		},
	}
	tex := func(path string) *Image {
		if path != `World\Tex\Stone.blp` {
			return nil
		}
		return &Image{W: 2, H: 1, Pix: []byte{255, 0, 0, 255, 0, 255, 0, 128}}
	}
	b, err := EncodeGLB(m, "Stone", tex)
	if err != nil {
		t.Fatal(err)
	}
	doc, bin := readGLB(t, b)
	if len(doc.Meshes) != 1 || len(doc.Meshes[0].Primitives) != 2 || len(doc.Materials) != 2 {
		t.Fatalf("meshes %d, primitives %v, materials %d", len(doc.Meshes), doc.Meshes, len(doc.Materials))
	}
	a, c := doc.Materials[0], doc.Materials[1]
	if a.AlphaMode != "MASK" || a.PBR.BaseColorTexture == nil || a.DoubleSided {
		t.Errorf("first material %+v", a)
	}
	if c.AlphaMode != "" || c.PBR.BaseColorTexture != nil || !c.DoubleSided || c.Extensions["KHR_materials_unlit"] == nil {
		t.Errorf("second material %+v", c)
	}
	if len(doc.ExtensionsUsed) != 1 || doc.ExtensionsUsed[0] != "KHR_materials_unlit" {
		t.Errorf("extensions used %v", doc.ExtensionsUsed)
	}
	pos := doc.Accessors[doc.Meshes[0].Primitives[0].Attributes["POSITION"]]
	if pos.Count != 4 || pos.Min[1] != 0 || pos.Max[1] != 2 || pos.Min[2] != -3 {
		t.Errorf("positions %+v", pos)
	}
	// The second primitive's indices start at the second triangle.
	ia := doc.Accessors[doc.Meshes[0].Primitives[1].Indices]
	view := doc.BufferViews[ia.BufferView]
	at := view.ByteOffset + ia.ByteOffset
	if ia.Count != 3 || binary.LittleEndian.Uint32(bin[at+4:]) != 2 || binary.LittleEndian.Uint32(bin[at+8:]) != 3 {
		t.Errorf("second primitive's indices %+v", ia)
	}
	// Normals come out unit length, a zero one pointing up.
	nv := doc.BufferViews[doc.Accessors[doc.Meshes[0].Primitives[0].Attributes["NORMAL"]].BufferView]
	f := func(i int) float32 {
		return math.Float32frombits(binary.LittleEndian.Uint32(bin[nv.ByteOffset+4*i:]))
	}
	if f(2) != 1 || f(10) != 1 {
		t.Errorf("normals %v %v, want 1 and 1", f(2), f(10))
	}
	// The texture is a PNG in the binary chunk.
	if len(doc.Images) != 1 || doc.Images[0].MimeType != "image/png" || doc.Images[0].Name != "Stone" {
		t.Fatalf("images %+v", doc.Images)
	}
	iv := doc.BufferViews[doc.Images[0].BufferView]
	img, err := png.Decode(bytes.NewReader(bin[iv.ByteOffset : iv.ByteOffset+iv.ByteLength]))
	if err != nil {
		t.Fatal(err)
	}
	if r, _, _, al := img.At(0, 0).RGBA(); img.Bounds().Dx() != 2 || r != 0xffff || al != 0xffff {
		t.Errorf("texture %v, first pixel red %x alpha %x", img.Bounds(), r, al)
	}
	for _, v := range doc.BufferViews {
		if v.ByteOffset%4 != 0 {
			t.Errorf("view at %d isn't 4-byte aligned", v.ByteOffset)
		}
	}
}

func TestEncodeGLBRefusesAnEmptyMesh(t *testing.T) {
	if _, err := EncodeGLB(&Mesh{}, "x", func(string) *Image { return nil }); err == nil {
		t.Fatal("an empty mesh encoded")
	}
	m := &Mesh{Pos: make([]float32, 9), Normal: make([]float32, 9), UV: make([]float32, 6), Index: []uint32{0, 1, 5}, Groups: []Group{{Count: 3}}}
	if _, err := EncodeGLB(m, "x", func(string) *Image { return nil }); err == nil {
		t.Fatal("a triangle naming a missing vertex encoded")
	}
}

// TestClientModelGLB exports a client doodad and a building with their textures.
// WOW_DIR=/path/to/client go test ./internal/wow/ -run ModelGLB
func TestClientModelGLB(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{`World\Azeroth\Elwynn\PassiveDoodads\Trees\ElwynnTreeCanopy01.m2`, `World\wmo\Azeroth\Buildings\Duskwood_Barn\Duskwood_Barn.wmo?set=1`} {
		b, err := c.ModelGLB(path)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		doc, _ := readGLB(t, b)
		if len(doc.Meshes[0].Primitives) == 0 || len(doc.Images) == 0 {
			t.Errorf("%s: %d primitives, %d images", path, len(doc.Meshes[0].Primitives), len(doc.Images))
		}
	}
}

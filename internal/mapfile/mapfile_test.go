package mapfile

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"math"
	"path/filepath"
	"testing"
)

func sample(size, splat int) *MapData {
	h := make([]byte, (size+1)*(size+1)*4)
	for i := 0; i < (size+1)*(size+1); i++ {
		binary.LittleEndian.PutUint32(h[i*4:], math.Float32bits(float32(i)*0.5))
	}
	a := make([]byte, splat*splat*4)
	b := make([]byte, splat*splat*4)
	for i := range a {
		a[i] = byte(i)
		b[i] = byte(255 - i%256)
	}
	return &MapData{
		Header: Header{
			Name: "test", Size: size, CellSize: 2, SplatRes: splat,
			WaterLevel: 1.5, WaterEnabled: true,
			Objects:       []PlacedObject{{Type: "oak", X: 1, Z: 2, RotY: 0.5, Scale: 1.2}},
			LayerTextures: []string{"", `Tileset\Elwynn\ElwynnGrassBase.blp`},
			TexScale:      4,
		},
		Heights: base64.StdEncoding.EncodeToString(h),
		SplatA:  base64.StdEncoding.EncodeToString(a),
		SplatB:  base64.StdEncoding.EncodeToString(b),
	}
}

func TestRoundTrip(t *testing.T) {
	m := sample(32, 64)
	path := filepath.Join(t.TempDir(), "x.wmap")
	if err := Save(path, m); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Heights != m.Heights || got.SplatA != m.SplatA || got.SplatB != m.SplatB {
		t.Fatal("blob mismatch")
	}
	if got.Name != "test" || got.WaterLevel != 1.5 || !got.WaterEnabled {
		t.Fatalf("header mismatch: %+v", got.Header)
	}
	if len(got.LayerTextures) != 2 || got.LayerTextures[1] != m.LayerTextures[1] || got.TexScale != 4 {
		t.Fatalf("layer textures mismatch: %+v", got.LayerTextures)
	}
	if len(got.Objects) != 1 || got.Objects[0].Type != "oak" || got.Objects[0].Scale != 1.2 {
		t.Fatalf("objects mismatch: %+v", got.Objects)
	}
}

func TestRejectsWrongBlobSize(t *testing.T) {
	m := sample(32, 64)
	m.SplatA = base64.StdEncoding.EncodeToString([]byte{1, 2, 3})
	if err := Write(&bytes.Buffer{}, m); err == nil {
		t.Fatal("expected error")
	}
}

func TestRejectsGarbage(t *testing.T) {
	if _, err := Read(bytes.NewReader([]byte("hello world"))); err == nil {
		t.Fatal("expected error")
	}
}

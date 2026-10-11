package mapfile

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"math"
	"path/filepath"
	"testing"
)

// sample is a version 2 map: size cells a side, with four texel weights per texel and a slot table.
func sample(size int) *MapData {
	h := make([]byte, (size+1)*(size+1)*4)
	for i := 0; i < (size+1)*(size+1); i++ {
		binary.LittleEndian.PutUint32(h[i*4:], math.Float32bits(float32(i)*0.5))
	}
	res := size * ChunkCells / 2
	w := make([]byte, res*res*4)
	for i := range w {
		w[i] = byte(i)
	}
	chunks := (size / ChunkCells) * (size / ChunkCells)
	slots := make([]byte, chunks*SlotsPerChunk)
	for i := range slots {
		slots[i] = byte(i % 3)
	}
	return &MapData{
		Header: Header{
			Name: "test", Size: size, CellSize: 4, SplatRes: res,
			WaterLevel: 1.5, WaterEnabled: true,
			Objects:  []PlacedObject{{ID: 1, Type: "oak", X: 1, Z: 2, RotY: 0.5, Scale: 1.2}, {ID: 2, Parent: 1, Type: "crate", X: 0.5, YOff: 3, Scale: 1}},
			Palette:  []string{"#5d8a2f", `Tileset\Elwynn\ElwynnGrassBase.blp`},
			TexScale: 4,
		},
		Heights:    base64.StdEncoding.EncodeToString(h),
		Weights:    base64.StdEncoding.EncodeToString(w),
		ChunkSlots: base64.StdEncoding.EncodeToString(slots),
	}
}

func TestRoundTrip(t *testing.T) {
	m := sample(32)
	path := filepath.Join(t.TempDir(), "x.wmap")
	if err := Save(path, m); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != Version {
		t.Fatalf("version = %d, want %d", got.Version, Version)
	}
	if got.Heights != m.Heights || got.Weights != m.Weights || got.ChunkSlots != m.ChunkSlots {
		t.Fatal("blob mismatch")
	}
	if got.Name != "test" || got.WaterLevel != 1.5 || !got.WaterEnabled || got.CellSize != 4 {
		t.Fatalf("header mismatch: %+v", got.Header)
	}
	if len(got.Palette) != 2 || got.Palette[1] != m.Palette[1] || got.TexScale != 4 {
		t.Fatalf("palette mismatch: %+v", got.Palette)
	}
	if len(got.Objects) != 2 || got.Objects[0].Type != "oak" || got.Objects[0].Scale != 1.2 || got.Objects[1].Parent != 1 {
		t.Fatalf("objects mismatch: %+v", got.Objects)
	}
}

// writeV1 writes a version 1 stream, as the format before chunks: eight global layers.
func writeV1(t *testing.T, size, splat int) []byte {
	t.Helper()
	hdr, err := json.Marshal(&Header{Name: "old", Size: size, CellSize: 2, SplatRes: splat, LayerTextures: []string{"", `Tileset\Dirt.blp`}})
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	var pre [12]byte
	copy(pre[:4], Magic)
	binary.LittleEndian.PutUint32(pre[4:8], 1)
	binary.LittleEndian.PutUint32(pre[8:12], uint32(len(hdr)))
	gz.Write(pre[:])
	gz.Write(hdr)
	gz.Write(make([]byte, (size+1)*(size+1)*4))
	gz.Write(make([]byte, splat*splat*4))
	gz.Write(make([]byte, splat*splat*4))
	gz.Close()
	return buf.Bytes()
}

func TestReadsVersion1(t *testing.T) {
	m, err := Read(bytes.NewReader(writeV1(t, 32, 64)))
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != 1 || m.SplatA == "" || m.SplatB == "" || m.Weights != "" {
		t.Fatalf("version 1 fields: version %d, splatA %d bytes", m.Version, len(m.SplatA))
	}
	if len(m.LayerTextures) != 2 || m.LayerTextures[1] != `Tileset\Dirt.blp` {
		t.Fatalf("layers = %v", m.LayerTextures)
	}
}

func TestRejectsWrongBlobSize(t *testing.T) {
	m := sample(32)
	m.Weights = base64.StdEncoding.EncodeToString([]byte{1, 2, 3})
	if err := Write(&bytes.Buffer{}, m); err == nil {
		t.Fatal("expected error")
	}
}

func TestRejectsSizeNotMultipleOfChunk(t *testing.T) {
	m := sample(32)
	m.Size = 36
	if err := Write(&bytes.Buffer{}, m); err == nil {
		t.Fatal("expected error for a size that isn't whole chunks")
	}
}

func TestRejectsTooManyPaletteEntries(t *testing.T) {
	m := sample(32)
	m.Palette = make([]string, MaxPalette+1)
	if err := Write(&bytes.Buffer{}, m); err == nil {
		t.Fatal("expected error")
	}
}

func TestRejectsGarbage(t *testing.T) {
	if _, err := Read(bytes.NewReader([]byte("hello world"))); err == nil {
		t.Fatal("expected error")
	}
}

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

// sample is a current-format map: size cells a side, with four texel weights per texel, a slot table
// and a hole in one cell.
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
	holes := make([]byte, size*size)
	holes[size+1] = 1
	// One water layer in chunk 3, over its first cell.
	liquids := make([]byte, 4+LiquidRecordSize)
	binary.LittleEndian.PutUint32(liquids, 1)
	binary.LittleEndian.PutUint32(liquids[4:], 3)
	liquids[8] = 1
	liquids[9] = 1
	// Chunk 2 is in zone 12 and impassable, and one cell grows no tufts.
	areas := make([]byte, chunks*4)
	binary.LittleEndian.PutUint32(areas[2*4:], 12)
	flags := make([]byte, chunks)
	flags[2] = ChunkImpassable
	noEffect := make([]byte, size*size)
	noEffect[2*size+5] = 1
	// One texel in shadow at each end of the shadow map.
	shadows := make([]byte, size*ShadowTexels*size*ShadowTexels/8)
	shadows[0], shadows[len(shadows)-1] = 1, 0x80
	return &MapData{
		Header: Header{
			Name: "test", Size: size, CellSize: 4, SplatRes: res,
			WaterLevel: 1.5, WaterEnabled: true,
			Objects:        []PlacedObject{{ID: 1, Type: "oak", X: 1, Z: 2, RotY: 0.5, Scale: 1.2, Group: 3}, {ID: 2, Parent: 1, Type: "crate", X: 0.5, YOff: 3, Scale: 1}},
			Palette:        []string{"#5d8a2f", `Tileset\Elwynn\ElwynnGrassBase.blp`},
			Roles:          &TextureRoles{Rock: 1, Dirt: -1},
			TextureEffects: map[string]uint32{`Tileset\Elwynn\ElwynnGrassBase.blp`: 42},
			TextureLooks:   map[string]uint32{`Tileset\Elwynn\ElwynnGrassBase.blp`: 0xd2},
			ZoneEffects:    map[string]map[string]uint32{"12": {`Tileset\Elwynn\ElwynnGrassBase.blp`: 7}},
			TileEffects:    map[string]map[string]uint32{"1,2": {`Tileset\Elwynn\ElwynnGrassBase.blp`: 9}},
		},
		Heights:    base64.StdEncoding.EncodeToString(h),
		Weights:    base64.StdEncoding.EncodeToString(w),
		ChunkSlots: base64.StdEncoding.EncodeToString(slots),
		Holes:      base64.StdEncoding.EncodeToString(holes),
		Liquids:    base64.StdEncoding.EncodeToString(liquids),
		AreaIDs:    base64.StdEncoding.EncodeToString(areas),
		ChunkFlags: base64.StdEncoding.EncodeToString(flags),
		NoEffect:   base64.StdEncoding.EncodeToString(noEffect),
		Shadows:    base64.StdEncoding.EncodeToString(shadows),
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
	if got.Heights != m.Heights || got.Weights != m.Weights || got.ChunkSlots != m.ChunkSlots || got.Holes != m.Holes || got.Liquids != m.Liquids ||
		got.AreaIDs != m.AreaIDs || got.ChunkFlags != m.ChunkFlags || got.NoEffect != m.NoEffect || got.Shadows != m.Shadows {
		t.Fatal("blob mismatch")
	}
	if got.Name != "test" || got.WaterLevel != 1.5 || !got.WaterEnabled || got.CellSize != 4 {
		t.Fatalf("header mismatch: %+v", got.Header)
	}
	if len(got.Palette) != 2 || got.Palette[1] != m.Palette[1] {
		t.Fatalf("palette mismatch: %+v", got.Palette)
	}
	if got.ZoneEffects["12"][m.Palette[1]] != 7 || got.TileEffects["1,2"][m.Palette[1]] != 9 {
		t.Fatalf("zone effects %v and tile effects %v", got.ZoneEffects, got.TileEffects)
	}
	if got.TextureEffects[m.Palette[1]] != 42 || got.TextureLooks[m.Palette[1]] != 0xd2 {
		t.Fatalf("texture effects %v and looks %v", got.TextureEffects, got.TextureLooks)
	}
	if len(got.Objects) != 2 || got.Objects[0].Type != "oak" || got.Objects[0].Scale != 1.2 || got.Objects[1].Parent != 1 || got.Objects[0].Group != 3 || got.Objects[1].Group != 0 {
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

// writeV2 writes a version 2 stream: the current layout without the holes blob.
func writeV2(t *testing.T, m *MapData) []byte {
	return writeOld(t, m, 2)
}

// writeOld writes a version 2, 3 or 4 stream: the current layout without the version 5 blobs, for
// version 3 without liquids too, and for version 2 without holes.
func writeOld(t *testing.T, m *MapData, version uint32) []byte {
	t.Helper()
	hdr, err := json.Marshal(&m.Header)
	if err != nil {
		t.Fatal(err)
	}
	dec := func(s string) []byte {
		b, err := base64.StdEncoding.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	var pre [12]byte
	copy(pre[:4], Magic)
	binary.LittleEndian.PutUint32(pre[4:8], version)
	binary.LittleEndian.PutUint32(pre[8:12], uint32(len(hdr)))
	gz.Write(pre[:])
	gz.Write(hdr)
	gz.Write(dec(m.Heights))
	gz.Write(dec(m.Weights))
	gz.Write(dec(m.ChunkSlots))
	if version >= 3 {
		gz.Write(dec(m.Holes))
	}
	if version >= 4 {
		liquids := dec(m.Liquids)
		var n [4]byte
		binary.LittleEndian.PutUint32(n[:], uint32(len(liquids)))
		gz.Write(n[:])
		gz.Write(liquids)
	}
	if version >= 5 {
		gz.Write(dec(m.AreaIDs))
		gz.Write(dec(m.ChunkFlags))
		gz.Write(dec(m.NoEffect))
	}
	gz.Close()
	return buf.Bytes()
}

// A version 2 map has no holes blob and opens with no holes.
func TestReadsVersion2WithoutHoles(t *testing.T) {
	m, err := Read(bytes.NewReader(writeV2(t, sample(32))))
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != 2 || m.Holes != "" || m.Weights == "" {
		t.Fatalf("version 2 fields: version %d, holes %d bytes", m.Version, len(m.Holes))
	}
}

// A version 3 map has holes but no liquids, and opens with none.
func TestReadsVersion3WithoutLiquids(t *testing.T) {
	m, err := Read(bytes.NewReader(writeOld(t, sample(32), 3)))
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != 3 || m.Liquids != "" || m.Holes == "" {
		t.Fatalf("version 3 fields: version %d, liquids %d bytes", m.Version, len(m.Liquids))
	}
}

// A version 4 map has liquids but no area IDs, chunk flags or no-effect cells, and opens with none.
func TestReadsVersion4WithoutChunkData(t *testing.T) {
	m, err := Read(bytes.NewReader(writeOld(t, sample(32), 4)))
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != 4 || m.Liquids == "" || m.AreaIDs != "" || m.ChunkFlags != "" || m.NoEffect != "" {
		t.Fatalf("version 4 fields: version %d, areas %q", m.Version, m.AreaIDs)
	}
}

// A version 5 map has chunk data but no shadows blob, and opens with no shadows of its own.
func TestReadsVersion5WithoutShadows(t *testing.T) {
	m, err := Read(bytes.NewReader(writeOld(t, sample(32), 5)))
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != 5 || m.Shadows != "" || m.NoEffect == "" {
		t.Fatalf("version 5 fields: version %d, shadows %d bytes", m.Version, len(m.Shadows))
	}
}

// A map with no shadows of its own keeps none: an empty blob, read back empty.
func TestNoShadowsStayNone(t *testing.T) {
	m := sample(32)
	m.Shadows = ""
	var buf bytes.Buffer
	if err := Write(&buf, m); err != nil {
		t.Fatal(err)
	}
	got, err := Read(&buf)
	if err != nil || got.Shadows != "" {
		t.Fatalf("shadows %d bytes, %v", len(got.Shadows), err)
	}
	m.Shadows = base64.StdEncoding.EncodeToString(make([]byte, 7))
	if err := Write(&buf, m); err == nil {
		t.Fatal("a shadows blob of the wrong size was written")
	}
}

// A writer that sends no chunk data writes zeros: no zone, nothing impassable, tufts everywhere.
func TestWritesEmptyChunkDataWhenNoneGiven(t *testing.T) {
	m := sample(32)
	m.AreaIDs, m.ChunkFlags, m.NoEffect = "", "", ""
	var buf bytes.Buffer
	if err := Write(&buf, m); err != nil {
		t.Fatal(err)
	}
	got, err := Read(&buf)
	if err != nil {
		t.Fatal(err)
	}
	areas, _ := base64.StdEncoding.DecodeString(got.AreaIDs)
	flags, _ := base64.StdEncoding.DecodeString(got.ChunkFlags)
	cells, _ := base64.StdEncoding.DecodeString(got.NoEffect)
	if len(areas) != 16*4 || len(flags) != 16 || len(cells) != 32*32 {
		t.Fatalf("sizes %d %d %d", len(areas), len(flags), len(cells))
	}
	for _, b := range [][]byte{areas, flags, cells} {
		if !bytes.Equal(b, make([]byte, len(b))) {
			t.Fatal("not all zero")
		}
	}
}

// A liquid layer must lie in one of the map's chunks.
func TestRejectsLiquidOffTheMap(t *testing.T) {
	m := sample(32)
	b, _ := base64.StdEncoding.DecodeString(m.Liquids)
	binary.LittleEndian.PutUint32(b[4:], 16) // a 32-cell map has 4x4 chunks
	m.Liquids = base64.StdEncoding.EncodeToString(b)
	if err := Write(&bytes.Buffer{}, m); err == nil {
		t.Fatal("a layer off the map was written")
	}
}

// A writer that sends no holes still produces a full file, with every cell solid.
func TestWritesEmptyHolesWhenNoneGiven(t *testing.T) {
	m := sample(32)
	m.Holes = ""
	var buf bytes.Buffer
	if err := Write(&buf, m); err != nil {
		t.Fatal(err)
	}
	got, err := Read(&buf)
	if err != nil {
		t.Fatal(err)
	}
	holes, _ := base64.StdEncoding.DecodeString(got.Holes)
	if len(holes) != 32*32 || bytes.Contains(holes, []byte{1}) {
		t.Fatalf("holes = %d bytes", len(holes))
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

// The client region link and the server folder survive a save, and a model keeps its client UID.
func TestClientLinkRoundTrip(t *testing.T) {
	m := sample(32)
	m.Region = &ClientRegion{MapName: "Azeroth", X: 32, Y: 48, Size: 4}
	m.Vmangos = &VmangosFolder{Dir: "MeldTest", MapID: 1900, Info: json.RawMessage(`{"type":2,"maxPlayers":40}`)}
	m.Objects[0].UID = 12345
	path := filepath.Join(t.TempDir(), "linked.wmap")
	if err := Save(path, m); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Region == nil || *got.Region != *m.Region {
		t.Fatalf("region link lost: %+v", got.Region)
	}
	if got.Vmangos == nil || got.Vmangos.Dir != m.Vmangos.Dir || got.Vmangos.MapID != m.Vmangos.MapID || string(got.Vmangos.Info) != string(m.Vmangos.Info) {
		t.Fatalf("server folder lost: %+v", got.Vmangos)
	}
	if got.Objects[0].UID != 12345 {
		t.Fatalf("model UID lost: %d", got.Objects[0].UID)
	}
}

// A map saved without a link has none, so older maps and plain maps still read as they did.
func TestNoClientLinkByDefault(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plain.wmap")
	if err := Save(path, sample(32)); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Region != nil || got.Vmangos != nil {
		t.Fatal("a map with no link must not gain one")
	}
}

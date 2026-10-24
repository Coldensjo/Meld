package worldfile

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

// The fixtures are the Rust side's (crates/world/tests/fixtures), so the two readers cannot drift.
// small.world is written by Rust; small-go.world is the same world written by this package, which
// the Rust test crates/world/tests/format.rs reads back.
var (
	fixture   = filepath.Join("..", "..", "..", "crates", "world", "tests", "fixtures", "small.world")
	goFixture = filepath.Join("..", "..", "..", "crates", "world", "tests", "fixtures", "small-go.world")
)

const (
	empty = iota
	dirt
	stone
	metal
	wood
	water
	sea
	lava
)

const (
	full = iota
	half
	slope
	stairs
	quarter
	pillar
	ladder
	doorway
	window
)

const (
	door = iota
	windowObject
	lever
	button
)

const (
	north = iota
	east
	south
	west
	up
	down
)

// Texture ids (crates/world/src/texture.rs, TEXTURES).
const (
	texDefault = iota
	texGrass
	texDirt
	texPath
	texStone
	texWood
	texPlanks
	texMetal
	texWater
	texSea
	texLava
)

type cube struct{ kind, shape, rotation byte }

// paintAt is the texture painted on face f of cube (x, z) of c, 0 when none is.
func paintAt(c *Chunk, x, z, f int) uint16 {
	if c.Paint == nil {
		return 0
	}
	return c.Paint[f*ChunkArea+z*ChunkSize+x]
}

func setPaint(c *Chunk, x, z, f int, t uint16) {
	if c.Paint == nil {
		c.Paint = make([]uint16, PaintLen)
	}
	c.Paint[f*ChunkArea+z*ChunkSize+x] = t
}

func chunkOf(w *World, cx, cz int32, layer uint8) *Chunk {
	for i := range w.Chunks {
		c := &w.Chunks[i]
		if c.CX == cx && c.CZ == cz && c.Layer == layer {
			return c
		}
	}
	return nil
}

func cubeAt(c *Chunk, x, z int) cube {
	i := z*ChunkSize + x
	return cube{c.Cubes[i], c.Cubes[ChunkArea+i], c.Cubes[2*ChunkArea+i]}
}

func setCube(c *Chunk, x, z int, v cube) {
	i := z*ChunkSize + x
	c.Cubes[i], c.Cubes[ChunkArea+i], c.Cubes[2*ChunkArea+i] = v.kind, v.shape, v.rotation
}

func filled(cx, cz int32, layer uint8, v cube) Chunk {
	c := Chunk{CX: cx, CZ: cz, Layer: layer, Cubes: make([]byte, PlanesLen)}
	for i := range ChunkArea {
		setCube(&c, i%ChunkSize, i/ChunkSize, v)
	}
	return c
}

// checkFixture asserts w is the world docs/world-format.md ("The fixture") lists.
func checkFixture(t *testing.T, w *World) {
	t.Helper()
	if w.ChunksX != 2 || w.ChunksZ != 2 {
		t.Fatalf("bounds %d x %d, want 2 x 2", w.ChunksX, w.ChunksZ)
	}
	if w.Spawn == nil || *w.Spawn != (CubePos{X: 4, Z: 5, Layer: 9}) {
		t.Fatalf("spawn %+v, want (4, 5, layer 9)", w.Spawn)
	}
	monsters := []MonsterSpawn{{"wolf", CubePos{20, 25, 9}}, {"höhlenbär", CubePos{3, 30, 25}}}
	if !slices.Equal(w.Monsters, monsters) {
		t.Errorf("monsters %+v, want %+v", w.Monsters, monsters)
	}
	npcs := []Npc{{"Warden Hask", CubePos{12, 20, 9}, []CubePos{{14, 20, 9}, {14, 28, 8}}}, {"Þóra", CubePos{6, 9, 10}, nil}}
	if !reflect.DeepEqual(w.Npcs, npcs) {
		t.Errorf("NPCs %+v, want %+v", w.Npcs, npcs)
	}
	if len(w.Chunks) != 6 {
		t.Fatalf("%d chunks, want 6", len(w.Chunks))
	}
	wall := []CubePos{{9, 2, 9}, {10, 2, 9}, {11, 2, 9}}
	if len(w.Joins) != 1 || w.Joins[0].ID != 1 || !slices.Equal(w.Joins[0].Cubes, wall) {
		t.Errorf("joins %+v, want group 1 of %v", w.Joins, wall)
	}
	objects := []Object{
		{ID: 1, Kind: door, Face: south, Pos: wall[0], State: 1},
		{ID: 2, Kind: lever, Face: south, Pos: wall[1], Targets: []uint32{1}, State: 1},
		{ID: 3, Kind: windowObject, Face: south, Pos: wall[2]},
	}
	if !slices.EqualFunc(w.Objects, objects, sameObject) {
		t.Errorf("objects %+v, want %+v", w.Objects, objects)
	}
	want := map[[3]int]map[[2]int]cube{
		{0, 0, 20}: nil, {1, 0, 20}: nil, {1, 1, 25}: nil, {0, 0, 10}: nil, {1, 1, 9}: nil, {0, 0, 9}: nil,
	}
	ground := map[[2]int]cube{
		{3, 4}:   {stone, slope, 1},
		{5, 6}:   {wood, stairs, 6},
		{7, 8}:   {water, full, 0},
		{15, 15}: {metal, pillar, 0},
		{1, 1}:   {wood, ladder, 3},
	}
	for x := range 16 {
		ground[[2]int{x, 0}] = cube{dirt, full, 0}
	}
	want[[3]int{0, 0, 10}] = ground
	want[[3]int{1, 1, 9}] = map[[2]int]cube{{4, 4}: {wood, half, 4}}
	want[[3]int{0, 0, 9}] = map[[2]int]cube{{9, 2}: {stone, doorway, 0}, {10, 2}: {stone, full, 0}, {11, 2}: {stone, window, 0}}
	// Paint: grass on top of the dirt row, a path across it at x = 5, planks on every north face of
	// chunk (1, 0) of layer 20, and wood on the south face of the wall's middle cube.
	paint := map[[3]int]map[[3]int]uint16{
		{0, 0, 10}: {},
		{1, 0, 20}: {},
		{0, 0, 9}:  {{10, 2, south}: texWood},
	}
	for x := range 16 {
		top := uint16(texGrass)
		if x == 5 {
			top = texPath
		}
		paint[[3]int{0, 0, 10}][[3]int{x, 0, up}] = top
	}
	for i := range ChunkArea {
		paint[[3]int{1, 0, 20}][[3]int{i % 16, i / 16, north}] = texPlanks
	}
	for key := range want {
		c := chunkOf(w, int32(key[0]), int32(key[1]), uint8(key[2]))
		if c == nil {
			continue
		}
		faces, painted := paint[key]
		if !painted {
			if c.Paint != nil {
				t.Errorf("chunk %v has paint, want none", key)
			}
			continue
		}
		for z := range 16 {
			for x := range 16 {
				for f := range FaceCount {
					if got, exp := paintAt(c, x, z, f), faces[[3]int{x, z, f}]; got != exp {
						t.Errorf("chunk %v cube (%d, %d) face %d painted %d, want %d", key, x, z, f, got, exp)
					}
				}
			}
		}
	}
	uniform := map[[3]int]cube{{0, 0, 20}: {stone, full, 0}, {1, 0, 20}: {stone, full, 0}, {1, 1, 25}: {lava, full, 0}}
	for key, cubes := range want {
		c := chunkOf(w, int32(key[0]), int32(key[1]), uint8(key[2]))
		if c == nil {
			t.Fatalf("chunk %v missing", key)
		}
		for z := range 16 {
			for x := range 16 {
				got := cubeAt(c, x, z)
				exp, ok := uniform[key]
				if !ok {
					exp = cubes[[2]int{x, z}]
				}
				if got != exp {
					t.Errorf("chunk %v cube (%d, %d) = %+v, want %+v", key, x, z, got, exp)
				}
			}
		}
	}
}

func sameObject(a, b Object) bool {
	return a.ID == b.ID && a.Kind == b.Kind && a.Face == b.Face && a.Pos == b.Pos && a.State == b.State && slices.Equal(a.Targets, b.Targets)
}

func TestReadsTheFixture(t *testing.T) {
	w, err := Load(fixture)
	if err != nil {
		t.Fatal(err)
	}
	checkFixture(t, w)
}

// The Go-written copy of the fixture holds the same world, and is what this writer writes now.
func TestGoFixtureIsTheFixture(t *testing.T) {
	w, err := Load(goFixture)
	if err != nil {
		t.Fatal(err)
	}
	checkFixture(t, w)
}

// Run with WRITE_GO_FIXTURE=1 to write small-go.world again (after an approved format change, with
// small.world written again first).
func TestWriteGoFixture(t *testing.T) {
	if os.Getenv("WRITE_GO_FIXTURE") == "" {
		t.Skip("set WRITE_GO_FIXTURE=1 to write the Go fixture")
	}
	w, err := Load(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if err := Save(goFixture, w); err != nil {
		t.Fatal(err)
	}
}

func TestRoundTrip(t *testing.T) {
	w, err := Load(fixture)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := Write(&buf, w); err != nil {
		t.Fatal(err)
	}
	back, err := Read(&buf)
	if err != nil {
		t.Fatal(err)
	}
	checkFixture(t, back)
	// The output depends only on the world: written again, the bytes are the same.
	var again bytes.Buffer
	if err := Write(&again, back); err != nil {
		t.Fatal(err)
	}
	var first bytes.Buffer
	_ = Write(&first, w)
	if !bytes.Equal(first.Bytes(), again.Bytes()) {
		t.Error("writing the same world twice gave different bytes")
	}
}

func TestSaveAndLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.world")
	w := &World{ChunksX: 3, ChunksZ: 1, Chunks: []Chunk{filled(2, 0, 30, cube{metal, full, 0})}}
	if err := Save(path, w); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Error("the temporary file is left behind")
	}
	back, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if back.ChunksX != 3 || len(back.Chunks) != 1 || cubeAt(&back.Chunks[0], 9, 9) != (cube{metal, full, 0}) {
		t.Errorf("loaded %+v", back)
	}
}

func TestWriterOrdersLeavesOutEmptyAndUsesUniform(t *testing.T) {
	mixed := filled(0, 0, 10, cube{})
	setCube(&mixed, 2, 3, cube{stone, full, 0})
	w := &World{ChunksX: 2, ChunksZ: 2, Chunks: []Chunk{
		filled(1, 1, 10, cube{dirt, full, 0}),
		mixed,
		filled(0, 1, 3, cube{}), // all empty: left out
		filled(1, 0, 10, cube{dirt, full, 0}),
	}}
	var buf bytes.Buffer
	if err := Write(&buf, w); err != nil {
		t.Fatal(err)
	}
	back, err := Read(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	var order [][3]int
	for _, c := range back.Chunks {
		order = append(order, [3]int{int(c.CX), int(c.CZ), int(c.Layer)})
	}
	want := [][3]int{{0, 0, 10}, {1, 0, 10}, {1, 1, 10}}
	if len(order) != len(want) {
		t.Fatalf("chunks %v, want %v", order, want)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("chunks %v, want %v", order, want)
		}
	}
	// The uniform chunk is the 12 position bytes, an 8-byte record header and 4 cube bytes.
	body, _ := ChunkBody(filled(1, 0, 10, cube{dirt, full, 0}))
	if len(body) != 24 || body[20] != EncodingUniform {
		t.Errorf("uniform chunk body %v", body)
	}
}

func TestNormalizes(t *testing.T) {
	c := filled(0, 0, 0, cube{})
	setCube(&c, 0, 0, cube{empty, slope, 3})
	setCube(&c, 1, 0, cube{stone, full, 7})
	setCube(&c, 2, 0, cube{stone, pillar, 5})
	setCube(&c, 3, 0, cube{stone, half, 7})
	setCube(&c, 4, 0, cube{wood, ladder, 7})
	setCube(&c, 5, 0, cube{stone, slope, 7})
	setCube(&c, 6, 0, cube{stone, doorway, 7})
	setCube(&c, 7, 0, cube{stone, window, 7})
	var buf bytes.Buffer
	if err := Write(&buf, &World{ChunksX: 1, ChunksZ: 1, Chunks: []Chunk{c}}); err != nil {
		t.Fatal(err)
	}
	back, err := Read(&buf)
	if err != nil {
		t.Fatal(err)
	}
	got := &back.Chunks[0]
	want := []cube{{}, {stone, full, 0}, {stone, pillar, 0}, {stone, half, 4}, {wood, ladder, 3}, {stone, slope, 7}, {stone, doorway, 7}, {stone, window, 3}}
	for x, w := range want {
		if g := cubeAt(got, x, 0); g != w {
			t.Errorf("cube %d = %+v, want %+v", x, g, w)
		}
	}
}

func TestPaint(t *testing.T) {
	// Every cube grass on top: the cubes and the paint both uniform.
	grass := filled(0, 0, 10, cube{dirt, full, 0})
	for i := range ChunkArea {
		setPaint(&grass, i%16, i/16, up, texGrass)
	}
	body, err := ChunkBody(grass)
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte(nil), body[:24]...)
	want = append(want, record(ChunkTagPaint, FlagRequired, []byte{EncodingUniform, 0, 0, 0, 0, texGrass, 0})...)
	if !bytes.Equal(body, want) {
		t.Errorf("uniform paint body %v, want %v", body, want)
	}

	// Mixed paint, normalized on writing: dirt painted dirt is not painted, an empty cube takes no
	// paint; a chunk whose paint all goes has none.
	c := filled(0, 0, 10, cube{dirt, full, 0})
	setCube(&c, 1, 0, cube{})
	setPaint(&c, 0, 0, west, texPlanks)
	setPaint(&c, 0, 0, up, texDirt)
	setPaint(&c, 1, 0, up, texGrass)
	plain := filled(1, 0, 10, cube{stone, full, 0})
	setPaint(&plain, 3, 3, down, texStone)
	var buf bytes.Buffer
	if err := Write(&buf, &World{ChunksX: 2, ChunksZ: 1, Chunks: []Chunk{c, plain}}); err != nil {
		t.Fatal(err)
	}
	back, err := Read(&buf)
	if err != nil {
		t.Fatal(err)
	}
	got := chunkOf(back, 0, 0, 10)
	if paintAt(got, 0, 0, west) != texPlanks || paintAt(got, 0, 0, up) != 0 || paintAt(got, 1, 0, up) != 0 {
		t.Errorf("paint read back %v", got.Paint[:16])
	}
	if p := chunkOf(back, 1, 0, 10).Paint; p != nil {
		t.Error("a chunk painted only with its own textures has paint")
	}
	if c.Paint[up*ChunkArea] != texDirt {
		t.Error("Write changed the caller's paint")
	}

	// A texture this editor does not know is kept, read and written back as it is (3dgame #215),
	// a wide one too, past a byte (#217).
	unknown := filled(0, 0, 10, cube{dirt, full, 0})
	setPaint(&unknown, 0, 0, up, TextureCount)
	setPaint(&unknown, 1, 0, up, 0x8000+4526)
	buf.Reset()
	if err := Write(&buf, &World{ChunksX: 1, ChunksZ: 1, Chunks: []Chunk{unknown}}); err != nil {
		t.Fatalf("unknown texture not written: %v", err)
	}
	if back, err := Read(&buf); err != nil {
		t.Errorf("unknown texture not read: %v", err)
	} else if g, h := paintAt(chunkOf(back, 0, 0, 10), 0, 0, up), paintAt(chunkOf(back, 0, 0, 10), 1, 0, up); g != TextureCount || h != 0x8000+4526 {
		t.Errorf("unknown textures read back as %d and %d, want %d and %d", g, h, TextureCount, 0x8000+4526)
	}

	// Refused: a paint of the wrong size, unknown encodings and short bodies.
	bad := filled(0, 0, 10, cube{dirt, full, 0})
	bad.Paint = make([]uint16, 10)
	if err := Write(io.Discard, &World{ChunksX: 1, ChunksZ: 1, Chunks: []Chunk{bad}}); err == nil {
		t.Error("a short paint was written")
	}
	paint := func(b ...byte) []byte { return record(ChunkTagPaint, FlagRequired, b) }
	stoneCubes := uniformCubes(stone, full, 0)
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, stoneCubes, paint(5, 0)).end(), "unknown paint encoding 5")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, stoneCubes, paint(0, 0, 0, 0, 0, 0, 0, 0)).end(), "bytes after a uniform paint")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, stoneCubes, paint(0, 1, 0, 0, 0, 0, 0), paint(0, 1, 0, 0, 0, 0, 0)).end(), "two paint records")
	var z bytes.Buffer
	z.WriteByte(EncodingZlibPlanes)
	zw := zlib.NewWriter(&z)
	_, _ = zw.Write(make([]byte, PaintLen-1))
	_ = zw.Close()
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, stoneCubes, record(ChunkTagPaint, FlagRequired, z.Bytes())).end(), "decompresses to 1535")
}

// --- hand-built files ----------------------------------------------------------------------------

type file struct{ bytes.Buffer }

func newFile(version uint32) *file {
	f := &file{}
	f.WriteString(Magic)
	binary.Write(f, binary.LittleEndian, version)
	return f
}

func record(tag, flags uint16, body []byte) []byte {
	out := make([]byte, 8, 8+len(body))
	binary.LittleEndian.PutUint16(out, tag)
	binary.LittleEndian.PutUint16(out[2:], flags)
	binary.LittleEndian.PutUint32(out[4:], uint32(len(body)))
	return append(out, body...)
}

func (f *file) rec(tag, flags uint16, body []byte) *file {
	f.Write(record(tag, flags, body))
	return f
}

func (f *file) bounds(x, z uint32) *file {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint32(b, x)
	binary.LittleEndian.PutUint32(b[4:], z)
	return f.rec(TagBounds, FlagRequired, b)
}

func chunkHead(cx, cz int32, layer uint8) []byte {
	b := make([]byte, 12)
	binary.LittleEndian.PutUint32(b, uint32(cx))
	binary.LittleEndian.PutUint32(b[4:], uint32(cz))
	b[8] = layer
	return b
}

func uniformCubes(k, s, r byte) []byte {
	return record(ChunkTagCubes, FlagRequired, []byte{EncodingUniform, k, s, r})
}

func (f *file) chunk(cx, cz int32, layer uint8, records ...[]byte) *file {
	body := chunkHead(cx, cz, layer)
	for _, r := range records {
		body = append(body, r...)
	}
	return f.rec(TagChunk, FlagRequired, body)
}

func (f *file) end() []byte {
	f.rec(TagEnd, FlagRequired, nil)
	return f.Bytes()
}

func zlibCubes(t *testing.T, planes []byte) []byte {
	t.Helper()
	var b bytes.Buffer
	b.WriteByte(EncodingZlibPlanes)
	zw := zlib.NewWriter(&b)
	zw.Write(planes)
	zw.Close()
	return record(ChunkTagCubes, FlagRequired, b.Bytes())
}

func readErr(t *testing.T, data []byte, want string) {
	t.Helper()
	_, err := Read(bytes.NewReader(data))
	if err == nil {
		t.Fatalf("read succeeded, want an error with %q", want)
	}
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("error %q, want one with %q", err, want)
	}
}

func TestUnknownOptionalRecordsAreSkipped(t *testing.T) {
	data := newFile(1).
		rec(99, 0, []byte("ignored")).
		bounds(1, 1).
		rec(77, 2, []byte{1, 2, 3}).
		chunk(0, 0, 10, record(55, 0, []byte("also ignored")), uniformCubes(stone, full, 0), record(56, 0, nil)).
		end()
	w, err := Read(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Chunks) != 1 || cubeAt(&w.Chunks[0], 0, 0) != (cube{stone, full, 0}) {
		t.Errorf("read %+v", w)
	}
}

func TestUnknownRequiredRecordsAreRefused(t *testing.T) {
	readErr(t, newFile(1).bounds(1, 1).rec(99, FlagRequired, nil).end(), "needs record 99")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, uniformCubes(stone, full, 0), record(55, FlagRequired, nil)).end(), "needs record 55")
}

func TestRefusesBadFiles(t *testing.T) {
	readErr(t, []byte("NOTWORLD\x01\x00\x00\x00"), "not a world file")
	readErr(t, []byte("3DG"), "not a world file")
	readErr(t, newFile(2).bounds(1, 1).end(), "version 2 is not supported")
	readErr(t, newFile(0).bounds(1, 1).end(), "version 0 is not supported")
	readErr(t, newFile(1).bounds(1, 1).Bytes(), "cut short")
	readErr(t, newFile(1).end(), "no bounds record")
	readErr(t, newFile(1).bounds(1, 1).bounds(1, 1).end(), "more than one bounds")
	readErr(t, newFile(1).chunk(0, 0, 10, uniformCubes(stone, full, 0)).bounds(1, 1).end(), "before the bounds")
	readErr(t, newFile(1).bounds(1, 1).chunk(1, 0, 10, uniformCubes(stone, full, 0)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).chunk(-1, 0, 10, uniformCubes(stone, full, 0)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 31, uniformCubes(stone, full, 0)).end(), "layer 31 does not exist")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, uniformCubes(stone, full, 0)).chunk(0, 0, 10, uniformCubes(dirt, full, 0)).end(), "appears twice")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10).end(), "no cubes record")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, uniformCubes(stone, full, 0), uniformCubes(stone, full, 0)).end(), "two cubes records")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, uniformCubes(8, full, 0)).end(), "unknown kind 8")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, uniformCubes(stone, 9, 0)).end(), "unknown shape 9")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, uniformCubes(stone, full, 8)).end(), "unknown rotation 8")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, record(ChunkTagCubes, FlagRequired, []byte{2})).end(), "unknown cube encoding 2")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, record(ChunkTagCubes, FlagRequired, []byte{0, 1, 0, 0, 0})).end(), "bytes after a uniform cube")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, zlibCubes(t, make([]byte, PlanesLen-1))).end(), "decompress to 767")
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, zlibCubes(t, make([]byte, PlanesLen+1))).end(), "decompress to 769")
	bad := make([]byte, PlanesLen)
	bad[ChunkArea+5] = 9
	readErr(t, newFile(1).bounds(1, 1).chunk(0, 0, 10, zlibCubes(t, bad)).end(), "unknown shape 9")
	big := make([]byte, 8)
	binary.LittleEndian.PutUint16(big, TagChunk)
	binary.LittleEndian.PutUint16(big[2:], FlagRequired)
	binary.LittleEndian.PutUint32(big[4:], maxRecordLen+1)
	readErr(t, append(newFile(1).bounds(1, 1).Bytes(), big...), "more than")
}

func spawnBody(x, z int32, layer uint8) []byte {
	b := make([]byte, 12)
	binary.LittleEndian.PutUint32(b, uint32(x))
	binary.LittleEndian.PutUint32(b[4:], uint32(z))
	b[8] = layer
	return b
}

func TestSpawn(t *testing.T) {
	w, err := Read(bytes.NewReader(newFile(1).bounds(1, 2).rec(TagSpawn, 0, spawnBody(15, 31, 9)).end()))
	if err != nil {
		t.Fatal(err)
	}
	if w.Spawn == nil || *w.Spawn != (CubePos{15, 31, 9}) {
		t.Fatalf("spawn %+v", w.Spawn)
	}
	// Written as an optional record right after the bounds.
	var buf bytes.Buffer
	if err := Write(&buf, w); err != nil {
		t.Fatal(err)
	}
	want := newFile(1).bounds(1, 2).rec(TagSpawn, 0, spawnBody(15, 31, 9)).end()
	if !bytes.Equal(buf.Bytes(), want) {
		t.Errorf("wrote % x, want % x", buf.Bytes(), want)
	}
	// A world without one has none, and writes none.
	w, err = Read(bytes.NewReader(newFile(1).bounds(1, 1).end()))
	if err != nil || w.Spawn != nil {
		t.Fatalf("read %+v, %v", w, err)
	}
	readErr(t, newFile(1).bounds(1, 1).rec(TagSpawn, 0, spawnBody(16, 0, 9)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).rec(TagSpawn, 0, spawnBody(-1, 0, 9)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).rec(TagSpawn, 0, spawnBody(0, 0, 31)).end(), "layer 31 does not exist")
	readErr(t, newFile(1).bounds(1, 1).rec(TagSpawn, 0, spawnBody(0, 0, 9)).rec(TagSpawn, 0, spawnBody(0, 0, 9)).end(), "more than one spawn")
	readErr(t, newFile(1).rec(TagSpawn, 0, spawnBody(0, 0, 9)).bounds(1, 1).end(), "before the bounds")
	readErr(t, newFile(1).bounds(1, 1).rec(TagSpawn, 0, []byte{1, 2, 3, 4}).end(), "ends before")
	if err := Write(&bytes.Buffer{}, &World{ChunksX: 1, ChunksZ: 1, Spawn: &CubePos{16, 0, 9}}); err == nil {
		t.Error("a spawn outside the world was written")
	}
}

// monstersBody is a MONSTERS record's body for spawns, names taken as given.
func monstersBody(spawns ...MonsterSpawn) []byte {
	b := u32(uint32(len(spawns)))
	for _, m := range spawns {
		b = append(b, posBytes(m.Pos)...)
		b = binary.LittleEndian.AppendUint16(b, uint16(len(m.Kind)))
		b = append(b, m.Kind...)
	}
	return b
}

func TestMonsters(t *testing.T) {
	spawns := []MonsterSpawn{{"wolf", CubePos{15, 31, 9}}, {"wolf", CubePos{15, 31, 9}}, {"é", CubePos{0, 0, 30}}, {"", CubePos{1, 2, 3}}}
	w, err := Read(bytes.NewReader(newFile(1).bounds(1, 2).rec(TagMonsters, 0, monstersBody(spawns...)).end()))
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(w.Monsters, spawns) {
		t.Fatalf("monsters %+v, want %+v", w.Monsters, spawns)
	}
	// Written as an optional record after the spawn point, before the joins, in their order; the
	// layout is docs/world-format.md's.
	w.Spawn = &CubePos{1, 1, 9}
	w.Joins = []Join{{ID: 1, Cubes: []CubePos{{0, 0, 9}, {1, 0, 9}}}}
	var buf bytes.Buffer
	if err := Write(&buf, w); err != nil {
		t.Fatal(err)
	}
	body := monstersBody(spawns...)
	if got := body[:4+12+2+4]; !bytes.Equal(got, []byte{4, 0, 0, 0, 15, 0, 0, 0, 31, 0, 0, 0, 9, 0, 0, 0, 4, 0, 'w', 'o', 'l', 'f'}) {
		t.Fatalf("monsters body starts % x", got)
	}
	want := newFile(1).bounds(1, 2).rec(TagSpawn, 0, spawnBody(1, 1, 9)).rec(TagMonsters, 0, body).rec(TagJoins, FlagRequired, joinsBody(w.Joins...)).end()
	if !bytes.Equal(buf.Bytes(), want) {
		t.Errorf("wrote % x, want % x", buf.Bytes(), want)
	}
	// A world without them has none, and writes none.
	w, err = Read(bytes.NewReader(newFile(1).bounds(1, 1).end()))
	if err != nil || w.Monsters != nil {
		t.Fatalf("read %+v, %v", w, err)
	}
	wolf := func(x int32, layer uint8) []byte { return monstersBody(MonsterSpawn{"wolf", CubePos{x, 0, layer}}) }
	readErr(t, newFile(1).bounds(1, 1).rec(TagMonsters, 0, wolf(16, 9)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).rec(TagMonsters, 0, wolf(-1, 9)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).rec(TagMonsters, 0, wolf(0, 31)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).rec(TagMonsters, 0, monstersBody(MonsterSpawn{"w\xffolf", CubePos{}})).end(), "not UTF-8")
	readErr(t, newFile(1).bounds(1, 1).rec(TagMonsters, 0, wolf(0, 9)).rec(TagMonsters, 0, wolf(0, 9)).end(), "more than one monsters")
	readErr(t, newFile(1).rec(TagMonsters, 0, wolf(0, 9)).bounds(1, 1).end(), "before the bounds")
	short := wolf(0, 9)
	readErr(t, newFile(1).bounds(1, 1).rec(TagMonsters, 0, short[:len(short)-1]).end(), "ends before")
	readErr(t, newFile(1).bounds(1, 1).rec(TagMonsters, 0, append(wolf(0, 9), 0)).end(), "bytes after")
	for _, bad := range []MonsterSpawn{{"wolf", CubePos{16, 0, 9}}, {"w\xffolf", CubePos{}}, {string(make([]byte, 0x10000)), CubePos{}}} {
		if err := Write(&bytes.Buffer{}, &World{ChunksX: 1, ChunksZ: 1, Monsters: []MonsterSpawn{bad}}); err == nil {
			t.Errorf("monster spawn point %q at %+v was written", bad.Kind, bad.Pos)
		}
	}
}

// npcsBody is an NPCS record's body for npcs, names taken as given.
func npcsBody(npcs ...Npc) []byte {
	b := u32(uint32(len(npcs)))
	for _, npc := range npcs {
		b = append(b, posBytes(npc.Pos)...)
		b = binary.LittleEndian.AppendUint16(b, uint16(len(npc.Name)))
		b = append(b, npc.Name...)
		b = append(b, u32(uint32(len(npc.Route)))...)
		for _, p := range npc.Route {
			b = append(b, posBytes(p)...)
		}
	}
	return b
}

func TestNpcs(t *testing.T) {
	npcs := []Npc{{"Hask", CubePos{15, 31, 9}, []CubePos{{3, 31, 9}, {3, 0, 8}}}, {"é", CubePos{0, 0, 30}, nil}, {"", CubePos{0, 0, 30}, nil}}
	w, err := Read(bytes.NewReader(newFile(1).bounds(1, 2).rec(TagNpcs, 0, npcsBody(npcs...)).end()))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(w.Npcs, npcs) {
		t.Fatalf("NPCs %+v, want %+v", w.Npcs, npcs)
	}
	// Written as an optional record after the monsters, before the joins, in their order; the
	// layout is docs/world-format.md's.
	w.Spawn = &CubePos{1, 1, 9}
	w.Monsters = []MonsterSpawn{{"wolf", CubePos{2, 2, 9}}}
	w.Joins = []Join{{ID: 1, Cubes: []CubePos{{0, 0, 9}, {1, 0, 9}}}}
	var buf bytes.Buffer
	if err := Write(&buf, w); err != nil {
		t.Fatal(err)
	}
	body := npcsBody(npcs...)
	if got := body[:4+12+2+4+4+12]; !bytes.Equal(got, []byte{3, 0, 0, 0, 15, 0, 0, 0, 31, 0, 0, 0, 9, 0, 0, 0, 4, 0, 'H', 'a', 's', 'k', 2, 0, 0, 0, 3, 0, 0, 0, 31, 0, 0, 0, 9, 0, 0, 0}) {
		t.Fatalf("NPCs body starts % x", got)
	}
	want := newFile(1).bounds(1, 2).rec(TagSpawn, 0, spawnBody(1, 1, 9)).rec(TagMonsters, 0, monstersBody(w.Monsters...)).rec(TagNpcs, 0, body).rec(TagJoins, FlagRequired, joinsBody(w.Joins...)).end()
	if !bytes.Equal(buf.Bytes(), want) {
		t.Errorf("wrote % x, want % x", buf.Bytes(), want)
	}
	// A world without them has none, and writes none.
	w, err = Read(bytes.NewReader(newFile(1).bounds(1, 1).end()))
	if err != nil || w.Npcs != nil {
		t.Fatalf("read %+v, %v", w, err)
	}
	hask := func(x int32, layer uint8, route ...CubePos) []byte {
		return npcsBody(Npc{"Hask", CubePos{x, 0, layer}, route})
	}
	readErr(t, newFile(1).bounds(1, 1).rec(TagNpcs, 0, hask(16, 9)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).rec(TagNpcs, 0, hask(-1, 9)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).rec(TagNpcs, 0, hask(0, 31)).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).rec(TagNpcs, 0, hask(0, 9, CubePos{1, 16, 9})).end(), "outside the world")
	readErr(t, newFile(1).bounds(1, 1).rec(TagNpcs, 0, npcsBody(Npc{"H\xffask", CubePos{}, nil})).end(), "not UTF-8")
	readErr(t, newFile(1).bounds(1, 1).rec(TagNpcs, 0, hask(0, 9)).rec(TagNpcs, 0, hask(0, 9)).end(), "more than one NPCs")
	readErr(t, newFile(1).rec(TagNpcs, 0, hask(0, 9)).bounds(1, 1).end(), "before the bounds")
	short := hask(0, 9, CubePos{1, 1, 9})
	readErr(t, newFile(1).bounds(1, 1).rec(TagNpcs, 0, short[:len(short)-1]).end(), "ends before")
	readErr(t, newFile(1).bounds(1, 1).rec(TagNpcs, 0, append(hask(0, 9), 0)).end(), "bytes after")
	for _, bad := range []Npc{{"Hask", CubePos{16, 0, 9}, nil}, {"Hask", CubePos{}, []CubePos{{0, 0, 31}}}, {"H\xffask", CubePos{}, nil}, {string(make([]byte, 0x10000)), CubePos{}, nil}} {
		if err := Write(&bytes.Buffer{}, &World{ChunksX: 1, ChunksZ: 1, Npcs: []Npc{bad}}); err == nil {
			t.Errorf("NPC %q at %+v walking %+v was written", bad.Name, bad.Pos, bad.Route)
		}
	}
}

func posBytes(p CubePos) []byte {
	return spawnBody(p.X, p.Z, p.Layer)
}

func u32(v uint32) []byte { return binary.LittleEndian.AppendUint32(nil, v) }

func joinsBody(joins ...Join) []byte {
	b := u32(uint32(len(joins)))
	for _, j := range joins {
		b = append(b, u32(j.ID)...)
		b = append(b, u32(uint32(len(j.Cubes)))...)
		for _, p := range j.Cubes {
			b = append(b, posBytes(p)...)
		}
	}
	return b
}

func objectsBody(objects ...Object) []byte {
	b := u32(uint32(len(objects)))
	for _, o := range objects {
		b = append(b, u32(o.ID)...)
		b = append(b, o.Kind, o.Face, 0, 0)
		b = append(b, posBytes(o.Pos)...)
		b = append(b, u32(uint32(len(o.Targets)))...)
		for _, t := range o.Targets {
			b = append(b, u32(t)...)
		}
	}
	return b
}

func TestJoinsAndObjects(t *testing.T) {
	joins := []Join{{ID: 1, Cubes: []CubePos{{1, 2, 8}, {1, 2, 9}}}}
	objects := []Object{
		{ID: 1, Kind: door, Face: south, Pos: CubePos{3, 4, 9}, State: 1},
		{ID: 2, Kind: lever, Face: east, Pos: CubePos{4, 4, 9}, Targets: []uint32{1}},
	}
	// Written after the bounds as three required records, the states last; the same bytes the Rust
	// writer gives for this world (crates/world/src/format.rs, objects_layout).
	data := newFile(1).bounds(1, 1).
		rec(TagJoins, FlagRequired, joinsBody(joins...)).
		rec(TagObjects, FlagRequired, objectsBody(objects...)).
		rec(TagObjectState, FlagRequired, []byte{1, 0}).
		end()
	w, err := Read(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Joins) != 1 || w.Joins[0].ID != 1 || !slices.Equal(w.Joins[0].Cubes, joins[0].Cubes) {
		t.Errorf("joins %+v", w.Joins)
	}
	if !slices.EqualFunc(w.Objects, objects, sameObject) {
		t.Errorf("objects %+v", w.Objects)
	}
	var buf bytes.Buffer
	if err := Write(&buf, w); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf.Bytes(), data) {
		t.Errorf("wrote % x, want % x", buf.Bytes(), data)
	}
	// The writer sorts groups, their cubes and objects, so the order given makes no difference.
	shuffled := &World{ChunksX: 1, ChunksZ: 1,
		Joins:   []Join{{ID: 1, Cubes: []CubePos{{1, 2, 9}, {1, 2, 8}}}},
		Objects: []Object{objects[1], objects[0]},
	}
	buf.Reset()
	if err := Write(&buf, shuffled); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf.Bytes(), data) {
		t.Errorf("wrote % x, want % x", buf.Bytes(), data)
	}
	// Without a states record every object is off.
	w, err = Read(bytes.NewReader(newFile(1).bounds(1, 1).rec(TagObjects, FlagRequired, objectsBody(objects[0])).end()))
	if err != nil || w.Objects[0].State != 0 {
		t.Fatalf("read %+v, %v", w, err)
	}
}

func TestRefusesBadJoinsAndObjects(t *testing.T) {
	at := func(x int32) CubePos { return CubePos{x, 1, 9} }
	withJoins := func(joins ...Join) []byte {
		return newFile(1).bounds(1, 1).rec(TagJoins, FlagRequired, joinsBody(joins...)).end()
	}
	withObjects := func(objects ...Object) []byte {
		return newFile(1).bounds(1, 1).rec(TagObjects, FlagRequired, objectsBody(objects...)).end()
	}
	readErr(t, withJoins(Join{1, []CubePos{at(1)}}), "two cubes or more")
	readErr(t, withJoins(Join{1, []CubePos{at(1), at(1)}}), "already in group")
	readErr(t, withJoins(Join{1, []CubePos{at(1), at(2)}}, Join{2, []CubePos{at(2), at(3)}}), "already in group 1")
	readErr(t, withJoins(Join{1, []CubePos{at(1), at(16)}}), "outside the world")
	readErr(t, withJoins(Join{1, []CubePos{at(1), {2, 1, 31}}}), "outside the world")
	readErr(t, withJoins(Join{1, []CubePos{at(1), at(2)}}, Join{1, []CubePos{at(3), at(4)}}), "two groups have the id 1")
	long := append(joinsBody(Join{1, []CubePos{at(1), at(2)}}), 0)
	readErr(t, newFile(1).bounds(1, 1).rec(TagJoins, FlagRequired, long).end(), "bytes after the joins")
	readErr(t, newFile(1).bounds(1, 1).rec(TagJoins, FlagRequired, long[:len(long)-3]).end(), "ends before")
	readErr(t, newFile(1).bounds(1, 1).rec(TagJoins, FlagRequired, joinsBody()).rec(TagJoins, FlagRequired, joinsBody()).end(), "more than one joins")
	readErr(t, newFile(1).rec(TagJoins, FlagRequired, joinsBody()).bounds(1, 1).end(), "before the bounds")

	readErr(t, withObjects(Object{ID: 1, Kind: ObjectKindCount, Pos: at(1)}), fmt.Sprintf("unknown object kind %d", ObjectKindCount))
	readErr(t, withObjects(Object{ID: 1, Face: 6, Pos: at(1)}), "unknown face 6")
	readErr(t, withObjects(Object{ID: 1, Pos: at(16)}), "outside the world")
	readErr(t, withObjects(Object{ID: 1, Kind: lever, Pos: at(1), Targets: []uint32{1}}), "acts on itself")
	readErr(t, withObjects(Object{ID: 1, Kind: lever, Pos: at(1), Targets: []uint32{2}}), "does not exist")
	readErr(t, withObjects(Object{ID: 1, Kind: lever, Pos: at(1), Targets: []uint32{2, 2}}, Object{ID: 2, Pos: at(1)}), "twice")
	readErr(t, withObjects(Object{ID: 1, Pos: at(1)}, Object{ID: 1, Pos: at(2)}), "two objects have the id 1")
	one := objectsBody(Object{ID: 1, Pos: at(1)})
	readErr(t, newFile(1).bounds(1, 1).rec(TagObjects, FlagRequired, one).rec(TagObjects, FlagRequired, one).end(), "more than one objects")
	readErr(t, newFile(1).bounds(1, 1).rec(TagObjectState, FlagRequired, []byte{1}).rec(TagObjects, FlagRequired, one).end(), "before the objects")
	readErr(t, newFile(1).bounds(1, 1).rec(TagObjects, FlagRequired, one).rec(TagObjectState, FlagRequired, []byte{1, 0}).end(), "2 object states for 1 objects")
	readErr(t, newFile(1).bounds(1, 1).rec(TagObjects, FlagRequired, one).rec(TagObjectState, FlagRequired, []byte{2}).end(), "unknown object state 2")
	readErr(t, newFile(1).bounds(1, 1).rec(TagObjects, FlagRequired, one).rec(TagObjectState, FlagRequired, []byte{1}).rec(TagObjectState, FlagRequired, []byte{1}).end(), "more than one object state")

	// The writer refuses the same.
	for name, w := range map[string]*World{
		"one cube":    {ChunksX: 1, ChunksZ: 1, Joins: []Join{{1, []CubePos{at(1)}}}},
		"two groups":  {ChunksX: 1, ChunksZ: 1, Joins: []Join{{1, []CubePos{at(1), at(2)}}, {2, []CubePos{at(2), at(3)}}}},
		"no target":   {ChunksX: 1, ChunksZ: 1, Objects: []Object{{ID: 1, Pos: at(1), Targets: []uint32{5}}}},
		"bad state":   {ChunksX: 1, ChunksZ: 1, Objects: []Object{{ID: 1, Pos: at(1), State: 2}}},
		"outside":     {ChunksX: 1, ChunksZ: 1, Objects: []Object{{ID: 1, Pos: at(-1)}}},
		"same object": {ChunksX: 1, ChunksZ: 1, Objects: []Object{{ID: 1, Pos: at(1)}, {ID: 1, Pos: at(1)}}},
	} {
		if err := Write(&bytes.Buffer{}, w); err == nil {
			t.Errorf("%s: written", name)
		}
	}
}

func TestReadStopsAtEnd(t *testing.T) {
	data := append(newFile(1).bounds(1, 1).end(), []byte("anything after")...)
	if _, err := Read(bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
}

func TestWriterRefusesWhatTheGameWouldRefuse(t *testing.T) {
	cases := map[string]*World{
		"outside":   {ChunksX: 1, ChunksZ: 1, Chunks: []Chunk{filled(1, 0, 10, cube{stone, full, 0})}},
		"layer":     {ChunksX: 1, ChunksZ: 1, Chunks: []Chunk{filled(0, 0, 31, cube{stone, full, 0})}},
		"twice":     {ChunksX: 1, ChunksZ: 1, Chunks: []Chunk{filled(0, 0, 1, cube{stone, full, 0}), filled(0, 0, 1, cube{dirt, full, 0})}},
		"kind":      {ChunksX: 1, ChunksZ: 1, Chunks: []Chunk{filled(0, 0, 1, cube{9, full, 0})}},
		"too short": {ChunksX: 1, ChunksZ: 1, Chunks: []Chunk{{Cubes: make([]byte, 10)}}},
	}
	for name, w := range cases {
		if err := Write(&bytes.Buffer{}, w); err == nil {
			t.Errorf("%s: written", name)
		}
	}
}

package wow

import (
	"encoding/binary"
	"errors"
	"math"
	"os"
	"testing"
)

// blob builds a file from its end: every add returns where the bytes went.
type blob struct{ b []byte }

func (f *blob) add(p []byte) int {
	for len(f.b)%4 != 0 {
		f.b = append(f.b, 0)
	}
	at := len(f.b)
	f.b = append(f.b, p...)
	return at
}
func (f *blob) u16(at int, v ...int) {
	for i, x := range v {
		binary.LittleEndian.PutUint16(f.b[at+i*2:], uint16(x))
	}
}
func (f *blob) u32(at int, v ...int) {
	for i, x := range v {
		binary.LittleEndian.PutUint32(f.b[at+i*4:], uint32(x))
	}
}
func (f *blob) f32(at int, v ...float32) {
	for i, x := range v {
		binary.LittleEndian.PutUint32(f.b[at+i*4:], math.Float32bits(x))
	}
}

func u16s(v ...int) []byte {
	b := make([]byte, len(v)*2)
	for i, x := range v {
		binary.LittleEndian.PutUint16(b[i*2:], uint16(x))
	}
	return b
}
func u32s(v ...int) []byte {
	b := make([]byte, len(v)*4)
	for i, x := range v {
		binary.LittleEndian.PutUint32(b[i*4:], uint32(x))
	}
	return b
}

// packQ is a quaternion component as a version-264 bone rotation stores it (unpackQ's reverse).
func packQ(v float32) int {
	if v >= 0 {
		return int(int16(v*32767 - 32768))
	}
	return int(v*32767 + 32767)
}

func quat(x, y, z, w float32) []byte { return u16s(packQ(x), packQ(y), packQ(z), packQ(w)) }

// keyList is one sequence's keys of a version-264 track: where its times and values are in the file
// their offsets index.
type keyList struct{ n, times, values int }

// track264 writes a version-264 track at at: its interpolation, its global sequence (0xFFFF for
// none) and a key list per sequence.
func (f *blob) track264(at, interp, gseq int, lists ...keyList) {
	f.u16(at, interp, gseq)
	if len(lists) == 0 {
		return
	}
	times, values := make([]int, 0, len(lists)*2), make([]int, 0, len(lists)*2)
	for _, l := range lists {
		times = append(times, l.n, l.times)
		values = append(values, l.n, l.values)
	}
	f.u32(at+4, len(lists), f.add(u32s(times...)))
	f.u32(at+12, len(lists), f.add(u32s(values...)))
}

const half = float32(0.70710678)

// model264 is a small version-264 model with its .skin and one .anim file: a triangle on one bone.
// The bone turns in Stand (keys in the model), in Walk (keys in Model0004-00.anim) and in an alias
// of Stand, and moves on a global sequence. One emitter rides it.
func model264() (m2, skin, anim []byte) {
	// The .anim file of Walk: two keys, at 100 and 400 ms.
	a := &blob{}
	a.add([]byte("pad!"))
	walkTimes := a.add(u32s(100, 400))
	walkValues := a.add(append(quat(0, 0, 0, 1), quat(0, 0, half, half)...))

	f := &blob{b: make([]byte, h264Size)}
	copy(f.b, "MD20")
	f.u32(4, m2Later)
	f.u32(h264Name, 6, f.add([]byte("Model\x00")))
	f.u32(h264GlobalLoops, 1, f.add(u32s(2000)))

	// Stand (0, in the file, 1000 ms), Walk (4, in its .anim, 500 ms), and an alias of Stand (5).
	seqs := f.add(make([]byte, 3*seq264Size))
	f.u32(h264Sequences, 3, seqs)
	for i, s := range []struct{ id, length, flags, alias int }{{0, 1000, seqInFile, 0}, {4, 500, 0, 0}, {5, 1000, seqInFile | seqAlias, 0}} {
		at := seqs + i*seq264Size
		f.u16(at, s.id, 0)
		f.u32(at+4, s.length)
		f.u32(at+12, s.flags)
		f.u16(at+0x3E, s.alias)
	}

	bone := f.add(make([]byte, 88))
	f.u32(h264Bones, 1, bone)
	f.u32(bone, 0xFFFFFFFF, 0)
	f.u16(bone+8, 0xFFFF)
	// It moves on global sequence 0: two keys, at 0 and 2000 ms.
	moveTimes := f.add(u32s(0, 2000))
	moveValues := f.add(floats(0, 0, 0, 0, 0, 1))
	f.track264(bone+16, 1, 0, keyList{2, moveTimes, moveValues})
	// It turns: Stand has keys at 0 and 500 ms; Walk's are in the .anim file; the alias has none.
	standTimes := f.add(u32s(0, 500))
	standValues := f.add(append(quat(0, 0, 0, 1), quat(0, 0, half, half)...))
	f.track264(bone+36, 1, 0xFFFF, keyList{2, standTimes, standValues}, keyList{2, walkTimes, walkValues}, keyList{})
	f.f32(bone+76, 1, 2, 3)

	verts := f.add(make([]byte, 3*48))
	f.u32(h264Vertices, 3, verts)
	for i, p := range [][3]float32{{0, 0, 0}, {1, 0, 0}, {0, 1, 0}} {
		f.f32(verts+i*48, p[0], p[1], p[2])
		f.b[verts+i*48+12] = 255 // the first bone, with all the weight
		f.f32(verts+i*48+20, 0, 0, 1)
	}
	f.u32(0x44, 1) // one view

	tex := f.add(make([]byte, 16))
	f.u32(h264Textures, 1, tex)
	f.u32(tex+8, 6, f.add([]byte("a.blp\x00")))
	f.u32(h264Materials, 1, f.add(u16s(0, 0)))
	f.u32(h264TexLookup, 1, f.add(u16s(0)))
	f.u32(h264HullVerts, 3, f.add(floats(0, 0, 0, 1, 0, 0, 0, 1, 0)))
	f.u32(h264HullTris, 3, f.add(u16s(0, 1, 2)))

	// An emitter: a constant rate and lifespan, a colour ramp of three keys with the middle at a
	// quarter of the life, an opacity ramp of two, a size ramp of three, and the head drawn.
	e := f.add(make([]byte, 476))
	f.u32(h264Emitters, 1, e)
	f.u32(e+4, 0x20000)
	f.f32(e+8, 1, 2, 3)
	f.b[e+0x28], f.b[e+0x29] = 4, 2 // additive, a sphere
	f.u16(e+0x30, 2, 4)
	one := func(v float32) keyList { return keyList{1, f.add(u32s(0)), f.add(floats(v))} }
	f.track264(e+0x98, 0, 0xFFFF, one(2), keyList{}, keyList{})  // the lifespan
	f.track264(e+0xB0, 0, 0xFFFF, one(10), keyList{}, keyList{}) // the rate
	f.u32(e+0x104, 3, f.add(u16s(0, 8192, 32767)))
	f.u32(e+0x104+8, 3, f.add(floats(255, 0, 0, 0, 255, 0, 0, 0, 255)))
	f.u32(e+0x114, 2, f.add(u16s(0, 32767)))
	f.u32(e+0x114+8, 2, f.add(u16s(32767, 0)))
	f.u32(e+0x124, 3, f.add(u16s(0, 8192, 32767)))
	f.u32(e+0x124+8, 3, f.add(floats(1, 1, 2, 2, 4, 4)))
	f.f32(e+0x15C, 0.5)  // the tail's length
	f.f32(e+0x174, 0.25) // the drag
	f.f32(e+0x180, 3)    // the spin

	// The .skin file: the triangle, one submesh of it, one batch that draws it with texture 0.
	s := &blob{b: make([]byte, 48)}
	copy(s.b, "SKIN")
	s.u32(4, 3, s.add(u16s(0, 1, 2)))
	s.u32(12, 3, s.add(u16s(0, 1, 2)))
	s.u32(20, 3, s.add(make([]byte, 12)))
	sub := s.add(make([]byte, 48))
	s.u32(28, 1, sub)
	s.u16(sub, 0, 0, 0, 3, 0, 3)
	s.u32(36, 1, s.add(make([]byte, 24)))
	s.u32(44, 1)
	return f.b, s.b, a.b
}

// files serves a model's .skin and .anim files, as a client's archives would.
func files(m map[string][]byte) func(string) ([]byte, error) {
	return func(name string) ([]byte, error) {
		if b, ok := m[name]; ok {
			return b, nil
		}
		return nil, os.ErrNotExist
	}
}

// A version-264 model comes back in the layout ParseM2Look reads, with its view from its .skin file,
// its sequences on one timeline and the keys of the loop it is read for from their .anim file (#1071).
func TestLegacyM2(t *testing.T) {
	m2, skin, anim := model264()
	const path = `World\Test\Model.m2`
	read := files(map[string][]byte{`World\Test\Model00.skin`: skin, `World\Test\Model0004-00.anim`: anim})

	// A 1.12 model is returned as it is, and needs no other file.
	old := append([]byte("MD20\x00\x01\x00\x00"), make([]byte, 64)...)
	if got, err := LegacyM2(old, path, 0, files(nil)); err != nil || &got[0] != &old[0] {
		t.Fatalf("a version 256 model was not returned as it is: %v", err)
	}
	if _, err := LegacyM2(m2, path, 0, files(nil)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("without its .skin file: %v", err)
	}
	if _, err := LegacyM2(m2[:h264Size-1], path, 0, read); err == nil {
		t.Fatal("a truncated header was taken")
	}

	out, err := LegacyM2(m2, path, 0, read)
	if err != nil {
		t.Fatal(err)
	}
	if M2Version(out) != 256 || M2Version(m2) != m2Later {
		t.Fatalf("versions %d and %d", M2Version(out), M2Version(m2))
	}
	if ids, err := M2Animations(out); err != nil || len(ids) != 3 || ids[0] != 0 || ids[1] != 4 || ids[2] != 5 {
		t.Errorf("animations %v, %v", ids, err)
	}
	if subs, err := M2Submeshes(out); err != nil || len(subs) != 1 || subs[0].Triangles != 1 {
		t.Errorf("submeshes %v, %v", subs, err)
	}
	if hull, err := m2HullFaces(out); err != nil || len(hull) != 9 {
		t.Errorf("the collision hull has %d floats, %v", len(hull), err)
	}
	if tex, _ := m2Refs(out); len(tex) != 1 || tex[0] != "a.blp" {
		t.Errorf("texture references %v", tex)
	}

	// Stand: the mesh, and the bone's turn with its last key held to the loop's end.
	mesh, err := ParseM2(out, path)
	if err != nil {
		t.Fatal(err)
	}
	if len(mesh.Pos) != 9 || len(mesh.Index) != 3 || len(mesh.Groups) != 1 || mesh.Groups[0].Texture != "a.blp" {
		t.Fatalf("%d vertex floats, %d indices, groups %+v", len(mesh.Pos), len(mesh.Index), mesh.Groups)
	}
	if mesh.Anim == nil || len(mesh.Anim.Bones) != 1 {
		t.Fatal("no moving bone")
	}
	bone := mesh.Anim.Bones[0]
	near := func(a, b float32) bool { return math.Abs(float64(a-b)) < 1e-3 }
	wantTurn := func(what string, tr *Track, loop uint32, times ...uint32) {
		t.Helper()
		if tr == nil || tr.Loop != loop || len(tr.Times) != len(times) {
			t.Fatalf("%s: %+v, want %d keys in a loop of %d", what, tr, len(times), loop)
		}
		for i, ms := range times {
			if tr.Times[i] != ms {
				t.Errorf("%s: key %d at %d ms, want %d", what, i, tr.Times[i], ms)
			}
		}
		// The first key is the identity, the last a quarter turn about the model's up axis.
		last := tr.Values[len(tr.Values)-4:]
		if !near(tr.Values[3], 1) || !near(last[3], half) || !near(last[0]*last[0]+last[1]*last[1]+last[2]*last[2], 0.5) {
			t.Errorf("%s: first key %v, last key %v", what, tr.Values[:4], last)
		}
	}
	wantTurn("Stand", bone.R, 1000, 0, 500, 1000)
	if bone.T == nil || bone.T.Loop != 2000 || len(bone.T.Times) != 2 || bone.T.Times[1] != 2000 {
		t.Errorf("the move on the global sequence: %+v", bone.T)
	}
	if x, y, z := toEditor(1, 2, 3); bone.Pivot != [3]float32{x, y, z} {
		t.Errorf("pivot %v", bone.Pivot)
	}

	// Walk, whose keys are in the .anim file: its first key held from the loop's start, its last to
	// its end.
	walk, err := LegacyM2(m2, path, 4, read)
	if err != nil {
		t.Fatal(err)
	}
	mesh, err = ParseM2Look(walk, path, &Look{Anim: 4})
	if err != nil || mesh.Anim == nil {
		t.Fatalf("Walk: %v", err)
	}
	wantTurn("Walk", mesh.Anim.Bones[0].R, 500, 0, 100, 400, 500)

	// The alias plays Stand's keys.
	mesh, err = ParseM2Look(out, path, &Look{Anim: 5})
	if err != nil || mesh.Anim == nil {
		t.Fatalf("the alias: %v", err)
	}
	wantTurn("the alias of Stand", mesh.Anim.Bones[0].R, 1000, 0, 500, 1000)

	// Without the .anim file Walk has no keys of its own: the bone holds still in it, and the model
	// still reads.
	bare, err := LegacyM2(m2, path, 4, files(map[string][]byte{`World\Test\Model00.skin`: skin}))
	if err != nil {
		t.Fatal(err)
	}
	if mesh, err = ParseM2Look(bare, path, &Look{Anim: 4}); err != nil || len(mesh.Groups) != 1 {
		t.Fatalf("Walk without its .anim file: %v", err)
	}
	if mesh.Anim != nil && mesh.Anim.Bones[0].R != nil && len(mesh.Anim.Bones[0].R.Times) > 1 {
		t.Errorf("Walk without its .anim file turns: %+v", mesh.Anim.Bones[0].R)
	}

	// The emitter, its ramps over a particle's life as 1.12's three values.
	mesh, _ = ParseM2(out, path)
	if len(mesh.Emitters) != 1 {
		t.Fatalf("%d emitters", len(mesh.Emitters))
	}
	e := mesh.Emitters[0]
	if e.Blend != 4 || e.Shape != 2 || e.Rows != 2 || e.Cols != 4 || e.HeadTail != 0 || e.Texture != "a.blp" || e.Bone != 0 {
		t.Errorf("emitter %+v", e)
	}
	if !near(e.Mid, 0.25) || e.Colors[0] != [4]float32{1, 0, 0, 1} || !near(e.Colors[1][1], 1) || !near(e.Colors[1][3], 0.75) || e.Colors[2] != [4]float32{0, 0, 1, 0} {
		t.Errorf("mid %g, colours %v", e.Mid, e.Colors)
	}
	if e.Sizes != [3]float32{1, 2, 4} || !near(e.TailTime, 0.5) || !near(e.Drag, 0.25) || !near(e.Spin, 3) {
		t.Errorf("sizes %v, tail %g, drag %g, spin %g", e.Sizes, e.TailTime, e.Drag, e.Spin)
	}
	if e.Rate == nil || e.Rate.Values[0] != 10 || e.Params[5] == nil || e.Params[5].Values[0] != 2 {
		t.Errorf("rate %+v, lifespan %+v", e.Rate, e.Params[5])
	}
}

func TestM2Paths(t *testing.T) {
	for path, want := range map[string]string{
		`Creature\Wolf\Wolf.m2`:  `Creature\Wolf\Wolf00.skin`,
		`Creature\Wolf\Wolf.MDX`: `Creature\Wolf\Wolf00.skin`,
		`World\A.b\Tree`:         `World\A.b\Tree00.skin`,
	} {
		if got := SkinPath(path); got != want {
			t.Errorf("SkinPath(%q) = %q, want %q", path, got, want)
		}
	}
	if got := animPath(`Creature\Wolf\Wolf.m2`, 4, 1); got != `Creature\Wolf\Wolf0004-01.anim` {
		t.Errorf("animPath = %q", got)
	}
}

package wow

import (
	"encoding/binary"
	"math"
	"strings"
	"testing"

	"Meld/internal/testclient"
)

// fakeM2 is an MD20 buffer with one sequence (0..1000 ms) and one emitter record, whose fields the
// test sets through put.
type fakeM2 struct{ b []byte }

func newFakeM2() *fakeM2 {
	f := &fakeM2{b: make([]byte, 0x400)}
	copy(f.b, "MD20")
	// One sequence: Stand (id 0), 0..1000 ms, at 0x200.
	f.u32(0x1C, 1)
	f.u32(0x20, 0x200)
	f.u32(0x200+4, 0)
	f.u32(0x200+8, 1000)
	// One emitter at the end of the buffer.
	f.u32(0x13C, 1)
	f.u32(0x140, len(f.b))
	f.b = append(f.b, make([]byte, emitterStride)...)
	return f
}

func (f *fakeM2) u32(o, v int)         { binary.LittleEndian.PutUint32(f.b[o:], uint32(v)) }
func (f *fakeM2) u16(o, v int)         { binary.LittleEndian.PutUint16(f.b[o:], uint16(v)) }
func (f *fakeM2) f32(o int, v float32) { binary.LittleEndian.PutUint32(f.b[o:], math.Float32bits(v)) }
func (f *fakeM2) em() int              { return int(binary.LittleEndian.Uint32(f.b[0x140:])) }

// track writes a one-key float track at the emitter's offset o, keyed in sequence 0.
func (f *fakeM2) track(o int, v float32) {
	at := len(f.b)
	f.b = append(f.b, make([]byte, 8+4+4)...)
	f.u32(at, 0)    // range 0: keys 0..0
	f.u32(at+4, 0)  //
	f.u32(at+8, 0)  // time 0
	f.f32(at+12, v) // value
	e := f.em() + o
	f.u32(e+4, 1)
	f.u32(e+8, at)
	f.u32(e+12, 1)
	f.u32(e+16, at+8)
	f.u32(e+20, 1)
	f.u32(e+24, at+12)
}

func (f *fakeM2) parse(t *testing.T) []Emitter {
	t.Helper()
	// The fake has no geometry; read the extras directly.
	_, _, em, _ := parseM2Extras(reader{f.b}, 256, nil, []string{`Particles\Smoke.blp`}, "", 1, 0, nil, nil)
	return em
}

func TestParseEmitterRecord(t *testing.T) {
	f := newFakeM2()
	e := f.em()
	f.u32(e+0x04, 0x1010) // model space, XY quad
	f.f32(e+0x08, 1)      // position (1, 2, 3) in WoW space
	f.f32(e+0x0C, 2)
	f.f32(e+0x10, 3)
	f.u16(e+0x2A, 2) // sphere
	f.b[e+0x28] = 4  // add
	f.b[e+0x2C] = 2  // head and tail
	f.u16(e+0x30, 4) // rows
	f.u16(e+0x32, 3) // cols: not a power of two, so the atlas falls back to 1x1
	f.u32(e+0x150, 0x80FF4020)
	f.f32(e+0x15C, 0.5)
	f.f32(e+0x190, 0.75) // inherit scale
	f.f32(e+0x1C4, 2.5)  // follow samples: speed, fraction, speed, fraction
	f.f32(e+0x1C8, 0.1)
	f.f32(e+0x1CC, 16.667)
	f.f32(e+0x1D0, 0.9)
	f.track(0xDC, 20) // rate
	f.track(0xC0, 2)  // lifespan
	got := f.parse(t)
	if len(got) != 1 {
		t.Fatalf("%d emitters", len(got))
	}
	g := got[0]
	if g.Shape != 2 || g.Blend != 4 || g.HeadTail != 2 || g.Flags != 0x1010 {
		t.Fatalf("fields %+v", g)
	}
	if g.Rows != 1 || g.Cols != 1 {
		t.Fatalf("atlas %dx%d, want the 1x1 fallback", g.Rows, g.Cols)
	}
	if g.Rate == nil || g.Rate.Values[0] != 20 || g.Params[5] == nil || g.Params[5].Values[0] != 2 || g.Params[0] != nil {
		t.Fatalf("tracks rate %+v lifespan %+v speed %+v", g.Rate, g.Params[5], g.Params[0])
	}
	if c := g.Colors[0]; c[0] != 1 || math.Abs(float64(c[1]-64.0/255)) > 1e-6 || math.Abs(float64(c[2]-32.0/255)) > 1e-6 || math.Abs(float64(c[3]-128.0/255)) > 1e-6 {
		t.Fatalf("colour key %v, want BGRA unpacked", c)
	}
	// The frame: spawn +X turns to WoW +Y (the 90° turn), which is editor -Z; spawn +Z is up.
	fr := g.Frame
	if fr[0] != 0 || fr[1] != 0 || fr[2] != -1 || fr[8] != 0 || fr[9] != 1 || fr[10] != 0 {
		t.Fatalf("frame axes %v", fr)
	}
	if fr[12] != 1 || fr[13] != 3 || fr[14] != -2 {
		t.Fatalf("frame origin %v, want (1, 3, -2)", fr[12:15])
	}
	if g.Bone != -1 {
		t.Fatalf("bone %d on a model without moving bones", g.Bone)
	}
	if g.Inherit != 0.75 || g.Follow != [4]float32{2.5, 0.1, 16.667, 0.9} {
		t.Fatalf("inherit %v follow %v", g.Inherit, g.Follow)
	}
}

func TestEmitterWithoutRateIsDropped(t *testing.T) {
	f := newFakeM2()
	f.track(0xC0, 2) // a lifespan, but no rate
	if got := f.parse(t); len(got) != 0 {
		t.Fatalf("%d emitters, want none", len(got))
	}
	f = newFakeM2()
	f.track(0xDC, 10)
	f.track(0xC0, 0) // never lives
	if got := f.parse(t); len(got) != 0 {
		t.Fatalf("%d emitters, want none", len(got))
	}
}

func TestEmitterPlacedByDoodad(t *testing.T) {
	m := &Mesh{Emitters: []Emitter{{Frame: emitterFrame([3]float32{0, 0, 0}), Bone: 3}}}
	// A quarter turn about WoW +Z, scale 2, at WoW (10, 0, 0).
	s := float32(math.Sqrt2 / 2)
	m.TransformWoW([3]float32{10, 0, 0}, [4]float32{0, 0, s, s}, 2)
	e := m.Emitters[0]
	if e.Bone != -1 {
		t.Fatal("a baked doodad's emitter keeps its bone")
	}
	if e.Frame[12] != 10 || e.Frame[13] != 0 || e.Frame[14] != 0 {
		t.Fatalf("origin %v", e.Frame[12:15])
	}
	// The up axis stays up, scaled.
	if math.Abs(float64(e.Frame[9]-2)) > 1e-5 {
		t.Fatalf("up axis %v", e.Frame[8:11])
	}
}

// TestClientEmitters reads emitters Benilla's particles.rs tests check: Elwynn's tall waterfall has
// one lit alpha emitter (flags 0x2), BloodSpurt.m2 four, FlameStrike_Area.m2 four spline
// emitters, and the free-standing torch two additive flames on a 4x4 flipbook. It needs WOW_DIR.
func TestClientEmitters(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	read := func(path string) []Emitter {
		m, err := c.m2Mesh(path, nil)
		if err != nil {
			t.Fatal(path, err)
		}
		return m.Emitters
	}
	fall := read(`World\Azeroth\Elwynn\PassiveDoodads\Waterfall\ElwynnTallWaterfall01.m2`)
	if len(fall) != 1 || fall[0].Flags != 0x2 || fall[0].Blend != 2 {
		t.Fatalf("waterfall emitters %+v", fall)
	}
	blood := read(`Particles\BloodSpurts\BloodSpurt.m2`)
	if len(blood) != 4 || blood[0].Rate.Values[0] != 100 {
		t.Fatalf("blood spurt: %d emitters", len(blood))
	}
	if !strings.Contains(strings.ToUpper(blood[3].Texture), "STARFLASH") || blood[3].Blend != 4 {
		t.Fatalf("blood spurt's flash: %s blend %d", blood[3].Texture, blood[3].Blend)
	}
	splines := 0
	for _, e := range read(`Spells\FlameStrike_Area.m2`) {
		if e.Shape == 3 {
			splines++
			if n := len(e.Spline) / 3; n < 16 || n%3 != 1 {
				t.Fatalf("a chain of %d points", n)
			}
		}
	}
	if splines != 4 {
		t.Fatalf("%d spline emitters, want the 4 fire columns", splines)
	}
	torch := read(`World\Generic\PassiveDoodads\Lights\FreestandingTorch01.m2`)
	if len(torch) != 2 || torch[0].Blend != 4 || torch[0].Rows != 4 || torch[0].Cols != 4 {
		t.Fatalf("torch emitters %+v", torch)
	}
}

func TestParseRibbonRecord(t *testing.T) {
	f := newFakeM2()
	// One ribbon record after the emitter's, at 0x134/0x138.
	rb := len(f.b)
	f.u32(0x134, 1)
	f.u32(0x138, rb)
	f.b = append(f.b, make([]byte, ribbonStride)...)
	f.f32(rb+0x08, 1) // position (1, 2, 3)
	f.f32(rb+0x0C, 2)
	f.f32(rb+0x10, 3)
	// textureIndices: one entry, texture 0.
	at := len(f.b)
	f.b = append(f.b, 0, 0, 0, 0)
	f.u32(rb+0x14, 1)
	f.u32(rb+0x18, at)
	f.f32(rb+0x94, 30)  // edges a second
	f.f32(rb+0x98, 0.1) // lifetime, raised to 0.25
	at = len(f.b)
	f.b = append(f.b, make([]byte, 16)...)
	f.u32(at, 0)
	f.u32(at+4, 0)
	f.u32(at+8, 0)
	f.f32(at+12, 0.5)
	for _, o := range []int{0x5C, 0x78} { // above and below: 0.5 each
		f.u32(rb+o+4, 1)
		f.u32(rb+o+8, at)
		f.u32(rb+o+12, 1)
		f.u32(rb+o+16, at+8)
		f.u32(rb+o+20, 1)
		f.u32(rb+o+24, at+12)
	}
	_, _, _, got := parseM2Extras(reader{f.b}, 256, nil, []string{`Spells\Trail.blp`}, "", 1, 0, nil, nil)
	if len(got) != 1 {
		t.Fatalf("%d ribbons", len(got))
	}
	g := got[0]
	if g.Texture != `Spells\Trail.blp` || g.Blend != 4 || g.EdgeLifetime != 0.25 || g.Rows != 1 || g.Cols != 1 {
		t.Fatalf("fields %+v", g)
	}
	if g.Above == nil || g.Above.Values[0] != 0.5 || g.Below == nil {
		t.Fatalf("heights %+v %+v", g.Above, g.Below)
	}
	// WoW +Y (the edge's axis) is editor -Z; the origin is toEditor(1, 2, 3).
	if fr := g.Frame; fr[4] != 0 || fr[5] != 0 || fr[6] != -1 || fr[12] != 1 || fr[13] != 3 || fr[14] != -2 {
		t.Fatalf("frame %v", fr)
	}
}

// TestClientRibbons reads Benilla's ribbons.rs case: Holy Smite's impact slash is two ribbons whose
// height rises to 0.167 and falls back; and the Caverns of Time energy trail lays its five ribbons from a
// moving bone. It needs WOW_DIR.
func TestClientRibbons(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	m, err := c.m2Mesh(`Spells\HolySmite_Low_Chest.m2`, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Ribbons) != 2 {
		t.Fatalf("%d smite ribbons", len(m.Ribbons))
	}
	for _, rb := range m.Ribbons {
		peak := float32(0)
		for _, v := range rb.Above.Values {
			peak = max(peak, v)
		}
		if math.Abs(float64(peak-0.167)) > 1e-3 || rb.Above.Values[0] != 0 {
			t.Fatalf("slash height %+v", rb.Above)
		}
		if rb.On != nil {
			t.Fatal("an always-on slash has a gate")
		}
	}
	trail, err := c.m2Mesh(`World\Dungeon\CavernsOfTime\PassiveDoodads\EnergyTrails\EnergyTrail01.m2`, nil)
	if err != nil {
		t.Skip("no Caverns of Time trail in this client:", err)
	}
	if len(trail.Ribbons) != 5 || trail.Ribbons[0].Bone < 0 || trail.Anim == nil {
		t.Fatalf("energy trail: %d ribbons, bone %d", len(trail.Ribbons), trail.Ribbons[0].Bone)
	}
}

// TestClientRecursionAndGeometry reads the explosive trap's child emitters and the frostwyrm
// waterfall's geometry particles from the client (WOW_DIR).
func TestClientRecursionAndGeometry(t *testing.T) {
	dir := testclient.DataDir(t)
	c := NewClient()
	if err := c.Open(dir); err != nil {
		t.Fatal(err)
	}
	// The explosive trap's recursion emitters (records 3 to 6) emit only when it fires, so its idle
	// loop drops them; resolve their recursion model directly.
	raw, err := c.readM2(`World\Goober\G_ExplosiveTrap.m2`)
	if err != nil {
		t.Fatal(err)
	}
	r := reader{raw}
	rec := m2PathAt(r, r.u32(0x140)+3*emitterStride+0x20)
	if rec != `Spells\ExplosiveTrap_Recursive.m2` {
		t.Fatalf("recursion path %q", rec)
	}
	m := &Mesh{Emitters: []Emitter{{Recursion: rec}}}
	c.recursionChildren(m)
	children := m.Emitters[0].Children
	t.Logf("%s: %d children", rec, len(children))
	if len(children) == 0 || len(children) > 4 {
		t.Fatal("no children from the recursion model")
	}
	for _, ch := range children {
		if len(ch.Children) > 0 || ch.Recursion != "" {
			t.Fatalf("a child keeps its own recursion: %+v", ch)
		}
	}
	// DarkIronNode's geometry emitter (record 5) is idle-silent too; its path must name a model.
	raw, err = c.readM2(`World\AZEROTH\BurningSteppes\ActiveDoodads\DarkIronNode\DarkIronNode.m2`)
	if err != nil {
		t.Fatal(err)
	}
	r = reader{raw}
	geo := m2PathAt(r, r.u32(0x140)+5*emitterStride+0x18)
	t.Logf("geometry %q", geo)
	if _, err := c.readM2(geo); err != nil {
		t.Fatalf("geometry model %q: %v", geo, err)
	}
}

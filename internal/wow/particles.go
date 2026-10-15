package wow

import "math"

// Emitter is one M2 particle emitter (B-182), read as the client reads a vanilla record (0x1F8 bytes,
// the array at MD20+0x13C), after Benilla's benilla-formats particles.rs (MIT/Apache), which cites the
// client's loader at 0x70ebd0. Its tracks are resolved for the same loop as the bones; the frontend
// simulates and draws the particles (world/particles.ts).
type Emitter struct {
	// Frame takes the emitter's spawn space (WoW axes, Z up, at the record's position, before the
	// client's fixed turn of 90° about +Z, which it holds) into model space in editor coordinates: a
	// column-major 4x4 matrix, as three's Matrix4.fromArray reads it.
	Frame [16]float32 `json:"frame"`
	// Bone is the animated bone the emitter rides, or -1 when the model has no moving bones.
	Bone    int    `json:"bone"`
	Flags   uint32 `json:"flags"`
	Shape   int    `json:"shape"` // 1 plane, 2 sphere, 3 spline
	Blend   int    `json:"blend"` // the M2 blend byte: 0 opaque, 1 alpha key, 2 alpha, 3/4 add, 5/6 mod
	Texture string `json:"texture"`
	Rows    int    `json:"rows"`
	Cols    int    `json:"cols"`
	// HeadTail is 0 for a camera-facing quad, 1 for a streak along the velocity, 2 for both.
	HeadTail int `json:"headTail"`
	// Rate is the spawn rate (+0xDC) and On the enabled gate (+0x1DC, nil: always on).
	Rate *Track `json:"rate"`
	On   *Track `json:"on,omitempty"`
	// Params are the other nine tracks (nil holds the default): speed, speed variation, vertical
	// range, horizontal range, gravity, lifespan, area length, area width and z source.
	Params   [9]*Track  `json:"params"`
	Drag     float32    `json:"drag"`
	TailTime float32    `json:"tailTime"`
	Spin     float32    `json:"spin"`
	Twinkle  [4]float32 `json:"twinkle"` // speed, percent, min, max
	// The over-life ramps: the mid point, three RGBA colour keys (alpha the opacity), three sizes,
	// the head's and the tail's flipbook cells per segment (begin, end, begin, end) and the repeats.
	Mid       float32       `json:"mid"`
	Colors    [3][4]float32 `json:"colors"`
	Sizes     [3]float32    `json:"sizes"`
	HeadCells [4]int        `json:"headCells"`
	TailCells [4]int        `json:"tailCells"`
	Repeat    [2]float32    `json:"repeat"`
	// Spline holds a spline emitter's control points (3K+1, x y z flat, spawn space).
	Spline []float32 `json:"spline,omitempty"`
}

const (
	emitterStride = 0x1F8
	maxEmitters   = 32
)

// seqWindow is the loop an emitter's tracks are baked for: the sequence's index (-1 for none) and its
// band on the model's timeline, and the global sequences' lengths.
type seqWindow struct {
	idx        int
	start, end uint32
	global     func(int) uint32
}

// bakeTrack resolves the track at o for the loop: its values are width bytes and n components each,
// which val reads into out. It samples as the client's key-window kernel does (0x713d50), after
// Benilla's key_anim.rs bake_track: a track whose keys are all equal is that constant; a global
// sequence's keys loop on their own; else the sequence's key range (the whole list without ranges) is
// sampled at the band's two edges and keeps its keys inside the band. Nil for a track without keys.
func bakeTrack(r reader, o, width, n int, val func(at int, out []float32), w seqWindow) *Track {
	if o+trackSize > len(r.b) {
		return nil
	}
	step := r.u16(o) == 0
	gseq := r.u16(o + 2)
	nRanges, ofsRanges, err1 := r.arr(o+4, 8)
	nTimes, ofsTimes, err2 := r.arr(o+12, 4)
	nVals, ofsVals, err3 := r.arr(o+20, width)
	if err1 != nil || err2 != nil || err3 != nil || nTimes == 0 || nVals == 0 {
		return nil
	}
	keys := min(nTimes, nVals)
	times := make([]uint32, keys)
	vals := make([]float32, keys*n)
	same := true
	for i := range times {
		times[i] = uint32(r.u32(ofsTimes + i*4))
		val(ofsVals+i*width, vals[i*n:(i+1)*n])
		for c := 0; c < n; c++ {
			same = same && vals[i*n+c] == vals[c]
		}
	}
	key := func(k int) []float32 { return vals[k*n : (k+1)*n] }
	constant := func(v []float32) *Track { return &Track{Times: []uint32{0}, Values: v, Step: step} }
	if same {
		return constant(key(0))
	}
	if gseq != 0xFFFF {
		loop := w.global(gseq)
		if loop == 0 {
			loop = max(times[keys-1], 1)
		}
		return &Track{Times: times, Values: vals, Loop: loop, Step: step}
	}
	lo, hi := 0, keys-1
	if w.idx >= 0 && w.idx < nRanges {
		lo, hi = r.u32(ofsRanges+w.idx*8), r.u32(ofsRanges+w.idx*8+4)
	}
	start, end := w.start, w.end
	if w.idx < 0 {
		start, end = 0, times[keys-1]
	}
	// The key at or before t within [lo, hi], held for a stepped track, else lerped toward the next.
	at := func(t uint32) []float32 {
		lo, hi := min(lo, keys-1), min(hi, keys-1)
		if lo >= hi {
			return key(lo)
		}
		k := lo
		for i := lo; i <= hi && times[i] <= t; i++ {
			k = i
		}
		if step || k+1 >= keys || times[k+1] <= times[k] {
			return key(k)
		}
		f := min(max((float32(t)-float32(times[k]))/float32(times[k+1]-times[k]), 0), 1)
		out := make([]float32, n)
		for c := range out {
			out[c] = vals[k*n+c] + (vals[(k+1)*n+c]-vals[k*n+c])*f
		}
		return out
	}
	equal := func(a, b []float32) bool {
		for c := range a {
			if a[c] != b[c] {
				return false
			}
		}
		return true
	}
	head := at(start)
	if end <= start {
		return constant(head)
	}
	tr := &Track{Times: []uint32{0}, Values: append([]float32(nil), head...), Loop: end - start, Step: step}
	moves := false
	for k := lo; k <= hi && k < keys; k++ {
		if times[k] > start && times[k] < end {
			tr.Times = append(tr.Times, times[k]-start)
			tr.Values = append(tr.Values, key(k)...)
			moves = moves || !equal(key(k), head)
		}
	}
	tail := at(end)
	tr.Times = append(tr.Times, end-start)
	tr.Values = append(tr.Values, tail...)
	if !moves && equal(tail, head) {
		return constant(head)
	}
	return tr
}

// scalarTrack bakes a track of float32 values.
func scalarTrack(r reader, o int, w seqWindow) *Track {
	return bakeTrack(r, o, 4, 1, func(at int, out []float32) { out[0] = r.f32(at) }, w)
}

// emitterFrame is the frame of an emitter at pos (WoW model space): the turn of 90° about +Z the client
// gives every emitter (0x719114), then the move to pos, in editor coordinates.
func emitterFrame(pos [3]float32) [16]float32 {
	x, y, z := toEditor(pos[0], pos[1], pos[2])
	// toEditor(R90(v)) = (-v.y, v.z, -v.x) for spawn-space v.
	return [16]float32{0, 0, -1, 0, -1, 0, 0, 0, 0, 1, 0, 0, x, y, z, 1}
}

// gateTrack bakes a track of on/off bytes, as 0 or 1; nil when it is on throughout the loop.
func gateTrack(r reader, o int, w seqWindow) *Track {
	t := bakeTrack(r, o, 1, 1, func(at int, out []float32) { out[0] = float32(min(r.u8(at), 1)) }, w)
	if t != nil && allOnes(t.Values) {
		return nil
	}
	return t
}

// parseEmitters reads a vanilla M2's particle emitters, their tracks baked for the loop w; bones says
// whether the model has moving bones, which an emitter can ride.
func parseEmitters(r reader, textures []string, bones bool, w seqWindow) []Emitter {
	n, ofs := r.u32(0x13C), r.u32(0x140)
	if n <= 0 || n > 256 || ofs < 0 || ofs+n*emitterStride > len(r.b) {
		return nil
	}
	f := func(o int) *Track { return scalarTrack(r, o, w) }
	peak := func(t *Track) float32 {
		m := float32(math.Inf(-1))
		if t != nil {
			for _, v := range t.Values {
				m = max(m, v)
			}
		}
		return m
	}
	color := func(o int) [4]float32 {
		v := uint32(r.u32(o))
		return [4]float32{float32(v>>16&0xFF) / 255, float32(v>>8&0xFF) / 255, float32(v&0xFF) / 255, float32(v>>24) / 255}
	}
	var out []Emitter
	for i := 0; i < n && len(out) < maxEmitters; i++ {
		e := ofs + i*emitterStride
		// A geometry model's particles are small models, not quads: not drawn yet.
		if r.u32(e+0x18) > 1 {
			continue
		}
		tex := ""
		if ti := r.u16(e + 0x16); ti < len(textures) {
			tex = textures[ti]
		}
		if tex == "" {
			continue
		}
		em := Emitter{
			Flags:    uint32(r.u32(e + 0x04)),
			Bone:     -1,
			Shape:    r.u16(e + 0x2A),
			Blend:    r.u8(e + 0x28),
			Texture:  tex,
			Rows:     r.u16(e + 0x30),
			Cols:     r.u16(e + 0x32),
			HeadTail: r.u8(e + 0x2C),
			Rate:     f(e + 0xDC),
			On:       gateTrack(r, e+0x1DC, w),
			Drag:     r.f32(e + 0x194),
			TailTime: r.f32(e + 0x17C),
			Spin:     r.f32(e + 0x198),
			Twinkle:  [4]float32{r.f32(e + 0x180), r.f32(e + 0x184), r.f32(e + 0x188), r.f32(e + 0x18C)},
			Mid:      r.f32(e + 0x14C),
			Colors:   [3][4]float32{color(e + 0x150), color(e + 0x154), color(e + 0x158)},
			Sizes:    [3]float32{r.f32(e + 0x15C), r.f32(e + 0x160), r.f32(e + 0x164)},
			// Ten u16s at +0x168: a head pair and its repeat per segment, then the tail's two pairs.
			HeadCells: [4]int{r.u16(e + 0x168), r.u16(e + 0x16A), r.u16(e + 0x16E), r.u16(e + 0x170)},
			TailCells: [4]int{r.u16(e + 0x174), r.u16(e + 0x176), r.u16(e + 0x178), r.u16(e + 0x17A)},
			Repeat:    [2]float32{float32(r.u16(e + 0x16C)), float32(r.u16(e + 0x172))},
		}
		// The atlas: both counts powers of two, else the client keeps its 1x1 (0x7b4ed0).
		if !pow2(em.Rows) || !pow2(em.Cols) {
			em.Rows, em.Cols = 1, 1
		}
		for k, o := range []int{0x34, 0x50, 0x6C, 0x88, 0xA4, 0xC0, 0xF8, 0x114, 0x130} {
			em.Params[k] = f(e + o)
		}
		// An emitter that never spawns or whose particles never live is dropped, as Benilla does.
		if peak(em.Rate) <= 0 || (em.Params[5] != nil && peak(em.Params[5]) <= 0) || (em.On != nil && peak(em.On) <= 0) {
			continue
		}
		if !finite(em.Drag, em.TailTime, em.Spin, em.Mid, em.Sizes[0], em.Sizes[1], em.Sizes[2]) {
			continue
		}
		pos := [3]float32{r.f32(e + 0x08), r.f32(e + 0x0C), r.f32(e + 0x10)}
		if !finite(pos[0], pos[1], pos[2]) {
			continue
		}
		em.Frame = emitterFrame(pos)
		if bones {
			em.Bone = r.u16(e + 0x14)
		}
		if em.Shape == 3 {
			q, po := r.u32(e+0x1D4), r.u32(e+0x1D8)
			if np := 3*(q/3) + 1; q >= 3 && po >= 0 && po+np*12 <= len(r.b) {
				for p := 0; p < np*3; p++ {
					em.Spline = append(em.Spline, r.f32(po+p*4))
				}
			}
		}
		out = append(out, em)
	}
	return out
}

func pow2(v int) bool { return v > 0 && v&(v-1) == 0 }

// place moves the emitter's frame by a doodad placement (placeFrame). The doodad's bones are gone in
// the baked mesh, so it rides none.
func (e *Emitter) place(rot func(x, y, z float32) (float32, float32, float32), scale float32, p [3]float32) {
	placeFrame(&e.Frame, rot, scale, p)
	e.Bone = -1
}

// placeFrame moves a frame by a doodad placement in editor space: rot (a rotation of a vector), then
// scale, then the move to p.
func placeFrame(f *[16]float32, rot func(x, y, z float32) (float32, float32, float32), scale float32, p [3]float32) {
	for c := 0; c < 4; c++ {
		x, y, z := rot(f[c*4]*scale, f[c*4+1]*scale, f[c*4+2]*scale)
		if c == 3 {
			x, y, z = x+p[0], y+p[1], z+p[2]
		}
		f[c*4], f[c*4+1], f[c*4+2] = x, y, z
	}
}

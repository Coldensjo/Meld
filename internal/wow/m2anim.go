package wow

import (
	"math"
	"strings"
)

// Track is one animated channel resolved for a single looping clip:
// key times in ms relative to the clip start, and flattened values.
type Track struct {
	Times  []uint32  `json:"t"`
	Values []float32 `json:"v"`
	Loop   uint32    `json:"loop"` // clip length (sequence or global sequence)
	Step   bool      `json:"step,omitempty"`
}

// Bone is an animated bone in editor space.
type Bone struct {
	Parent int        `json:"parent"`
	Pivot  [3]float32 `json:"pivot"`
	T      *Track     `json:"tr,omitempty"` // xyz
	R      *Track     `json:"rot,omitempty"`
	S      *Track     `json:"sc,omitempty"` // xyz
}

// Anim holds what the frontend needs to play a model's idle ("Stand") loop.
type Anim struct {
	Bones   []Bone `json:"bones"`
	BoneIdx []byte `json:"-"` // 4 per vertex
	BoneW   []byte `json:"-"` // 4 per vertex
}

// Effect is a light source or flame attached to a model, in model space.
type Effect struct {
	Kind      string     `json:"kind"` // "fire" (flame + light) or "light"
	Pos       [3]float32 `json:"pos"`
	Color     [3]float32 `json:"color"`
	Intensity float32    `json:"intensity"`
	Radius    float32    `json:"radius"`
	Size      float32    `json:"size,omitempty"`
	// Interior marks a light inside a WMO's interior group. The game bakes those into the
	// group's vertex colours, and without shadows a dynamic light would shine out through the walls.
	Interior bool `json:"interior,omitempty"`
}

const (
	trackSize = 28
	seqSize   = 68
)

var fireWords = []string{"fire", "flame", "torch", "candle", "brazier", "ember", "lava", "campfire", "sconce", "lantern", "lamp"}

func hasAny(s string, words []string) bool {
	l := strings.ToLower(s)
	for _, w := range words {
		if strings.Contains(l, w) {
			return true
		}
	}
	return false
}

// parseM2Extras reads bones/animation, lights, particle emitters (as flame anchors among the
// effects, and as emitters for the frontend to simulate) and ribbons. The loop played is the
// first sequence of AnimationData ID animID, else Stand, else the model's first sequence.
// vertMap maps output vertices to source vertex indices (the view's list). refs names each group's
// texture transform, colour and transparency (-1 for none), whose animations for the same loop are
// set on the group.
func parseM2Extras(r reader, version int, vertMap []int, textures []string, modelPath string, bboxSize float32, animID int, groups []Group, refs []batchRefs) (*Anim, []Effect, []Emitter, []Ribbon) {
	nGlobal, ofsGlobal, _ := r.arr(0x14, 4)
	globalLoop := func(i int) uint32 {
		if i < 0 || i >= nGlobal {
			return 0
		}
		return uint32(r.u32(ofsGlobal + i*4))
	}

	// The asked-for sequence, else "Stand" (id 0), else the first one.
	nSeq, ofsSeq, err := r.arr(0x1C, seqSize)
	seqIdx, seqStart, seqEnd := -1, uint32(0), uint32(0)
	if err == nil {
		for _, want := range []int{animID, 0} {
			for i := 0; i < nSeq && seqIdx < 0; i++ {
				if r.u16(ofsSeq+i*seqSize) == want {
					seqIdx = i
				}
			}
		}
		if seqIdx < 0 && nSeq > 0 {
			seqIdx = 0
		}
		if seqIdx >= 0 {
			seqStart = uint32(r.u32(ofsSeq + seqIdx*seqSize + 4))
			seqEnd = uint32(r.u32(ofsSeq + seqIdx*seqSize + 8))
		}
	}

	// readTrack resolves keys for our clip. kind: 3 = vec3, 4 = quaternion.
	readTrack := func(o int, kind int, conv func([]float32) []float32) *Track {
		if o+trackSize > len(r.b) {
			return nil
		}
		interp := r.u16(o)
		gseq := int(int16(r.u16(o + 2)))
		nRanges, ofsRanges, err1 := r.arr(o+4, 8)
		nTimes, ofsTimes, err2 := r.arr(o+12, 4)
		nVals := r.u32(o + 20)
		ofsVals := r.u32(o + 24)
		if err1 != nil || err2 != nil || nTimes == 0 || nVals != nTimes {
			return nil
		}
		// Value width: vec3 = 12 bytes; quaternions are float (16) in vanilla,
		// packed int16 (8) in later versions. Detect by normalisation. Kind 1 is a fixed-point
		// scalar (int16 over 32767): an alpha or a transparency weight.
		width := 12
		packed := false
		if kind == 1 {
			width = 2
		}
		if kind == 4 {
			width = 16
			if ofsVals+nVals*16 > len(r.b) || !unitQuat(r.f32(ofsVals), r.f32(ofsVals+4), r.f32(ofsVals+8), r.f32(ofsVals+12)) {
				width, packed = 8, true
			}
		}
		if ofsVals < 0 || ofsVals+nVals*width > len(r.b) {
			return nil
		}
		lo, hi := 0, nTimes-1
		var base, loop uint32
		if gseq >= 0 {
			loop = globalLoop(gseq)
		} else {
			base, loop = seqStart, seqEnd-seqStart
			if seqIdx >= 0 && seqIdx < nRanges {
				lo = r.u32(ofsRanges + seqIdx*8)
				hi = r.u32(ofsRanges + seqIdx*8 + 4)
			} else {
				// No ranges: take keys inside the sequence's time window.
				lo, hi = -1, -1
				for i := 0; i < nTimes; i++ {
					t := uint32(r.u32(ofsTimes + i*4))
					if t >= seqStart && t <= seqEnd {
						if lo < 0 {
							lo = i
						}
						hi = i
					}
				}
			}
		}
		if lo < 0 || hi < lo || hi >= nTimes {
			return nil
		}
		tr := &Track{Loop: loop, Step: interp == 0}
		for i := lo; i <= hi; i++ {
			t := uint32(r.u32(ofsTimes + i*4))
			if t < base {
				t = base
			}
			tr.Times = append(tr.Times, t-base)
			vo := ofsVals + i*width
			var v []float32
			switch {
			case kind == 1:
				v = []float32{float32(int16(r.u16(vo))) / 32767}
			case kind == 3:
				v = []float32{r.f32(vo), r.f32(vo + 4), r.f32(vo + 8)}
			case packed:
				v = []float32{unpackQ(r.u16(vo)), unpackQ(r.u16(vo + 2)), unpackQ(r.u16(vo + 4)), unpackQ(r.u16(vo + 6))}
			default:
				v = []float32{r.f32(vo), r.f32(vo + 4), r.f32(vo + 8), r.f32(vo + 12)}
			}
			tr.Values = append(tr.Values, conv(v)...)
		}
		return tr
	}
	vecConv := func(v []float32) []float32 { x, y, z := toEditor(v[0], v[1], v[2]); return []float32{x, y, z} }
	scaleConv := func(v []float32) []float32 { return []float32{v[0], v[2], v[1]} }
	quatConv := func(v []float32) []float32 { x, y, z := toEditor(v[0], v[1], v[2]); return []float32{x, y, z, v[3]} }

	// ---- bones (stride 108 in vanilla, 112 from TBC) ----
	var anim *Anim
	nBones := r.u32(0x34)
	ofsBones := r.u32(0x38)
	stride := 108
	if version >= 260 {
		stride = 112
	}
	if nBones > 0 && nBones < 512 && ofsBones+nBones*stride <= len(r.b) {
		trackBase := 12
		if stride == 112 {
			trackBase = 16
		}
		bones := make([]Bone, nBones)
		animated := false
		for i := range bones {
			o := ofsBones + i*stride
			parent := int(int16(r.u16(o + 8)))
			if parent >= nBones {
				parent = -1
			}
			po := o + trackBase + 3*trackSize
			px, py, pz := toEditor(r.f32(po), r.f32(po+4), r.f32(po+8))
			b := Bone{Parent: parent, Pivot: [3]float32{px, py, pz}}
			b.T = readTrack(o+trackBase, 3, vecConv)
			b.R = readTrack(o+trackBase+trackSize, 4, quatConv)
			b.S = readTrack(o+trackBase+2*trackSize, 3, scaleConv)
			for k, t := range []*Track{b.T, b.R, b.S} {
				stride := 3
				if k == 1 {
					stride = 4
				}
				if t != nil && len(t.Times) > 1 && varies(t.Values, stride) {
					animated = true
				}
			}
			bones[i] = b
		}
		if animated {
			nVerts, ofsVerts, _ := r.arr(0x44, 48)
			anim = &Anim{Bones: bones, BoneIdx: make([]byte, len(vertMap)*4), BoneW: make([]byte, len(vertMap)*4)}
			for i, vi := range vertMap {
				if vi >= nVerts {
					continue
				}
				o := ofsVerts + vi*48
				for k := 0; k < 4; k++ {
					anim.BoneW[i*4+k] = r.b[o+12+k]
					idx := r.b[o+16+k]
					if int(idx) >= nBones {
						idx = 0
					}
					anim.BoneIdx[i*4+k] = idx
				}
			}
		}
	}

	// ---- texture transforms (three tracks each: translation, rotation, scaling) ----
	if nUV, ofsUV, err := r.arr(0x74, 3*trackSize); err == nil && nUV > 0 {
		raw := func(v []float32) []float32 { return v }
		// A channel that only ever holds its identity is dropped, as the client's bake does.
		keep := func(t *Track, id ...float32) *Track {
			if t == nil {
				return nil
			}
			for i, v := range t.Values {
				if d := v - id[i%len(id)]; d > 1e-6 || d < -1e-6 {
					return t
				}
			}
			return nil
		}
		baked := map[int]*UVAnim{}
		for gi, ref := range refs {
			ti := ref.uv
			if ti < 0 || ti >= nUV || gi >= len(groups) {
				continue
			}
			a, ok := baked[ti]
			if !ok {
				o := ofsUV + ti*3*trackSize
				a = &UVAnim{
					T: keep(readTrack(o, 3, raw), 0, 0, 0),
					R: keep(readTrack(o+trackSize, 4, raw), 0, 0, 0, 1),
					S: keep(readTrack(o+2*trackSize, 3, raw), 1, 1, 1),
				}
				if a.T == nil && a.R == nil && a.S == nil {
					a = nil
				}
				baked[ti] = a
			}
			groups[gi].UV = a
		}
	}

	// ---- colours and transparency (after Benilla's mat_anim.rs and m2_batches.rs) ----
	nColors, ofsColors, _ := r.arr(0x54, 2*trackSize)
	nWeights, ofsWeights, _ := r.arr(0x64, trackSize)
	// A scalar for the clip: nil when it only ever holds 1 there.
	scalar := func(o int) *Track {
		t := readTrack(o, 1, func(v []float32) []float32 { return v })
		if t == nil {
			return nil
		}
		for _, v := range t.Values {
			if v != 1 {
				return t
			}
		}
		return nil
	}
	for gi, ref := range refs {
		if gi >= len(groups) {
			break
		}
		c := &ColorAnim{}
		if ref.color >= 0 && ref.color < nColors {
			o := ofsColors + ref.color*2*trackSize
			// Modulating blends drop the colour's RGB (0x70c507), so their tint stays white.
			if b := groups[gi].Blend; b != BlendMod && b != BlendMod2x {
				if t := readTrack(o, 3, func(v []float32) []float32 { return v }); t != nil && !allOnes(t.Values) {
					c.RGB = t
				}
			}
			c.Alpha = scalar(o + trackSize)
		}
		if ref.weight >= 0 && ref.weight < nWeights {
			c.Weight = scalar(ofsWeights + ref.weight*trackSize)
		}
		if c.RGB != nil || c.Alpha != nil || c.Weight != nil {
			groups[gi].Color = c
		}
	}

	// ---- lights (212 bytes each) ----
	var effects []Effect
	firstVec := func(o int) ([3]float32, bool) {
		n, ofs := r.u32(o+20), r.u32(o+24)
		if n == 0 || ofs+12 > len(r.b) {
			return [3]float32{}, false
		}
		return [3]float32{r.f32(ofs), r.f32(ofs + 4), r.f32(ofs + 8)}, true
	}
	firstF := func(o int, def float32) float32 {
		n, ofs := r.u32(o+20), r.u32(o+24)
		if n == 0 || ofs+4 > len(r.b) {
			return def
		}
		return r.f32(ofs)
	}
	if nLights, ofsLights, err := r.arr(0x11C, 212); err == nil {
		for i := 0; i < nLights && i < 8; i++ {
			o := ofsLights + i*212
			x, y, z := toEditor(r.f32(o+4), r.f32(o+8), r.f32(o+12))
			col, ok := firstVec(o + 16 + 2*trackSize)
			if !ok {
				col = [3]float32{1, 0.7, 0.4}
			}
			intensity := firstF(o+16+3*trackSize, 1)
			radius := firstF(o+16+5*trackSize, 8)
			if radius <= 0 || radius > 80 || math.IsNaN(float64(radius)) {
				radius = 8
			}
			// WoW's attenuation radii are small; scale up so the light reads on the terrain.
			effects = append(effects, Effect{Kind: "light", Pos: [3]float32{x, y, z}, Color: col, Intensity: clampF(intensity, 0.2, 3), Radius: clampF(radius*3, 8, 30)})
		}
	}

	// ---- particle emitters: position @8, bone @20, texture @22 ----
	if nPart := r.u32(0x13C); nPart > 0 && nPart < 64 {
		ofsPart := r.u32(0x140)
		pStride := 0
		for _, cand := range []int{504, 476, 492, 888} { // 504 = vanilla M2Particle
			if ofsPart+nPart*cand > len(r.b) {
				continue
			}
			ok := true
			for i := 0; i < nPart && ok; i++ {
				o := ofsPart + i*cand
				if r.u16(o+20) >= max(nBones, 1) || r.u16(o+22) >= max(len(textures), 1) || !sanePos(r.f32(o+8), r.f32(o+12), r.f32(o+16)) {
					ok = false
				}
			}
			if ok {
				pStride = cand
				break
			}
		}
		if pStride > 0 {
			size := clampF(bboxSize*0.22, 0.25, 2.5)
			// Flame colour: the model's own light if it has one, else by name, else orange.
			flame := [3]float32{1, 0.55, 0.22}
			switch {
			case len(effects) > 0:
				flame = effects[0].Color
			case hasAny(modelPath, []string{"blue"}):
				flame = [3]float32{0.25, 0.6, 1}
			case hasAny(modelPath, []string{"green", "fel"}):
				flame = [3]float32{0.35, 1, 0.3}
			case hasAny(modelPath, []string{"purple", "shadow"}):
				flame = [3]float32{0.7, 0.3, 1}
			}
			for i := 0; i < nPart && i < 8; i++ {
				o := ofsPart + i*pStride
				tex := ""
				if ti := r.u16(o + 22); ti < len(textures) {
					tex = textures[ti]
				}
				if !hasAny(tex, fireWords) && !(tex == "" && hasAny(modelPath, fireWords)) && !hasAny(modelPath, []string{"torch", "brazier", "campfire", "candle"}) {
					continue
				}
				x, y, z := toEditor(r.f32(o+8), r.f32(o+12), r.f32(o+16))
				effects = append(effects, Effect{Kind: "fire", Pos: [3]float32{x, y, z}, Color: flame, Intensity: 1.2, Radius: clampF(size*14, 8, 26), Size: size})
			}
		}
	}
	var emitters []Emitter
	var ribbons []Ribbon
	if version < 260 {
		loops := seqWindow{idx: seqIdx, start: seqStart, end: seqEnd, global: globalLoop}
		emitters = parseEmitters(r, textures, anim != nil, loops)
		ribbons = parseRibbons(r, textures, anim != nil, loops)
	}
	return anim, effects, emitters, ribbons
}

// batchRefs is what a batch's animations come from: its texture transform, colour and transparency
// weight, by index into the model's tables (-1 for none).
type batchRefs struct{ uv, color, weight int }

// constFixed16 is the fixed-point scalar track at o's value when every key of it (in every sequence)
// holds the same one, or 1 for a track without keys; ok is false for a track that changes.
func constFixed16(r reader, o int) (float32, bool) {
	if o+trackSize > len(r.b) {
		return 1, true
	}
	n, ofs := r.u32(o+20), r.u32(o+24)
	if n == 0 {
		return 1, true
	}
	if ofs < 0 || ofs+n*2 > len(r.b) {
		return 1, false
	}
	v := r.u16(ofs)
	for i := 1; i < n; i++ {
		if r.u16(ofs+i*2) != v {
			return 1, false
		}
	}
	return float32(int16(v)) / 32767, true
}

// allOnes reports whether every value is 1 (a white tint).
func allOnes(v []float32) bool {
	for _, x := range v {
		if x != 1 {
			return false
		}
	}
	return true
}

// sanePos rejects garbage positions (denormals, huge values) from a wrong stride.
func sanePos(v ...float32) bool {
	for _, f := range v {
		a := math.Abs(float64(f))
		if math.IsNaN(a) || (a != 0 && (a < 1e-6 || a > 500)) {
			return false
		}
	}
	return true
}

func unpackQ(v int) float32 {
	s := int16(v)
	if s < 0 {
		return float32(int32(s)+32768) / 32767
	}
	return float32(int32(s)-32767) / 32767
}

func unitQuat(x, y, z, w float32) bool {
	l := x*x + y*y + z*z + w*w
	return l > 0.9 && l < 1.1
}

func finite(v ...float32) bool {
	for _, f := range v {
		if math.IsNaN(float64(f)) || math.IsInf(float64(f), 0) || math.Abs(float64(f)) > 1e4 {
			return false
		}
	}
	return true
}

// varies reports whether any key differs from the first (stride = components per key).
func varies(v []float32, stride int) bool {
	for i := stride; i+stride <= len(v); i += stride {
		for k := 0; k < stride; k++ {
			if math.Abs(float64(v[i+k]-v[k])) > 1e-4 {
				return true
			}
		}
	}
	return false
}

func clampF(v, lo, hi float32) float32 {
	if v < lo || math.IsNaN(float64(v)) {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

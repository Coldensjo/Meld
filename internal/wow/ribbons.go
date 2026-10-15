package wow

// Ribbon is one M2 ribbon emitter (B-183): a trail of edges laid behind a point as its bone moves (a
// weapon's swing, a wisp's streamer), read as the client reads a vanilla record (0xDC bytes, the array at
// MD20+0x134), after Benilla's benilla-formats ribbons.rs (MIT/Apache), which cites the client's loader.
// Its tracks are baked for the same loop as the bones; the frontend lays and draws the trail
// (world/ribbons.ts).
type Ribbon struct {
	// Frame takes the ribbon's own space (WoW axes at the record's position) into model space in
	// editor coordinates: a column-major 4x4. An edge spans the frame's +Y (WoW) axis.
	Frame   [16]float32 `json:"frame"`
	Bone    int         `json:"bone"`    // the animated bone it rides, or -1
	Texture string      `json:"texture"` // the first of its textures
	Blend   int         `json:"blend"`   // its first material's M2 blend
	// Color (RGB) and Alpha tint it; Above and Below are the edge's half-widths over and under the
	// path; On is the visibility gate (nil: always on).
	Color *Track `json:"color,omitempty"`
	Alpha *Track `json:"alpha,omitempty"`
	Above *Track `json:"above,omitempty"`
	Below *Track `json:"below,omitempty"`
	On    *Track `json:"on,omitempty"`
	// EdgesPerSecond are laid while it shows; each lives EdgeLifetime seconds (0.25 at least) and
	// rises by Gravity (g·t² over its life, as Benilla integrates it).
	EdgesPerSecond float32 `json:"edgesPerSecond"`
	EdgeLifetime   float32 `json:"edgeLifetime"`
	Gravity        float32 `json:"gravity"`
	// The atlas, and the cell of it drawn (texSlot's first value).
	Rows int `json:"rows"`
	Cols int `json:"cols"`
	Slot int `json:"slot"`
}

const (
	ribbonStride = 0xDC
	maxRibbons   = 32
)

// ribbonFrame is the frame of a ribbon at pos (WoW model space), in editor coordinates.
func ribbonFrame(pos [3]float32) [16]float32 {
	x, y, z := toEditor(pos[0], pos[1], pos[2])
	return [16]float32{1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, x, y, z, 1}
}

// parseRibbons reads a vanilla M2's ribbon emitters, their tracks baked for the loop w; bones says
// whether the model has moving bones, which a ribbon can ride. A ribbon that never lays an edge or has
// no width is dropped, as Benilla does.
func parseRibbons(r reader, textures []string, bones bool, w seqWindow) []Ribbon {
	n, ofs := r.u32(0x134), r.u32(0x138)
	if n <= 0 || n > 256 || ofs < 0 || ofs+n*ribbonStride > len(r.b) {
		return nil
	}
	nFlags, ofsFlags, _ := r.arr(0x84, 4)
	// The first entry of the M2Array<u16> at o, or -1.
	first := func(o int) int {
		c, at := r.u32(o), r.u32(o+4)
		if c <= 0 || at < 0 || at+2 > len(r.b) {
			return -1
		}
		return r.u16(at)
	}
	peak := func(t *Track) float32 {
		m := float32(0)
		if t != nil {
			for _, v := range t.Values {
				m = max(m, v)
			}
		}
		return m
	}
	var out []Ribbon
	for i := 0; i < n && len(out) < maxRibbons; i++ {
		e := ofs + i*ribbonStride
		ti := first(e + 0x14)
		if ti < 0 || ti >= len(textures) || textures[ti] == "" {
			continue
		}
		// Shipped ribbons are almost all additive, so an unresolved material is too.
		blend := 4
		if m := first(e + 0x1C); m >= 0 && m < nFlags {
			blend = r.u16(ofsFlags + m*4 + 2)
		}
		rb := Ribbon{
			Bone:    -1,
			Texture: textures[ti],
			Blend:   blend,
			Color: bakeTrack(r, e+0x24, 12, 3, func(at int, v []float32) {
				v[0], v[1], v[2] = r.f32(at), r.f32(at+4), r.f32(at+8)
			}, w),
			// Signed fixed point; the draw clamps a negative to 0.
			Alpha:          bakeTrack(r, e+0x40, 2, 1, func(at int, v []float32) { v[0] = float32(int16(r.u16(at))) / 32767 }, w),
			Above:          scalarTrack(r, e+0x5C, w),
			Below:          scalarTrack(r, e+0x78, w),
			On:             gateTrack(r, e+0xC0, w),
			EdgesPerSecond: r.f32(e + 0x94),
			EdgeLifetime:   max(r.f32(e+0x98), 0.25),
			Gravity:        r.f32(e + 0x9C),
			Rows:           max(r.u16(e+0xA0), 1),
			Cols:           max(r.u16(e+0xA2), 1),
		}
		if c, at := r.u32(e+0xA4+0x14), r.u32(e+0xA4+0x18); c > 0 && at >= 0 && at+2 <= len(r.b) {
			rb.Slot = r.u16(at)
		}
		if rb.On != nil && peak(rb.On) <= 0 {
			continue
		}
		if !(rb.EdgesPerSecond > 0) || peak(rb.Above)+peak(rb.Below) <= 0 || !finite(rb.EdgeLifetime, rb.Gravity) {
			continue
		}
		pos := [3]float32{r.f32(e + 0x08), r.f32(e + 0x0C), r.f32(e + 0x10)}
		if !finite(pos[0], pos[1], pos[2]) {
			continue
		}
		rb.Frame = ribbonFrame(pos)
		if bones {
			rb.Bone = r.u16(e + 0x04)
		}
		out = append(out, rb)
	}
	return out
}

// place moves the ribbon's frame by a doodad placement (placeFrame). The doodad's bones are gone in the
// baked mesh, so it rides none.
func (rb *Ribbon) place(rot func(x, y, z float32) (float32, float32, float32), scale float32, p [3]float32) {
	placeFrame(&rb.Frame, rot, scale, p)
	rb.Bone = -1
}

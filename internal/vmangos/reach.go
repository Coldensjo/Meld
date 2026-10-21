package vmangos

import (
	"encoding/binary"
	"math"
	"strings"

	"Meld/internal/adt"
	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// reaches works out how far placed models reach. The writer lists a model in the terrain chunks its
// bounds touch, and the client draws it only in those chunks, so the bounds must cover the whole model.
// The writer's default is a guess around the origin, which cuts a large building short.
type reaches struct {
	set   *mpq.Set
	cache map[string][3]float32
}

func newReaches(set *mpq.Set) *reaches {
	return &reaches{set: set, cache: map[string][3]float32{}}
}

// bound sets an object's bounds from its model's size, scaled by the object's scale. A model that can't be
// read keeps the writer's default.
func (r *reaches) bound(o *adt.Object) {
	h, ok := r.halfSize(o.Kind, o.Name)
	if !ok {
		return
	}
	s := o.Scale
	if s <= 0 {
		s = 1
	}
	p := o.Position
	for k := 0; k < 3; k++ {
		o.Min[k] = p[k] - h[k]*s
		o.Max[k] = p[k] + h[k]*s
	}
}

// halfSize is the half-size of a model's bounds around its origin: its horizontal reach and its height
// either side of the origin, in yards. ok is false when the model can't be read.
func (r *reaches) halfSize(kind adt.Kind, name string) ([3]float32, bool) {
	key := strings.ToLower(name)
	if kind == adt.WMO {
		key = "wmo:" + key
	}
	h, cached := r.cache[key]
	if !cached {
		h = r.readHalfSize(kind, name)
		r.cache[key] = h
	}
	return h, h != [3]float32{}
}

func (r *reaches) readHalfSize(kind adt.Kind, name string) [3]float32 {
	b, err := r.set.ReadFile(name)
	// The client's tiles name models ".mdx" (or ".mdl"), which its archives hold as ".m2"; without this
	// every model read from a tile kept the writer's default reach.
	if l := strings.ToLower(name); err != nil && kind == adt.M2 && (strings.HasSuffix(l, ".mdx") || strings.HasSuffix(l, ".mdl")) {
		b, err = r.set.ReadFile(name[:len(name)-len(".mdx")] + ".m2")
	}
	if err != nil {
		return [3]float32{}
	}
	if kind == adt.WMO {
		box, ok := wmoBox(b)
		if !ok {
			return [3]float32{}
		}
		// A WMO's Z axis is up, so its corners are (x, z, -y) in editor space.
		var pts [][3]float32
		for _, x := range []float32{box[0], box[3]} {
			for _, y := range []float32{box[1], box[4]} {
				for _, z := range []float32{box[2], box[5]} {
					pts = append(pts, [3]float32{x, z, -y})
				}
			}
		}
		return halfSizeOf(pts)
	}
	m, err := wow.ParseM2(b, name)
	if err != nil || len(m.Pos) < 3 {
		return [3]float32{}
	}
	pts := make([][3]float32, 0, len(m.Pos)/3)
	for i := 0; i+2 < len(m.Pos); i += 3 {
		pts = append(pts, [3]float32{m.Pos[i], m.Pos[i+1], m.Pos[i+2]})
	}
	return halfSizeOf(pts)
}

// halfSizeOf is the half-size of the box around points given in editor space, from the origin.
func halfSizeOf(pts [][3]float32) [3]float32 {
	var h [3]float32
	for _, p := range pts {
		h[0] = max(h[0], float32(math.Hypot(float64(p[0]), float64(p[2]))))
		h[1] = max(h[1], float32(math.Abs(float64(p[1]))))
	}
	h[2] = h[0]
	return h
}

// wmoBox reads the bounding box from a WMO root file's MOHD chunk: min x, y, z then max x, y, z.
func wmoBox(b []byte) ([6]float32, bool) {
	for off := 0; off+8 <= len(b); {
		id := string([]byte{b[off+3], b[off+2], b[off+1], b[off]})
		size := int(binary.LittleEndian.Uint32(b[off+4:]))
		if off+8+size > len(b) {
			break
		}
		if id == "MOHD" {
			mohd := b[off+8 : off+8+size]
			if len(mohd) < 0x3c {
				return [6]float32{}, false
			}
			var box [6]float32
			for k := range box {
				box[k] = math.Float32frombits(binary.LittleEndian.Uint32(mohd[0x24+4*k:]))
			}
			return box, true
		}
		off += 8 + size
	}
	return [6]float32{}, false
}

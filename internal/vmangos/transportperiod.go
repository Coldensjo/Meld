package vmangos

import "math"

// A transport's period as the 1.12 client works it out (#955). The client sails a boat or zeppelin
// from its own TaxiPathNode.dbc and the template's speed and acceleration, at the server's clock
// modulo this period; VMaNGOS's own sum (GenerateWaypoints) differs from it, which is why the server
// takes the period from the `transports` table, whose rows are sniffs of the client's. So a new or
// edited route's row must hold the client's period to the millisecond, or the boat the server moves
// and the one the player sees drift apart a little more every trip.
//
// Ported from Benilla (crates/benilla-formats/src/transport_period.rs, MIT), a step-for-step
// transcription of the client's computation that reproduces the nine live transports' periods
// exactly: each float32 rounding below is the client's, and a float64 product is converted before it
// is added so that no fused multiply-add changes a bit.

// crBasis is the client's uniform Catmull-Rom basis: row i the Horner coefficients, highest degree
// first, that weigh control point i.
var crBasis = [4][4]float32{
	{-0.5, 1.0, -0.5, 0.0},
	{1.5, -2.5, 0.0, 1.0},
	{-1.5, 2.0, 0.5, 0.0},
	{0.5, -0.5, 0.0, 0.0},
}

// basisWeight is a basis cubic at t, in float64.
func basisWeight(c [4]float32, t float32) float64 {
	tt := float64(t)
	w := float64(c[0])
	for _, v := range c[1:] {
		w = float64(w*tt) + float64(v)
	}
	return w
}

// evalCubic is the curve through the four control points cps at t: the x product stays float64 into
// its add, y's and z's are rounded to float32 first, and every sum is rounded to float32.
func evalCubic(cps [][3]float32, t float32) [3]float32 {
	var out [3]float32
	for i := 0; i < 4 && i < len(cps); i++ {
		p := cps[i]
		w := basisWeight(crBasis[i], t)
		out[0] = float32(float64(w*float64(p[0])) + float64(out[0]))
		ty := float32(w * float64(p[1]))
		tz := float32(w * float64(p[2]))
		out[1] = float32(float64(ty) + float64(out[1]))
		out[2] = float32(float64(tz) + float64(out[2]))
	}
	return out
}

// segLength is a segment's length over 20 chords, the parameter stepped by 0.05 in float32.
func segLength(cps [][3]float32) float32 {
	prev := evalCubic(cps, 0)
	var acc float32
	t := math.Float32frombits(0x3d4ccccd) // 0.05
	for range 20 {
		cur := evalCubic(cps, t)
		dx := float64(cur[0]) - float64(prev[0])
		dy := float64(cur[1]) - float64(prev[1])
		dz := float64(cur[2]) - float64(prev[2])
		l := math.Sqrt(float64(float64(dz*dz)+float64(dy*dy)) + float64(dx*dx))
		acc = float32(l + float64(acc))
		t = float32(float64(t) + 0.05)
		prev = cur
	}
	return acc
}

// knotSum is point idx's distance from the leg's start: the float64 sum of the first idx-1 segments.
func knotSum(segs []float32, idx int) float64 {
	var acc float64
	for i := 0; i < idx-1 && i < len(segs); i++ {
		acc += float64(segs[i])
	}
	return acc
}

// roundMS is seconds as whole milliseconds, rounded half away from zero (0 for a NaN).
func roundMS(t float64) int64 {
	s := t * 1000
	if math.IsNaN(s) {
		return 0
	}
	if s > 0 {
		s += 0.5
	} else {
		s -= 0.5
	}
	s = math.Trunc(s)
	return int64(max(math.MinInt32, min(math.MaxInt32, s)))
}

// spanMS is the milliseconds of a span from l to p along a leg, speeding up at accel to speed and
// slowing again; a leg's first span (first) has one ramp only, since its start is mid-cruise.
func spanMS(p float64, l, speed, accel float32, first bool) int64 {
	d := p - float64(l)
	v, ac := float64(speed), float64(accel)
	a := float32(v / ac)
	bLive := 0.5 * v * float64(a)
	b := float32(bLive)
	var t float64
	switch {
	case first && bLive < d:
		t = (d-float64(b))/v + float64(a)
	case first:
		t = math.Sqrt(2 * d / ac)
	case bLive < 0.5*d:
		t = (d-2*float64(b))/v + 2*float64(a)
	default:
		t = 2 * math.Sqrt(d/ac)
	}
	return roundMS(t)
}

// lastSpanMS is a leg's last span, from l to its end p: cruise all the way when the leg had no dock,
// else one ramp out of the last dock.
func lastSpanMS(p, l, speed, accel float32, first bool) int64 {
	d := float64(p) - float64(l)
	v, ac := float64(speed), float64(accel)
	if first {
		return roundMS(d / v)
	}
	a := float32(v / ac)
	bLive := 0.5 * v * float64(a)
	if bLive < d {
		return roundMS((d-float64(float32(bLive)))/v + float64(a))
	}
	return roundMS(math.Sqrt(2 * d / ac))
}

type legStop struct {
	at    int
	delay int64
}

// legMS is a leg's spans and its docks' waits, in milliseconds.
func legMS(points [][3]float32, stops []legStop, speed, accel float32) int64 {
	var segs []float32
	var total float32
	if len(points) > 3 {
		segs = make([]float32, len(points)-3)
		var sum float64
		for s := range segs {
			segs[s] = segLength(points[s:])
			sum += float64(segs[s])
		}
		total = float32(sum)
	}
	var ms int64
	var l float32
	done := 0
	for _, s := range stops {
		ms += s.delay
		// A dock on the leg's last point or its guard has no span, but its wait counts.
		if s.at+1 >= len(points) {
			break
		}
		p := knotSum(segs, s.at)
		ms += spanMS(p, l, speed, accel, done == 0)
		l = float32(p)
		done++
	}
	return ms + lastSpanMS(total, l, speed, accel, done == 0)
}

// TransportPeriod is the milliseconds of a transport's round trip as the client works it out from
// its path's points (TaxiPathNode.dbc's, in order), its speed and its acceleration: a leg ends where
// the map changes or after a point with flags 1, its first and last points only shape the curve, and
// a point with flags 2 is a dock waited at for its delay. False when the path has no points, the
// acceleration is not above 0 or the period does not fit 32 bits.
func TransportPeriod(points []TaxiPoint, speed, accel float32) (uint32, bool) {
	if len(points) == 0 || !(accel > 0) || !(speed > 0) {
		return 0, false
	}
	var period int64
	var leg [][3]float32
	var stops []legStop
	legMap := points[0].MapID
	jumped := false
	for _, p := range points {
		if p.MapID != legMap || jumped {
			period += legMS(leg, stops, speed, accel)
			leg, stops = leg[:0], stops[:0]
			legMap = p.MapID
		}
		// A dock on a leg's first point is not one.
		if p.Flags&2 != 0 && len(leg) > 0 {
			stops = append(stops, legStop{len(leg), int64(int32(p.Delay)) * 1000})
		}
		leg = append(leg, [3]float32{p.X, p.Y, p.Z})
		jumped = p.Flags&1 != 0
	}
	if len(leg) > 0 {
		period += legMS(leg, stops, speed, accel)
	}
	if period < 0 || period > math.MaxUint32 {
		return 0, false
	}
	return uint32(period), true
}

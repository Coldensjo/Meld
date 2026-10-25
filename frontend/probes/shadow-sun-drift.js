// #366: between redraws of the near sun shadow map (held while the sun turns under 0.1°, #324), its
// lookup matrix stays the one the map was drawn with, though the key light follows the live sun for the
// lighting. Steps the hour a little a frame on a flat map with cubes round the near box, and checks that
// on every frame without a near redraw the lookup matrix equals the one after the last redraw, and that
// the view then stays within the threshold of the shot taken just after that redraw. The pixel test is
// weak (the lighting also turns, and a 0.1° slide is a few texels: mean 0.07 before the fix, 0.03 after),
// so the matrix is the real check.
// touches: frontend/src/lib/engine/shadowCascades.ts, frontend/src/lib/engine/Environment.ts
const e = P.e
const { prefs } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(3)
if (!e.env.key.castShadow) return { ok: false, error: 'the sun casts no shadows (Graphics › Shadows is off)' }
const wasCycle = prefs.dayCycle
prefs.dayCycle = false
await P.frames(2)
const near = e.env.key.shadow
let redrawn = false
const mark = e.markShadows.bind(e)
e.markShadows = () => {
	mark()
	if (near.needsUpdate) redrawn = true
}
const r = { frames: 0, redraws: 0, held: 0, matrixOff: 0 }
try {
	// A low afternoon sun, for long shadows that slide the most.
	e.hour = 16
	const focus = e.env.key.target.position
	for (const [dx, dz] of [
		[-25, -25],
		[25, -25],
		[-25, 25],
		[25, 25],
		[0, 0],
	])
		e.objects.add({ type: 'helper:cube:4', x: focus.x + dx, z: focus.z + dz, yOff: 0, rotY: 0, scale: 1 })
	await P.settle()
	await P.frames(10)
	// Freeze everything but the hour: a shot is then only the sun's doing.
	e.timer.setTimescale(0)
	near.needsUpdate = true
	await P.frames(2)
	let drawn = near.matrix.clone()
	let base = await P.shot()
	const again = await P.shot()
	r.noise = P.diff(base, again)
	let worst = { off: 0, mean: 0 }
	// 0.0005 h a frame is about 0.0075°: a refit (0.1°) every dozen frames or so.
	for (let i = 0; i < 40; i++) {
		e.hour += 0.0005
		redrawn = false
		const shot = await P.shot()
		r.frames++
		if (redrawn) {
			r.redraws++
			drawn = near.matrix.clone()
			base = shot
			continue
		}
		r.held++
		if (!near.matrix.equals(drawn)) r.matrixOff++
		const d = P.diff(base, shot)
		if (d.mean > worst.mean) worst = d
	}
	r.worstHeld = worst
} finally {
	e.timer.setTimescale(1)
	e.markShadows = mark
	prefs.dayCycle = wasCycle
}
r.ok = r.held > 10 && r.redraws > 0 && r.matrixOff === 0 && r.worstHeld.off <= r.noise.off + 0.001
return r

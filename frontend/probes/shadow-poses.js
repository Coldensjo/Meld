// #346: with moving models in the near shadow box (posed creatures on the creatures map; animated
// doodads and moving cut-out textures on objects-mixed) and Prop animations on, a still view draws only
// the moving models into the near sun shadow map each frame, over a copy of the still casters, rather
// than the whole map. With the clock held (so the poses hold), the view drawn that way matches the view
// after a full redraw, and on the creatures map differs once the moving pass is left out (the creatures'
// shadows are then missing), so the comparison sees them.
// touches: frontend/src/lib/engine/posedShadows.ts, frontend/src/lib/engine/shadowCascades.ts, frontend/src/lib/world/shadowCasters.ts
const e = P.e
const { prefs } = await P.state()
const was = prefs.animations
const near = e.env.key.shadow
const ps = e.posedShadows
let fulls = 0
let forceFull = false
const mark = e.markShadows.bind(e)

const run = async (kind) => {
	await P.loadBenchMap(kind)
	const r = { kind }
	await P.frames(4)
	fulls = 0
	const p0 = ps.passes
	await P.frames(6)
	r.still = { full: fulls, posed: ps.passes - p0 }
	// Hold the clock: every frame still poses the models, at the same time.
	e.timer.setTimescale(0)
	try {
		await P.frames(3)
		const split = await P.shot()
		const again = await P.shot()
		forceFull = true
		const full = await P.shot()
		await P.frames(1)
		forceFull = false
		// After a full redraw, a split frame without the moving pass: the still casters alone.
		ps.drawPosed = () => {}
		const bare = await P.shot()
		delete ps.drawPosed
		await P.frames(2)
		r.noise = P.diff(split, again)
		r.vsFull = P.diff(split, full)
		r.vsBare = P.diff(split, bare)
	} finally {
		e.timer.setTimescale(1)
		delete ps.drawPosed
		forceFull = false
	}
	r.ok = r.still.full === 0 && r.still.posed === 6 && r.vsFull.off <= r.noise.off + 0.0005 && r.vsFull.litA > 0.5
	return r
}

prefs.animations = true
e.markShadows = () => {
	mark()
	if (forceFull) near.needsUpdate = true
	if (near.needsUpdate) fulls++
}
let creatures, mixed
try {
	if (!e.env.key.castShadow) return { ok: false, error: 'the sun casts no shadows (Graphics › Shadows is off)' }
	creatures = await run('creatures')
	mixed = await run('objects-mixed')
} finally {
	e.markShadows = mark
	prefs.animations = was
}
const seen = creatures.vsBare.off > creatures.noise.off + 0.001
return { ok: creatures.ok && mixed.ok && seen, creatures, mixed }

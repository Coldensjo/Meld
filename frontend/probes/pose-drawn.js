// Only the animated spawn types the cull drew are posed each frame, and with Prop animations off a drawn type holds its first frame, not the bind pose (#328).
// touches: frontend/src/lib/world/Animator.ts, frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/world/ObjectLayer.ts
await P.loadBenchMap('creatures', 300)
const { animatedAssets } = await P.app('/src/lib/models/assets.ts')
const layer = P.e.doc.spawnLayer
const types = [...animatedAssets.keys()].filter((t) => layer.hasType(t))
const drawn = () => types.filter((t) => layer.drawsType(t))
const posed = () => Object.fromEntries(types.map((t) => [t, animatedAssets.get(t).anim.posedAt]))
/** Steps a frame and returns how many drawn types were posed in it and how many undrawn ones. */
async function step() {
	const b = posed()
	await P.frames(1)
	const a = posed()
	const d = new Set(drawn())
	let drawnPosed = 0
	let hiddenPosed = 0
	for (const t of types) {
		if (a[t] === b[t]) continue
		if (d.has(t)) drawnPosed++
		else hiddenPosed++
	}
	return { drawn: d.size, drawnPosed, hiddenPosed }
}
await P.frames(2)
const front = await step()
// Creatures and NPCs hidden (View): nothing of them is drawn, so nothing is posed.
const { prefs } = await P.state()
prefs.showMonsters = false
prefs.showNpcs = false
await P.frames(2)
const hidden = await step()
// Shown again: every type drawn is posed on that first frame.
prefs.showMonsters = true
prefs.showNpcs = true
const b = posed()
await P.frames(1)
const a = posed()
const shownAgain = drawn()
const cameBackPosed = shownAgain.filter((t) => a[t] !== b[t]).length
// Prop animations off: every drawn type is posed at time 0, not left in the bind pose.
prefs.animations = false
await P.frames(3)
const still = drawn().map((t) => animatedAssets.get(t).anim.posedAt)
prefs.animations = true
await P.frames(1)
const ok =
	front.drawn > 0 &&
	front.drawnPosed === front.drawn &&
	front.hiddenPosed === 0 &&
	hidden.drawn === 0 &&
	hidden.hiddenPosed === 0 &&
	shownAgain.length > 0 &&
	cameBackPosed === shownAgain.length &&
	still.length > 0 &&
	still.every((x) => x === 0)
return { ok, types: types.length, front, hidden, shownAgain: shownAgain.length, cameBackPosed, stillPosedAt0: still.every((x) => x === 0), stillTypes: still.length }

// Show › Spawn colours (#949): Level mode paints the Northshire and Goldshire spawns' instances along the level ramp over the block's creature levels, Rank (picked in the legend) and Reaction give their colours, the legend shows, the discs under the creatures (#982) take each one's colour, and Kind puts the kind colours back and hides the discs; needs the world database.
// touches: frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/world/spawnColors.ts, frontend/src/components/SpawnColorLegend.svelte, frontend/src/lib/engine/Engine.ts, frontend/src/lib/world/SpawnLinks.ts
const e = P.e
const se = await P.app('/src/lib/world/spawnEdits.ts')
const sc = await P.app('/src/lib/world/spawnColors.ts')
const THREE = await P.app('three')
const { prefs } = await P.state()
const App = window.go.main.App
const before = prefs.spawnColors
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const loaded = await App.LoadSpawns('Azeroth', 31, 48, 2)
const layer = e.activeDocument().spawnLayer
layer.set(loaded)
se.syncSpawnUi(layer, true)
await P.settle()
// The colours written into the instances of every batch drawn now, as hex.
const painted = () => {
	const out = new Set()
	const c = new THREE.Color()
	for (const m of layer.group.children) {
		if (!m.visible || !m.instanceColor) continue
		for (let k = 0; k < m.userData.ids.length; k++) out.add(c.fromArray(m.instanceColor.array, k * 3).getHex())
	}
	return out
}
// Looks down on the block from high up, so its spawns are in view.
const cx = layer.spawns.reduce((t, s) => t + s.x, 0) / layer.spawns.length
const cz = layer.spawns.reduce((t, s) => t + s.z, 0) / layer.spawns.length
e.controller.setView(cx, 0, cz, 0, 1.45, 1400)
await P.frames(3)
const res = {}
// The spawns sit at the client's heights over a flat map, so few are in the camera's view (`count`);
// every packed one (the shadow passes' too, `userData.ids`) is painted.
res.packed = layer.group.children.reduce((t, m) => t + (m.visible ? m.userData.ids.length : 0), 0)
try {
	prefs.spawnColors = 'level'
	await P.frames(4)
	res.mode = layer.coloring
	res.levels = [...layer.levelSpread]
	const lowS = layer.spawns.find((s) => s.kind !== 'object' && sc.spawnLevel(s) === res.levels[0])
	const highS = layer.spawns.find((s) => s.kind !== 'object' && sc.spawnLevel(s) === res.levels[1])
	const c = new THREE.Color()
	res.low = layer.spawnTint(lowS, false, c).getHex() === sc.LEVEL_RAMP[0]
	res.high = layer.spawnTint(highS, false, c).getHex() === sc.LEVEL_RAMP[4]
	res.levelColours = painted().size
	res.legend = !!document.querySelector('[aria-label="Spawn colours"]')
	// Every colour painted is one the mode gives a spawn (a marker's own, or a model's tint of it); how many differ.
	const check = () => {
		const want = new Set()
		for (const s of layer.spawns) for (const model of [false, true]) want.add(layer.spawnTint(s, model, c).getHex())
		const got = [...painted()]
		return got.every((x) => want.has(x)) ? got.length : -1
	}
	res.levelChecked = check()
	// A disc under every creature shown, in its marker's colour (#982).
	const discs = e.links.discs
	const creatures = layer.spawns.filter((s) => s.kind !== 'object' && layer.eventShown(s))
	res.discs = discs.visible ? discs.count : -1
	res.creatures = creatures.length
	res.discColoured = creatures.every((s) => {
		const i = e.links.discOf.get(s)
		return i !== undefined && c.fromArray(discs.instanceColor.array, i * 3).getHex() === layer.spawnTint(s, false, new THREE.Color()).getHex()
	})
	// The legend's picker sets the mode (its change event must bubble: Svelte delegates it to the root).
	const select = document.querySelector('[aria-label="Colour the spawns"]')
	select.value = 'rank'
	select.dispatchEvent(new Event('change', { bubbles: true }))
	await P.frames(4)
	res.picked = prefs.spawnColors === 'rank'
	res.rankColours = check()
	prefs.spawnColors = 'reaction'
	await P.frames(4)
	res.reactionColours = check()
	prefs.spawnColors = 'kind'
	await P.frames(4)
	const kinds = Object.values(sc.KIND_COLORS)
	res.kindBack = [...painted()].every((x) => kinds.includes(x))
	res.discsGone = !e.links.discs.visible
	res.legendGone = !document.querySelector('[aria-label="Spawn colours"]')
} finally {
	prefs.spawnColors = before
}
const ok =
	res.packed > 0 &&
	res.mode === 'level' &&
	res.levels[1] > res.levels[0] &&
	res.low &&
	res.high &&
	res.levelColours >= 3 &&
	res.levelChecked >= 3 &&
	res.discs === res.creatures &&
	res.creatures > 0 &&
	res.discColoured &&
	res.discsGone &&
	res.legend &&
	res.picked &&
	res.rankColours >= 2 &&
	res.reactionColours >= 2 &&
	res.kindBack &&
	res.legendGone
return { ok, spawns: layer.spawns.length, ...res }

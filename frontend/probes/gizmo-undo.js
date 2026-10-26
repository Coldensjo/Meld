// The Select tool's gizmo drags (one model's spin ring, height arrow, scale knob and move arrow, a group's ring and arrow, a spawn's ring and arrow) each leave one History step that Undo and Redo restore (#694, #696; the tool's own drags are in tests/toolUndo.test.ts); the spawn part needs the world database.
// touches: frontend/src/lib/engine/TransformGizmo.ts, frontend/src/lib/engine/GizmoDrag.ts, frontend/src/lib/state/history.ts, frontend/src/lib/state/historyCore.ts, frontend/src/lib/tools/ObjectTools.ts
const e = P.e
const { editor } = await P.state()
const sel = await P.app('/src/lib/state/selection.ts')
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { spawnKey } = await P.app('/src/lib/world/SpawnLayer.ts')
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'select'
await P.frames(1)
const L = e.objects
// A fresh ocean map's ground is at -12: the cubes stand above the water.
const cubes = [
	[120, 120],
	[128, 124],
	[136, 120],
].map(([x, z]) => L.add({ type: 'helper:cube:4', x, z, yOff: 14, rotY: 0, scale: 1 }))
await P.lookAt({ x: 128, y: e.terrain.heightAt(128, 122) + 14, z: 122 }, { pitch: 0.7, back: 40 })
const V3 = e.controller.target.constructor
const g = e.gizmo

/** Points the Engine's pointer at world point p. */
const aim = (p) => {
	const q = p.clone().project(e.camera)
	e.ndc.set(q.x, q.y)
	e.raycaster.setFromCamera(e.ndc, e.camera)
}
/** What `state` reads: the cubes, or the spawn when one is chosen. */
let spawnKeyNow = null
/** The fields a gizmo drag edits, of every cube (or of the spawn). */
const state = () => {
	if (spawnKeyNow) {
		const s = e.doc.spawnLayer.get(spawnKeyNow)
		return JSON.stringify([s.x, s.y, s.z, s.orientation])
	}
	return JSON.stringify(cubes.map((c) => L.objects.get(c.id)).map((o) => [o.x, o.yOff, o.z, o.rotY, o.scale, o.parent ?? null]))
}
/** A point on the ring at `a` radians round, from the ring's centre. */
const onRing = (a) => g.ring.position.clone().add(new V3(Math.cos(a) * g.ring.scale.x, 0, Math.sin(a) * g.ring.scale.x))

/** Where each handle is grabbed, and where the drag takes the pointer. */
const handles = {
	ring: () => {
		for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
			aim(onRing(a))
			if (g.pick(e.raycaster) === 'ring') return [onRing(a), onRing(a + 1)]
		}
		return null
	},
	arrow: () => [g.arrow.position.clone(), g.arrow.position.clone().add(new V3(0, 3, 0))],
	scale: () => {
		const from = g.knob.position.clone()
		const out = from.clone().sub(g.ring.position).setY(0).normalize().multiplyScalar(3)
		return [from, from.clone().add(out)]
	},
	moveX: () => {
		const axis = g.axisDir('moveX', new V3())
		const from = g.axes.position.clone().add(axis.clone().multiplyScalar(g.ring.scale.x + g.arrow.scale.x * 0.5))
		return [from, from.clone().add(axis.multiplyScalar(4))]
	},
}

/** Drags handle `name` of the gizmo as it is now: one step pushed, Undo and Redo bringing the cubes back. */
const drag = async (name) => {
	await P.frames(2)
	const at = handles[name]()
	if (!at) return { name, error: 'no ring point picks the ring' }
	aim(at[0])
	const picked = g.pick(e.raycaster)
	const before = state()
	const steps = e.history.position
	const started = e.startGizmoDrag()
	aim(at[1])
	e.updateGizmoDrag(false)
	await P.frames(1)
	e.endGizmoDrag()
	const after = state()
	const pushed = e.history.position - steps
	e.history.undo()
	const undone = state() === before
	e.history.redo()
	const redone = state() === after
	const ok = picked === name && started && after !== before && pushed === 1 && undone && redone
	return { name, ok, ...(ok ? {} : { picked, started, changed: after !== before, pushed, undone, redone }) }
}

const results = []
sel.selectObjects(L, [cubes[1].id])
for (const name of ['ring', 'arrow', 'scale', 'moveX']) results.push(await drag(name))
sel.selectObjects(
	L,
	cubes.map((c) => c.id),
)
for (const name of ['ring', 'arrow']) results.push({ ...(await drag(name)), group: true })

// A creature of the world database, on the flat map, picked as the selected spawn (no model selected).
const loaded = await window.go.main.App.LoadSpawns('Azeroth', 30, 48, 1)
const found = loaded.find((x) => x.kind === 'monster')
if (!found) return { ok: false, results, error: 'no creature spawn from the world database' }
const layer = e.doc.spawnLayer
const spawn = { ...found, x: 128, z: 122, y: e.terrain.heightAt(128, 122), orientation: 0.5 }
layer.set([spawn])
se.syncSpawnUi(layer, true)
await P.settle()
sel.selectObjects(L, [])
se.selectSpawn(spawn)
spawnKeyNow = spawnKey(spawn)
await P.lookAt({ x: 128, y: spawn.y + 1, z: 122 }, { pitch: 0.7, back: 12 })
await P.frames(3)
for (const name of ['ring', 'arrow']) results.push({ ...(await drag(name)), spawn: true })
return { ok: results.every((r) => r.ok), results }

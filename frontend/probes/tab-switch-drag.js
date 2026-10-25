// A tab switch in the middle of a gizmo drag ends the drag on the tab it began in (#549): the turned model keeps its turn with one undo step in that tab's History, the other tab's History gets nothing, and moves after the switch touch neither tab; the same for a group of two, and a brush-size drag is dropped.
// touches: frontend/src/lib/engine/TransformGizmo.ts, frontend/src/lib/engine/GizmoDrag.ts, frontend/src/lib/tools/ObjectTools.ts, frontend/src/lib/engine/Engine.ts
const e = P.e
const { editor } = await P.state()
const { selectObjects } = await P.app('/src/lib/state/selection.ts')
const V3 = e.controller.target.constructor
const R = e.raycaster.constructor
const other = e.newDocument(256, 'flat', 0, 'Probe B')
const docA = e.newDocument(256, 'flat', 0, 'Probe A')
editor.tool = 'select'
await P.frames(2)
const h0 = e.terrain.heightAt(128, 128)
await P.lookAt({ x: 128, y: h0, z: 128 }, { pitch: 1.0, back: 40 })

/** A spot on the viewport (shares, y = 0 the top) where the gizmo's ring is under the pointer, or null. */
const ringSpot = () => {
	const ray = new R()
	const ndc = { x: 0, y: 0 }
	for (let y = 0.2; y <= 0.8; y += 0.01) {
		for (let x = 0.2; x <= 0.8; x += 0.01) {
			ndc.x = x * 2 - 1
			ndc.y = 1 - y * 2
			ray.setFromCamera(ndc, e.camera)
			if (e.gizmo.pick(ray) === 'ring') return [x, y]
		}
	}
	return null
}

/** Presses the ring, turns a little, switches to the other tab, turns more and lets go. */
const turnAcrossSwitch = async () => {
	const at = ringSpot()
	if (!at) return { found: false }
	const stepsA = docA.history.position
	const stepsB = other.history.position
	P.pointer('pointermove', ...at)
	P.pointer('pointerdown', ...at)
	await P.frames(1)
	for (let i = 1; i <= 4; i++) {
		P.pointer('pointermove', at[0] + i * 0.03, at[1] + i * 0.02, { buttons: 1 })
		await P.frames(1)
	}
	e.switchDocument(other.id)
	await P.frames(1)
	const onB = e.doc === other
	for (let i = 5; i <= 8; i++) {
		P.pointer('pointermove', at[0] + i * 0.03, at[1] + i * 0.02, { buttons: 1 })
		await P.frames(1)
	}
	P.pointer('pointerup', at[0] + 0.24, at[1] + 0.16)
	await P.frames(1)
	return {
		found: true,
		onB,
		stepA: docA.history.position - stepsA,
		stepB: other.history.position - stepsB,
		label: docA.history.peek()?.label ?? '',
	}
}

const out = {}
const L = docA.objects
const cube = L.add({ type: 'helper:cube:4', x: 128, z: 128, yOff: 0, rotY: 0, scale: 1 })
selectObjects(L, [cube.id])
await P.frames(3)
const one = await turnAcrossSwitch()
const turned = cube.rotY
out.one = { ...one, turned: +turned.toFixed(3) }
// Back on A, the step undoes the turn.
e.switchDocument(docA.id)
await P.frames(1)
const backOnA = e.doc === docA
e.history.undo()
await P.frames(1)
out.one.undone = cube.rotY === 0
const oneOk = one.found && one.onB && backOnA && one.stepA === 1 && one.stepB === 0 && Math.abs(turned) > 0.01 && out.one.undone && one.label === 'Transform'

// A group of two.
const c2 = L.add({ type: 'helper:cube:4', x: 134, z: 128, yOff: 0, rotY: 0, scale: 1 })
selectObjects(L, [cube.id, c2.id], cube.id)
await P.frames(3)
const group = await turnAcrossSwitch()
out.group = { ...group, moved: c2.x !== 134 || c2.z !== 128 || c2.rotY !== 0 }
const groupOk = group.found && group.onB && group.stepA === 1 && group.stepB === 0 && out.group.moved && /objects/.test(group.label)
e.switchDocument(docA.id)
await P.frames(1)

// A brush-size drag (Alt+right) is dropped by the switch (to B and back): later moves don't size the brush.
editor.tool = 'sculpt'
await P.frames(1)
const r0 = editor.brush.radius
P.pointer('pointermove', 0.5, 0.5)
P.pointer('pointerdown', 0.5, 0.5, { button: 2, altKey: true })
await P.frames(1)
e.switchDocument(other.id)
await P.frames(1)
P.pointer('pointermove', 0.8, 0.5, { button: 2, altKey: true, buttons: 2 })
await P.frames(1)
P.pointer('pointerup', 0.8, 0.5, { button: 2, altKey: true })
await P.frames(1)
out.size = { r0, r1: editor.brush.radius }
const sizeOk = editor.brush.radius === r0
editor.tool = 'select'

for (const d of [docA, other]) e.closeDocument(d.id)
await P.frames(1)
out.ok = oneOk && groupOk && sizeOk
return out

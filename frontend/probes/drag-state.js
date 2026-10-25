// Drags write the editor's reactive state at most once a frame, not on every pointer move (#448): a model dragged by the Select tool reaches the Inspector's copy (editor.selected) at the next frame, an area drag reaches editor.selection then, a dragged path point reaches editor.paths on release, the Sculpt vertex slope slider records its undo step at most every 100 ms and once more when it rests,, a paint stroke over a full chunk says so once, not every tick, and the viewport hint of a gizmo or brush-size drag is published once a frame (#621).
// touches: frontend/src/lib/tools/ObjectTools.ts, frontend/src/lib/tools/PathTool.ts, frontend/src/lib/tools/TerrainTools.ts, frontend/src/lib/engine/TransformGizmo.ts, frontend/src/lib/state/editor.svelte.ts
const e = P.e
const { editor, ui } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'select'
await P.frames(1)
const V3 = e.controller.target.constructor
const h0 = e.terrain.heightAt(128, 128)
await P.lookAt({ x: 128, y: h0, z: 128 }, { pitch: 1.3, back: 120 })
/** Where a world point is on the viewport, as shares of it (y = 0 the top). */
const share = (x, y, z) => {
	const v = new V3(x, y, z).project(e.camera)
	return [(v.x + 1) / 2, (1 - v.y) / 2]
}
const out = {}

// A model drag: the moves land in the object at once, in editor.selected at the next frame.
const L = e.objects
const cube = L.add({ type: 'helper:cube:8', x: 128, z: 128, yOff: 0, rotY: 0, scale: 1 })
await P.frames(2)
const at = share(128, h0 + 4, 128)
P.pointer('pointermove', ...at)
P.pointer('pointerdown', ...at)
await P.frames(1)
const picked = editor.selected?.id === cube.id
const x0 = editor.selected?.x
for (let i = 1; i <= 6; i++) P.pointer('pointermove', at[0] + i * 0.02, at[1], { buttons: 1 })
const live = L.objects.get(cube.id)
const movedNow = live.x - x0
const shownNow = editor.selected?.x - x0
await P.frames(1)
const shownNext = editor.selected?.x - x0
P.pointer('pointerup', at[0] + 0.12, at[1])
await P.frames(1)
out.model = { picked, movedNow: +movedNow.toFixed(2), shownNow: +shownNow.toFixed(2), shownNext: +shownNext.toFixed(2) }
const modelOk = picked && movedNow > 1 && shownNow === 0 && Math.abs(shownNext - movedNow) < 1e-6

// An area drag: editor.selection follows at the next frame, and the release sees the last cell.
const a0 = share(60, h0, 60)
const a1 = share(100, h0, 90)
P.pointer('pointermove', ...a0)
P.pointer('pointerdown', ...a0)
await P.frames(1)
const start = editor.selection
for (let i = 1; i <= 6; i++) P.pointer('pointermove', a0[0] + ((a1[0] - a0[0]) * i) / 6, a0[1] + ((a1[1] - a0[1]) * i) / 6, { buttons: 1 })
const areaNow = editor.selection
await P.frames(1)
const areaNext = editor.selection
P.pointer('pointerup', ...a1)
await P.frames(1)
const areaEnd = editor.selection
out.area = { now: { ...areaNow }, next: { ...areaNext }, end: { ...areaEnd } }
const areaOk = !!start && areaNow === start && !!areaNext && areaNext.x1 - areaNext.x0 > 2 && !!areaEnd && areaEnd.x1 === areaNext.x1 && areaEnd.z1 === areaNext.z1
editor.selection = null

// A path point drag: editor.paths keeps the old point until the release, which records one step.
editor.tool = 'path'
await P.frames(1)
for (const [x, z] of [
	[80, 128],
	[176, 128],
])
	await P.click(...share(x, h0, z))
const p0 = { ...editor.paths[0]?.points[1] }
const pAt = share(p0.x, p0.y, p0.z)
await P.click(...pAt)
const steps0 = e.history.position
P.pointer('pointermove', ...pAt)
P.pointer('pointerdown', ...pAt)
await P.frames(1)
for (let i = 1; i <= 6; i++) {
	P.pointer('pointermove', pAt[0], pAt[1] + i * 0.02, { buttons: 1 })
	await P.frames(1)
}
const pathDuring = editor.paths[0].points[1].z - p0.z
P.pointer('pointerup', pAt[0], pAt[1] + 0.12)
await P.frames(1)
const pathAfter = editor.paths[0].points[1].z - p0.z
const pathSteps = e.history.position - steps0
e.history.undo()
await P.frames(1)
const pathUndone = editor.paths[0].points[1].z - p0.z
out.path = { during: +pathDuring.toFixed(2), after: +pathAfter.toFixed(2), steps: pathSteps, undone: +pathUndone.toFixed(2) }
const pathOk = pathDuring === 0 && pathAfter > 1 && pathSteps === 1 && Math.abs(pathUndone) < 1e-6
editor.paths = []

// The vertex slope slider: the heights follow every change, the undo step is recorded at most every
// 100 ms and once more when the slider rests. The tool's frame is called directly, many times in 100 ms,
// since a frame of the probes' page takes longer than that.
editor.tool = 'sculpt'
editor.sculptMode = 'vertex'
await P.frames(1)
await P.stroke('sculpt', { x: 128, z: 128 }, { x: 132, z: 128 }, 4)
const steps1 = e.history.position
const hv0 = ui.historyVersion
const corner = () => e.terrain.heightAt(128 + 8, 128)
const c0 = corner()
const F = 30
const sculpt = e.tools.sculpt
let follows = true
let last = c0
const t0 = performance.now()
for (let i = 1; i <= F; i++) {
	editor.vertexAngle = i
	sculpt.frame(e.ctx, null)
	if (corner() === last) follows = false
	last = corner()
}
const loopMs = performance.now() - t0
const bumpsMoving = ui.historyVersion - hv0
await P.frames(2)
const slopeSteps = e.history.position - steps1
const slopeBumps = ui.historyVersion - hv0
const tilted = corner() - c0
e.history.undo()
await P.frames(1)
const slopeUndone = corner() - c0
out.slope = { changes: F, loopMs: Math.round(loopMs), bumpsMoving, bumps: slopeBumps, steps: slopeSteps, tilted: +tilted.toFixed(2), undone: +slopeUndone.toFixed(2), follows }
const slopeOk = follows && slopeSteps === 1 && bumpsMoving <= 1 + loopMs / 100 && slopeBumps === bumpsMoving + 1 && Math.abs(tilted) > 0.1 && Math.abs(slopeUndone) < 1e-4
e.tools.sculpt.vertexAction(e.ctx, 'clear')

// A paint stroke over a chunk that already has four textures says so once, not every tick.
editor.tool = 'paint'
editor.paintMode = 'paint'
editor.paintSpray = false
await P.frames(1)
const slots = ['#203040', '#405060', '#607080', '#8090a0', '#a0b0c0'].map((c) => e.useTexture(c))
for (let i = 0; i < 4; i++) {
	editor.paintLayer = slots[i]
	await P.stroke('paint', { x: 120 + i * 2, z: 120 }, { x: 121 + i * 2, z: 120 }, 2)
}
editor.paintLayer = slots[4]
ui.status = 'probe'
const tool = e.tools.paint
const hit = new V3(124, h0, 120)
tool.onDown(e.ctx, hit)
tool.tick(e.ctx, 0.05, hit)
const first = ui.status
ui.status = 'probe'
for (let i = 0; i < 10; i++) tool.tick(e.ctx, 0.05, hit)
const later = ui.status
tool.onUp(e.ctx)
await P.frames(1)
out.chunkFull = { first: first.slice(0, 30), later }
const fullOk = first.startsWith('Not painted') && later === 'probe'

// A brush-size drag (stepBrush calls showBrushHint): the hint reaches ui.viewportHint at the next frame, once.
editor.tool = 'sculpt'
await P.frames(2)
const seq0 = ui.viewportHintSeq
const r0 = editor.brush.radius
for (let i = 1; i <= 6; i++) e.stepBrush(1)
const hintNow = ui.viewportHintSeq - seq0
await P.frames(1)
const hintNext = ui.viewportHintSeq - seq0
out.hint = { now: hintNow, next: hintNext, text: ui.viewportHint }
const hintOk = hintNow === 0 && hintNext === 1 && ui.viewportHint.startsWith('Size')
editor.brush.radius = r0

editor.tool = 'select'
await P.frames(1)
return { ok: modelOk && areaOk && pathOk && slopeOk && fullOk && hintOk, hintOk, modelOk, areaOk, pathOk, slopeOk, fullOk, ...out }

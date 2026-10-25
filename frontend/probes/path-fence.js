// Path tool's Fence (#167): a model picked in the asset browser's place goes on the picked path, and Apply stands it end to end along the curve at its own length, each turned along the curve, as one undo step that removes them all; applying again after a change replaces them.
// touches: frontend/src/lib/tools/PathTool.ts, frontend/src/lib/tools/pathApply.ts, frontend/src/lib/terrain/paths.ts
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'path'
editor.pathKind = 'fence'
await P.frames(1)
const V3 = e.controller.target.constructor
const t = e.terrain
const h0 = t.heightAt(256, 256)
const at = (x, z) => new V3(x, t.heightAt(x, z), z)
const tool = e.tools.path
const ev = new PointerEvent('pointerdown')
for (const [x, z] of [
	[200, 240],
	[256, 250],
	[310, 240],
]) {
	e.ctx.raycaster.ray.origin.set(x, h0 + 1000, z + 1000)
	tool.onDown(e.ctx, at(x, z), ev)
	tool.onUp(e.ctx)
}
const model = 'm2:World\\Azeroth\\Duskwood\\PassiveDoodads\\Fence\\DuskWoodFenceSegment.m2'
e.path((tl, c) => tl.setField(c, 'model', model))
const before = e.objects.list().length
await e.path((tl, c) => tl.apply(c))
await P.frames(2)
const fence = e.objects.list().filter((o) => o.type === model)
const count = fence.length
// Each model turned along the curve: its +X, (cos r, -sin r), points along the run from one to the next.
let turned = true
for (let i = 1; i < fence.length; i++) {
	const a = fence[i - 1],
		b = fence[i]
	const dx = b.x - a.x,
		dz = b.z - a.z
	const len = Math.hypot(dx, dz)
	const dot = (Math.cos(a.rotY) * dx - Math.sin(a.rotY) * dz) / len
	const doz = (Math.cos(a.rotY + Math.PI / 2) * dx - Math.sin(a.rotY + Math.PI / 2) * dz) / len
	if (Math.max(Math.abs(dot), Math.abs(doz)) < 0.9) turned = false
}
const gaps = fence.slice(1).map((o, i) => Math.hypot(o.x - fence[i].x, o.z - fence[i].z))
await P.lookAt({ x: 256, y: h0, z: 245 }, { pitch: 0.5, back: 70 })
await P.settle()
P.save(await P.shot(), 'applied')
// A wider spacing applied again replaces the models rather than adding to them.
e.path((tl, c) => tl.setField(c, 'spacing', 20))
await e.path((tl, c) => tl.apply(c))
const respaced = e.objects.list().filter((o) => o.type === model).length
e.history.undo()
const back = e.objects.list().filter((o) => o.type === model).length
e.history.undo()
e.history.undo()
const gone = e.objects.list().filter((o) => o.type === model).length
return {
	ok: before === 0 && count > 10 && turned && respaced === 6 && back === count && gone === 0,
	count,
	gapMin: Math.min(...gaps),
	gapMax: Math.max(...gaps),
	turned,
	respaced,
	back,
	gone,
}

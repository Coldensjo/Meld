// Path tool's River (#167): Apply carves the bed along the curve and fills it with the liquid, its surface running downhill from the higher end, as one undo step that takes the bed and the liquid back.
// touches: frontend/src/lib/tools/PathTool.ts, frontend/src/lib/tools/pathApply.ts, frontend/src/lib/terrain/paths.ts, frontend/src/lib/water/Water.ts
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'path'
editor.pathKind = 'river'
await P.frames(1)
const V3 = e.controller.target.constructor
const t = e.terrain
const h0 = t.heightAt(256, 256)
const at = (x, z) => new V3(x, t.heightAt(x, z), z)
const tool = e.tools.path
const ev = new PointerEvent('pointerdown')
for (const [x, z] of [
	[150, 200],
	[250, 260],
	[360, 240],
]) {
	// Aim the press away from the dots, as a click on empty ground.
	e.ctx.raycaster.ray.origin.set(x, h0 + 1000, z + 1000)
	tool.onDown(e.ctx, at(x, z), ev)
	tool.onUp(e.ctx)
}
// The upstream end 6 yd higher: the surface falls from it to the far end.
e.path((tl, c) => {
	const p = editor.paths[0]
	editor.pathPoint = 0
	tl.setField(c, 'width', 14)
	tl.setField(c, 'depth', 3)
	editor.paths[0].points[0].y = h0 + 6
	return p
})
e.path((tl, c) => tl.apply(c))
await P.frames(2)
const liquids = e.doc.liquids
/** The surface of the liquid over world (x, z), or null. */
const surfaceAt = (x, z) => {
	const gx = Math.floor(x / t.cellSize),
		gz = Math.floor(z / t.cellSize)
	const c = Math.floor(gz / 8) * liquids.side + Math.floor(gx / 8)
	const l = liquids.layers(c).find((q) => q.cells[(gz % 8) * 8 + (gx % 8)])
	return l ? l.heights[(gz % 8) * 9 + (gx % 8)] : null
}
const p = editor.paths[0]
const kind = p.kind
const up = surfaceAt(160, 203)
const down = surfaceAt(350, 241)
const bed = t.heightAt(250, 260)
const off = t.heightAt(250, 300) - h0
await P.lookAt({ x: 250, y: h0, z: 250 }, { pitch: 0.6, back: 160 })
P.save(await P.shot(), 'applied')
e.history.undo()
await P.frames(1)
const emptied = liquids.empty
const flat = Math.abs(t.heightAt(250, 260) - h0) < 1e-3
return {
	ok: kind === 'river' && up !== null && down !== null && up > down && bed < (down ?? 0) && Math.abs(off) < 1e-3 && emptied && flat,
	kind,
	up,
	down,
	bed,
	off,
	emptied,
	flat,
}

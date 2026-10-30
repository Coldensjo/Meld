// Path tool (#167): clicks drop a road's points, a click on a point picks it and Shift+drag raises it, Apply levels and paints along the curve as one undo step, and applying again after an edit takes the first apply back. Then, each on a fresh flat map in the same page (once the probes path-river and path-fence): the River's Apply carves the bed along the curve and fills it with the liquid, its surface running downhill from the higher end, as one undo step that takes the bed and the liquid back; and the Fence's Apply stands a picked model end to end along the curve at its own length, each turned along the curve, as one undo step that removes them all, applying again after a change replacing them. And (#395) a road's, a river's and a fence's last applies saved through the Go side and read back: on the reopened map, with no history, applying each again after a change still takes the old road's hump, the old river bed and its liquid, and the old fence models back.
// touches: frontend/src/lib/tools/PathTool.ts, frontend/src/lib/tools/pathApply.ts, frontend/src/lib/terrain/paths.ts, frontend/src/components/PathEditBar.svelte, frontend/src/lib/water/Water.ts, frontend/src/lib/tools/pathRecord.ts, frontend/src/lib/io/mapData.ts, internal/mapfile/*
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'path'
await P.frames(1)
const V3 = e.controller.target.constructor
const h0 = e.terrain.heightAt(256, 256)
await P.lookAt({ x: 256, y: h0, z: 256 }, { pitch: 1.3, back: 260 })
/** Where a world point is on the viewport, as shares of it (y = 0 the top). */
const share = (x, y, z) => {
	const v = new V3(x, y, z).project(e.camera)
	return [(v.x + 1) / 2, (1 - v.y) / 2]
}
const close = (a, b, d = 0.05) => Math.abs(a - b) <= d

for (const [x, z] of [
	[190, 256],
	[256, 290],
	[322, 256],
])
	await P.click(...share(x, h0, z))
const drawn = editor.paths.length === 1 && editor.paths[0].points.length === 3
const steps = e.history.steps().map((s) => s.label)

// A click on the middle point picks it rather than adding one; Shift+drag up raises it.
const mid = editor.paths[0].points[1]
const at = share(mid.x, mid.y, mid.z)
await P.click(...at)
const picked = editor.pathPoint === 1 && editor.paths[0].points.length === 3
await P.drag(at, [at[0], at[1] - 0.1], 8, { shiftKey: true, movementY: -10 })
const raised = editor.paths[0].points[1].y - h0

const slot = e.useTexture('#a08050')
e.path((t, c) => t.setField(c, 'texture', editor.palette[slot]))
e.path((t, c) => t.setField(c, 'width', 10))
e.path((t, c) => t.apply(c))
await P.frames(1)
const t = e.terrain
const hump = t.heightAt(256, 290) - h0
const R = t.splatRes
const texel = Math.floor(290 / (t.worldSize / R)) * R + Math.floor(256 / (t.worldSize / R))
const chunk = Math.floor(texel / R / (R / t.paintChunksPerSide)) * t.paintChunksPerSide + Math.floor((texel % R) / (R / t.paintChunksPerSide))
const k = [...t.chunkSlots.slice(chunk * 4, chunk * 4 + 4)].indexOf(slot)
const painted = k >= 0 ? t.weights[texel * 4 + k] : 0
const offRoad = t.heightAt(256, 330) - h0
P.save(await P.shot(), 'applied')

// Deleting the raised point and applying again leaves a straight, level road: the hump goes.
editor.pathPoint = 1
e.path((t2, c) => t2.deletePoint(c))
e.path((t2, c) => t2.apply(c))
await P.frames(1)
const humpAfter = t.heightAt(256, 290) - h0
const lineAfter = t.heightAt(256, 256) - h0
const labels = e.history
	.steps()
	.map((s) => s.label)
	.slice(-2)
e.history.undo()
e.history.undo()
await P.frames(1)
const humpUndone = t.heightAt(256, 290) - h0
e.history.undo()
await P.frames(1)
const flatAgain = t.heightAt(256, 290) - h0
// The paths travel to the map file and back through mapData.ts (the Go side's round trip is mapfile_test).
const mapData = await P.app('/src/lib/io/mapData.ts')
const back = mapData.fromMapData(JSON.parse(JSON.stringify(mapData.toMapData(e.snapshot())))).paths
const saved = back.length === 1 && back[0].points.length === editor.paths[0].points.length && back[0].width === 10 && back[0].texture === editor.palette[slot]

// River (#167).
const river = await (async () => {
	e.newDocument(256, 'flat', 0, 'Probe')
	editor.tool = 'path'
	editor.pathKind = 'river'
	await P.frames(1)
	const V3 = e.controller.target.constructor
	const t = e.terrain
	const h0 = t.heightAt(256, 256)
	const at = (x, z) => new V3(x, t.heightAt(x, z), z)
	const tool = e.debug.tools.path
	const ev = new PointerEvent('pointerdown')
	for (const [x, z] of [
		[150, 200],
		[250, 260],
		[360, 240],
	]) {
		// Aim the press away from the dots, as a click on empty ground.
		e.debug.ctx.raycaster.ray.origin.set(x, h0 + 1000, z + 1000)
		tool.onDown(e.debug.ctx, at(x, z), ev)
		tool.onUp(e.debug.ctx)
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
	const liquids = e.debug.doc.liquids
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
	P.save(await P.shot(), 'river-applied')
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
})()

// Fence (#167).
const fence = await (async () => {
	e.newDocument(256, 'flat', 0, 'Probe')
	editor.tool = 'path'
	editor.pathKind = 'fence'
	await P.frames(1)
	const V3 = e.controller.target.constructor
	const t = e.terrain
	const h0 = t.heightAt(256, 256)
	const at = (x, z) => new V3(x, t.heightAt(x, z), z)
	const tool = e.debug.tools.path
	const ev = new PointerEvent('pointerdown')
	for (const [x, z] of [
		[200, 240],
		[256, 250],
		[310, 240],
	]) {
		e.debug.ctx.raycaster.ray.origin.set(x, h0 + 1000, z + 1000)
		tool.onDown(e.debug.ctx, at(x, z), ev)
		tool.onUp(e.debug.ctx)
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
	P.save(await P.shot(), 'fence-applied')
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
})()

// Reopened (#395): a road's, a river's and a fence's last applies are saved through the Go side and
// read back, so on the reopened map, which has no history, applying each again still takes the old one back.
const reopened = await (async () => {
	e.newDocument(256, 'flat', 0, 'Probe')
	editor.tool = 'path'
	await P.frames(1)
	const V3 = e.controller.target.constructor
	const t0 = e.terrain
	const h0 = t0.heightAt(256, 256)
	const tool = e.debug.tools.path
	const ev = new PointerEvent('pointerdown')
	/** Starts a path of `kind` through the points, as clicks on empty ground. */
	const lay = (kind, pts) => {
		tool.pick(-1)
		editor.pathKind = kind
		for (const [x, z] of pts) {
			e.debug.ctx.raycaster.ray.origin.set(x, h0 + 1000, z + 1000)
			tool.onDown(e.debug.ctx, new V3(x, t0.heightAt(x, z), z), ev)
			tool.onUp(e.debug.ctx)
		}
		return editor.pathId
	}
	const road = lay('road', [
		[150, 256],
		[256, 290],
		[360, 256],
	])
	editor.paths.find((p) => p.id === road).points[1].y = h0 + 8
	e.path((tl, c) => tl.apply(c))
	const river = lay('river', [
		[150, 120],
		[360, 120],
	])
	e.path((tl, c) => tl.setField(c, 'width', 14))
	e.path((tl, c) => tl.apply(c))
	const model = 'm2:World\\Azeroth\\Duskwood\\PassiveDoodads\\Fence\\DuskWoodFenceSegment.m2'
	const fence = lay('fence', [
		[200, 400],
		[310, 400],
	])
	e.path((tl, c) => tl.setField(c, 'model', model))
	await e.path((tl, c) => tl.apply(c))
	await P.frames(1)
	const hump = t0.heightAt(256, 290) - h0
	const fenceCount = e.objects.list().filter((o) => o.type === model).length
	const bedBefore = t0.heightAt(256, 120) - h0
	const { toMapData, fromMapData } = await P.app('/src/lib/io/mapData.ts')
	const App = window.go.main.App
	const raw = await App.LoadMap(await App.SaveSceneMap(toMapData(e.snapshot())))
	const blob = (raw.pathApplies ?? '').length
	e.openDocument(fromMapData(raw), '')
	editor.tool = 'path'
	await P.frames(1)
	const t = e.terrain
	const fresh = t !== t0 && e.history.steps().length === 0
	// The road straightened and applied again: the hump goes with the old apply.
	tool.pick(road)
	editor.pathPoint = 1
	e.path((tl, c) => tl.deletePoint(c))
	e.path((tl, c) => tl.apply(c))
	const humpAfter = t.heightAt(256, 290) - h0
	const roadLabel = e.history.peek()?.label
	// The river moved 40 yd south and applied again: its old bed and liquid go.
	tool.pick(river)
	const list = editor.paths.map((p) => (p.id === river ? { ...p, points: p.points.map((q) => ({ ...q, z: q.z + 40 })) } : p))
	editor.paths = list
	e.path((tl, c) => tl.apply(c))
	const oldBed = t.heightAt(256, 120) - h0
	const newBed = t.heightAt(256, 160) - h0
	const liquids = e.debug.doc.liquids
	const cell = (x, z) => {
		const gx = Math.floor(x / t.cellSize),
			gz = Math.floor(z / t.cellSize)
		return liquids.layers(Math.floor(gz / 8) * liquids.side + Math.floor(gx / 8)).some((l) => l.cells[(gz % 8) * 8 + (gx % 8)])
	}
	const oldWet = cell(256, 121)
	const newWet = cell(256, 161)
	// The fence at a wider spacing applied again replaces its models.
	tool.pick(fence)
	e.path((tl, c) => tl.setField(c, 'spacing', 20))
	await e.path((tl, c) => tl.apply(c))
	const respaced = e.objects.list().filter((o) => o.type === model).length
	// Undo of the fence's apply on the reopened map brings the saved models back.
	e.history.undo()
	const restored = e.objects.list().filter((o) => o.type === model).length
	return {
		ok:
			hump > 4 &&
			fenceCount > 10 &&
			bedBefore < -1 &&
			blob > 0 &&
			fresh &&
			close(humpAfter, 0) &&
			roadLabel === 'Apply Road 1 again' &&
			close(oldBed, 0) &&
			newBed < -1 &&
			!oldWet &&
			newWet &&
			respaced >= 4 &&
			respaced <= 7 &&
			restored === fenceCount,
		hump,
		fenceCount,
		bedBefore,
		blob,
		fresh,
		humpAfter,
		roadLabel,
		oldBed,
		newBed,
		oldWet,
		newWet,
		respaced,
		restored,
	}
})()

return {
	ok:
		reopened.ok &&
		river.ok &&
		fence.ok &&
		drawn &&
		picked &&
		raised > 5 &&
		hump > 4 &&
		painted > 200 &&
		close(offRoad, 0) &&
		close(humpAfter, 0) &&
		close(lineAfter, 0) &&
		close(humpUndone, hump) &&
		close(flatAgain, 0) &&
		saved &&
		labels[1] === 'Apply Road 1 again',
	drawn,
	steps,
	picked,
	raised,
	hump,
	painted,
	offRoad,
	humpAfter,
	lineAfter,
	labels,
	humpUndone,
	flatAgain,
	saved,
	river,
	fence,
	reopened,
}

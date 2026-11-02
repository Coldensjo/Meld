// Symmetry painting (#182): on a flat map, a Raise stroke with Mirror X leaves the heights the same on both sides of the centre and undoes in one step; Radial 4 gives four turned copies; a stroke along the axis merges its copies into one dab there (the same heights as one stroke on the axis with symmetry off, not twice as high); the Place tool puts a mirrored copy of a helper cube down in the same undo step, facing the mirrored way; the dashed guide shows while the tool is active; and a new map starts with symmetry off.
// touches: frontend/src/lib/tools/symmetry.ts, frontend/src/lib/tools/symmetryGuide.ts, frontend/src/lib/tools/BrushTool.ts, frontend/src/lib/tools/SculptTool.ts, frontend/src/lib/tools/PlaceTool.ts, frontend/src/components/options/SymmetryOptions.svelte, frontend/src/lib/engine/docMeta.ts
const e = P.e
const { editor, prefs } = await P.state()
const { selectObjects } = await P.app('/src/lib/state/selection.ts')
const before = {
	tool: editor.tool,
	prefab: editor.prefab,
	tilt: editor.placeRandomTilt,
	rot: editor.placeRandomRot,
	follow: editor.followGround,
	scatter: editor.placeScatter,
	fit: prefs.placeFitGround,
	radius: editor.brush.radius,
	strength: editor.brush.strength,
	mode: editor.sculptMode,
	image: editor.brushImage.name,
}
const bad = []
const r = {}
try {
	e.newDocument(128, 'flat', 0, 'Probe symmetry')
	if (editor.symmetry.mode !== 'off') bad.push(`a new map starts with symmetry ${editor.symmetry.mode}`)
	editor.tool = 'sculpt'
	editor.sculptMode = 'raise'
	editor.brush.radius = 9
	editor.brush.strength = 1
	editor.brushImage.name = ''
	await P.frames(1)
	const t = e.terrain
	const V = t.verts
	const c = t.size / 2
	const ws = t.worldSize
	const cs = t.cellSize
	const V3 = e.controller.target.constructor
	const at = (x, z) => new V3(x, t.heightAt(x, z), z)
	const tool = e.debug.tools.sculpt
	const ctx = e.debug.ctx
	const stroke = (x0, z0, dx, dz, n = 20) => {
		tool.onDown(ctx, at(x0, z0))
		for (let i = 0; i < n; i++) tool.tick(ctx, 0.05, at(x0 + dx * i, z0 + dz * i))
		tool.onUp(ctx)
	}
	const flat = () => {
		t.heights.fill(0)
		t.markDirty(0, 0, V - 1, V - 1)
	}
	/** The largest height difference between each vertex and its copy under `map` (vertex x, z to x, z). */
	const asym = (map) => {
		let worst = 0
		let changed = 0
		for (let z = 0; z < V; z++)
			for (let x = 0; x < V; x++) {
				const h = t.heights[z * V + x]
				if (h !== 0) changed++
				const [mx, mz] = map(x, z)
				if (mx < 0 || mz < 0 || mx >= V || mz >= V) continue
				worst = Math.max(worst, Math.abs(h - t.heights[mz * V + mx]))
			}
		return { worst, changed }
	}

	// Mirror X about the map's centre: vertex x goes to size - x.
	editor.symmetry = { mode: 'x', count: 4, center: null }
	await P.frames(2)
	const guide = e.symmetryGuide.lines
	r.guide = { visible: guide.visible, points: guide.geometry.getAttribute('position')?.count ?? 0 }
	if (!r.guide.visible || r.guide.points < 2) bad.push('the guide does not show with Mirror X on')
	const pos0 = e.history.position
	stroke(ws * 0.25, ws * 0.4, cs * 0.5, cs * 0.3)
	r.mirrorX = asym((x, z) => [t.size - x, z])
	if (r.mirrorX.changed === 0) bad.push('the Mirror X stroke changed nothing')
	if (r.mirrorX.worst > 1e-3) bad.push(`Mirror X leaves the sides ${r.mirrorX.worst} apart`)
	// Both sides raised: the copy's peak is as high as the stroke's.
	r.sides = [t.heightAt(ws * 0.25 + cs * 5, ws * 0.4 + cs * 3), t.heightAt(ws * 0.75 - cs * 5, ws * 0.4 + cs * 3)]
	if (!(r.sides[1] > 0.5)) bad.push(`the mirrored side rose only ${r.sides[1]}`)
	if (e.history.position !== pos0 + 1) bad.push(`the stroke took ${e.history.position - pos0} undo steps`)
	e.history.undo()
	await P.frames(1)
	if (t.heights.some((h) => h !== 0)) bad.push('one undo left heights changed')

	// Radial 4: a quarter turn takes (x, z) to (c + (z - c), c - (x - c)).
	flat()
	editor.symmetry = { mode: 'radial', count: 4, center: null }
	stroke(ws * 0.3, ws * 0.35, cs * 0.4, 0)
	r.radial = asym((x, z) => [c + (z - c), c - (x - c)])
	if (r.radial.changed === 0 || r.radial.worst > 1e-3) bad.push(`Radial 4 is off by ${r.radial.worst} (${r.radial.changed} changed)`)

	// Along the axis, one cell off it: the copies merge into one dab on the axis, so the heights equal one stroke on the axis without symmetry.
	flat()
	editor.symmetry = { mode: 'x', count: 4, center: null }
	stroke(ws / 2 + cs, ws * 0.3, 0, cs * 0.5)
	const merged = Float32Array.from(t.heights)
	flat()
	editor.symmetry = { mode: 'off', count: 4, center: null }
	stroke(ws / 2, ws * 0.3, 0, cs * 0.5)
	let mergeDiff = 0
	for (let i = 0; i < merged.length; i++) mergeDiff = Math.max(mergeDiff, Math.abs(merged[i] - t.heights[i]))
	r.mergeDiff = mergeDiff
	r.mergedPeak = Math.max(...merged)
	if (mergeDiff > 1e-4) bad.push(`the merged stroke differs from one on the axis by ${mergeDiff}`)
	await P.frames(1)
	if (e.symmetryGuide.lines.visible) bad.push('the guide still shows with symmetry off')

	// Place with Mirror X: the cube and its copy in one undo step, the copy turned the mirrored way.
	flat()
	prefs.placeFitGround = false
	editor.tool = 'place'
	editor.prefab = 'helper:cube:4'
	editor.placeRandomTilt = false
	editor.placeRandomRot = false
	editor.followGround = false
	editor.placeScatter = false
	editor.symmetry = { mode: 'x', count: 4, center: null }
	selectObjects(e.objects, [])
	await P.frames(1)
	await P.lookAt({ x: ws * 0.3, y: 0, z: ws * 0.5 }, { pitch: 0.9, back: 60 })
	await P.frames(2)
	e.placeTool.rotatePreview(0.5)
	const pos1 = e.history.position
	await P.click(0.5, 0.5, {}, 2)
	const placed = [...e.objects.objects.values()]
	r.placed = placed.map((o) => ({ x: +o.x.toFixed(2), z: +o.z.toFixed(2), rotY: +o.rotY.toFixed(3) }))
	if (placed.length !== 2) bad.push(`${placed.length} models after the click with Mirror X`)
	else {
		const [a, b] = placed
		if (Math.abs(a.x + b.x - ws) > 1e-6 || Math.abs(a.z - b.z) > 1e-6) bad.push('the copy is not mirrored across the centre')
		const sum = (((a.rotY + b.rotY) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
		if (Math.abs(sum - Math.PI) > 1e-6) bad.push(`the headings ${a.rotY} and ${b.rotY} are not mirrored (they should add up to a half turn)`)
	}
	if (e.history.position !== pos1 + 1) bad.push(`the placement took ${e.history.position - pos1} undo steps`)
	e.undo()
	await P.frames(1)
	if (e.objects.objects.size !== 0) bad.push(`${e.objects.objects.size} models left after one undo`)
} finally {
	editor.symmetry = { mode: 'off', count: 4, center: null }
	editor.tool = before.tool
	editor.prefab = before.prefab
	editor.placeRandomTilt = before.tilt
	editor.placeRandomRot = before.rot
	editor.followGround = before.follow
	editor.placeScatter = before.scatter
	prefs.placeFitGround = before.fit
	editor.brush.radius = before.radius
	editor.brush.strength = before.strength
	editor.sculptMode = before.mode
	editor.brushImage.name = before.image
}
return { ok: bad.length === 0, bad, ...r }

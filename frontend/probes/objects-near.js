// The layer's cells for "objects near a point" (#512): on the everything benchmark map, the Clear tool's models under the brush, the Doodad brush's spacing neighbours and prop list, the Select brush and the area's objects match a scan of every object, after the models loaded (a building's box only then reaching wide) and after a move; prints the ms a call.
// touches: frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/world/cellGrid.ts, frontend/src/lib/tools/ClearTool.ts, frontend/src/lib/tools/DoodadBrushTool.ts, frontend/src/lib/state/selection.ts
const map = await P.loadBenchMap('everything')
const e = P.e
const L = e.objects
const ctx = e.ctx
const { editor } = await P.state()
const sel = await P.app('/src/lib/state/selection.ts')
const V3 = e.camera.position.constructor
const roots = [...L.objects.values()].filter((o) => o.parent === undefined)
// A few props hung on models, so the attached path has something to find.
for (let i = 0; i < 20; i++) {
	const p = roots[i * 41]
	const c = L.add({ type: p.type, x: 0, z: 0, yOff: 0, rotY: 0, scale: 1 })
	L.place(c, p.id, { pos: L.worldPosition(p, new V3()).add(new V3(2, 1, 0)), rot: 0, scale: 0.5 })
}
editor.brush.radius = 25
editor.doodad.onProps = true
const clear = e.tools.clear
const doodad = e.tools.doodad
const xs = roots.map((o) => o.x)
const zs = roots.map((o) => o.z)
const minX = Math.min(...xs),
	maxX = Math.max(...xs),
	minZ = Math.min(...zs),
	maxZ = Math.max(...zs)
const K = 120
const hit = new V3()
const spot = (i) => hit.set(minX + ((maxX - minX) * ((i * 7919) % K)) / K, 0, minZ + ((maxZ - minZ) * ((i * 104729) % K)) / K)
const sorted = (s) => [...s].sort((a, b) => a - b).join(',')
const w = new V3()
const at = (o) => (o.parent === undefined ? w.set(o.x, 0, o.z) : L.worldPosition(o, w))

// What each caller found before #512: a scan of every object.
const scan = {
	clear(p, r) {
		const out = new Set()
		for (const o of L.objects.values()) if (o.parent === undefined && L.pickable(o.id) && (o.x - p.x) ** 2 + (o.z - p.z) ** 2 <= r * r) out.add(o.id)
		return L.descendantsOf(out)
	},
	props(p, reach) {
		const out = []
		for (const o of L.objects.values()) {
			const q = at(o)
			const r = reach + L.groundReach(o.type, L.worldScale(o))
			if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 <= r * r) out.push(o.id)
		}
		return out
	},
	near(p, reach) {
		let n = 0
		for (const o of L.objects.values()) {
			const q = at(o)
			if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 <= reach * reach) n++
		}
		return n
	},
	rect(p, h) {
		const out = []
		for (const o of L.objects.values()) {
			if (!L.pickable(o.id)) continue
			const q = at(o)
			if (q.x >= p.x - h && q.x <= p.x + h && q.z >= p.z - h && q.z <= p.z + h) out.push(o.id)
		}
		return out
	},
}

const ms = { clear: 0, gather: 0, props: 0, rect: 0 }
const bad = []
let found = 0
const round = (label) => {
	for (let i = 0; i < K; i++) {
		const p = spot(i)
		const ids = new Set()
		let t0 = performance.now()
		clear.modelsIn(L, p, ids)
		ms.clear += performance.now() - t0
		if (sorted(ids) !== sorted(scan.clear(p, 25))) bad.push(`${label} clear ${i}`)
		found += ids.size
		t0 = performance.now()
		doodad.gatherNear(ctx, p, 33)
		ms.gather += performance.now() - t0
		if (doodad.nearCount + doodad.nearOnCount !== scan.near(p, 33)) bad.push(`${label} gather ${i}`)
		doodad.propLayer = null
		t0 = performance.now()
		doodad.ensureProps(ctx, p.x, p.z)
		ms.props += performance.now() - t0
		if (sorted(doodad.props.slice(0, doodad.propCount)) !== sorted(scan.props(p, (25 + 8) * 1.5))) bad.push(`${label} props ${i}`)
		t0 = performance.now()
		const inRect = sel.objectsInRect(L, 1, { x0: p.x - 40, z0: p.z - 40, x1: p.x + 40, z1: p.z + 40 })
		ms.rect += performance.now() - t0
		if (sorted(inRect.map((o) => o.id)) !== sorted(scan.rect(p, 40))) bad.push(`${label} rect ${i}`)
	}
}
round('loaded')
// A drag of every tenth root, as the Select tool moves them: fields written, then a touch.
for (let i = 0; i < roots.length; i += 10) {
	roots[i].x += 30
	L.touch(roots[i].id)
}
round('moved')
for (let i = 0; i < roots.length; i += 10) {
	roots[i].x -= 30
	L.touch(roots[i].id)
}
const per = (v) => Math.round((v / (2 * K)) * 1000) / 1000
const wide = L.wide.size
if (bad.length) throw new Error(`the cells and the scan differ: ${bad.slice(0, 8).join('; ')}`)
if (!wide) throw new Error('no root reaches wide: the buildings should, once their models load')
return { objects: L.objects.size, wide, found: Math.round(found / (2 * K)), msCall: { clear: per(ms.clear), gather: per(ms.gather), props: per(ms.props), rect: per(ms.rect) } }

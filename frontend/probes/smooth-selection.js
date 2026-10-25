// Terrain › Smooth Selection (#713) on a Mountains map: over a selected square and over a lasso-style free-form area it smooths the ground inside (rougher before than after), leaves every vertex outside the area as it was, is one undo step that undo and redo restore exactly, fades in from the edge with the falloff on, and a cancelled run changes nothing.
// touches: frontend/src/lib/terrain/smoothArea.ts, frontend/src/components/SmoothAreaDialog.svelte, frontend/src/lib/state/areaSelection.ts
const e = P.e
const { editor } = await P.state()
const area = await P.app('/src/lib/state/areaSelection.ts')
e.newDocument(256, 'mountains', 3, 'Probe')
editor.tool = 'sculpt'
await P.frames(1)
const t = e.terrain
const V = t.verts
const diff = (a, b) => {
	let n = 0
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
	return n
}
/** The summed bend (second difference along x) over the vertices strictly inside the square `s`: bumps, not slopes. */
const rough = (h, s) => {
	let sum = 0
	for (let z = s.z0 + 1; z < s.z1; z++) for (let x = s.x0 + 2; x < s.x1 - 1; x++) sum += Math.abs(h[z * V + x + 1] - 2 * h[z * V + x] + h[z * V + x - 1])
	return sum
}
const sel = { x0: 100, z0: 100, x1: 160, z1: 160 }
// Noise of up to a yard over the square and around it, from a fixed seed, so there is something to smooth.
let seed = 7
for (let z = sel.z0 - 10; z <= sel.z1 + 10; z++) {
	for (let x = sel.x0 - 10; x <= sel.x1 + 10; x++) {
		seed = (seed * 1103515245 + 12345) >>> 0
		t.heights[z * V + x] += (seed / 2 ** 32 - 0.5) * 2
	}
}
t.markDirty(sel.x0 - 10, sel.z0 - 10, sel.x1 + 10, sel.z1 + 10)
await P.frames(1)

/** Smooths with `o` over the current area; how many vertices it changed, which vertices changed outside `inside(x, z)`, and how undo and redo went. */
async function run(o, inside) {
	const before = Float32Array.from(t.heights)
	let last = 0
	const finished = await e.smoothArea(
		o,
		(f) => (last = f),
		() => false,
	)
	await P.frames(1)
	const after = Float32Array.from(t.heights)
	let outside = 0
	for (let i = 0; i < after.length; i++) {
		if (after[i] === before[i]) continue
		if (!inside(i % V, Math.floor(i / V))) outside++
	}
	const label = e.history.peek()?.label
	e.history.undo()
	await P.frames(1)
	const undone = diff(before, t.heights)
	e.history.redo()
	await P.frames(1)
	const redone = diff(after, t.heights)
	e.history.undo()
	await P.frames(1)
	return { finished, progress: last, changed: diff(before, after), outside, label, undone, redone, before, after }
}

// A square, hard edge.
editor.selection = { ...sel }
await P.frames(1)
const inSquare = (x, z) => x > sel.x0 && z > sel.z0 && x < sel.x1 && z < sel.z1
const hard = await run({ strength: 0.5, passes: 10, falloff: false, width: 12 }, inSquare)
const roughBefore = rough(hard.before, sel)
const roughAfter = rough(hard.after, sel)
// With the falloff, the vertices next to the edge move less than half as far than with a hard edge.
const soft = await run({ strength: 0.5, passes: 10, falloff: true, width: 20 }, inSquare)
const edgeMove = (r) => {
	let s = 0
	for (let z = sel.z0 + 5; z < sel.z1 - 5; z++) s += Math.abs(r.after[z * V + sel.x0 + 1] - r.before[z * V + sel.x0 + 1])
	return s
}
const hardEdge = edgeMove(hard)
const softEdge = edgeMove(soft)

// A free-form area: the left half of the square's cells only, as a mask.
const size = t.size
const cells = new Uint8Array(size * size)
const INSIDE = 255
for (let z = sel.z0; z < sel.z1; z++) for (let x = sel.x0; x < sel.x0 + 30; x++) cells[z * size + x] = INSIDE
area.setAreaCells(t, size, cells)
await P.frames(1)
const inMask = (x, z) => x > sel.x0 && z > sel.z0 && x < sel.x0 + 30 && z < sel.z1
const masked = await run({ strength: 0.5, passes: 10, falloff: false, width: 12 }, inMask)

// Cancelled: nothing changes.
const beforeCancel = Float32Array.from(t.heights)
const cancelled = await e.smoothArea(
	{ strength: 1, passes: 50, falloff: false, width: 12 },
	() => {},
	() => true,
)
const afterCancel = diff(beforeCancel, t.heights)
editor.selection = null
await P.frames(1)

const good = (r) => r.finished && r.progress === 1 && r.changed > 300 && r.outside === 0 && r.undone === 0 && r.redone === 0 && r.label === 'Smooth selection'
const strip = ({ before, after, ...r }) => r
return {
	ok: good(hard) && good(soft) && good(masked) && roughAfter < roughBefore * 0.3 && softEdge < hardEdge * 0.5 && cancelled === false && afterCancel === 0,
	rough: { before: +roughBefore.toFixed(1), after: +roughAfter.toFixed(1) },
	edge: { hard: +hardEdge.toFixed(3), soft: +softEdge.toFixed(3) },
	hard: strip(hard),
	soft: strip(soft),
	masked: strip(masked),
	cancelled,
	afterCancel,
}

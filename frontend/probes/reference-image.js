// A reference image (#184) on a flat map: drawn over the ground and over the top-down view, dragged in it, turned into zones, heights, textures and the mask, each undone, and kept by the map's save data.
// touches: frontend/src/lib/terrain/referenceImage.ts, frontend/src/lib/io/referenceLoad.ts, frontend/src/components/ReferenceWindow.svelte
const e = P.e
const { editor, ui } = await P.state()
const { referenceFrom } = await P.app('/src/lib/io/referenceLoad.ts')
const { toMapData, fromMapData } = await P.app('/src/lib/io/mapData.ts')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const t = e.terrain
const ws = t.worldSize

// A plan 64 x 32: red on the left half, blue on the right.
const canvas = document.createElement('canvas')
canvas.width = 64
canvas.height = 32
const g = canvas.getContext('2d')
g.fillStyle = '#ff0000'
g.fillRect(0, 0, 32, 32)
g.fillStyle = '#0000ff'
g.fillRect(32, 0, 32, 32)
const img = referenceFrom('C:/plans/probe.png', canvas, 64, 32)
e.useReferenceImage(img)
e.setReference(e.referenceFor(img), 'Add reference image')
const placed = { ...editor.reference }
const fitted = placed.w === ws && placed.h === ws / 2 && placed.x === ws / 2 && placed.z === ws / 2

// The whole map from above.
ui.topDown = true
const c = e.controller
c.target.set(ws / 2, 0, ws / 2)
c.distance = ws * 0.95
c.yaw = 0
await P.frames(4)
/** The colour at shares (x, y) of the view, y = 0 the top. */
const at = (shot, x, y) => {
	const px = Math.floor(x * shot.w)
	const row = shot.h - 1 - Math.floor(y * shot.h)
	const i = (row * shot.w + px) * 4
	return [shot.px[i], shot.px[i + 1], shot.px[i + 2]]
}
editor.reference.opacity = 1
const on = await P.shot()
editor.reference.shown = false
const off = await P.shot()
editor.reference.shown = true
editor.reference.opacity = placed.opacity
const left = at(on, 0.4, 0.5)
const right = at(on, 0.6, 0.5)
const offLeft = at(off, 0.4, 0.5)
const changed = P.diff(on, off).off
const drawn = left[0] > 150 && left[2] < 80 && right[2] > 150 && right[0] < 80 && !(offLeft[0] > 150 && offLeft[2] < 80) && changed > 0.05

// Over the top-down view instead: the overlay element shows, and lays back where the ground one was.
e.setReference({ ...editor.reference, mode: 'screen' }, 'Reference image over the view')
await P.frames(1)
await new Promise((r) => setTimeout(r, 50))
const overlay = !!document.querySelector('[data-ui="ReferenceOverlay"]')
const fromScreen = e.referenceFromScreen()
const screenOk = !!fromScreen && Math.abs(fromScreen.w / fromScreen.h - 2) < 0.01 && Math.abs(fromScreen.x - ws / 2) < 1 && Math.abs(fromScreen.z - ws / 2) < 1
e.history.undo()
const backOnGround = editor.reference.mode === 'ground'

// Placing by dragging: a drag inside moves it by as much on the ground, one undo step.
ui.referenceAdjust = true
await P.frames(1)
const x0 = editor.reference.x
await P.drag([0.5, 0.5], [0.55, 0.5], 4)
const moved = editor.reference.x - x0
e.history.undo()
const dragUndone = editor.reference.x === x0
ui.referenceAdjust = false

// Zones: red is zone 12, blue zone 40, into the chunks under the image; undo clears them.
const colours = img.colours()
const red = colours.findIndex((k) => k.r > 200)
const blue = colours.findIndex((k) => k.b > 200)
const areaOf = colours.map((_, k) => (k === red ? 12 : k === blue ? 40 : 0))
e.referenceToZones(colours, areaOf, 40)
const side = t.paintChunksPerSide
const mid = Math.floor(side / 2)
const zoneLeft = t.areaIds[mid * side + 2]
const zoneRight = t.areaIds[mid * side + side - 3]
const zoneTop = t.areaIds[0]
e.history.undo()
const zonesUndone = t.areaIds.every((a) => a === 0)

// Heights: both colours are a third bright, so 0 to 30 sets 10 under the image; undo puts them back.
const before = t.heights.slice()
e.referenceToHeights(0, 30, 'set')
const V = t.verts
const hMid = t.heights[Math.floor(V / 2) * V + Math.floor(V / 2)]
const hEdge = t.heights[0]
e.history.undo()
const heightsUndone = t.heights.every((h, i) => h === before[i])

// Textures: red paints palette entry 1, blue entry 2, alone; undo puts the paint back.
const wBefore = t.weights.slice()
const sBefore = t.chunkSlots.slice()
e.referenceToTextures(
	colours,
	colours.map((_, k) => (k === red ? 1 : k === blue ? 2 : -1)),
	40,
)
const R = t.splatRes
const texel = Math.floor(R / 2) * R + Math.floor(R / 4)
const ch = Math.floor(R / 2 / (R / side)) * side + Math.floor(R / 4 / (R / side))
const k1 = [0, 1, 2, 3].find((k) => t.chunkSlots[ch * 4 + k] === 1)
const painted = k1 !== undefined && t.weights[texel * 4 + k1] === 255
e.history.undo()
const paintUndone = t.weights.every((w, i) => w === wBefore[i]) && t.chunkSlots.every((s, i) => s === sBefore[i])

// The mask: red's texels, a quarter of the map; undo empties it.
e.referenceToMask(
	colours,
	colours.map((_, k) => k === red),
	40,
)
const masked = t.mask.reduce((n, m) => n + (m ? 1 : 0), 0) / t.mask.length
e.history.undo()
const maskUndone = t.mask.every((m) => m === 0)

// The map's save data keeps the record (its path and place, not the picture).
const back = fromMapData(toMapData(e.snapshot())).reference
const saved = !!back && back.path === placed.path && back.w === placed.w && back.turn === placed.turn

// Removing it is one undo step too.
e.setReference(null, 'Remove reference image')
const removed = editor.reference === null
e.history.undo()
const restored = editor.reference?.path === placed.path
ui.topDown = false

const ok =
	fitted &&
	drawn &&
	overlay &&
	screenOk &&
	backOnGround &&
	moved > 1 &&
	dragUndone &&
	zoneLeft === 12 &&
	zoneRight === 40 &&
	zoneTop === 0 &&
	zonesUndone &&
	Math.abs(hMid - 10) < 0.01 &&
	hEdge === before[0] &&
	heightsUndone &&
	painted &&
	paintUndone &&
	Math.abs(masked - 0.25) < 0.02 &&
	maskUndone &&
	saved &&
	removed &&
	restored
return {
	ok,
	fitted,
	drawn,
	left,
	right,
	offLeft,
	changed,
	overlay,
	screenOk,
	fromScreen,
	backOnGround,
	moved,
	dragUndone,
	zoneLeft,
	zoneRight,
	zoneTop,
	zonesUndone,
	hMid,
	hEdge,
	heightsUndone,
	painted,
	paintUndone,
	masked,
	maskUndone,
	saved,
	removed,
	restored,
	colours: colours.length,
}

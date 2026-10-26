// A new world's tiles picked on the client's 64×64 grid (#46): in the Start dialog's New world the default 2×2 at tiles 31-32 loses its south-east tile to a Ctrl+click, and Create world makes an Island over the L of three, its coast following the tiles (the tile left out is seabed); the map remembers where it sits (tileX, tileY, the mask), the tile left out is not drawn or picked (a ray from above passes through it), the export writes the three tiles at their grid numbers, and Launch's spot is in the grid's frame. Map Properties' grid then adds the tile back (one undo step, undone and redone) and adds a tile two west of the square, which asks and grows the map to 4×4 tiles from tile 29: a model on the map keeps its server spot, and the map's heights there are the same. Nothing written.
// touches: frontend/src/components/NewMapDialog.svelte, frontend/src/components/TileGrid.svelte, frontend/src/components/MapPropertiesDialog.svelte, frontend/src/lib/terrain/tileMask.ts, frontend/src/lib/terrain/presets.ts, frontend/src/lib/terrain/Terrain.ts, frontend/src/lib/terrain/rayMarch.ts, frontend/src/lib/io/worldGrow.ts, frontend/src/lib/io/vmangosExport.ts, frontend/src/lib/io/portCoords.ts
const { ui } = await P.state()
const TILE = 1600 / 3
const r = {}

/** Presses tile (x, y) of the grid in `root` with the modifier keys `mods`. */
const press = (root, x, y, mods = {}) => {
	const c = root.querySelector('[data-tilegrid] canvas')
	const b = c.getBoundingClientRect()
	const at = { clientX: b.left + ((x + 0.5) * b.width) / 64, clientY: b.top + ((y + 0.5) * b.height) / 64, button: 0, pointerId: 7, bubbles: true }
	c.dispatchEvent(new PointerEvent('pointerdown', { ...at, ...mods }))
	c.dispatchEvent(new PointerEvent('pointerup', at))
}

ui.newMapMode = 'new'
ui.showNewDialog = true
const start = await P.until(() => (document.querySelector('[data-tilegrid] canvas') ? P.dialog('Start') : null), 10_000, 'the tile grid in the Start dialog')
r.first = start.querySelector('[data-tilegrid] .readout span')?.textContent.trim()
press(start, 32, 32, { ctrlKey: true })
await P.frames(1)
r.picked = start.querySelector('[data-tilegrid] .readout span')?.textContent.trim()
const name = start.querySelector('input[type=text]')
name.value = 'ProbeTiles'
name.dispatchEvent(new Event('input', { bubbles: true }))
;[...start.querySelectorAll('.preset')].find((b) => b.textContent.includes('Island')).click()
await P.frames(1)
;[...start.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
await P.until(() => P.e.activeVmangos()?.dir === 'ProbeTiles', 20_000, 'the new world')
await P.frames(3)
const e = P.e
const ref = e.activeVmangos()
r.ref = { tileX: ref.tileX, tileY: ref.tileY, tiles: ref.tiles }
const t = e.terrain
r.size = t.size / 128
// The tile left out: a hole to everything, seabed under the sea, and a ray from above passes it by.
const off = { x: 1.5 * TILE, z: 1.5 * TILE }
const on = { x: 0.5 * TILE, z: 0.5 * TILE }
r.offIsHole = t.isHole(off.x, off.z)
r.offHeight = +t.heightAt(off.x, off.z).toFixed(1)
// Three's Ray and Vector3, through the engine's own.
const Ray = e.raycaster.ray.constructor
const Vec = e.camera.position.constructor
const ray = (p) => t.raycast(new Ray(new Vec(p.x, 500, p.z), new Vec(0, -1, 0)), new Vec())
r.rayOff = ray(off)
r.rayOn = ray(on)
const { mapToTiles } = await P.app('/src/lib/io/vmangosExport.ts')
const { maskBytes } = await P.app('/src/lib/terrain/tileMask.ts')
const out = mapToTiles(e.exportInput(), { x: ref.tileX ?? 0, y: ref.tileY ?? 0, present: maskBytes(ref.tiles, r.size) })
r.exported = out.tiles.map((x) => `${x.X},${x.Y}`)
// Launch's spot over the first tile's middle, in the grid's frame: tile 31's corner is a tile short of the world's middle.
e.controller.setFollowGround(false)
e.controller.setView(on.x, 200, on.z, 0, 0.3, 10)
e.camera.position.set(on.x, 200, on.z)
const spot = await e.playerSpot()
r.spot = [+spot.x.toFixed(1), +spot.y.toFixed(1)]
r.spotOk = Math.abs(spot.x - (TILE - on.z)) < 0.5 && Math.abs(spot.y - (TILE - on.x)) < 0.5

// Map Properties: the tile added back, undone and redone, then a tile past the square grows the map.
const model = e.objects.add({ type: 'helper:cube', x: on.x, z: on.z, yOff: 0, rotY: 0, scale: 1 })
const groundBefore = +t.heightAt(on.x + 3, on.z + 5).toFixed(3)
const spotOf = async (o) => {
	const p = e.objects.worldPlacement(o).pos
	e.camera.position.set(p.x, 300, p.z)
	e.controller.setView(p.x, 300, p.z, 0, 0.3, 10)
	const s = await e.playerSpot()
	return [+s.x.toFixed(2), +s.y.toFixed(2)]
}
const modelSpot = await spotOf(model)
ui.dialog = 'mapProps'
const props = await P.until(() => (P.dialog('Map Properties')?.querySelector('[data-tilegrid] canvas') ? P.dialog('Map Properties') : null), 10_000, 'the tile grid in Map Properties')
press(props, 32, 32)
await P.frames(1)
r.addedBack = e.activeVmangos().tiles ?? 'every tile'
r.maskAfterAdd = e.terrain.tileMask === null
e.undo()
r.undone = e.activeVmangos().tiles
r.offAfterUndo = e.terrain.isHole(off.x, off.z)
e.redo()
r.redone = e.activeVmangos().tiles ?? 'every tile'
e.undo()
press(props, 29, 31)
const ask = await P.until(() => P.dialog('Grow the map?'), 10_000, 'the grow question')
ask.querySelector('[data-confirm="yes"]').click()
await P.until(() => P.e.terrain.size === 4 * 128, 20_000, 'the grown map')
await P.frames(3)
const g = P.e
const gref = g.activeVmangos()
r.grown = { tileX: gref.tileX, tileY: gref.tileY, tiles: gref.tiles, size: g.terrain.size / 128, sameRef: gref === ref }
const moved = [...g.objects.objects.values()].find((o) => o.type === 'helper:cube')
r.modelX = moved && +(moved.x - model.x).toFixed(2)
r.modelSpotKept = JSON.stringify(await spotOf(moved)) === JSON.stringify(modelSpot)
r.groundKept = +g.terrain.heightAt(on.x + 2 * TILE + 3, on.z + 5).toFixed(3) === groundBefore
r.dirty = (await P.state()).editor.dirty
ui.dialog = null
g.closeDocument(g.activeDocumentId())

r.ok =
	r.first === '4 tiles in 2×2 from 31, 31' &&
	r.picked === '3 tiles in 2×2 from 31, 31' &&
	r.ref.tileX === 31 &&
	r.ref.tileY === 31 &&
	r.ref.tiles === '1110' &&
	r.size === 2 &&
	r.offIsHole &&
	r.offHeight < 0 &&
	!r.rayOff &&
	r.rayOn &&
	r.exported.join(' ') === '31,31 32,31 31,32' &&
	r.spotOk &&
	r.addedBack === 'every tile' &&
	r.maskAfterAdd &&
	r.undone === '1110' &&
	r.offAfterUndo &&
	r.redone === 'every tile' &&
	r.grown.tileX === 29 &&
	r.grown.tileY === 31 &&
	r.grown.tiles === '1011001000000000' &&
	r.grown.size === 4 &&
	r.grown.sameRef &&
	Math.abs(r.modelX - 2 * TILE) < 0.01 &&
	r.modelSpotKept &&
	r.groundKept &&
	r.dirty
return r

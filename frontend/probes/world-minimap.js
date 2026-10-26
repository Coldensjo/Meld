// The minimap in a world view (#15): opening Azeroth's world view from Elwynn's block, the floating minimap is the map's client overview cut to the square of its tiles (worldExtent; the stand-in's heights hidden), with the camera's marker where the camera is and the block File › Edit Here would open outlined (blockAround); a click on another tile of the map flies the camera there, and once that tile has loaded the camera looks at its ground (flying, the camera's look point stands on it); Save Minimap Image's key (Ctrl+Shift+P) refuses in the world tab.
// touches: frontend/src/components/MinimapView.svelte, frontend/src/components/MinimapWindow.svelte, frontend/src/lib/world/worldMinimap.ts, frontend/src/lib/io/images.ts
const { ui, editor, prefs } = await P.state()
const e = P.e
const { openWorldView } = await P.app('/src/lib/io/region.ts')
const { worldExtent } = await P.app('/src/lib/world/worldMinimap.ts')
const { blockAround } = await P.app('/src/lib/world/teleport.ts')
const { tileKey } = await P.app('/src/lib/io/mapTiles.ts')
const T = 1600 / 3
const was = { docked: prefs.minimapDocked, minimap: ui.minimap }
prefs.minimapDocked = false
ui.minimap = true
openWorldView(e, 'Azeroth', { x: 31, y: 48, size: 3 })
await P.until(() => (editor.worldMap === 'Azeroth' && e.worldTiles()?.size ? true : null), 30000, "Azeroth's world tab and its tile list")
await P.until(() => (e.worldStats()?.loaded >= 1 ? true : null), 60000, 'the first tile')
const box = () => document.querySelector('aside[aria-label="Minimap"]')
const svg = await P.until(() => box()?.querySelector('svg[data-world="Azeroth"]'), 10000, "the world view's minimap")
const r = {}
const tiles = e.worldTiles()
const sq = worldExtent(tiles)
r.square = `${sq.x},${sq.y} ${sq.n}`
r.viewBox = svg.getAttribute('viewBox') === `${sq.x} ${sq.y} ${sq.n} ${sq.n}`
r.overview = (svg.querySelector('image')?.getAttribute('href') ?? '').includes('/wow/overview?map=Azeroth')
r.heightsHidden = box().querySelector('canvas').classList.contains('hidden')
r.title = box().querySelector('.title').textContent.trim()
const c = e.controller
const cam = () => box().querySelector('circle.camera')
/** How far the marker is from the camera's target, in tiles, once the 2 Hz stats have caught up. */
const markerOff = () => Math.hypot(+cam().getAttribute('cx') - c.target.x / T, +cam().getAttribute('cy') - c.target.z / T)
await P.until(() => (cam() && markerOff() < 0.01 ? true : null), 10000, 'the marker at the camera')
r.marker = true
const block = blockAround({ x: Math.floor(c.target.x / T), y: Math.floor(c.target.z / T) }, tiles, 3)
const rect = svg.querySelector('rect.block')
r.block = !!rect && +rect.getAttribute('x') === block.x && +rect.getAttribute('y') === block.y && +rect.getAttribute('width') === block.size

// A click on a tile of the map some way off (Redridge or the Burning Steppes) flies the camera there.
const dest = [
	[36, 50],
	[33, 44],
	[30, 53],
].find(([x, y]) => tiles.has(tileKey(x, y)))
const button = box().querySelector('button.map')
const b = button.getBoundingClientRect()
// A mouse event's position is in whole pixels, a sixth of a tile here: the point is the pixel's.
const px = Math.round(b.left + ((dest[0] + 0.5 - sq.x) / sq.n) * b.width)
const py = Math.round(b.top + ((dest[1] + 0.5 - sq.y) / sq.n) * b.height)
const to = { x: (sq.x + ((px - b.left) / b.width) * sq.n) * T, z: (sq.y + ((py - b.top) / b.height) * sq.n) * T }
button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: px, clientY: py }))
/** Where the camera looks, across the ground: flying, the target is the eye, its view's distance back from the point. */
const look = () => {
	if (prefs.followGround) return c.target.clone()
	const cp = Math.cos(c.pitch)
	return c.target.clone().sub({ x: Math.sin(c.yaw) * cp * c.distance, y: Math.sin(c.pitch) * c.distance, z: Math.cos(c.yaw) * cp * c.distance })
}
const l0 = look()
r.flew = Math.round(Math.hypot(l0.x - to.x, l0.z - to.z))
await P.until(() => (!Number.isNaN(e.doc.world.heightAt(to.x, to.z)) ? true : null), 60000, 'the tile clicked on loaded')
await P.frames(3)
const l1 = look()
const ground = e.doc.world.heightAt(to.x, to.z)
r.onGround = +(l1.y - ground).toFixed(2)
r.across = +Math.hypot(l1.x - to.x, l1.z - to.z).toFixed(2)

// Ctrl+Shift+P (Save Minimap Image) refuses: the world tab's terrain is a hidden stand-in.
ui.status = 'Ready'
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true, bubbles: true }))
await P.frames(2)
r.imageRefused = ui.status.includes('looked at, not edited')

prefs.minimapDocked = was.docked
ui.minimap = was.minimap
r.ok = r.viewBox && r.overview && r.heightsHidden && r.title === 'Minimap · Azeroth world' && r.marker && r.block && r.flew < 2 && Math.abs(r.onGround) < 0.5 && r.across < 2 && r.imageRefused
return r

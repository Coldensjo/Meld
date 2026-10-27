// Launch and Copy Teleport in a world view (#756): in Kalimdor's world view near Orgrimmar, Copy Teleport at the cursor (teleportAtCursor) gives `.go xyz ... 1` at the streamed ground under the cursor, not the hidden stand-in, and Launch's spot (playerSpot) and the tab's spot for another tab (spotOfDoc) stand on the streamed ground below the camera on map 1, in the whole map's frame (tile 0,0).
// touches: frontend/src/lib/engine/Engine.ts, frontend/src/lib/io/portCoords.ts
const { stats } = await P.app('/src/lib/state/editor.svelte.ts')
const { editor } = await P.state()
const e = P.e
const { openWorldView } = await P.app('/src/lib/io/region.ts')
const { serverSpot, editorPoint } = await P.app('/src/lib/io/portCoords.ts')
const T = 1600 / 3
openWorldView(e, 'Kalimdor', { x: 39, y: 27, size: 3 })
await P.until(() => (editor.worldMap === 'Kalimdor' ? true : null), 30000, "Kalimdor's world tab")
const world = e.doc.world
const s = { x: 40.3 * T, z: 28.6 * T }
await P.until(() => (!Number.isNaN(world.heightAt(s.x, s.z)) ? true : null), 120000, 'the tile under the spot')
const ground = world.heightAt(s.x, s.z)
await P.lookAt({ x: s.x, y: ground, z: s.z }, { pitch: 1.2, back: 120 })
const V3 = e.controller.target.constructor
const v = new V3(s.x, ground, s.z).project(e.camera)
const canvas = e.renderer.domElement
canvas.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
P.pointer('pointermove', (v.x + 1) / 2, (1 - v.y) / 2)
await P.until(() => (stats.cursor && Math.hypot(stats.cursor.x - s.x, stats.cursor.z - s.z) < 0.5 ? true : null), 20000, 'the cursor on the streamed ground')
const r = {}
const t = await e.teleportAtCursor()
r.teleport = t.command ?? t.error
const want = serverSpot({ x: s.x, y: ground, z: s.z }, 1)
const n = (r.teleport ?? '').match(/^\.go xyz (\S+) (\S+) (\S+) (\d+)$/)
r.teleportOk = !!n && n[4] === '1' && Math.abs(+n[1] - want.x) < 1 && Math.abs(+n[2] - want.y) < 1 && Math.abs(+n[3] - ground) < 1
const spot = await e.playerSpot()
r.spot = spot
// The spot's own ground, where it says it stands: the streamed height there, half a yard up.
const at = spot && editorPoint(spot)
r.spotOk = !!spot && spot.map === 1 && Math.abs(spot.z - 0.5 - world.heightAt(at.x, at.z)) < 0.05
const other = await e.spotOfDoc(e.doc.id)
r.docOk = !!other && other.map === 1 && other.x === spot?.x && other.y === spot?.y
r.ok = r.teleportOk && r.spotOk && r.docOk
return r

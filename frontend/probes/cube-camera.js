// Cube worlds' camera, minimap and Start dialog (#62): in a world tab the camera flies free with Follow the Ground and Camera Collision on, so it can go down through the layers; the status bar's layer follows it; the minimap draws the camera's layer from above and redraws after an edit; World Properties shows the world's facts; the Start dialog (Ctrl+N) makes a world.
const e = P.e
const { prefs, ui, stats } = await P.state()
const { CubeWorld, kindId } = await P.app('/src/lib/cubes/world.ts')
const { layerBottom } = await P.app('/src/lib/cubes/mesher.ts')

prefs.cameraFollowGround = true
prefs.cameraCollision = true
await P.frames(2)
const r = {}

e.openWorld(CubeWorld.create(2, 2, true), 'Camera world', '')
const worldId = e.activeDocumentId()
await P.frames(2)
const c = e.controller
r.freeInWorld = c.followGround === false && c.collision === false

// Fly down to layer 15 (stone): the camera stays where it is put, under the stand-in ground.
const y = layerBottom(15) + 1.5
c.setView(24, y, 24, 0, 0, 10)
await P.until(() => stats.cameraLayer === 15 || null, 3000, 'the status bar reading layer 15')
r.cameraLayer = stats.cameraLayer === 15
r.stayedDown = Math.abs(e.camera.position.y - y) < 1

// The minimap: the camera's layer from above, redrawn after an edit there.
ui.minimap = true
await P.until(() => (stats.view && stats.view.layer === 15) || null, 3000, 'the minimap view of layer 15')
await P.frames(2)
const canvas = document.querySelector('.minimap canvas')
r.minimapSize = !!canvas && canvas.width === 32 && canvas.height === 32
const px = (x, z) => Array.from(canvas.getContext('2d').getImageData(x, z, 1, 1).data)
const stone = px(3, 3)
const w = e.activeDocument().world
const { CubeChanges, chunksAround } = await P.app('/src/lib/cubes/edit.ts')
new CubeChanges(w).set(3, 3, 15, kindId('wood'))
e.activeDocument().cubes.rebuild(chunksAround(w, 3, 3, 15))
await P.until(() => (stats.view && stats.view.cubes > 0) || null, 3000, 'the minimap seeing the edit')
await P.frames(2)
const wood = px(3, 3)
r.minimapRedrawn = wood.join() !== stone.join() && wood[0] > wood[2]
r.minimapLayerTitle = !!document.querySelector('.minimap header')?.textContent?.includes('layer 15')
ui.minimap = false

// World Properties shows the world's size.
ui.dialog = 'mapProps'
await P.frames(2)
r.mapProps = !!document.querySelector('[role=dialog]')?.textContent?.includes('2 × 2 chunks')
ui.dialog = null

// The Start dialog opens on Ctrl+N and makes a world.
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
await P.frames(2)
r.startOpens = ui.showNewDialog
const create = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Create world')
create?.click()
await P.frames(2)
const made = e.activeDocument().world
r.startMade = !ui.showNewDialog && !!made && made.chunksX === 8 && e.activeDocumentId() !== worldId

return { ok: Object.values(r).every(Boolean), ...r }

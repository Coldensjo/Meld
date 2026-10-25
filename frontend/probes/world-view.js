// The world view (#15): opening Azeroth's from the Start dialog's block (Elwynn, 31-33 x 48-50) streams the client's tiles around the camera, nearest first, and looks at the block's middle once its tile is in; the ground is drawn (the view differs with the tiles hidden) and the camera rides it; flying four tiles east loads the tiles there and lets go of those left behind, so what is loaded stays bounded; the tools do nothing in it (a Sculpt click makes no undo step); the scene line names the world view; Edit Here opens the block around the camera in a region tab with the camera where it was (the region's coordinates are the world's less the block's corner), and File › World View from that region goes back to the world tab, the camera again where it was.
const { ui, editor } = await P.state()
const e = P.e
const { openWorldView, editWorldHere } = await P.app('/src/lib/io/mapio.ts')
const { streamReach, keepReach, wantedTiles } = await P.app('/src/lib/world/worldGround.ts')
const T = 1600 / 3
openWorldView(e, 'Azeroth', { x: 31, y: 48, size: 3 })
await P.until(() => editor.worldMap === 'Azeroth' || null, 30000, "Azeroth's world tab")
const worldId = e.activeDocumentId()
// The camera looks at the block's middle (tile 32_49's) once that tile has loaded.
const mid = { x: 32.5 * T, z: 49.5 * T }
await P.until(() => {
	const s = e.worldStats()
	return s && s.loaded >= 9 && !s.loading && !s.queued ? s : null
}, 120000, 'the tiles around the camera loaded')
await P.frames(3)
const c = e.controller
const first = e.worldStats()
const ground = e.doc.world.heightAt(mid.x, mid.z)
const focused = Math.abs(c.target.x - mid.x) < 600 && Math.abs(c.target.z - mid.z) < 600 && Number.isFinite(c.target.y)
// Every tile within the reach of the eye is loaded, and nothing else beyond a tile further.
const reach = streamReach(1)
const eye = e.camera.position
const want = wantedTiles(eye.x, eye.z, reach, e.worldTiles())
const loadedAll = first.loaded >= want.length && first.loaded <= wantedTiles(eye.x, eye.z, keepReach(reach), e.worldTiles()).length
// Drawn: the view with the tiles hidden differs.
await P.lookAt({ x: mid.x, y: ground + 120, z: mid.z + 300 }, { pitch: 0.35, back: 1 })
await P.settle()
const shown = await P.shot()
e.doc.world.group.visible = false
const hidden = await P.shot()
e.doc.world.group.visible = true
const drawn = +P.diff(shown, hidden).off.toFixed(3)
// A Sculpt click does nothing in a world view.
editor.tool = 'sculpt'
await P.frames(2)
await P.click(0.5, 0.6, {}, 3)
const noEdit = !e.history.peek() && !editor.dirty
editor.tool = 'select'
const scene = await window.__sceneText()
// Four tiles east: the tiles there load, the ones far behind go.
c.setView(c.target.x + 4 * T, c.target.y, c.target.z, c.yaw, c.pitch, c.distance)
const east = { x: c.target.x, z: c.target.z }
await P.until(() => {
	const s = e.worldStats()
	return s && !s.loading && !s.queued && !Number.isNaN(e.doc.world.heightAt(east.x, east.z)) ? s : null
}, 120000, 'the tiles four tiles east')
const moved = e.worldStats()
const westDropped = Number.isNaN(e.doc.world.heightAt(mid.x - 2 * T, mid.z))
// Edit Here: the block around the camera in a region tab (a project lent in the state, as instance-open does).
const hadProject = ui.project
ui.project = hadProject ?? { name: 'probe', path: '', clientPath: '' }
const before = { x: c.target.x, y: c.target.y, z: c.target.z }
await editWorldHere(e)
await P.until(() => (editor.regionMap === 'Azeroth' ? true : null), 180000, 'the region tab Edit Here opens')
const r = e.activeRegion()
const tile = { x: Math.floor(before.x / T), y: Math.floor(before.z / T) }
const holds = tile.x >= r.x && tile.x < r.x + r.size && tile.y >= r.y && tile.y < r.y + r.size
const regionCam = Math.hypot(c.target.x + r.x * T - before.x, c.target.z + r.y * T - before.z)
// And back to the world tab, the camera where the region had it.
openWorldView(e)
await P.frames(3)
const backToWorld = e.activeDocumentId() === worldId && editor.worldMap === 'Azeroth'
const worldCam = Math.hypot(c.target.x - before.x, c.target.z - before.z)
ui.project = hadProject
const out = {
	first,
	ground: +ground.toFixed(1),
	focused,
	loadedAll,
	drawn,
	noEdit,
	sceneNamesWorld: scene.includes('"world":{"mapName":"Azeroth"}'),
	moved,
	westDropped,
	region: `${r.x},${r.y} ${r.size}`,
	holds,
	regionCam: +regionCam.toFixed(2),
	backToWorld,
	worldCam: +worldCam.toFixed(2),
}
out.ok =
	focused &&
	Number.isFinite(ground) &&
	loadedAll &&
	drawn > 0.05 &&
	noEdit &&
	out.sceneNamesWorld &&
	moved.loaded <= first.tiles &&
	moved.loaded <= wantedTiles(east.x, east.z, keepReach(reach) + T, e.worldTiles()).length &&
	westDropped &&
	holds &&
	regionCam < 0.5 &&
	backToWorld &&
	worldCam < 0.5
return out

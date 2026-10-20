// The weather preview's splashes, wind and doorways (#244): heavy rain on Stormwind's map leaves splashes on the ground, heavy snow leaves settled flakes there (#316), a camera moving along +X leads the rain's box and tips the streaks' tails that way (and both settle when it stops), the rain shows whole on the Trade District's street (a 0x40 group), and from a shop (SI:7, group 113) only while a doorway onto the street is in view.
await P.scene(P.BENCH)
await P.settle()
const e = P.e
const { prefs, ui } = await P.state()
await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 300_000, 'the Stormwind batch')
const sw = [...e.objects.objects.values()].find((o) => o.type.includes('stormwind.wmo'))
const m = e.camera.matrixWorld.clone()
e.objects.matrixOf(sw, m)
prefs.cameraFollowGround = false
ui.weather = 'rain'
ui.weatherGrade = 'heavy'
const layer = e.weather
const out = {}

// Splashes on open ground near the bench view (no model within 12 yd), the camera low and still.
const THREE = await P.app('three')
const ray = new THREE.Raycaster()
const down = new THREE.Vector3(0, -1, 0)
const open = (x, z) => {
	const h = e.terrain.heightAt(x, z)
	for (const [dx, dz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) {
		ray.set(new THREE.Vector3(x + dx, h + 60, z + dz), down)
		const hit = e.objects.raycastSurface(ray)
		if (hit && hit.point.y > e.terrain.heightAt(x + dx, z + dz) + 0.3) return false
	}
	return true
}
let spot = null
for (let r = 0; r <= 200 && !spot; r += 20)
	for (let a = 0; a < 16 && !spot; a++) {
		const x = 182 + Math.cos((a / 16) * 2 * Math.PI) * r, z = 353 + Math.sin((a / 16) * 2 * Math.PI) * r
		if (e.terrain.contains(x, z) && open(x, z)) spot = [x, z]
	}
if (!spot) throw new Error('no open ground near the bench view')
const ground = e.camera.position.clone().set(spot[0], 0, spot[1])
ground.y = e.terrain.heightAt(ground.x, ground.z) + 1
e.setSceneView({ target: ground.toArray(), yaw: 0.5, pitch: 0.25, distance: 0.5, hour: 13 })
await P.until(() => layer.splash?.material.visible, 30_000, 'the splash texture')
await P.frames(3)
// The same frame drawn with and without the splashes.
const withSplash = await P.shot()
const bare = await P.shot(() => {
	layer.splash.visible = false
	e.renderer.render(e.scene, e.camera)
})
P.save(withSplash, 'splashes')
// The live splashes (this frame's: the probe's frames are slower than a splash's 0.25 s): on the ground or a model, never under the ground.
const live = () => {
	const a = layer.splash.geometry.getAttribute('splash').array
	const clock = Math.fround(layer.splash.material.uniforms.clock.value)
	const r = { live: 0, onTerrain: 0, onModels: 0, under: 0 }
	for (let i = 0; i < layer.splash.geometry.instanceCount; i++) {
		if (a[i * 4 + 3] !== clock) continue
		r.live++
		const d = a[i * 4 + 1] - 0.02 - e.terrain.heightAt(a[i * 4], a[i * 4 + 2])
		if (Math.abs(d) < 0.01) r.onTerrain++
		else if (d > 0) r.onModels++
		else r.under++
	}
	return r
}
out.splash = { spot: spot.map(Math.round), ...live(), drawn: P.diff(bare, withSplash, 2).off }

// Snow's settled flakes (#316) on the same ground: this frame's lie on the terrain, none under it, and they change pixels.
ui.weather = 'snow'
await P.until(() => layer.settled?.material.visible, 30_000, 'the settled flakes texture')
await P.frames(3)
const withSettled = await P.shot()
const unsettled = await P.shot(() => {
	layer.settled.visible = false
	e.renderer.render(e.scene, e.camera)
})
P.save(withSettled, 'settled-flakes')
const settled = { live: 0, onTerrain: 0, onModels: 0, under: 0, splashes: layer.splash.geometry.instanceCount }
{
	const a = layer.settled.geometry.getAttribute('ground').array
	const clock = Math.fround(layer.settled.material.uniforms.clock.value)
	for (let i = 0; i < layer.settled.geometry.drawRange.count; i++) {
		if (a[i * 4 + 3] !== clock) continue
		settled.live++
		const d = a[i * 4 + 1] - 0.05 - e.terrain.heightAt(a[i * 4], a[i * 4 + 2])
		if (Math.abs(d) < 0.01) settled.onTerrain++
		else if (d > 0) settled.onModels++
		else settled.under++
	}
}
out.settled = { ...settled, drawn: P.diff(unsettled, withSettled, 2).off }
ui.weather = 'rain'
await P.frames(2)
out.settled.goneInRain = layer.settled.geometry.drawRange.count === 0 && !layer.settled.visible

// The wind: 2 yd a frame along +X, then still.
const lead = () => layer.rain.material.uniforms.lead.value.clone()
const tipX = () => {
	const t = layer.rain.material.uniforms.tilt.value.elements
	// Where the tilt takes straight up: the matrix's second column (elements are column-major); its x.
	return t[3]
}
for (let i = 0; i < 8; i++) {
	ground.x += 2
	e.setSceneView({ target: ground.toArray(), yaw: 0.5, pitch: 0.25, distance: 0.5, hour: 13 })
	await P.frames(1)
}
const moving = { speed: +layer.wind.speed.toFixed(2), lead: +lead().x.toFixed(2), leadZ: +lead().z.toFixed(2), tipX: +tipX().toFixed(3) }
await P.frames(4)
const still = { speed: +layer.wind.speed.toFixed(3), lead: +lead().x.toFixed(3), tipX: +tipX().toFixed(3) }
out.wind = { moving, still }

// The rooms: the Trade District's street, then SI:7 facing its door and facing away.
await P.until(() => e.rooms.navs.get(sw.type.slice(4).toLowerCase()) || null, 60_000, "Stormwind's room data")
const nav = e.rooms.navs.get(sw.type.slice(4).toLowerCase())
const at = (local, yaw) => e.setSceneView({ target: e.camera.position.clone().set(...local).applyMatrix4(m).toArray(), yaw, pitch: 0.05, distance: 0.5, hour: 13 })
const state = async (name) => {
	await P.frames(3)
	const r = e.rooms.current
	out[name] = { group: r?.group ?? null, gate: layer.gateCount.value, visible: layer.group.visible }
}
at([-51, 3.78, -249.13], 5)
await P.frames(2)
await state('street')
// On the street the splashes land on Stormwind's streets and roofs once the probes reach their cells, a few a frame.
await P.frames(6)
out.street.splash = live()
const g = nav.groups[113]
const shop = [(g.min[0] + g.max[0]) / 2, g.min[2] + 2.5, -(g.min[1] + g.max[1]) / 2]
at(shop, 0)
await state('shopDoor')
// The same frame with and without the weather: it shows in the doorway (the left half), not on the room's wall (the right).
const inShop = await P.shot()
const dry = await P.shot(() => {
	layer.group.visible = false
	e.renderer.render(e.scene, e.camera)
})
P.save(inShop, 'shop-door')
out.shopDoor.door = P.diff(dry, inShop, 2, { x0: 0.2, x1: 0.48, y0: 0.2, y1: 0.9 }).off
out.shopDoor.wall = P.diff(dry, inShop, 2, { x0: 0.6, x1: 1, y0: 0, y1: 1 }).off
at(shop, 3.2)
await state('shopWall')
out.glError = P.glError()
ui.weather = 'clear'
await P.frames(1)
out.clearHidden = !layer.group.visible

out.ok =
	out.splash.live > 100 &&
	out.splash.onTerrain > out.splash.live / 2 &&
	out.splash.under === 0 &&
	out.splash.drawn > 0 &&
	out.settled.live > 100 &&
	out.settled.onTerrain > out.settled.live / 2 &&
	out.settled.under === 0 &&
	out.settled.splashes === 0 &&
	out.settled.drawn > 0 &&
	out.settled.goneInRain &&
	moving.speed > 1 &&
	moving.lead > 1 &&
	Math.abs(moving.leadZ) < 0.5 &&
	moving.tipX > 0.01 &&
	still.speed < 0.01 &&
	Math.abs(still.lead) < 0.01 &&
	out.street.group === 49 &&
	out.street.gate === -1 &&
	out.street.visible &&
	out.street.splash.onModels > 0 &&
	out.shopDoor.group === 113 &&
	out.shopDoor.gate > 0 &&
	out.shopDoor.visible &&
	out.shopDoor.door > 0.001 &&
	out.shopDoor.wall === 0 &&
	out.shopWall.group === 113 &&
	out.shopWall.gate === 0 &&
	!out.shopWall.visible &&
	!out.glError &&
	out.clearHidden
return out

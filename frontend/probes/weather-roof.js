// The weather through Stormwind's doorways (#244, #315): the rain shows whole on the Trade District's street (a 0x40 group), from a shop (SI:7, group 113) only while a doorway onto the street is in view, and from the street outside the shop's door the drops under its roof are hidden. Split from weather-wind (#420).
// touches: frontend/src/lib/world/WeatherLayer.ts, frontend/src/lib/world/WeatherRoof.ts, frontend/src/lib/wow/weather.ts
await P.scene(P.BENCH)
await P.settle()
const e = P.e
const { prefs, ui } = await P.state()
await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 120_000, 'the Stormwind batch')
const sw = [...e.objects.objects.values()].find((o) => o.type.includes('stormwind.wmo'))
const m = e.camera.matrixWorld.clone()
e.objects.matrixOf(sw, m)
prefs.cameraFollowGround = false
ui.weather = 'rain'
ui.weatherGrade = 'heavy'
const layer = e.debug.weather
const out = {}

const THREE = await P.app('three')
const { SPLASH_LIFE, SETTLE_LIFE } = await P.app('/src/lib/wow/weather.ts')
const landed = (part, name, n, lift, life) => {
	const a = part.geometry.getAttribute(name).array
	const clock = Math.fround(part.material.uniforms.clock.value)
	const r = { live: 0, onTerrain: 0, onModels: 0, under: 0 }
	for (let i = 0; i < n; i++) {
		const age = clock - a[i * 4 + 3]
		if (!(age >= 0 && age < life)) continue
		r.live++
		const x = a[i * 4],
			z = a[i * 4 + 2]
		const d = a[i * 4 + 1] - lift - e.terrain.heightAt(x, z)
		if (!e.terrain.contains(x, z) || e.terrain.isHole(x, z)) r.onModels++
		else if (Math.abs(d) < 0.01) r.onTerrain++
		else if (d > 0) r.onModels++
		else r.under++
	}
	return r
}
const live = () => landed(layer.splash, 'splash', layer.splash.geometry.instanceCount, 0.02, SPLASH_LIFE)

// The rooms: the Trade District's street, then SI:7 facing its door and facing away.
await P.until(() => e.debug.rooms.navs.get(sw.type.slice(4).toLowerCase()) || null, 60_000, "Stormwind's room data")
const nav = e.debug.rooms.navs.get(sw.type.slice(4).toLowerCase())
const at = (local, yaw) =>
	e.setSceneView({
		target: e.camera.position
			.clone()
			.set(...local)
			.applyMatrix4(m)
			.toArray(),
		yaw,
		pitch: 0.05,
		distance: 0.5,
		hour: 13,
	})
const state = async (name) => {
	await P.frames(3)
	const r = e.debug.rooms.current
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
// The wall's share is held to the noise floor, two shots of the same dry frame (swaying trees and particles differ between frames; as wmo-cull does).
const wallRect = { x0: 0.6, x1: 1, y0: 0, y1: 1 }
const dry2 = await P.shot(() => {
	layer.group.visible = false
	e.renderer.render(e.scene, e.camera)
})
out.shopDoor.wall = P.diff(dry, inShop, 2, wallRect).off
out.shopDoor.noise = P.diff(dry, dry2, 2, wallRect).off
at(shop, 3.2)
await state('shopWall')

// From the street outside SI:7's way out (group 118's portal onto the street, group 122, 6 yd out on
// the street's side), the drops under the shop's roof are hidden (#315): the shop's cells are roofed
// over its floor, and the same frames drawn with the roofs emptied have more drops in the doorway.
{
	const c = [-102.81, 9.03, 308.94]
	const n = [-0.961, 0, -0.275]
	const outside = new THREE.Vector3(c[0] + 6 * n[0], c[1], c[2] + 6 * n[2]).applyMatrix4(m)
	const look = new THREE.Vector3(-n[0], 0, -n[2]).transformDirection(m)
	e.setSceneView({ target: outside.toArray(), yaw: Math.atan2(-look.x, -look.z), pitch: 0, distance: 0.5, hour: 13 })
	const roof = layer.roof
	roof.budget = 50
	await P.until(() => roof.reach > 20, 120_000, 'the roofs within 20 yd')
	roof.budget = 1
	await P.frames(2)
	const { NO_ROOF } = await P.app('/src/lib/world/WeatherRoof.ts')
	const door = { x0: 0.42, x1: 0.58, y0: 0.25, y1: 0.7 }
	let hidden = 0
	for (let k = 0; k < 4; k++) {
		const roofed = await P.shot()
		const open = await P.shot(() => {
			const kept = roof.heights.slice()
			roof.heights.fill(NO_ROOF)
			roof.texture.needsUpdate = true
			e.renderer.render(e.scene, e.camera)
			roof.heights.set(kept)
			roof.texture.needsUpdate = true
		})
		if (k === 0) P.save(roofed, 'outside-door')
		hidden += P.diff(open, roofed, 2, door).off
	}
	const cells = { n: 0, roofed: 0 }
	for (const gi of [113, 118]) {
		const b = nav.groups[gi]
		for (let x = b.min[0] + 1.5; x <= b.max[0] - 1.5; x += 1)
			for (let y = b.min[1] + 1.5; y <= b.max[1] - 1.5; y += 1) {
				const w = new THREE.Vector3(x, b.min[2], -y).applyMatrix4(m)
				const r = roof.get(w.x, w.z)
				cells.n++
				if (r !== undefined && r > w.y + 2) cells.roofed++
			}
	}
	out.outsideDoor = { group: e.debug.rooms.current?.group ?? null, hidden: +hidden.toFixed(5), cells }
}

out.glError = P.glError()
ui.weather = 'clear'
await P.frames(1)
out.clearHidden = !layer.group.visible

out.ok =
	out.street.group === 49 &&
	out.street.gate === -1 &&
	out.street.visible &&
	out.street.splash.onModels > 0 &&
	out.street.splash.under === 0 &&
	out.shopDoor.group === 113 &&
	out.shopDoor.gate > 0 &&
	out.shopDoor.visible &&
	out.shopDoor.door > 0.001 &&
	out.shopDoor.wall <= out.shopDoor.noise + 0.002 &&
	out.shopWall.group === 113 &&
	out.shopWall.gate === 0 &&
	!out.shopWall.visible &&
	out.outsideDoor.group === 122 &&
	out.outsideDoor.hidden > 0 &&
	out.outsideDoor.cells.roofed > out.outsideDoor.cells.n * 0.8 &&
	!out.glError &&
	out.clearHidden
return out

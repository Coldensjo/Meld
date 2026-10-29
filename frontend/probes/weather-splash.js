// Heavy rain on the open ground west of Stormwind leaves splashes (#244) and heavy snow leaves settled flakes (#316): the live ones lie on the terrain or a model and never under it, they change pixels, and the flakes are gone in rain. Split from weather-wind (#420).
// touches: frontend/src/lib/world/WeatherLayer.ts, frontend/src/lib/wow/weather.ts
await P.scene(P.BENCH)
await P.settle()
const e = P.e
const { prefs, ui } = await P.state()
await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 120_000, 'the Stormwind batch')
prefs.cameraFollowGround = false
ui.weather = 'rain'
ui.weatherGrade = 'heavy'
const layer = e.debug.weather
const out = {}

// Splashes on open ground near the bench view (no model within 12 yd), the camera low and still.
const THREE = await P.app('three')
const ray = new THREE.Raycaster()
const down = new THREE.Vector3(0, -1, 0)
const open = (x, z) => {
	const h = e.terrain.heightAt(x, z)
	for (const [dx, dz] of [
		[0, 0],
		[12, 0],
		[-12, 0],
		[0, 12],
		[0, -12],
	]) {
		ray.set(new THREE.Vector3(x + dx, h + 60, z + dz), down)
		const hit = e.objects.raycastSurface(ray)
		if (hit && hit.point.y > e.terrain.heightAt(x + dx, z + dz) + 0.3) return false
	}
	return true
}
let spot = null
for (let r = 0; r <= 200 && !spot; r += 20)
	for (let a = 0; a < 16 && !spot; a++) {
		const x = 182 + Math.cos((a / 16) * 2 * Math.PI) * r,
			z = 353 + Math.sin((a / 16) * 2 * Math.PI) * r
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
// The live splashes (or settled flakes), born within their 0.25 s (#871: SwiftShader's frames are slower than that, so only
// this frame's live there, but the GPU's are 10 to 20 ms, a few each): on the ground or a model, never under the ground. Over
// a hole, or off the map's terrain (Stormwind's walls past its edge, where `heightAt` gives the edge's height, #872),
// they land on a model, which may lie under that height (a canal, a cellar).
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
out.splash = { spot: spot.map(Math.round), ...live(), drawn: P.diff(bare, withSplash, 2).off }

// Snow's settled flakes (#316) on the same ground: the live ones lie on the terrain, none under it, and they change pixels.
ui.weather = 'snow'
await P.until(() => layer.settled?.material.visible, 30_000, 'the settled flakes texture')
await P.frames(3)
const withSettled = await P.shot()
const unsettled = await P.shot(() => {
	layer.settled.visible = false
	e.renderer.render(e.scene, e.camera)
})
P.save(withSettled, 'settled-flakes')
const settled = { ...landed(layer.settled, 'ground', layer.settled.geometry.drawRange.count, 0.05, SETTLE_LIFE), splashes: layer.splash.geometry.instanceCount }
out.settled = { ...settled, drawn: P.diff(unsettled, withSettled, 2).off }
ui.weather = 'rain'
await P.frames(2)
out.settled.goneInRain = layer.settled.geometry.drawRange.count === 0 && !layer.settled.visible

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
	!out.glError &&
	out.clearHidden
return out

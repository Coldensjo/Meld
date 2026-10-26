// The sea's colour carries on across the map's edge (#748): on a flat map under 20 yd of sea, seen from above the west edge, the sea just inside and just outside the edge differ by little, and far out it is still the deep colour. Before #748 the sea outside stepped straight to the ocean's last, opaque row, a hard line along the edge. Patches the sea's shader back to that step and checks the probe sees it. Saves the view for each with `--shot`.
// touches: frontend/src/lib/water/liquidMaterial.ts, frontend/src/lib/water/Water.ts
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(2)
const t = e.terrain
const w = t.worldSize
const ground = t.heightAt(w * 0.25, w * 0.5)
editor.waterEnabled = true
editor.waterLevel = ground + 20
await P.fullView()
// Above the west edge on the middle row, looking down and east, as an orbit around the edge.
e.controller.setFollowGround(true)
e.controller.setView(0, editor.waterLevel, w * 0.5, -Math.PI / 2, 0.9, 600)
await P.settle()
await P.frames(10)
e.timer.setTimescale(0)

const THREE = await P.app('three')
const v = new THREE.Vector3()
/** The mean brightness of a 9 by 9 pixel box around the sea at world (x, z). */
const at = (img, x, z) => {
	v.set(x, editor.waterLevel, z).project(e.camera)
	const px = Math.round(((v.x + 1) / 2) * img.w)
	const py = Math.round(((v.y + 1) / 2) * img.h)
	if (px < 4 || py < 4 || px >= img.w - 4 || py >= img.h - 4) throw new Error(`(${x}, ${z}) is off the view`)
	let s = 0
	for (let y = py - 4; y <= py + 4; y++) for (let x2 = px - 4; x2 <= px + 4; x2++) s += img.px[(y * img.w + x2) * 4] + img.px[(y * img.w + x2) * 4 + 1] + img.px[(y * img.w + x2) * 4 + 2]
	return s / 81 / 3
}
// The sea near the view's top left corner: past the map's north edge and some 250 yd or more out.
const ray = new THREE.Raycaster()
ray.setFromCamera(new THREE.Vector2(-0.9, 0.85), e.camera)
const corner = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -editor.waterLevel), new THREE.Vector3())
if (!corner || corner.z > -250) return { ok: false, why: 'the view no longer reaches 250 yd past the north edge', corner: corner?.toArray() }
const look = async (label) => {
	const img = await P.shot()
	P.save(img, label)
	const inside = at(img, 6, w * 0.5)
	const outside = at(img, -6, w * 0.5)
	const far = at(img, corner.x, corner.z)
	return { inside: Math.round(inside), outside: Math.round(outside), far: Math.round(far), step: Math.round(Math.abs(inside - outside)) }
}
const r = { now: await look('fade') }
const m = e.water.material
const src = m.fragmentShader
const old = src.replace(/float past = [^;]+;/, 'float past = length(g - gc) * groundCell * 1e6;')
if (old === src) return { ok: false, why: 'the sea shader no longer holds float past', ...r }
m.fragmentShader = old
m.needsUpdate = true
await P.frames(2)
r.step = await look('step')
m.fragmentShader = src
m.needsUpdate = true
// Now the edge holds no step; the old shader's is plain; the sea still darkens away from the map.
r.ok = r.now.step <= 4 && r.step.step >= 3 * Math.max(r.now.step, 4) && r.now.far < r.now.inside - 5
return r

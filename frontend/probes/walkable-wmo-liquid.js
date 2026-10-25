// View › Walkable ground over Ironforge (Azeroth 33_41, #281): the WMO's forge lava, an MLIQ inside the building, is liquid area in the browser's build as in the server's mmaps, and of the same kind: slime, since the mmap builder reads the vmaps' LiquidType ID (3, magma) by its low two bits. The slime within 60 yd of the forge must cover over 1000 yd² in both and agree within 15% (3475 and 3357 yd² when written). Needs the VMaNGOS folder's data/mmaps for map 0, as walkable-server does.
// touches: frontend/src/lib/world/nav/*, internal/wow/wmoliquid.go, internal/wow/wmonav.go
const e = P.e
const { prefs } = await P.state()
await P.scene(
	'Meld scene {"v":1,"map":{"region":{"mapName":"Azeroth","x":33,"y":41,"size":1}},"view":{"target":[478,431,56],"yaw":0.5,"pitch":0.6,"distance":60,"hour":13},"prefs":{},"tool":"select","selectedIds":[],"selected":null,"area":null,"viewport":[1000,600]}',
)
await P.settle()
const nav = e.nav
const c = e.controller.target.clone()
const loaded = (what) =>
	P.until(
		() => {
			const k = nav.counts
			return k.total > 0 && k.done === k.total && k.loading === 0 && !k.settling && k
		},
		120_000,
		what,
	)
const v = c.clone()
const a = c.clone(),
	b = c.clone(),
	d = c.clone()
const measure = () => {
	nav.group.updateMatrixWorld(true)
	const out = { slime: 0, water: 0, magma: 0, near: 0 }
	nav.group.traverse((m) => {
		if (!m.isMesh || !m.geometry.attributes.color) return
		const p = m.geometry.attributes.position
		const col = m.geometry.attributes.color
		for (let i = 0; i < p.count; i += 3) {
			a.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)
			if (Math.abs(a.x - c.x) > 60 || Math.abs(a.z - c.z) > 60) continue
			b.fromBufferAttribute(p, i + 1).applyMatrix4(m.matrixWorld)
			d.fromBufferAttribute(p, i + 2).applyMatrix4(m.matrixWorld)
			const area = b.sub(a).cross(d.sub(a)).length() / 2
			const r = col.getX(i),
				g = col.getY(i),
				bl = col.getZ(i)
			out.near += area
			if (r > 0.5 && g > 0.6 && bl < 0.2) out.slime += area
			else if (bl > 0.7 && r < 0.3) out.water += area
			else if (r > 0.6 && g < 0.3) out.magma += area
		}
	})
	for (const k in out) out[k] = Math.round(out[k])
	return out
}
prefs.navView = true
prefs.navServer = false
const t0 = performance.now()
await loaded('the browser build')
const buildS = Math.round((performance.now() - t0) / 1000)
const browser = measure()
prefs.navServer = true
await P.frames(2)
await loaded("the server's tiles")
const server = measure()
prefs.navView = false
prefs.navServer = false
await P.frames(2)
const ok = browser.slime > 1000 && server.slime > 1000 && Math.abs(browser.slime - server.slime) < 0.15 * server.slime && browser.magma === 0
return { ok, buildS, browser, server }

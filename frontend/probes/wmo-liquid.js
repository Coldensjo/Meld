// A WMO's liquids (#287): Blackrock Depths' lava (its groups' MLIQ) is drawn, instanced with the dungeon, as the client's magma: the frame's orange, opaque, over the lava pools, and gone with the liquids' material hidden.
// touches: frontend/src/lib/water/liquidMaterial.ts, frontend/src/lib/world/ObjectLayer.ts, internal/wow/wmoliquid.go
const { editor } = await P.state()
const { openWowBuilding } = await P.app('/src/lib/io/region.ts')
const { wmoLiquidMaterial } = await P.app('/src/lib/water/liquidMaterial.ts')
openWowBuilding(P.e, 'BlackrockDepths')
await P.until(() => editor.regionMap === 'BlackrockDepths' || null, 120000, "Blackrock Depths' tab")
const e = P.e
const key = () => [...e.objects.batches.keys()].find((k) => k.includes('blackrock_lower_instance.wmo'))
await P.until(() => (key() && e.objects.batches.get(key()).liquid) || null, 180000, "the dungeon's lava")
await P.fullView()
const b = e.objects.batches.get(key())
const g = b.liquid.geometry
// A lava vertex in the world, through the dungeon's placement.
const pos = g.attributes.position.array
const m = b.rows.matrices
const idx = g.index.array
const vi = idx[Math.floor(idx.length / 6) * 3]
const x = pos[vi * 3]
const y = pos[vi * 3 + 1]
const z = pos[vi * 3 + 2]
const p = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
// 10 yards over the lava, looking down across it.
e.setSceneView({ target: [p[0], p[1] + 10, p[2]], yaw: 0, pitch: 0.5, distance: 30, hour: 13 })
await P.settle()
await P.frames(3)
const a = await P.shot()
P.save(a, 'lava')
const mat = wmoLiquidMaterial()
mat.visible = false
let bare
try {
	bare = await P.shot()
} finally {
	mat.visible = true
}
const below = { x0: 0.3, x1: 0.7, y0: 0.6, y1: 0.95 }
const d = P.diff(a, bare, undefined, below)
// The mean colour below the horizon: the lava's orange.
const { x0, x1, y0, y1 } = P.rect(a, below)
const sum = [0, 0, 0]
for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) for (let c = 0; c < 3; c++) sum[c] += a.px[(yy * a.w + xx) * 4 + c]
const n = (x1 - x0) * (y1 - y0)
const rgb = sum.map((s) => Math.round(s / n))
const out = {
	triangles: idx.length / 3,
	instances: b.liquid.count,
	magmaFrame: mat.uniforms.magmaTex.value.image?.width ?? 0,
	differs: +(d.off * 100).toFixed(1) + '%',
	rgb,
	glErrors: P.glError(),
}
out.ok = out.triangles > 1000 && out.instances === 1 && out.magmaFrame > 1 && d.off > 0.8 && rgb[0] > 100 && rgb[0] > 2 * rgb[2] && out.glErrors === 0
return out

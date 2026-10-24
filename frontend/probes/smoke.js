// The world format's fixture (crates/world/tests/fixtures/small.world) opens, its chunks are built, and it draws with no WebGL or page errors. Paths are relative to the Go process, which runs in editor/.
const e = P.e
if (!window.go?.main?.App?.LoadWorld) throw new Error('no Go bindings on the page (cube worlds need the backend)')
const mapio = await P.app('/src/lib/io/mapio.ts')
await mapio.openPath(e, '../crates/world/tests/fixtures/small.world')
const d = e.activeDocument()
if (!d?.world) return { ok: false, opened: false }
await P.until(() => d.cubes.pending === 0, 60_000, 'the chunks built')
await P.lookAt({ x: 16, y: 3, z: 16 }, { pitch: 0.8, back: 40 })
P.glError()
await P.frames(3)
const r = e.renderer.info.render
const gl = P.glError()
return {
	ok: gl === 0 && r.triangles > 0,
	triangles: r.triangles,
	calls: r.calls,
	glErrors: gl,
}

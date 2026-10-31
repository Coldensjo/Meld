// P.viewSpawn (#983): frames a Young Wolf of Northshire from a flat map with nothing loaded (it loads P.BENCH's region), and the wolf's batch has instances in the camera's view; needs the world database.
// touches: frontend/probes/lib.js
const e = P.e
const { prefs } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const s = await P.viewSpawn('Young Wolf')
const layer = window.__engine.activeDocument().spawnLayer
await P.settle()
const t = window.__engine.controller.target
const inView = layer.group.children.reduce((n, m) => n + (m.visible ? m.count : 0), 0)
const res = { name: s.name, objectsHidden: prefs.showObjects === false, follow: prefs.cameraFollowGround === true, near: Math.hypot(t.x - s.x, t.z - s.z), inView }
return { ok: /young wolf/i.test(s.name) && res.objectsHidden && res.follow && res.near < 5 && inView > 0, ...res }

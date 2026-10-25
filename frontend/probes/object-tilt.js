// A tilted game object keeps its tilt (#229): the Sunken Chest (guid 42485) is read with its tilt, drawn tilted as its quaternion says, and a move writes its rotation0..3 back unchanged.
// touches: frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/world/spawnEdits.ts, frontend/src/lib/world/spawnTilt.ts, internal/vmangos/spawns.go, internal/vmangos/spawnedit.go
const e = P.e
const { spawnKey } = await P.app('/src/lib/world/SpawnLayer.ts')
const se = await P.app('/src/lib/world/spawnEdits.ts')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
// Server (-9366.48, -2472.26) on Azeroth lies in tile (36, 49).
const spawns = await window.go.main.App.LoadSpawns('Azeroth', 36, 49, 1)
const chest = spawns.find((s) => s.kind === 'object' && s.guid === 42485)
if (!chest) return { ok: false, why: 'the world database lacks gameobject 42485' }
const tilt = chest.tilt ?? []
const layer = e.activeDocument().spawnLayer
layer.set([chest])
const key = spawnKey(chest)
let up = null
await P.until(
	() => {
		layer.forEachModel((k, _type, m) => {
			if (k !== key) return
			// The model's up axis (its mesh's +Y) as drawn, scale taken out.
			const el = m.elements
			const len = Math.hypot(el[4], el[5], el[6])
			up = [el[4] / len, el[5] / len, el[6] / len]
		})
		return up !== null
	},
	60_000,
	'the chest model',
)
// The server's quaternion turns its up axis (0, 0, 1) to this, in the editor's axes (-y, z, -x).
const [x, y, z, w] = [-0.118706, -0.071149, 0.899253, -0.414959]
const n = Math.hypot(x, y, z, w)
const [qx, qy, qz, qw] = [x / n, y / n, z / n, w / n]
const sUp = [2 * (qx * qz + qw * qy), 2 * (qy * qz - qw * qx), 1 - 2 * (qx * qx + qy * qy)]
const want = [-sUp[1], sUp[2], -sUp[0]]
const upError = Math.hypot(up[0] - want[0], up[1] - want[1], up[2] - want[2])
// Moving it writes the rotation unchanged.
P.e.history.push(se.spawnChange(layer, key, { x: chest.x + 2 }, 'Move spawn'))
const sql = await window.go.main.App.SpawnEditSQL('Azeroth', 36, 49, 1, layer.edits())
e.undo()
return {
	ok: tilt.length === 4 && upError < 1e-3 && up[1] < 0.99 && sql.sql.includes('`rotation0` = -0.118706, `rotation1` = -0.071149, `rotation2` = 0.899253, `rotation3` = -0.414959,') && layer.edits().length === 0,
	tilt,
	up,
	want,
	sql: sql.sql.split('\n').find((l) => l.startsWith('UPDATE')),
}

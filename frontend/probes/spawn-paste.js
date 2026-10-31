// Area copy and paste carries the spawns (#964): a camp of a formation with a path and a pool of two veins, copied with the ground, pastes turned as new spawns with new guids (above the database's), a new leader and pool, its path moved and turned, one undo step; pasted into another tab too, with guids of its own; the SQL inserts the new rows.
// touches: frontend/src/lib/world/clipSpawns.ts, frontend/src/lib/world/clipboard.ts, frontend/src/lib/world/clipRotate.ts, frontend/src/components/options/SelectOptions.svelte
const e = P.e
const { editor, ui } = await P.state()
const se = await P.app('/src/lib/world/spawnEdits.ts')
const App = window.go.main.App

const src = e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(2)
const cs = e.terrain.cellSize
const look = { model: '', look: '', anim: 0, displayScale: 1 }
const t = (entry, name) => ({ entry, name, subname: '', levelMin: 5, levelMax: 5, faction: 14, npcFlags: 0, rank: 0, type: 7, display: 0, scale: 1, equipment: 0, model: '', look: '', displayScale: 1 })
const vein = (guid, x) => se.newObjectSpawn({ entry: 1731, name: 'Copper Vein', type: 3, display: 0, model: '', size: 1 }, guid, x, 0, 30 * cs, 0)
// Guids far above the database's, so nothing here could name a real spawn.
const leader = se.newCreatureSpawn(t(38, 'Defias Thug'), 9_000_001, 20 * cs, 0, 20 * cs, 0, look)
Object.assign(leader, { leader: 9_000_001, groupFlags: 3, movementType: 2, waypoints: [se.newWaypoint(25 * cs, 0, 20 * cs), { ...se.newWaypoint(25 * cs, 0, 25 * cs), orientation: 1 }] })
const follower = se.newCreatureSpawn(t(38, 'Defias Thug'), 9_000_002, 20 * cs, 0, 20 * cs + 3, 0, look)
Object.assign(follower, { leader: 9_000_001, followDist: 3, followAngle: Math.PI, groupFlags: 3 })
const pool = { pool: 60_000, poolLimit: 1, poolName: 'Probe veins' }
const veins = [Object.assign(vein(9_000_101, 22 * cs), pool), Object.assign(vein(9_000_102, 24 * cs), pool)]
const outside = se.newCreatureSpawn(t(38, 'Defias Thug'), 9_000_003, 100 * cs, 0, 100 * cs, 0, look)
const layer = src.spawnLayer
layer.set([leader, follower, ...veins, outside])
se.syncSpawnUi(layer, true)

// Copy the 20 by 20 cells at (15, 15) with the Select tool's area.
editor.selection = { x0: 15, z0: 15, x1: 35, z1: 35 }
e.copySelection()
const status = ui.status ?? ''
const copied = Number(status.match(/(\d+) spawns/)?.[1] ?? -1)

/** Pastes the clip turned a quarter turn with its corner at cell (px, pz) of the active tab, and waits for the guids. */
async function paste(px, pz, turn) {
	e.startPaste()
	if (turn) e.rotateClip()
	e.selectTool.pasteAt = { x: px, z: pz }
	editor.paste.spawns = true
	e.commitPaste()
	for (let i = 0; i < 100 && ui.pasting; i++) await P.frames(2)
}

const before = layer.spawns.length
await paste(150, 150, true)
const added = layer.spawns.slice(before)
const by = (name, kind) => added.filter((s) => s.name === name && (kind ? s.kind === kind : true))
const [pl, pf] = by('Defias Thug')
const pv = by('Copper Vein')
const dbNext = await App.NextCreatureGUID()
// The leader stood 5 cells in at (5, 5) of a 20-cell clip: turned, at (5, 15) of it.
const pasted = {
	count: added.length,
	newGuids: added.every((s) => ![9_000_001, 9_000_002, 9_000_101, 9_000_102].includes(s.guid)),
	aboveDb: pl ? pl.guid >= dbNext : false,
	leaderAt: pl ? [Math.round(pl.x / cs - 150), Math.round(pl.z / cs - 150)] : null,
	facing: pl ? Math.round((pl.orientation * 180) / Math.PI) : null,
	path: pl ? pl.waypoints.map((p) => [Math.round(p.x / cs - 150), Math.round(p.z / cs - 150), Math.round((p.orientation * 180) / Math.PI)]) : null,
	formation: !!pl && !!pf && pl.leader === pl.guid && pf.leader === pl.guid && pf.followDist === 3,
	slot: pl && pf ? Math.round(Math.hypot(pf.x - pl.x, pf.z - pl.z) * 100) / 100 : null,
	pool: pv.length === 2 && pv[0].pool > 0 && pv[0].pool !== 60_000 && pv[1].pool === pv[0].pool,
	sourceKept: leader.guid === 9_000_001 && leader.x === 20 * cs && follower.leader === 9_000_001,
}
const sql = (await App.SpawnEditSQL('Azeroth', 32, 48, 1, layer.edits())).sql
const wrote = {
	creatures: (sql.match(/INSERT INTO `creature` /g) ?? []).length,
	path: !!pl && sql.includes(`(${pl.guid}, 1,`) && sql.includes(`(${pl.guid}, 2,`),
	pool: pv[0] ? sql.includes(`SELECT ${pv[0].pool}, 1,`) && (sql.match(/INSERT INTO `pool_gameobject`/g) ?? []).length === 2 : false,
	groups: (sql.match(/REPLACE INTO `creature_groups`/g) ?? []).length,
}

// One undo step takes the paste back, ground and spawns.
e.undo()
await P.frames(1)
const undone = layer.spawns.length === before
e.redo()
await P.frames(1)
const redone = layer.spawns.length === before + added.length

// Into another tab: new spawns with guids of their own, on that tab only.
const other = e.newDocument(256, 'flat', 0, 'Other')
await P.frames(2)
await paste(10, 10, false)
const there = other.spawnLayer.spawns
const otherTab = {
	count: there.length,
	own: there.every((s) => !layer.spawns.some((o) => o.kind === s.kind && o.guid === s.guid)),
	sourceCount: layer.spawns.length === before + added.length,
}
editor.selection = null
for (const d of [src, other]) {
	d.spawnLayer.set([])
	e.closeDocument(d.id)
}
await P.frames(2)
return {
	ok:
		copied === 4 &&
		pasted.count === 4 &&
		pasted.newGuids &&
		pasted.aboveDb &&
		JSON.stringify(pasted.leaderAt) === '[5,15]' &&
		pasted.facing === 90 &&
		JSON.stringify(pasted.path) === '[[5,10,0],[10,10,147]]' &&
		pasted.formation &&
		pasted.slot === 3 &&
		pasted.pool &&
		pasted.sourceKept &&
		wrote.creatures === 2 &&
		wrote.path &&
		wrote.pool &&
		wrote.groups === 2 &&
		undone &&
		redone &&
		otherTab.count === 4 &&
		otherTab.own &&
		otherTab.sourceCount,
	copied,
	status,
	pasted,
	wrote,
	undone,
	redone,
	otherTab,
}

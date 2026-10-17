// Formations and spawn pools (#172): the server's are read with their slots, limits and mother pools; a formation and a pool built by clicks on the map draw their lines and rings, write creature_groups and pool rows in the SQL, a dragged follower takes its slot, and undo takes it all back.
const e = P.e
const { editor, prefs, ui } = await P.state()
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { spawnKey } = await P.app('/src/lib/world/SpawnLayer.ts')
const App = window.go.main.App

// What the database has: Elwynn's patrols (tile 30, 48) and Redridge's master pools of vein spots (36, 48).
const elwynn = await App.LoadSpawns('Azeroth', 30, 48, 1)
const redridge = await App.LoadSpawns('Azeroth', 36, 48, 1)
const read = {
	leaders: elwynn.filter((s) => s.leader && s.leader === s.guid).length,
	followers: elwynn.filter((s) => s.leader && s.leader !== s.guid && s.followDist > 0).length,
	pooled: redridge.filter((s) => s.pool).length,
	inMother: redridge.filter((s) => s.motherPool && s.motherLimit > 0 && s.motherSize > 1 && s.motherName).length,
	elsewhere: redridge.some((s) => s.poolElsewhere > 0),
}

e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const look = { model: '', look: '', anim: 0, displayScale: 1 }
const t = (entry, name) => ({ entry, name, subname: '', levelMin: 5, levelMax: 5, faction: 14, npcFlags: 0, rank: 0, type: 7, display: 0, scale: 1, equipment: 0, model: '', look: '', displayScale: 1 })
// Guids far above the database's, so nothing here could name a real spawn.
const leader = se.newCreatureSpawn(t(38, 'Defias Thug'), 9_000_001, 100, 0, 100, 0, look)
const a = se.newCreatureSpawn(t(38, 'Defias Thug'), 9_000_002, 100, 0, 103, 0, look)
const b = se.newCreatureSpawn(t(38, 'Defias Thug'), 9_000_003, 97, 0, 100, 0, look)
const vein = se.newObjectSpawn({ entry: 1731, name: 'Copper Vein', type: 3, display: 0, model: '', size: 1 }, 9_000_101, 120, 0, 100, 0)
const other = se.newObjectSpawn({ entry: 1731, name: 'Copper Vein', type: 3, display: 0, model: '', size: 1 }, 9_000_102, 140, 0, 100, 0)
const layer = e.activeDocument().spawnLayer
layer.set([leader, a, b, vein, other])
se.syncSpawnUi(layer, true)
e.focusPoint(100, 100)
await P.frames(2)

// A formation: the leader picked, then a real click on one creature in the viewport and a pick of the other.
e.startSpawnPick(spawnKey(leader), 'lead')
await P.frames(1)
const bar = document.querySelector('.pickbar')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const v = e.camera.position.clone().set(a.x, a.y + 1, a.z).project(e.camera)
await P.click((v.x + 1) / 2, (1 - v.y) / 2, {}, 2)
const clicked = a.leader === leader.guid
if (!clicked) e.pickSpawn(a)
e.pickSpawn(b)
ui.spawnPick = null
await P.frames(2)
const links = e.links
const formation = {
	leader: leader.leader === leader.guid && leader.groupFlags === 3,
	slots: links.slots.count,
	lines: links.lines.geometry.getAttribute('position')?.count ?? 0,
	aDist: Math.round(a.followDist * 100) / 100,
	aAngle: Math.round((a.followAngle * 180) / Math.PI),
}
// A follower moved by its field takes its new slot.
await e.editSpawn(spawnKey(b), { x: 100, z: 95 }, 'Move')
const moved = { dist: Math.round(b.followDist * 100) / 100, angle: Math.round((b.followAngle * 180) / Math.PI) }

// A pool: made of one vein (a new pool entry from the database), the other added by a pick.
se.selectSpawn(vein)
await e.makePool(spawnKey(vein))
const poolPick = ui.spawnPick?.mode
e.pickSpawn(other)
ui.spawnPick = null
prefs.showPools = true
await P.frames(2)
const pool = {
	entry: vein.pool,
	same: other.pool === vein.pool && other.poolLimit === 1,
	rings: links.rings.geometry.getAttribute('position')?.count ?? 0,
}
prefs.showPools = false

const sql = (await App.SpawnEditSQL('Azeroth', 32, 48, 1, layer.edits())).sql
const wrote = {
	groups: (sql.match(/REPLACE INTO `creature_groups`/g) ?? []).length,
	poolRows: (sql.match(/INSERT INTO `pool_gameobject`/g) ?? []).length,
	template: sql.includes(`INSERT INTO \`pool_template\` (\`entry\`, \`max_limit\`, \`description\`) SELECT ${vein.pool}, 1,`),
}
// Five steps: two joins, the move, the new pool and the second vein.
let steps = 0
while (layer.edits().length && steps < 10 && e.undo()) steps++
await P.frames(1)
const after = { edits: layer.edits().length, leader: leader.leader, a: a.leader, pool: vein.pool }
e.activeDocument().spawnLayer.set([])
se.syncSpawnUi(layer, true)
return {
	ok:
		read.leaders > 0 &&
		read.followers > 0 &&
		read.pooled > 0 &&
		read.inMother > 0 &&
		bar.includes('Formation of Defias Thug') &&
		formation.leader &&
		formation.slots === 2 &&
		formation.lines === 4 &&
		formation.aDist === 3 &&
		formation.aAngle === 180 &&
		moved.dist === 5 &&
		moved.angle === 0 &&
		poolPick === 'pool' &&
		pool.entry > 0 &&
		pool.same &&
		pool.rings > 0 &&
		wrote.groups === 3 &&
		wrote.poolRows === 2 &&
		wrote.template &&
		after.edits === 0 &&
		after.leader === 0 &&
		after.a === 0 &&
		after.pool === 0 &&
		steps === 5,
	read,
	bar,
	clicked,
	formation,
	moved,
	pool,
	wrote,
	steps,
	after,
}

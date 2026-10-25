// Selection groups read from the layer's index (#630): on the everything benchmark map with every root put in a group of ten, withGroups for each grouped model under a Select brush matches a scan of every object, as does the Ungroup command's member list and its undo; prints the ms the brush's withGroups calls took a spot, against the scan's.
// touches: frontend/src/lib/state/selection.ts, frontend/src/lib/world/ObjectLayer.ts
const map = await P.loadBenchMap('everything')
const e = P.e
const L = e.objects
const { editor } = await P.state()
const sel = await P.app('/src/lib/state/selection.ts')
const roots = [...L.objects.values()].filter((o) => o.parent === undefined)
// Every root in a group of ten, as Group (Ctrl+G) puts them.
for (let i = 0; i < roots.length; i += 10) {
	const g = L.newGroup()
	for (const o of roots.slice(i, i + 10)) L.setGroup(o.id, g)
}
// What withGroups did before #630: a scan of every object for the groups.
const scanGroups = (ids) => {
	const out = new Set(ids)
	const groups = new Set()
	for (const id of out) {
		const g = L.objects.get(id)?.group
		if (g) groups.add(g)
	}
	if (groups.size) for (const o of L.objects.values()) if (o.group && groups.has(o.group)) out.add(o.id)
	return out
}
const sorted = (s) => [...s].sort((a, b) => a - b).join(',')
const xs = roots.map((o) => o.x)
const zs = roots.map((o) => o.z)
const minX = Math.min(...xs),
	maxX = Math.max(...xs),
	minZ = Math.min(...zs),
	maxZ = Math.max(...zs)
const K = 60
const R = 60
const near = []
const bad = []
let index = 0,
	scan = 0,
	models = 0
for (let i = 0; i < K; i++) {
	const x = minX + ((maxX - minX) * ((i * 7919) % K)) / K
	const z = minZ + ((maxZ - minZ) * ((i * 104729) % K)) / K
	near.length = 0
	L.rootsNear(x, z, R, near)
	models += near.length
	// As SelectTool.brushOne: withGroups once for each grouped model under the brush.
	let t0 = performance.now()
	const got = near.map((o) => sel.withGroups(L, [o.id]))
	index += performance.now() - t0
	t0 = performance.now()
	const want = near.map((o) => scanGroups([o.id]))
	scan += performance.now() - t0
	for (let k = 0; k < near.length; k++) if (sorted(got[k]) !== sorted(want[k])) bad.push(`spot ${i} model ${near[k].id}`)
}
if (bad.length) throw new Error(`withGroups and the scan differ: ${bad.slice(0, 8).join('; ')}`)
if (!models) throw new Error('no model under the brush at any spot')

// Ungroup the first group through the command, then undo it: the index follows each step.
const first = roots[0].group
const members = sorted(scanGroups([roots[0].id]))
editor.selectedIds = [roots[0].id]
e.ungroupSelected()
if (roots[0].group !== undefined || L.groupMembers(first).size) throw new Error('Ungroup left the group in the index')
e.history.undo()
if (sorted(L.groupMembers(first)) !== members) throw new Error(`undo of Ungroup: ${sorted(L.groupMembers(first))} not ${members}`)
// Group two of them anew, then undo: back in their old group.
editor.selectedIds = [roots[0].id, roots[1].id]
e.groupSelected()
const made = roots[0].group
if (made === first || sorted(L.groupMembers(made)) !== sorted([roots[0].id, roots[1].id])) throw new Error('Group did not make a new group of the two')
e.history.undo()
if (L.groupMembers(made).size || sorted(L.groupMembers(first)) !== members) throw new Error('undo of Group did not put them back')
const per = (v) => Math.round((v / K) * 1000) / 1000
return { objects: L.objects.size, groups: Math.ceil(roots.length / 10), modelsUnderBrush: Math.round(models / K), msSpot: { index: per(index), scan: per(scan) } }

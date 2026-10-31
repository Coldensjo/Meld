// The host makes the session's map again, as a guest sees it (#1008): the page joins a scripted host (meldtool session host --on-join, through P.bun) that sends the page its map, a `heights` edit, then a bigger map to everyone with `gen` 1 (a revert or a grow), an edit made against the old map (dropped) and one against the new (applied). The new map opens over the session's tab (no tab more); a guest's own replacement is refused, and its next edit and new model go to the host tagged with the new map, the model's id in its lane from the host's counts.
// touches: frontend/src/lib/session/**, frontend/src/lib/engine/MapDocument.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { GUEST_REPLACE_REASON } = await P.app('/src/lib/session/peers.ts')
const { toMapData } = await P.app('/src/lib/io/mapData.ts')
const { floatsToBase64, base64ToFloats } = await P.app('/src/lib/io/base64.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Host Map')
await P.frames(1)
const map = toMapData(e.snapshot())
e.newDocument(128, 'flat', 0, 'Host Map Grown')
await P.frames(1)
const grown = toMapData(e.snapshot())
const base = e.terrain.heights[5 * e.terrain.verts + 6]
e.newDocument(64, 'flat', 0, 'Mine')
// Something on it, or the opened map would take an untouched tab's place, as Open does.
e.objects.add({ type: 'helper:cube:4', x: 10, z: 10, yOff: 0, rotY: 0, scale: 1 })
await P.frames(1)
const mine = e.activeDocumentId()
const tabsBefore = e.documents.length
const one = (x, z, v, g) => ({ kind: 'heights', data: { id: 1, rect: { x0: x, z0: z, x1: x, z1: z }, h: floatsToBase64(new Float32Array([v])), ...(g ? { g } : {}) } })
// The page is the first guest, member 2, in lane 2.
const send = [{ to: 2, kind: 'map', data: { seq: 0, map, ids: { lane: 2, nextId: 0, nextGroup: 0 } } }, one(5, 5, 3), { kind: 'map', data: { seq: 0, gen: 1, map: grown, ids: { nextId: 50, nextGroup: 0 } } }, one(6, 5, 4), one(7, 5, 6, 1)]
const host = await P.bun('hostBot', { name: 'Ann', seconds: 10, onJoin: true, send })
let got
try {
	await S.joinSession(host.addr, host.code, 'Probe')
	await P.until(() => shared.docId && e.activeDocument().terrain.size === 128, 30_000, 'the grown map opening')
	const t = e.terrain
	const V = t.verts
	await P.until(() => t.heights[5 * V + 7] === 6, 15_000, "the host's edit against the new map")
	got = {
		name: editor.mapName,
		marked: e.activeDocument().shared,
		tabs: e.documents.length,
		mineOpen: e.documents.some((d) => d.id === mine),
		stale: t.heights[5 * V + 6],
		fresh: t.heights[5 * V + 7],
		refused: (() => {
			try {
				S.replaceSessionMap(shared.docId, () => {})
				return 'not refused'
			} catch (err) {
				return err instanceof Error ? err.message : String(err)
			}
		})(),
	}
	// An edit and a model of the guest's own on the new map.
	t.heights[100 * V + 110] = 9
	t.markDirty(110, 100, 110, 100)
	got.objectId = e.objects.add({ type: 'helper:cube:4', x: 20, z: 20, yOff: 0, rotY: 0, scale: 1 }).id
	await new Promise((r) => setTimeout(r, 600))
} finally {
	await S.leaveSession()
}
await P.until(() => !shared.role, 5000, 'the session ending')
const lines = await P.bun('botDone', host.bot)
const edit = lines.find((l) => l.kind === 'heights' && l.from === 2)
const objs = lines.find((l) => l.kind === 'objects' && l.from === 2)
const sent = {
	edit: edit ? { g: edit.data.g, rect: edit.data.rect, h: Array.from(base64ToFloats(edit.data.h)) } : null,
	objects: objs ? { g: objs.data.g, ids: objs.data.put.map((o) => o.id) } : null,
}
const ok =
	got.name === 'Host Map Grown' &&
	got.marked &&
	got.tabs === tabsBefore + 1 &&
	got.mineOpen &&
	got.stale === base &&
	got.fresh === 6 &&
	got.refused === GUEST_REPLACE_REASON &&
	got.objectId >= 50 &&
	got.objectId % 16 === 2 &&
	sent.edit?.g === 1 &&
	sent.edit.rect.x0 === 110 &&
	sent.edit.h[0] === 9 &&
	sent.objects?.g === 1 &&
	sent.objects.ids.includes(got.objectId)
return { ok, got, base, sent, hostSaw: lines.map((l) => l.kind ?? (l.hosting ? 'hosting' : '?')) }

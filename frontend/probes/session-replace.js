// The session's map is never replaced in its tab behind the sync's back (#1007): the page hosts an untouched new map, then a map opened from a snapshot takes a new tab instead of the untouched one's place, and Revert's and Grow Region's replacement of the session's map straight through the engine is refused with the reason, the sync still bound to it; once the session ends the map can be replaced again. Then the host makes the session's map again the way Revert and Grow Region do (replaceSessionMap, #1008) with a scripted guest in (meldtool session join, through P.bun): the sync is bound to the new tab, the bot gets the new map sent to everyone with `gen` 1, and the page's next edit goes out tagged with that map and fits its bigger grid.
// touches: frontend/src/lib/session/**, frontend/src/lib/engine/MapDocument.ts, frontend/src/lib/io/recovery.ts, frontend/src/lib/io/mapio.ts, frontend/src/components/MapPropertiesDialog.svelte, frontend/src/lib/ui/menus.ts, frontend/src/components/MenuBar.svelte, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { SESSION_MAP_REASON } = await P.app('/src/lib/session/peers.ts')
const { base64ToFloats } = await P.app('/src/lib/io/base64.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
// Untouched, unsaved and untitled: outside a session, opening a map takes its tab's place.
const d = e.newDocument(64, 'flat', 0, 'Replace Probe')
await P.frames(2)
const pristineBefore = d.pristine
await S.hostSession(0, 'Probe')
const refused = (fn) => {
	try {
		fn()
		return 'not refused'
	} catch (err) {
		return err instanceof Error ? err.message : String(err)
	}
}
let got
try {
	const marked = { shared: d.shared, pristine: d.pristine, docId: shared.docId === d.id, isSessionMap: S.isSessionMap(d.id) }
	const snap = e.snapshotOf(d)
	// Open: a new tab beside the session's map, not in its place.
	e.openDocument(snap, '')
	await P.frames(1)
	const opened = { sessionMapOpen: e.documents.includes(d), otherActive: e.activeDocumentId() !== d.id }
	const other = e.activeDocumentId()
	e.closeDocument(other)
	await P.frames(1)
	// Revert and the rest that reopen a map in its tab, straight through the engine.
	const revert = refused(() => e.openDocument(snap, '', d.id))
	// Grow Region, from the session's map in the active tab.
	e.switchDocument(d.id)
	const grow = refused(() => e.growWorld({ x: 30, y: 30, size: 2 }, ''))
	got = { marked, opened, revert, grow, stillOpen: e.documents.includes(d), bound: d.shared && shared.docId === d.id }
} finally {
	await S.leaveSession()
}
await P.until(() => !shared.role, 5000, 'the session ending')
const after = { shared: d.shared, pristine: d.pristine }

// #1008: the host makes the session's map again, with a guest in.
const big = e.newDocument(128, 'flat', 0, 'Replace Big')
await P.frames(1)
const bigSnap = e.snapshotOf(big)
e.closeDocument(big.id)
e.switchDocument(d.id)
await P.frames(1)
await S.hostSession(0, 'Probe')
let bot
let replaced
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 10 })
	await P.until(() => shared.peers.length === 2, 30_000, 'the bot joining')
	// Its own handoff goes out on the join; give it a moment to be sent before the map changes.
	await new Promise((r) => setTimeout(r, 500))
	const tabs = e.documents.length
	S.replaceSessionMap(d.id, () => e.openDocument(bigSnap, '', d.id))
	await P.frames(1)
	const nd = e.activeDocument()
	replaced = { newTab: nd.id !== d.id && shared.docId === nd.id, oldGone: !e.documents.includes(d), marked: nd.shared, sameTabs: e.documents.length === tabs, size: e.terrain.size }
	// An edit of the host's own on the new map, past the old map's grid.
	const t = e.terrain
	const V = t.verts
	t.heights[100 * V + 120] = 7
	t.markDirty(120, 100, 120, 100)
	await new Promise((r) => setTimeout(r, 600))
} finally {
	await S.leaveSession()
}
await P.until(() => !shared.role, 5000, 'the session ending')
const lines = await P.bun('botDone', bot)
const maps = lines.filter((l) => l.kind === 'map' || l.kind === 'map.part')
const toAll = maps.find((l) => l.kind === 'map' && !l.to)
const edit = lines.find((l) => l.kind === 'heights' && l.from === 1 && l.data?.rect?.x0 === 120)
const editH = edit ? Array.from(base64ToFloats(edit.data.h)) : null
const sent = {
	maps: maps.map((l) => ({ to: l.to ?? 0, gen: l.data?.gen ?? 0, size: l.data?.map?.size })),
	toAll: toAll ? { gen: toAll.data.gen, size: toAll.data.map.size, counts: toAll.data.ids } : null,
	edit: edit ? { g: edit.data.g, rect: edit.data.rect, h: editH, afterMap: !!toAll && edit.seq > toAll.seq } : null,
}
const ok =
	pristineBefore &&
	got.marked.shared &&
	!got.marked.pristine &&
	got.marked.docId &&
	got.marked.isSessionMap &&
	got.opened.sessionMapOpen &&
	got.opened.otherActive &&
	got.revert === SESSION_MAP_REASON &&
	got.grow === SESSION_MAP_REASON &&
	got.stillOpen &&
	got.bound &&
	!after.shared &&
	after.pristine &&
	replaced.newTab &&
	replaced.oldGone &&
	replaced.marked &&
	replaced.sameTabs &&
	replaced.size === 128 &&
	maps.length === 2 &&
	sent.maps[0].to === 2 &&
	sent.maps[0].size === 64 &&
	sent.toAll?.gen === 1 &&
	sent.toAll.size === 128 &&
	typeof sent.toAll.counts?.nextId === 'number' &&
	sent.edit?.g === 1 &&
	sent.edit.afterMap &&
	sent.edit.h.length === 1 &&
	sent.edit.h[0] === 7
return { ok, pristineBefore, ...got, after, replaced, sent }

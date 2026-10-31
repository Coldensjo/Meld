// The session's map is never replaced in its tab (#1007): the page hosts an untouched new map, then a map opened from a snapshot takes a new tab instead of the untouched one's place, and Revert's and Grow Region's replacement of the session's map is refused with the reason, the sync still bound to it; once the session ends the map can be replaced again.
// touches: frontend/src/lib/session/**, frontend/src/lib/engine/MapDocument.ts, frontend/src/lib/io/recovery.ts, frontend/src/components/MapPropertiesDialog.svelte, frontend/src/lib/ui/menus.ts, frontend/src/components/MenuBar.svelte
// timeout: 60
const e = P.e
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { SESSION_MAP_REASON } = await P.app('/src/lib/session/peers.ts')
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
	// Revert and the rest that reopen a map in its tab.
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
	after.pristine
return { ok, pristineBefore, ...got, after }

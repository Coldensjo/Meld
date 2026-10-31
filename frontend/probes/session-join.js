// File › Join Session (#1000): the page joins a scripted host (meldtool session host --on-join, through P.bun), which sends it a map addressed to it; the map opens as a new unsaved tab marked as the session's, the chip names the host, and leaving clears both.
// touches: frontend/src/lib/session/**, frontend/src/components/StatusBar.svelte, frontend/src/components/DocTabs.svelte, frontend/src/components/JoinSessionDialog.svelte, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { toMapData } = await P.app('/src/lib/io/mapData.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
// The host's map, as its page would send it, then a map of the page's own for the session's to open beside.
e.newDocument(64, 'flat', 0, 'Host Map')
await P.frames(1)
const map = toMapData(e.snapshot())
e.newDocument(128, 'flat', 0, 'Mine')
// Something on it, or the opened map would take an untouched tab's place, as Open does.
e.objects.add({ type: 'helper:cube:4', x: 10, z: 10, yOff: 0, rotY: 0, scale: 1 })
await P.frames(1)
const mine = e.activeDocumentId()
// The page is the first guest, member 2.
const host = await P.bun('hostBot', { name: 'Ann', seconds: 8, onJoin: true, send: [{ to: 2, kind: 'map', data: { seq: 3, map } }] })
let opened
try {
	await S.joinSession(host.addr, host.code, 'Probe')
	await P.until(() => shared.docId, 30_000, 'the map opening')
	await P.frames(2)
	opened = {
		role: shared.role,
		you: shared.you,
		name: editor.mapName,
		size: e.terrain.size,
		filePath: editor.filePath,
		newTab: shared.docId !== mine && e.documents.some((d) => d.id === mine),
		active: e.activeDocumentId() === shared.docId,
		tab: !!document.querySelector('[data-session-tab]'),
		chip: document.querySelector('[data-session-peers]')?.textContent.trim(),
	}
} finally {
	await S.leaveSession()
}
await P.until(() => !shared.role, 5000, 'the session ending')
const after = { tab: !!document.querySelector('[data-session-tab]'), chip: !!document.querySelector('[data-session-peers]') }
const lines = await P.bun('botDone', host.bot)
const ok =
	opened.role === 'guest' && opened.you === 2 && opened.name === 'Host Map' && opened.size === 64 && opened.filePath === '' && opened.newTab && opened.active && opened.tab && opened.chip === 'Session: Ann' && !after.tab && !after.chip
return { ok, opened, after, hostSaw: lines.map((l) => l.kind ?? (l.hosting ? 'hosting' : '?')) }

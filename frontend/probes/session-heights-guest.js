// Terrain heights as a guest (#1001): the page joins a scripted host (meldtool session host --on-join, through P.bun) that sends a `heights` edit before the map (held until the map opens, then applied, since the map's `seq` says it is older) and one after; then an edit in the page goes to the host as a `heights` message from member 2.
// touches: frontend/src/lib/session/**, frontend/src/lib/terrain/Terrain.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { toMapData } = await P.app('/src/lib/io/mapData.ts')
const { floatsToBase64, base64ToFloats } = await P.app('/src/lib/io/base64.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Host Map')
await P.frames(1)
const map = toMapData(e.snapshot())
const one = (x, z, v) => ({ kind: 'heights', data: { id: 1, rect: { x0: x, z0: z, x1: x, z1: z }, h: floatsToBase64(new Float32Array([v])) } })
// The page is the first guest, member 2; seq 0 in the handoff: every edit the host sends is newer than the map.
const host = await P.bun('hostBot', { name: 'Ann', seconds: 8, onJoin: true, send: [one(5, 5, 3), { to: 2, kind: 'map', data: { seq: 0, map } }, one(6, 5, 4)] })
let got
try {
	await S.joinSession(host.addr, host.code, 'Probe')
	await P.until(() => shared.docId && e.activeDocumentId() === shared.docId, 30_000, 'the map opening')
	const t = e.terrain
	const V = t.verts
	await P.until(() => t.heights[5 * V + 6] === 4, 15_000, "the host's edit after the map")
	got = { held: t.heights[5 * V + 5], after: t.heights[5 * V + 6] }
	// An edit of the guest's own, as a brush writes it.
	t.heights[20 * V + 21] = 9
	t.markDirty(21, 20, 21, 20)
	// A flush or two (HEIGHTS_FLUSH_MS) sends it.
	await new Promise((r) => setTimeout(r, 500))
} finally {
	await S.leaveSession()
}
await P.until(() => !shared.role, 5000, 'the session ending')
const lines = await P.bun('botDone', host.bot)
const sent = lines.find((l) => l.kind === 'heights' && l.from === 2)
const r = sent?.data?.rect
const h = sent ? Array.from(base64ToFloats(sent.data.h)) : null
const ok = got.held === 3 && got.after === 4 && !!sent && r.x0 === 21 && r.z0 === 20 && r.x1 === 21 && r.z1 === 20 && h.length === 1 && h[0] === 9
return { ok, got, sent: sent ? { rect: r, h } : null, hostSaw: lines.map((l) => l.kind ?? (l.hosting ? 'hosting' : '?')) }

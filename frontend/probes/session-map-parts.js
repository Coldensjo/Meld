// A shared session's map too large for one message goes in parts (#1010): the page hosts a map whose JSON is over MAP_PART_CHARS, a scripted guest gets it as `map.part` messages addressed to it that join to the handoff; then a scripted host sends those parts to the page as a guest, which opens the map once the last is in.
// touches: frontend/src/lib/session/**, frontend/probes/session-bot.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 240
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { MAP_PART_CHARS } = await P.app('/src/lib/session/peers.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
// 512 cells of hills is about 24 MB of JSON: three or four parts.
e.newDocument(512, 'hills', 1, 'Parts Map')
await P.frames(1)
await S.hostSession(0, 'Probe')
let lines
try {
	const bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 8 })
	lines = await P.bun('botDone', bot)
} finally {
	await S.leaveSession()
}
await P.until(() => !shared.role, 5000, 'the session ending')
const you = lines[0]?.data?.you
const parts = lines.filter((l) => l.kind === 'map.part')
const whole = parts.every((l, i) => l.to === you && l.data.part === i && l.data.parts === parts.length && l.data.text.length <= MAP_PART_CHARS)
let sent
try {
	sent = JSON.parse(parts.map((l) => l.data.text).join(''))
} catch {
	sent = null
}
const host = { parts: parts.length, whole, single: lines.some((l) => l.kind === 'map'), name: sent?.map?.name, size: sent?.map?.size, seq: sent?.seq }

// The page as the guest: a map of its own first, so the session's opens beside it.
e.newDocument(64, 'flat', 0, 'Mine')
e.objects.add({ type: 'helper:cube:4', x: 10, z: 10, yOff: 0, rotY: 0, scale: 1 })
await P.frames(1)
const hb = await P.bun('hostBot', { name: 'Ann', seconds: 20, onJoin: true, send: parts.map((l) => ({ to: 2, kind: 'map.part', data: l.data })) })
let guest
try {
	await S.joinSession(hb.addr, hb.code, 'Probe')
	await P.until(() => shared.docId, 60_000, 'the map opening from its parts')
	await P.frames(2)
	guest = { you: shared.you, name: editor.mapName, size: e.terrain.size, active: e.activeDocumentId() === shared.docId }
} finally {
	await S.leaveSession()
}
await P.until(() => !shared.role, 5000, 'the session ending')
await P.bun('botDone', hb.bot)
const ok = host.parts >= 2 && host.whole && !host.single && host.name === 'Parts Map' && host.size === 512 && typeof host.seq === 'number' && guest.you === 2 && guest.name === 'Parts Map' && guest.size === 512 && guest.active
return { ok, host, guest }

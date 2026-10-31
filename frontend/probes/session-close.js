// Closing the map the host shares in a session ends the session (#1013), since its sync stops with the tab: File › Close (the closeMap command) on the session's tab asks "End the session?" and leaves the tab open on Cancel; confirming ends the session, so the scripted guest (meldtool session join, through P.bun) is told "the host ended the session", and closes the tab. Closing another tab while hosting asks nothing. Then the page joins a scripted host (meldtool session host --on-join) as a guest (#1014): closing the session's tab asks "Leave the session?", Cancel keeps it, and confirming leaves (the host's peer list drops to itself) and closes the tab.
// touches: frontend/src/lib/session/**, frontend/src/components/DocTabs.svelte, frontend/src/components/AppDialogs.svelte, frontend/src/lib/ui/runCommand.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { ui } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { runCommand } = await P.app('/src/lib/ui/runCommand.ts')
const { toMapData } = await P.app('/src/lib/io/mapData.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
const d = e.newDocument(64, 'flat', 0, 'Close Probe')
await P.frames(2)
await S.hostSession(0, 'Probe')
let bot
let got
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 20 })
	await P.until(() => shared.peers.length === 2, 30_000, 'the bot joining')
	// Another tab closes without asking.
	const other = e.newDocument(64, 'flat', 0, 'Close Other')
	await P.frames(1)
	runCommand('closeMap')
	await P.frames(1)
	const otherClosed = !e.documents.includes(other) && ui.dialog === null && shared.role === 'host'
	e.switchDocument(d.id)
	await P.frames(1)
	// The session's tab asks; Cancel keeps it and the session.
	runCommand('closeMap')
	await P.frames(2)
	const asked = ui.dialog === 'closeSession'
	const text = document.querySelector('[data-ui~="Modal"]')?.textContent ?? ''
	ui.dialog = null
	await P.frames(1)
	const kept = e.documents.includes(d) && shared.role === 'host'
	// Confirming ends the session and closes the tab.
	runCommand('closeMap')
	await P.frames(2)
	const button = document.querySelector('[data-end-session]')
	button?.click()
	await P.until(() => !shared.role, 5000, 'the session ending')
	await P.frames(1)
	got = { otherClosed, asked, mentionsMember: text.includes('member'), kept, button: !!button, closed: !e.documents.includes(d), docId: shared.docId }
} finally {
	if (shared.role) await S.leaveSession()
}
const lines = await P.bun('botDone', bot)
const end = lines.find((l) => l.ended)
const hostOk = got.otherClosed && got.asked && got.mentionsMember && got.kept && got.button && got.closed && got.docId === 0 && end?.ended === 'the host ended the session'

// The page as a guest (#1014): its session tab asks "Leave the session?", and leaving drops it from the host's peers.
e.newDocument(64, 'flat', 0, 'Guest Map')
await P.frames(1)
const map = toMapData(e.snapshot())
const host = await P.bun('hostBot', { name: 'Ann', seconds: 12, onJoin: true, send: [{ to: 2, kind: 'map', data: { seq: 3, map } }] })
let guest
try {
	await S.joinSession(host.addr, host.code, 'Probe')
	await P.until(() => shared.docId, 30_000, 'the map opening')
	await P.frames(2)
	const id = shared.docId
	e.switchDocument(id)
	await P.frames(1)
	runCommand('closeMap')
	await P.frames(2)
	const asked = ui.dialog === 'closeSession'
	const title = document.querySelector('[data-ui~="Modal"]')?.textContent ?? ''
	ui.dialog = null
	await P.frames(1)
	const kept = e.documents.some((d) => d.id === id) && shared.role === 'guest'
	runCommand('closeMap')
	await P.frames(2)
	const button = document.querySelector('[data-end-session]')
	const label = button?.textContent.trim() ?? ''
	button?.click()
	await P.until(() => !shared.role, 5000, 'leaving the session')
	await P.frames(1)
	guest = { asked, leaveTitle: title.includes('Leave the session?'), kept, label, closed: !e.documents.some((d) => d.id === id), docId: shared.docId }
} finally {
	if (shared.role) await S.leaveSession()
}
const hostLines = await P.bun('botDone', host.bot)
const peers = hostLines.filter((l) => l.kind === 'session.peers').map((l) => (l.data ?? []).length)
const guestOk = guest.asked && guest.leaveTitle && guest.kept && guest.label === 'Leave the session and close' && guest.closed && guest.docId === 0 && peers.includes(2) && peers[peers.length - 1] === 1
return { ok: hostOk && guestOk, ...got, ended: end?.ended ?? null, guest, hostPeers: peers }

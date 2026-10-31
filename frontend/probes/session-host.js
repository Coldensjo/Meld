// File › Host Session (#1000): the page hosts its map, a scripted guest (meldtool session join, through P.bun) joins, the status bar's chip names it and the map's tab is marked, the guest gets the host's map addressed to it alone, and the chip drops it when it leaves.
// touches: frontend/src/lib/session/**, frontend/src/components/StatusBar.svelte, frontend/src/components/DocTabs.svelte, frontend/src/components/HostSessionDialog.svelte, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { ui } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { shared } = S
// A session left over from an earlier run of the page would refuse the host.
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Session Probe')
await P.frames(2)
const docId = e.activeDocumentId()
await S.hostSession(0, 'Probe')
const hosted = { role: shared.role, port: shared.port, code: shared.code, docId: shared.docId }
let bot
try {
	// The meldtool build is the first call's cost.
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 5 })
	await P.until(() => document.querySelector('[data-session-peers]')?.textContent.includes('Bot'), 60_000, 'the chip naming the bot')
} catch (err) {
	await S.leaveSession()
	throw err
}
const chip = document.querySelector('[data-session-peers]').textContent.trim()
const tab = !!document.querySelector('[data-session-tab]')
const lines = await P.bun('botDone', bot)
await P.until(() => shared.peers.length === 1, 15_000, 'the bot leaving the members')
const chipAfter = document.querySelector('[data-session-peers]')?.textContent.trim()
// The chip opens the host's dialog again, with the code to give.
document.querySelector('[data-session-peers]')?.click()
await P.frames(3)
const codeShown = ui.dialog === 'hostSession' && document.querySelector('[data-session-code]')?.textContent === shared.code
ui.dialog = null
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
const welcome = lines[0]
const map = lines.find((l) => l.kind === 'map')
const you = welcome?.data?.you
const m = map?.data?.map
const ok =
	hosted.role === 'host' &&
	hosted.docId === docId &&
	chip === 'Session: Bot' &&
	tab &&
	!!map &&
	map.to === you &&
	m?.name === 'Session Probe' &&
	m?.size === 64 &&
	typeof map.data.seq === 'number' &&
	chipAfter === 'Session: waiting for others' &&
	codeShown &&
	!document.querySelector('[data-session-peers]')
return { ok, hosted: { ...hosted, code: undefined }, chip, chipAfter, codeShown, tab, you, mapTo: map?.to, mapName: m?.name, mapSize: m?.size, mapSeq: map?.data?.seq, kinds: lines.map((l) => l.kind) }

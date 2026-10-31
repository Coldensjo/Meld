// Presence in a shared session (#1004): the page hosts a flat map, a scripted guest (meldtool session join, through P.bun) sends two `presence` messages, and the page draws the later one: a marker at its camera and its brush ring on the ground, named on the status bar's chip in its colour; a click on that name flies the page's camera to the bot's view; the page's own camera goes out to the bot as `presence` messages; and the marker goes once the bot leaves.
// touches: frontend/src/lib/session/**, frontend/src/components/StatusBar.svelte, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { memberColor } = await P.app('/src/lib/session/presence.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Presence Probe')
await P.frames(2)
await S.hostSession(0, 'Probe')
const pres = (x) => ({ cam: [x, 40, 30], dir: [0, -0.6, 0.8], t: [x + 2, 5, 32], yaw: 0.4, pitch: 0.6, d: 50, tool: 'sculpt', b: [x + 2, 32, 8, 0] })
const send = [
	{ kind: 'presence', data: pres(10) },
	{ kind: 'presence', data: pres(30) },
]
let bot
let seen
let flown
let chip
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 4, send })
	await P.until(() => S.presenceMarker(2)?.cam[0] === 30, 60_000, "the bot's marker at its later camera")
	seen = S.presenceMarker(2)
	await P.frames(2)
	const name = document.querySelector('[data-session-peer="2"]')
	chip = { text: document.querySelector('[data-session-peers]')?.textContent.trim(), color: name ? getComputedStyle(name).color : '' }
	name?.click()
	await P.frames(2)
	const c = e.controller
	flown = { t: [c.target.x, c.target.y, c.target.z], yaw: c.yaw, pitch: c.pitch, d: c.distance }
} catch (err) {
	await S.leaveSession()
	throw err
}
const lines = await P.bun('botDone', bot)
await P.until(() => shared.peers.length === 1, 15_000, 'the bot leaving the members')
await P.until(() => S.presenceMarker(2) === null, 5000, "the bot's marker going")
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
// The page's own presence, as the bot saw it: from the host, its camera where the page's was.
const mine = lines.filter((l) => l.kind === 'presence' && l.from === 1)
const last = mine.at(-1)?.data
const hex = memberColor(2)
const rgb = `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
const near = (a, b) => Math.abs(a - b) < 0.05
const ok =
	seen.visible &&
	seen.cam[1] === 40 &&
	near(seen.dir[1], -0.6) &&
	near(seen.dir[2], 0.8) &&
	!!seen.ring &&
	near(seen.ring[0], 32) &&
	near(seen.ring[1], 32) &&
	chip.text === 'Session: Bot' &&
	chip.color === rgb &&
	near(flown.t[0], 32) &&
	near(flown.t[2], 32) &&
	near(flown.yaw, 0.4) &&
	near(flown.d, 50) &&
	mine.length >= 1 &&
	Array.isArray(last?.cam) &&
	Array.isArray(last?.dir) &&
	near(last.t[0], 32) &&
	near(last.d, 50)
return { ok, seen, chip, rgb, flown, mine: mine.length, last }

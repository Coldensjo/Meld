// The paths' last applies in a shared session (#1022): the page hosts a flat map with two roads, a scripted guest (meldtool session join, through P.bun) sends a `pathapply` message saying it applied the first; the page's Apply of that road is refused with a status line naming the bot and changes nothing, while its Apply of the second goes through and out as a `pathapply` message with that road's id on.
// touches: frontend/src/lib/session/**, frontend/src/lib/tools/PathTool.ts, frontend/src/lib/tools/pathRecord.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor, ui } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { newPath } = await P.app('/src/lib/terrain/paths.ts')
const { othersApplies } = await P.app('/src/lib/tools/pathRecord.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(256, 'flat', 0, 'Path Apply Probe')
editor.tool = 'path'
await P.frames(2)
const t = e.terrain
const h0 = t.heightAt(256, 256)
// Two raised roads, so an apply moves the ground.
const road = (z) => [
	{ x: 180, y: h0 + 6, z },
	{ x: 256, y: h0 + 6, z },
	{ x: 330, y: h0 + 6, z },
]
const a = { ...newPath([], 'road', ''), points: road(200) }
const b = { ...newPath([a], 'road', ''), points: road(320) }
editor.paths = [a, b]
await S.hostSession(0, 'Probe')
const send = [{ kind: 'pathapply', data: { id: 1, on: [a.id], off: [] } }]
let bot
let got
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 8, send })
	await P.until(() => othersApplies(t).has(a.id), 60_000, "the bot's apply noted in the page")
	const steps = e.history.steps().length
	editor.pathId = a.id
	await e.path((tl, c) => tl.apply(c))
	got = { status: ui.status, refusedSteps: e.history.steps().length - steps, refusedH: t.heightAt(256, 200) - h0, by: othersApplies(t).get(a.id)?.name }
	editor.pathId = b.id
	await e.path((tl, c) => tl.apply(c))
	got.appliedSteps = e.history.steps().length - steps
	got.appliedH = t.heightAt(256, 320) - h0
	await new Promise((res) => setTimeout(res, 600))
} catch (err) {
	await S.leaveSession()
	throw err
}
const lines = await P.bun('botDone', bot)
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
const fromHost = lines.filter((l) => l.kind === 'pathapply' && l.from === 1).map((l) => l.data)
const ok = got.by === 'Bot' && got.status.includes('Bot applied') && got.refusedSteps === 0 && Math.abs(got.refusedH) < 0.01 && got.appliedSteps === 1 && got.appliedH > 1 && fromHost.some((d) => d.on?.includes(b.id) && !d.on.includes(a.id))
return { ok, got, fromHost }

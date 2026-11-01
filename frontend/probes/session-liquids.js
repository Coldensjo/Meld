// Painted liquids in a shared session (#1017): the page hosts a flat map, a scripted guest (meldtool session join, through P.bun) sends a `liquids` message with a chunk of water and the page shows it; then a Water tool stroke in the page and its undo go out as `liquids` messages, and the liquids the bot's messages give in the host's order match the page's, as the map file saves them.
// touches: frontend/src/lib/session/**, frontend/src/lib/water/liquids.ts, frontend/src/lib/water/liquidStroke.ts, frontend/src/lib/tools/WaterTool.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const L = await P.app('/src/lib/session/liquids.ts')
const W = await P.app('/src/lib/water/liquids.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Liquids Probe')
await P.frames(2)
const doc = e.activeDocument()
const map = doc.liquids
await S.hostSession(0, 'Probe')
// The bot's edit: chunk 9 all water, 2 yards up.
const lake = W.newLayer(W.LIQUID_WATER, 2)
lake.cells.fill(1)
const send = [{ kind: 'liquids', data: { id: 1, chunks: [{ c: 9, layers: L.encodeLayers(9, [lake]) }] } }]
let bot
let got
let wetAfterStroke = 0
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 8, send })
	await P.until(() => map.layers(9).length === 1, 60_000, "the bot's water in the page")
	await P.frames(2)
	got = { height: map.layers(9)[0].heights[0], unsaved: editor.dirty, drawn: !map.dirty.has(9) }
	// The page's own stroke with the Water tool, one undo step, then its undo: both go out.
	editor.tool = 'water'
	editor.waterMode = 'paint'
	await P.frames(1)
	editor.brush.radius = 20
	const ctx = e.debug.ctx
	const V3 = e.controller.target.constructor
	const at = (x, z) => new V3(x, e.terrain.heightAt(x, z), z)
	const water = e.debug.tools.water
	water.onDown(ctx, at(150, 150), { ctrlKey: false })
	for (let i = 0; i < 10; i++) water.tick(ctx, 0.05, at(150 + i, 150))
	water.onUp(ctx)
	for (const [c] of map.entries()) if (c !== 9) wetAfterStroke++
	await new Promise((r) => setTimeout(r, 400))
	e.history.undo()
	await new Promise((r) => setTimeout(r, 400))
} catch (err) {
	await S.leaveSession()
	throw err
}
const lines = await P.bun('botDone', bot)
const page = W.encodeLiquids(map)
const wetChunks = [...map.entries()].map(([c]) => c)
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
// The bot's view: a dry map, then every liquids message in the host's order.
const you = lines[0]?.data?.you
const msgs = lines.filter((l) => l.kind === 'liquids').sort((a, b) => a.seq - b.seq)
const mine = msgs.filter((l) => l.from === 1)
const replay = new W.LiquidMap(map.side * W.LIQUID_CELLS)
for (const m of msgs) for (const ch of m.data.chunks) replay.set(ch.c, L.decodeLayers(ch.layers) ?? [])
const bytes = W.encodeLiquids(replay)
const same = bytes.length === page.length && bytes.every((b, i) => b === page[i])
// After the undo, the page holds only the bot's chunk.
const ok = got.height === 2 && got.unsaved && got.drawn && wetAfterStroke > 0 && msgs.some((m) => m.from === you) && mine.length >= 2 && same && wetChunks.length === 1 && wetChunks[0] === 9
return { ok, got, you, wetAfterStroke, liquidsMsgs: msgs.length, fromHost: mine.length, same, wetChunks, chunks: mine.map((m) => m.data.chunks.map((c) => c.c)) }

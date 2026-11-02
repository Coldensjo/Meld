// The session map's settings in a shared session (#1019): the page hosts a flat 2×2-tile client map, a scripted guest (meldtool session join, through P.bun) sends a `settings` message (Map Properties' name, a texture's ground effect, a tile mask leaving one tile out) and the page shows them (the tile off the terrain, the unsaved mark); then the page moves the sea level and sets the map's facts (an undo step each) and undoes both, all going out, and the settings the bot's messages give in the host's order, over the map's at the start, match the page's.
// touches: frontend/src/lib/session/**, frontend/src/lib/terrain/tileMask.ts, frontend/src/lib/engine/docMeta.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { readSettings } = await P.app('/src/lib/session/settings.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
const doc = e.newVmangosDocument(2, 'flat', 0, { dir: 'ProbeSessionSettings', mapId: 1996 })
await P.frames(2)
const t = doc.terrain
const tex = editor.palette[0]
// The map's settings at the start, as the session sends them (plain JSON).
const start = JSON.parse(JSON.stringify(readSettings(editor, doc.meta.vmangos)))
await S.hostSession(0, 'Probe')
const info = { type: 1, name: 'Bot Keep', areaId: 0, loadingScreen: 0, maxPlayers: 5, resetDelay: 0, ghostMap: -1, ghostX: 0, ghostY: 0 }
const send = [{ kind: 'settings', data: { id: 1, set: { info, textureEffects: { [tex]: 77 }, tiles: '1101' } } }]
let bot
let got
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 8, send })
	await P.until(() => doc.meta.vmangos?.info?.name === 'Bot Keep', 60_000, "the bot's settings in the page")
	got = { name: doc.meta.vmangos.info.name, effect: editor.textureEffects[tex], tiles: doc.meta.vmangos.tiles, off: t.tileOff(0, 128), on: t.tileOff(128, 128), unsaved: editor.dirty }
	// The page's own sea level and facts, an undo step each, then their undo.
	const level = editor.waterLevel
	e.setWorldSettings('Sea level', { waterLevel: level + 9 })
	e.setMapInfo({ ...info, name: 'Page Keep' })
	await new Promise((res) => setTimeout(res, 400))
	e.history.undo()
	e.history.undo()
	await new Promise((res) => setTimeout(res, 400))
} catch (err) {
	await S.leaveSession()
	throw err
}
const lines = await P.bun('botDone', bot)
const page = JSON.parse(JSON.stringify(readSettings(editor, doc.meta.vmangos)))
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
// The bot's view: the map's settings at the start, then every settings message in the host's order.
const you = lines[0]?.data?.you
const msgs = lines.filter((l) => l.kind === 'settings').sort((a, b) => a.seq - b.seq)
const mine = msgs.filter((l) => l.from === 1)
const fold = { ...start }
for (const m of msgs) Object.assign(fold, m.data.set)
const differ = Object.keys({ ...fold, ...page }).filter((k) => JSON.stringify(fold[k]) !== JSON.stringify(page[k]))
const ok =
	got.name === 'Bot Keep' &&
	got.effect === 77 &&
	got.tiles === '1101' &&
	got.off === true &&
	got.on === false &&
	got.unsaved &&
	msgs.some((m) => m.from === you) &&
	mine.length >= 2 &&
	differ.length === 0 &&
	page.info?.name === 'Bot Keep' &&
	page.waterLevel === start.waterLevel
return { ok, got, you, msgs: msgs.length, fromHost: mine.length, sets: mine.map((m) => Object.keys(m.data.set)), differ, page: { name: page.info?.name, waterLevel: page.waterLevel, tiles: page.tiles } }

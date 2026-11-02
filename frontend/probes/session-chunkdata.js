// The ground's chunk data and baked shadows in a shared session (#1018): the page hosts a flat map, a scripted guest (meldtool session join, through P.bun) sends a `chunkdata` message (a chunk's zone and impassable flag, two no-tuft cells) and a `shadows` message (a row of shadowed texels on a map with none), with two cells of the Biome Brush's biome map and a `settings` message with the map's biomes (#1036), and the page shows them; then the page sets a zone and flag with a biome cell (one undo step) and shadows a rect (one undo step) and undoes both, all going out, and the chunk data and shadows the bot's messages give in the host's order match the page's.
// touches: frontend/src/lib/session/**, frontend/src/lib/terrain/Terrain.ts, frontend/src/lib/tools/chunkDataStroke.ts, frontend/src/lib/tools/shadowStroke.ts, frontend/src/lib/tools/BiomeBrushTool.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { bytesToBase64, base64ToBytes } = await P.app('/src/lib/io/base64.ts')
const { ChunkDataStroke } = await P.app('/src/lib/tools/chunkDataStroke.ts')
const { ShadowStroke } = await P.app('/src/lib/tools/shadowStroke.ts')
const { newBiome } = await P.app('/src/lib/terrain/biome.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Chunk Data Probe')
await P.frames(2)
const t = e.terrain
const N = t.size
const SIDE = t.paintChunksPerSide
const SH = t.shadowSide
const hadShadow = t.shadow !== null
await S.hostSession(0, 'Probe')
// The bot's edits: chunk (2, 3) in zone 12 and impassable, cells (5, 5) and (6, 5) without tufts, and the first 8 texels of the top row shadowed.
const send = [
	{
		kind: 'chunkdata',
		data: {
			id: 1,
			a: { rect: { x0: 2, z0: 3, x1: 2, z1: 3 }, b: bytesToBase64(new Uint8Array(Uint32Array.of(12).buffer)) },
			f: { rect: { x0: 2, z0: 3, x1: 2, z1: 3 }, b: bytesToBase64(Uint8Array.of(2)) },
			n: { rect: { x0: 5, z0: 5, x1: 6, z1: 5 }, b: bytesToBase64(Uint8Array.of(1, 1)) },
			m: { rect: { x0: 7, z0: 5, x1: 8, z1: 5 }, b: bytesToBase64(Uint8Array.of(1, 1)) },
		},
	},
	{ kind: 'settings', data: { id: 1, set: { biomes: [newBiome('Bot biome')] } } },
	{ kind: 'shadows', data: { id: 1, rect: { x0: 0, z0: 0, x1: 7, z1: 0 }, b: bytesToBase64(Uint8Array.of(0xff)) } },
]
let bot
let got
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 8, send })
	await P.until(() => t.areaIds[3 * SIDE + 2] === 12 && t.shadow?.[0] === 255 && editor.mapBiomes.length === 1, 60_000, "the bot's zone, shadows and biomes in the page")
	got = {
		area: t.areaIds[3 * SIDE + 2],
		flag: t.chunkFlags[3 * SIDE + 2],
		cells: t.noEffect[5 * N + 5] + t.noEffect[5 * N + 6],
		biomeCells: t.biomeMap[5 * N + 7] + t.biomeMap[5 * N + 8],
		biome: editor.mapBiomes[0]?.name,
		shadow: t.shadow[7],
		lit: t.shadow[8],
		unsaved: editor.dirty,
	}
	// The page's own zone and flag, one undo step, then its undo.
	const cd = new ChunkDataStroke(t, 'Probe zone')
	t.areaIds[0] = 40
	t.chunkFlags[0] = 2
	t.touchChunkData({ x0: 0, z0: 0, x1: 0, z1: 0 })
	// A Biome Brush cell, as its stroke touches it (not part of the zone's undo step: it stays).
	t.biomeMap[N + 1] = 1
	t.touchBiomeMap({ x0: 1, z0: 1, x1: 1, z1: 1 })
	e.history.push(cd.finish())
	// And a shadowed rect, one undo step.
	const sh = new ShadowStroke(t, 'Probe shadow')
	const r = { x0: 100, z0: 100, x1: 103, z1: 103 }
	sh.reserve(r)
	const layer = t.ensureShadow()
	for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) layer[z * SH + x] = 255
	sh.touch(r)
	e.history.push(sh.finish())
	await new Promise((res) => setTimeout(res, 400))
	e.history.undo()
	e.history.undo()
	await new Promise((res) => setTimeout(res, 400))
} catch (err) {
	await S.leaveSession()
	throw err
}
const lines = await P.bun('botDone', bot)
const page = { areas: Uint32Array.from(t.areaIds), flags: Uint8Array.from(t.chunkFlags), cells: Uint8Array.from(t.noEffect), biomeMap: Uint8Array.from(t.biomeMap), shadow: t.shadow ? Uint8Array.from(t.shadow) : null }
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
// The bot's view: an empty map, then every message in the host's order.
const you = lines[0]?.data?.you
const msgs = lines.filter((l) => l.kind === 'chunkdata' || l.kind === 'shadows').sort((a, b) => a.seq - b.seq)
const mine = msgs.filter((l) => l.from === 1)
const areas = new Uint8Array(SIDE * SIDE * 4)
const flags = new Uint8Array(SIDE * SIDE)
const cells = new Uint8Array(N * N)
const biomeMap = new Uint8Array(N * N)
let shadow = null
const put = (grid, side, stride, part) => {
	const r = part.rect
	const b = base64ToBytes(part.b)
	const w = (r.x1 - r.x0 + 1) * stride
	for (let z = r.z0; z <= r.z1; z++) grid.set(b.subarray((z - r.z0) * w, (z - r.z0 + 1) * w), (z * side + r.x0) * stride)
}
for (const m of msgs) {
	const d = m.data
	if (m.kind === 'chunkdata') {
		if (d.a) put(areas, SIDE, 4, d.a)
		if (d.f) put(flags, SIDE, 1, d.f)
		if (d.n) put(cells, N, 1, d.n)
		if (d.m) put(biomeMap, N, 1, d.m)
		continue
	}
	if (d.none) {
		shadow = null
		continue
	}
	shadow ??= new Uint8Array(SH * SH)
	const bits = base64ToBytes(d.b)
	const w = d.rect.x1 - d.rect.x0 + 1
	for (let z = d.rect.z0; z <= d.rect.z1; z++) {
		for (let x = d.rect.x0; x <= d.rect.x1; x++) {
			const i = (z - d.rect.z0) * w + (x - d.rect.x0)
			shadow[z * SH + x] = (bits[i >> 3] >> (i & 7)) & 1 ? 255 : 0
		}
	}
}
const differ = (a, b) => {
	let n = 0
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
	return n
}
const pageAreas = new Uint8Array(page.areas.buffer)
const result = {
	areas: differ(areas, pageAreas),
	flags: differ(flags, page.flags),
	cells: differ(cells, page.cells),
	biomeMap: differ(biomeMap, page.biomeMap),
	shadow: shadow && page.shadow ? differ(shadow, page.shadow) : shadow === page.shadow ? 0 : -1,
}
const after = { area0: page.areas[0], flag0: page.flags[0], shadowed: page.shadow ? page.shadow.reduce((n, v) => n + (v ? 1 : 0), 0) : 0 }
const ok =
	!hadShadow &&
	got.area === 12 &&
	got.flag === 2 &&
	got.cells === 2 &&
	got.biomeCells === 2 &&
	got.biome === 'Bot biome' &&
	page.biomeMap[N + 1] === 1 &&
	got.shadow === 255 &&
	got.lit === 0 &&
	got.unsaved &&
	msgs.some((m) => m.from === you) &&
	mine.length === 4 &&
	Object.values(result).every((n) => n === 0) &&
	after.area0 === 0 &&
	after.flag0 === 0 &&
	after.shadowed === 8
return { ok, got, you, msgs: msgs.length, fromHost: mine.length, kinds: mine.map((m) => m.kind), result, after }

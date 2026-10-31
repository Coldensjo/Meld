// View › Ground overlay (#950): on Azeroth 32_48 (Northshire and the north of Elwynn) Level shades the ground by the average level of the monsters within 40 yd of each cell, as a count by hand over the spawns gives it, Density by the creatures around it, both drawn over the terrain from above (the cell texture's blue and alpha, no new sampler), a moved spawn is counted where it went, the cells straying from their zone's exploration level get the stray bit and are hatched (the block's chunks named Goldshire for it, as Northshire's areas have no level), and the legend picks the mode and goes; needs the world database.
// touches: frontend/src/lib/world/spawnGround.ts, frontend/src/lib/world/groundOverlay.ts, frontend/src/components/GroundOverlayLegend.svelte, frontend/src/lib/terrain/TerrainMaterial.ts, frontend/src/lib/terrain/Terrain.ts, frontend/src/lib/terrain/terrainOverlays.ts
await P.scene(P.BENCH)
const e = P.e
const { prefs, ui } = await P.state()
const sg = await P.app('/src/lib/world/spawnGround.ts')
const layer = e.debug.doc.spawnLayer
await P.until(() => layer.spawns.length > 0, 60_000, 'the spawns to be read')
const t = e.terrain
const n = t.size
const cs = t.cellSize
const before = { mode: prefs.groundOverlay, stray: prefs.groundStray }
const res = { spawns: layer.spawns.length }

// The block from straight above, so every cell of it is on screen.
const ws = t.worldSize
const c = e.controller
const top0 = ui.topDown
ui.topDown = true
c.target.set(ws / 2, 0, ws / 2)
c.distance = ws * 0.95
c.yaw = 0
await P.frames(4)

/** The average level of the monsters within the radius of cell (cx, cz), and the creatures there, counted by hand. */
const byHand = (cx, cz) => {
	const x = (cx + 0.5) * cs
	const z = (cz + 0.5) * cs
	let sum = 0
	let k = 0
	let all = 0
	for (const s of layer.spawns) {
		if (s.kind === 'object' || !layer.eventShown(s)) continue
		if ((s.x - x) ** 2 + (s.z - z) ** 2 > sg.GROUND_RADIUS ** 2) continue
		all++
		if (s.kind !== 'monster') continue
		const lo = s.levelMin > 0 ? s.levelMin : s.levelMax
		const hi = s.levelMax > 0 ? s.levelMax : s.levelMin
		if (lo > 0) {
			sum += (lo + hi) / 2
			k++
		}
	}
	return { level: k ? sum / k : 0, all }
}

try {
	prefs.groundStray = 0
	prefs.groundOverlay = 'off'
	await P.frames(3)
	const off = await P.shot()
	prefs.groundOverlay = 'level'
	await P.frames(3)
	const ground = e.debug.groundOverlay.groundOf(t)
	res.counted = ground?.size ?? 0
	res.mode = t.material.uniforms.spawnMode.value
	const level = await P.shot()
	res.levelDrawn = P.diff(off, level).off
	// The sums against a count by hand, at the cells of a few monsters.
	const bytes = t.spawnCellBytes()
	const monsters = layer.spawns.filter((s) => s.kind === 'monster' && s.x >= 0 && s.z >= 0 && s.x < ws && s.z < ws)
	res.checked = 0
	res.wrong = []
	for (let k = 0; k < monsters.length; k += Math.max(1, Math.floor(monsters.length / 12))) {
		const s = monsters[k]
		const cx = Math.floor(s.x / cs)
		const cz = Math.floor(s.z / cs)
		const want = byHand(cx, cz)
		const i = cz * n + cx
		const got = { level: ground.levelAt(i), all: ground.count[i], byte: bytes[i * 4 + 2] }
		res.checked++
		if (Math.abs(got.level - want.level) > 1e-3 || got.all !== want.all || Math.abs(got.byte / sg.LEVEL_SCALE - want.level) > 0.13) res.wrong.push({ cx, cz, want, got })
	}
	// The level by thirds of the block, north (Northshire) to south.
	res.thirds = [0, 1, 2].map((third) => {
		let sum = 0
		let k = 0
		for (let cz = Math.floor((third * n) / 3); cz < Math.floor(((third + 1) * n) / 3); cz++)
			for (let cx = 0; cx < n; cx++) {
				const i = cz * n + cx
				if (ground.levelCount[i]) {
					sum += ground.levelAt(i)
					k++
				}
			}
		return k ? +(sum / k).toFixed(1) : 0
	})
	res.legend = !!document.querySelector('[aria-label="Ground overlay"]')

	// Density, picked in the legend (its change event must bubble: Svelte delegates it to the root).
	const select = document.querySelector('[aria-label="Shade the ground by"]')
	select.value = 'density'
	select.dispatchEvent(new Event('change', { bubbles: true }))
	await P.frames(3)
	res.picked = prefs.groundOverlay === 'density' && t.material.uniforms.spawnMode.value === 2
	const density = await P.shot()
	res.densityDrawn = P.diff(off, density).off
	res.densityDiffers = P.diff(level, density).off

	// A spawn moved 120 yd counts where it went, and no longer where it stood.
	const s = monsters[0]
	const x0 = s.x
	const from = Math.floor(s.z / cs) * n + Math.floor(s.x / cs)
	const countFrom = ground.count[from]
	s.x = x0 + (x0 < ws / 2 ? 120 : -120)
	layer.refresh(s)
	await P.frames(2)
	const to = Math.floor(s.z / cs) * n + Math.floor(s.x / cs)
	res.moved = ground.count[from] === countFrom - 1 && ground.count[to] === byHand(Math.floor(s.x / cs), Math.floor(s.z / cs)).all
	s.x = x0
	layer.refresh(s)
	await P.frames(2)
	res.movedBack = ground.count[from] === countFrom

	// The level compare. Northshire's zone and subzones have no exploration level in 1.12's AreaTable (0,
	// as most zones; their subzones carry one, Goldshire's 5), so the block's chunks are named Goldshire
	// (87) for the check, and put back after. With a stray of 1 the cells of Northshire's level 1 to 4
	// monsters stray from 5 once the zones' levels are read (AreaRows).
	const areas = t.areaIds.slice()
	t.areaIds.fill(87)
	t.touchChunkData()
	prefs.groundOverlay = 'level'
	prefs.groundStray = 1
	const stray = () => {
		let k = 0
		for (let i = 0; i < n * n; i++) if (bytes[i * 4 + 3] & sg.STRAY_BIT) k++
		return k
	}
	try {
		await P.until(() => stray() > 0, 30_000, 'cells straying from their zone')
		res.strayCells = stray()
		const hatched = await P.shot()
		prefs.groundStray = 0
		await P.frames(2)
		res.strayOff = stray() === 0
		res.hatchDrawn = P.diff(await P.shot(), hatched).off
	} finally {
		t.areaIds.set(areas)
		t.touchChunkData()
	}

	document.querySelector('[aria-label="Ground overlay"] .close').click()
	await P.frames(2)
	res.closed = prefs.groundOverlay === 'off' && t.material.uniforms.spawnMode.value === 0 && !document.querySelector('[aria-label="Ground overlay"]')
} finally {
	prefs.groundOverlay = before.mode
	prefs.groundStray = before.stray
	ui.topDown = top0
}
const ok =
	res.counted > 0 &&
	res.mode === 1 &&
	res.levelDrawn > 0.05 &&
	res.checked > 3 &&
	res.wrong.length === 0 &&
	res.legend &&
	res.picked &&
	res.densityDrawn > 0.05 &&
	res.densityDiffers > 0.02 &&
	res.moved &&
	res.movedBack &&
	res.strayCells > 0 &&
	res.strayOff &&
	res.hatchDrawn > 0.01 &&
	res.closed
return { ok, ...res }

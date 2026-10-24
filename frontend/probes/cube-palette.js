// The asset browser's cube palette (#63): its tiles are drawn, a click on a shape or a material sets the Cubes tool's cube and takes the tool and goes into Recent, the search and the categories narrow it, the preview follows the hover, sets of tiles made by a right-click and shown, renamed and picked from in the Sets tab (#73), a prefab of cubes in the prefab folder listed, drawn and pasted with one click (#73).
const e = P.e
const { prefs, editor } = await P.state()
const { CubeWorld, kindId } = await P.app('/src/lib/cubes/world.ts')
const { CUBE_ITEMS } = await P.app('/src/lib/cubes/palette.ts')

prefs.browserCollapsed = false
prefs.browserNames = true
prefs.cubeCategory = ''
prefs.cubeRecent = []
editor.tool = 'select'
e.openWorld(CubeWorld.create(2, 2, true), 'Palette world', '')
await P.frames(3)
const r = {}
const browser = () => document.querySelector('.browser')
const tiles = () => [...browser().querySelectorAll('.tile[data-key]')]
const tile = (key) => browser().querySelector(`.grid-wrap > .grid:last-of-type .tile[data-key="${key}"]`)
const search = () => browser().querySelector('input.search')

r.palette = !!browser()?.textContent?.includes('Cubes') && tiles().length === CUBE_ITEMS.length
// A tile's picture is drawn: some pixel of its canvas is not blank.
const canvas = tile('kind:2')?.querySelector('canvas')
const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
r.drawn = !!data && data.some((v, i) => i % 4 === 3 && v > 0)

tile('shape:2').click()
await P.frames(2)
r.pickShape = editor.cubeShape === 2 && editor.tool === 'cube'
tile(`kind:${kindId('wood')}`).click()
await P.frames(2)
r.pickKind = editor.cubeKind === kindId('wood')
r.active = tile('shape:2').getAttribute('aria-pressed') === 'true' && tile(`kind:${kindId('wood')}`).getAttribute('aria-pressed') === 'true'
r.recent = prefs.cubeRecent.join() === `kind:${kindId('wood')},shape:2` && !!browser().textContent.includes('Recent')

// The search and the categories.
const input = search()
input.value = 'magma'
input.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(2)
r.search = tiles().map((t) => t.dataset.key).join() === `kind:${kindId('lava')}`
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(2)
;[...browser().querySelectorAll('.facet')].find((b) => b.textContent.trim().startsWith('Liquids')).click()
await P.frames(2)
r.category = prefs.cubeCategory === 'Liquids' && tiles().length === 3
prefs.cubeCategory = ''
await P.frames(2)

// The preview names the hovered tile, else the tool's cube.
tile('shape:3').dispatchEvent(new PointerEvent('pointerenter'))
await P.frames(2)
r.previewHover = browser().querySelector('.side .name')?.textContent === 'Stairs'
browser().querySelector('.grid-wrap').dispatchEvent(new PointerEvent('pointerleave'))
await P.frames(2)
r.previewTool = browser().querySelector('.side .name')?.textContent?.startsWith('wood slope')

// Sets (#73): a right-click on a tile adds it to a new set and to that set; the Sets tab shows them, renames the set, picks from it and takes a tile out.
const { ui } = await P.state()
const menuOf = async (el) => {
	const b = el.getBoundingClientRect()
	el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 4, clientY: b.y + 4 }))
	await P.frames(1)
	const m = ui.contextMenu
	ui.contextMenu = null
	return m
}
prefs.cubeTab = 'cubes'
prefs.cubeSets = []
await P.frames(2)
const run = (m, label) => m?.items.find((it) => it.label === label)?.run?.()
run(await menuOf(tile('shape:3')), 'Add to a New Set')
run(await menuOf(tile(`kind:${kindId('stone')}`)), 'Add to "New set"')
await P.frames(2)
r.setMade = prefs.cubeSets.length === 1 && prefs.cubeSets[0].items.join() === `shape:3,kind:${kindId('stone')}`
;[...browser().querySelectorAll('.kinds .tab')].find((b) => b.textContent.trim() === 'Sets').click()
await P.frames(2)
r.setTab = prefs.cubeTab === 'sets' && tiles().map((t) => t.dataset.key).join() === `shape:3,kind:${kindId('stone')}`
const nameBox = browser().querySelector('input.setname')
nameBox.value = 'Stone stairs'
nameBox.dispatchEvent(new Event('change', { bubbles: true }))
await P.frames(2)
r.setRenamed = prefs.cubeSets[0].name === 'Stone stairs' && prefs.cubeSet === 'Stone stairs' && !!browser().querySelector('.facets')?.textContent.includes('Stone stairs')
browser().querySelector('.tile[data-key="shape:3"]').click()
await P.frames(2)
r.setPick = editor.cubeShape === 3 && editor.tool === 'cube'
run(await menuOf(browser().querySelector('.tile[data-key="shape:3"]')), 'Remove from "Stone stairs"')
await P.frames(2)
r.setRemove = tiles().map((t) => t.dataset.key).join() === `kind:${kindId('stone')}`

// Prefabs (#73): a prefab of cubes written to the prefab folder is listed and drawn in the Prefabs tab, a click pastes it under the cursor with the Select tool, and the box put down is the prefab's cubes, one History step.
const App = window.go?.main?.App
if (App?.WriteTextFile) {
	const THREE = await P.app('/deps/three.js')
	const mesher = await P.app('/src/lib/cubes/mesher.ts')
	const { GROUND_LAYER } = await P.app('/src/lib/cubes/world.ts')
	const { copyBox, clipCount } = await P.app('/src/lib/cubes/clip.ts')
	const { formatCubePrefab } = await P.app('/src/lib/cubes/prefabs.ts')
	const STONE = kindId('stone')
	const WOOD = kindId('wood')
	// A stone arch 3 x 1 x 2 with a wood slope on its middle: (0, 0) and (2, 0) two high, (1, 0) on top only.
	const clip = { w: 3, d: 1, h: 3, cubes: new Uint32Array([0, WOOD | (2 << 8) | (1 << 16), 0, STONE, STONE, STONE, STONE, 0, STONE]) }
	await App.WriteTextFile('build/bin/probe-cube-prefab.toml', formatCubePrefab({ name: 'Probe arch', clip }))
	prefs.prefabDir = 'build/bin'
	// A new empty world to put it in (the palette world is untouched, so it is replaced).
	e.openWorld(CubeWorld.create(1, 1, false), 'Prefab world', '')
	const d = e.activeDocument()
	await P.until(() => d.cubes.pending === 0, 60_000, 'prefab world built')
	await P.lookAt({ x: 24, y: 3, z: 24 }, { pitch: 1.2, back: 45, yaw: 0 })
	e.history.clear()
	;[...browser().querySelectorAll('.kinds .tab')].find((b) => b.textContent.trim() === 'Prefabs').click()
	const prefabTile = () => browser().querySelector('.tile[data-prefab="probe-cube-prefab.toml"]')
	await P.until(() => !!prefabTile(), 20_000, 'prefab listed')
	await P.frames(2)
	const pc = prefabTile().querySelector('canvas')
	const px = pc?.getContext('2d')?.getImageData(0, 0, pc.width, pc.height).data
	r.prefabDrawn = !!px && px.some((v, i) => i % 4 === 3 && v > 0)
	prefabTile().dispatchEvent(new PointerEvent('pointerenter'))
	await P.frames(1)
	r.prefabHover = browser().querySelector('.side .name')?.textContent === 'Probe arch'
	prefabTile().click()
	await P.frames(1)
	r.prefabPasting = ui.cubePasting && editor.tool === 'select'
	const v = new THREE.Vector3(8 * 3 + 1.5, mesher.layerBottom(GROUND_LAYER), 8 * 3 + 1.5).project(e.camera)
	await P.click((v.x + 1) / 2, (1 - v.y) / 2)
	const put = ui.cubeSelection && { ...ui.cubeSelection }
	const got = put && copyBox(d.world, put)
	r.prefabPlaced = !ui.cubePasting && !!got && got.w === 3 && got.d === 1 && got.h === 3 && clipCount(got) === 6 && got.cubes.every((c, i) => c === clip.cubes[i]) && e.history.steps().length === 1
	// The placed box is selected, and Save selection's clip is those cubes.
	const sel = e.cubeSelectionClip()
	r.selectionClip = !!sel && sel.cubes.every((c, i) => c === clip.cubes[i])
	prefs.cubeTab = 'cubes'
}

return { ok: Object.values(r).every(Boolean), ...r }

// Swap sign (#843): a right-click on a road sign doodad offers Swap sign…; its window lists the client's road signs as thumbnails, the selected sign's folder first and its own tile marked, hovering a tile shows it in the large preview, and a click swaps the selected sign for it as one History step that keeps its place, turn and scale, leaving a selected barrel alone. Undo restores the model.
// touches: frontend/src/components/SignSwapWindow.svelte, frontend/src/lib/wow/signs.ts
const e = P.e
const { editor, ui, prefs } = await P.state()
const sel = await P.app('/src/lib/state/selection.ts')
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'select'
await P.frames(1)
const WAIT = 60_000
const L = e.objects
const POSTS = 'World\\Generic\\Human\\Passive Doodads\\SignPosts\\'
const FROM = `m2:${POSTS}HumanSignPostPointer01.m2`
const sign = L.add({ type: FROM, x: 128, z: 128, yOff: 0, rotY: 0.7, scale: 1.3 })
const barrel = L.add({ type: 'm2:World\\Generic\\Human\\Passive Doodads\\Barrels\\Barrel01.m2', x: 140, z: 128, yOff: 0, rotY: 0, scale: 1 })
// The right-click menu on the sign (P.contextMenuOn sweeps spots over a thin model until one lands on it).
let menu = null
let seen = 'no menu'
try {
	menu = await P.contextMenuOn(sign.id, { timeout: WAIT })
	seen = `${menu.title}: ${menu.items.map((it) => it.label ?? '-').join('|')}`
} catch (err) {
	seen = String(err.message)
}
const menuTitle = menu?.title ?? seen
ui.contextMenu = null
sel.selectObjects(L, [sign.id, barrel.id])
await P.frames(1)
ui.signSwap = true

const root = () => document.querySelector('[data-testid="sign-swap"]')
const grid = () => root()?.querySelector('[aria-label="Sign models"]')
const tiles = () => [...(grid()?.querySelectorAll('button') ?? [])]
// The preview's path line, there while the asset browser shows names (prefs.browserNames, #655).
const previewPath = () => root()?.querySelector('.side .path')?.textContent.trim() ?? ''
await P.until(() => tiles().length > 0, WAIT, 'the sign tiles')
const listed = tiles().map((b) => b.title.split('\n')[0])
const roadOnly = root().querySelector('input[type="checkbox"]').checked
const firstInFolder = listed[0].startsWith(POSTS)
const marked = grid().querySelector('button.active')?.title.split('\n')[0] ?? ''
await P.until(() => grid().querySelectorAll('img').length > 0, WAIT, 'a thumbnail')

const target = tiles().find((b) => b.title.startsWith(`${POSTS}WoodSignPointer`))
const toPath = target.title.split('\n')[0]
target.dispatchEvent(new PointerEvent('pointerenter'))
if (prefs.browserNames) await P.until(() => previewPath() === toPath, WAIT, 'the hover preview')
const hovered = prefs.browserNames ? previewPath() : 'names off'

const place = (o) => JSON.stringify([o.x, o.yOff, o.z, o.rotY, o.scale, o.parent ?? null])
const before = place(L.objects.get(sign.id))
const steps = e.history.position
target.click()
await P.frames(1)
const after = L.objects.get(sign.id)
const swapped = { type: after.type, kept: place(after) === before, steps: e.history.position - steps, barrel: L.objects.get(barrel.id).type.includes('Barrel01') }
await P.frames(2)
const markedAfter = grid().querySelector('button.active')?.title.split('\n')[0] ?? ''
ui.signSwap = false
await P.frames(1)
e.history.undo()
const undone = L.objects.get(sign.id).type === FROM

const ok =
	menuTitle === 'HumanSignPostPointer01' &&
	roadOnly &&
	firstInFolder &&
	listed.every((p) => /signpost|pointer|directional|streetsign/i.test(p)) &&
	marked === FROM.slice(3) &&
	hovered !== '' &&
	swapped.type === `m2:${toPath}` &&
	swapped.kept &&
	swapped.steps === 1 &&
	swapped.barrel &&
	markedAfter === toPath &&
	undone
return { ok, menuTitle, roadOnly, count: listed.length, first: listed[0], marked, hovered, swapped, markedAfter, undone }

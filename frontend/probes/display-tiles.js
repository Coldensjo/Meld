// The display picker's tiles fill the row (#389): in the new-creature guide's "How it looks" step, the first row of the grid holds the columns that fit at the smallest tile and its last tile ends within a few pixels of the grid's inner right edge.
// touches: frontend/src/components/DisplayPicker.svelte, frontend/src/components/CreaturesWorkspace.svelte
const { ui } = await P.state()
ui.creatures = true
await P.frames(5)
const q = (s) => document.querySelector(s)
const type = async (el, v) => {
	el.value = v
	el.dispatchEvent(new Event('input', { bubbles: true }))
	await P.frames(2)
}
const next = async () => {
	const b = [...document.querySelectorAll('footer button')].find((x) => x.textContent.trim() === 'Next')
	b.click()
	await P.frames(3)
}
await type(q('input[placeholder="Gregor the Smith"]'), 'Probe')
await next()
await P.until(() => q('input[name="faction"]'), 60_000, 'factions')
q('input[name="faction"]').click()
await P.frames(3)
await next()
await P.until(() => q('[aria-label="Creature displays"] .grid > *'), 60_000, 'tiles')
await P.frames(10)
const wrap = q('[aria-label="Creature displays"]')
const tiles = [...wrap.querySelectorAll('.grid > *')]
const top = tiles[0].getBoundingClientRect().top
const row = tiles.filter((t) => Math.abs(t.getBoundingClientRect().top - top) < 2).map((t) => t.getBoundingClientRect())
const w = wrap.getBoundingClientRect()
const inner = w.left + 1 + 6 + wrap.clientWidth - 12
const gap = inner - row[row.length - 1].right
const size = row[0].width
return { ok: row.length >= 2 && gap >= -1 && gap < 4 && size >= 104 && size <= 140, cols: row.length, size, gap }

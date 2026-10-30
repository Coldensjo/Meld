// The paint mask's Border and Smooth (#769), picked from the Paint panel's Modify mask drop-down on a square mask: Border leaves only a band along its edge (the middle cleared), Smooth keeps the square but for its corners, and each is one undo step that gives the square back.
// touches: frontend/src/lib/terrain/maskSelect.ts, frontend/src/lib/tools/maskWand.ts, frontend/src/components/options/PaintOptions.svelte
const e = P.e
const bad = []
const check = (c, what) => {
	if (!c) bad.push(what)
}
const { editor } = await P.state()
e.newDocument(256, 'flat', 3, 'Probe')
await P.settle()
const t = e.terrain
const R = t.splatRes
const m = t.mask
m.fill(0)
for (let z = R / 4; z < (3 * R) / 4; z++) for (let x = R / 4; x < (3 * R) / 4; x++) m[z * R + x] = 255
t.markMaskDirty()
e.refreshMaskState()
editor.tool = 'paint'
editor.paintMode = 'mask'
editor.maskSelect.step = 2
await P.settle()
const count = () => m.reduce((n, v) => n + (v >= 128 ? 1 : 0), 0)
const before = count()
document.querySelector('[data-ui="OptionsBar"] .brushbtn')?.click()
await P.frames(2)
const sel = document.querySelector('select[aria-label="Modify mask"]')
check(!!sel, 'the Modify mask drop-down is shown')
const opts = [...sel.options].map((o) => o.value)
check(opts.includes('border') && opts.includes('smooth'), 'it lists Border and Smooth: ' + opts.join(','))
const run = (v) => {
	sel.value = v
	sel.dispatchEvent(new Event('change', { bubbles: true }))
}
const t0 = performance.now()
run('border')
const borderMs = performance.now() - t0
const afterBorder = count()
check(afterBorder > 0 && afterBorder < before, `border leaves a band (${before} -> ${afterBorder})`)
check(m[(R / 2) * R + R / 2] === 0, 'the middle is cleared')
e.undo()
check(count() === before, 'undo brings the square back')
run('smooth')
const afterSmooth = count()
check(Math.abs(afterSmooth - before) < before * 0.05, `smooth keeps the square about the same (${afterSmooth})`)
e.undo()
check(count() === before, 'undo of smooth')
document.querySelector('[data-ui="OptionsBar"] .brushbtn')?.click()
return { ok: !bad.length, bad, before, afterBorder, afterSmooth, borderMs: Math.round(borderMs) }

// Wheel over a slider (#847): scrolling over a range input steps its value one step a notch (up on scroll up), clamped to its range, with no click first; the input and change handlers run (the brush size follows), Ctrl+wheel and a disabled slider are left alone, and the wheel over the canvas still zooms.
// touches: frontend/src/lib/ui/wheelValue.ts, frontend/src/components/OptSlider.svelte, frontend/src/components/Slider.svelte
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'sculpt'
await P.frames(2)
const bad = []
const range = [...document.querySelectorAll('input[type=range]')].find((i) => !i.disabled && i.offsetParent && i.closest('label')?.textContent?.includes('Size'))
if (!range) bad.push('no visible Size slider in the options bar')
else {
	const wheel = (dy, init = {}) => range.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true, ...init }))
	const step = Number(range.step) || 1
	const v0 = Number(range.value)
	let fired = 0
	range.addEventListener('change', () => fired++)
	const size0 = editor.brush.radius
	const ev = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
	range.dispatchEvent(ev)
	await P.frames(1)
	if (!ev.defaultPrevented) bad.push('the wheel was not kept from scrolling the panel')
	if (Math.abs(Number(range.value) - (v0 + step)) > 1e-6) bad.push(`scroll up: ${v0} -> ${range.value}, wanted +${step}`)
	if (fired !== 1) bad.push(`change fired ${fired} times`)
	if (editor.brush.radius === size0 && v0 + step <= Number(range.max)) bad.push('the brush size did not follow the slider')
	wheel(100)
	await P.frames(1)
	if (Math.abs(Number(range.value) - v0) > 1e-6) bad.push(`scroll down: ${range.value}, wanted ${v0}`)
	wheel(-100, { ctrlKey: true })
	if (Math.abs(Number(range.value) - v0) > 1e-6) bad.push('Ctrl+wheel moved the slider')
	for (let i = 0; i < 400; i++) wheel(-100)
	if (Number(range.value) !== Number(range.max)) bad.push(`not clamped at the max: ${range.value}`)
	for (let i = 0; i < 400; i++) wheel(100)
	if (Number(range.value) !== Number(range.min)) bad.push(`not clamped at the min: ${range.value}`)
	range.disabled = true
	const d0 = range.value
	wheel(-100)
	if (range.value !== d0) bad.push('a disabled slider moved')
	range.disabled = false
}
return { ok: bad.length === 0, bad }

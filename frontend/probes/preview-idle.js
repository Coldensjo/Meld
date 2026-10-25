// The asset browser's preview and the Preview window draw only while something moves (#589): a hovered tile's model spins a few seconds and stops, the pointer over the preview spins it again, the Preview window on a still helper shape draws nothing until Turn is checked, and Graphics › FPS limit caps their frames; prints the frames each drew in 2 s, idle and moving.
// touches: frontend/src/components/AssetPreview.svelte, frontend/src/components/CreaturePreview.svelte, frontend/src/components/ModelPreviewWindow.svelte, frontend/src/components/PaletteTile.svelte, frontend/src/lib/ui/previewRenderer.ts
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const { ui, prefs } = await P.state()

// Counts a canvas's frames: the draws of one task are one frame.
function counter(canvas) {
	const gl = canvas.getContext('webgl2')
	const c = { frames: 0 }
	let pending = false
	const count = () => {
		if (pending) return
		pending = true
		queueMicrotask(() => {
			pending = false
			c.frames++
		})
	}
	for (const name of ['drawElements', 'drawArrays']) {
		const f = gl[name].bind(gl)
		gl[name] = (...a) => {
			count()
			return f(...a)
		}
	}
	return c
}
/** Frames drawn in `ms`. */
async function framesIn(c, ms) {
	const from = c.frames
	await wait(ms)
	return c.frames - from
}

const limit = prefs.fpsLimit
const browserKind = prefs.browserKind
try {
	prefs.fpsLimit = 0
	// The doodads tab, whose first tile is a still model.
	prefs.browserKind = 'm2'
	await wait(300)
	// The asset browser's preview: a hovered tile's model spins, then settles.
	const tile = await P.until(() => document.querySelector('[data-ui="PaletteTile"]'), 60_000, 'a palette tile')
	const view = document.querySelector('[role="img"][aria-label="Model preview"]')
	const canvas = view?.querySelector('canvas')
	if (!canvas) throw new Error('no asset preview canvas')
	const asset = counter(canvas)
	tile.dispatchEvent(new PointerEvent('pointerenter'))
	await P.until(() => asset.frames > 0, 120_000, 'the asset preview to draw the hovered model')
	const spinning = await framesIn(asset, 2000)
	// The spin lasts a few seconds after the model is shown.
	await wait(6000)
	const settled = await framesIn(asset, 2000)
	// The pointer over the preview spins it again, and the FPS limit caps it.
	view.dispatchEvent(new PointerEvent('pointerenter'))
	await wait(300)
	const hovered = await framesIn(asset, 2000)
	prefs.fpsLimit = 5
	await wait(300)
	const limited = await framesIn(asset, 2000)
	prefs.fpsLimit = 0
	view.dispatchEvent(new PointerEvent('pointerleave'))
	tile.dispatchEvent(new PointerEvent('pointerleave'))
	await wait(500)
	const left = await framesIn(asset, 2000)

	// The Preview window on a still shape: one frame, then nothing until Turn is checked.
	ui.modelPreview = { title: 'probe', type: 'helper:cube:4', scale: 1 }
	const win = await P.until(() => document.querySelector('[role="dialog"][aria-label="Model preview"]'), 30_000, 'the Preview window')
	const winCanvas = win.querySelector('canvas')
	const preview = counter(winCanvas)
	await wait(1500)
	const still = await framesIn(preview, 2000)
	const turn = win.querySelector('label.spin input')
	turn.click()
	await wait(300)
	const turning = await framesIn(preview, 2000)
	turn.click()
	await wait(300)
	const stopped = await framesIn(preview, 2000)
	ui.modelPreview = null

	const asset2s = { spinning, settled, hovered, limited, left }
	const window2s = { still, turning, stopped }
	// Headless Chrome throttles the previews' rAF, so "moving" only needs a few frames; the limit allows 5 a second and a frame of slack.
	const ok = spinning >= 3 && settled === 0 && hovered >= 3 && limited <= 11 && left === 0 && still === 0 && turning >= 3 && stopped === 0
	return { ok, asset2s, window2s }
} finally {
	prefs.fpsLimit = limit
	prefs.browserKind = browserKind
	ui.modelPreview = null
}

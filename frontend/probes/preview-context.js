// The asset browser's preview and the Preview window (CreaturePreview) draw the model again, with no WebGL errors, after their own WebGL context is lost and restored (#213), and a closed Preview's released context stays lost.
// touches: frontend/src/components/AssetPreview.svelte, frontend/src/components/CreaturePreview.svelte, frontend/src/components/ModelPreviewWindow.svelte, frontend/src/lib/ui/previewRenderer.ts
await P.scene(P.BENCH)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Counts a canvas's draws and errors, and how much of the picture is drawn after its last draw of a
// frame (read in a microtask, the same task, before the drawing buffer is cleared).
function watch(canvas) {
	const gl = canvas.getContext('webgl2')
	const w = { gl, draws: 0, errs: [], lit: -1 }
	let pending = false
	const draw = gl.drawElements.bind(gl)
	gl.drawElements = (...a) => {
		w.draws++
		const r = draw(...a)
		const e = gl.getError()
		if (e !== 0) w.errs.push(e)
		if (!pending) {
			pending = true
			queueMicrotask(() => {
				pending = false
				const n = gl.drawingBufferWidth * gl.drawingBufferHeight
				const px = new Uint8Array(n * 4)
				gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px)
				let on = 0
				for (let i = 3; i < px.length; i += 4) if (px[i] > 0) on++
				w.lit = on / n
			})
		}
		return r
	}
	return w
}

// Its rAF runs on its own (throttled in a hidden page), so this waits for draws, not frames.
async function loseAndRestore(name, canvas) {
	const w = watch(canvas)
	await P.until(() => w.draws > 20 && w.lit > 0, 180_000, `${name}: its draws`)
	await wait(1000)
	const before = w.lit
	const ext = w.gl.getExtension('WEBGL_lose_context')
	ext.loseContext()
	await wait(500)
	const lost = w.gl.isContextLost()
	// getError gives CONTEXT_LOST_WEBGL once after a loss; it is not the preview's.
	w.gl.getError()
	w.draws = 0
	w.lit = -1
	w.errs.length = 0
	ext.restoreContext()
	await P.until(() => w.draws > 20 && w.lit >= 0, 180_000, `${name}: its draws after the restore`)
	await wait(1000)
	const r = { lost, restored: !w.gl.isContextLost(), litBefore: +before.toFixed(3), litAfter: +w.lit.toFixed(3), errs: w.errs.slice(0, 5) }
	// The model turns, so its drawn share moves a little between shots.
	r.ok = r.lost && r.restored && r.errs.length === 0 && r.litAfter > 0.01 && Math.abs(r.litAfter - r.litBefore) < 0.1
	return r
}

// The asset browser's preview, with a hovered model tile, and the pointer over the preview so its
// model keeps spinning and drawing (#589: a still preview draws nothing).
const tile = await P.until(() => document.querySelector('[data-ui="PaletteTile"]'), 60_000, 'a palette tile')
tile.dispatchEvent(new PointerEvent('pointerenter'))
const assetView = document.querySelector('[role="img"][aria-label="Model preview"]')
const assetCanvas = assetView?.querySelector('canvas')
if (!assetCanvas) throw new Error('no asset preview canvas')
assetView.dispatchEvent(new PointerEvent('pointerenter'))
const asset = await loseAndRestore('asset preview', assetCanvas)
assetView.dispatchEvent(new PointerEvent('pointerleave'))
tile.dispatchEvent(new PointerEvent('pointerleave'))

// The Preview window, on a model of the scene with particles where there is one (#200).
const { ui } = await P.state()
const types = [...new Set([...P.e.objects.objects.values()].map((o) => o.type))].filter((t) => t.startsWith('m2:'))
const api = await P.app('/src/lib/wow/api.ts')
let type = types[0]
for (const t of types.slice(0, 150)) {
	if ((await api.fetchMesh(t.slice(3))).emitters.length) {
		type = t
		break
	}
}
ui.modelPreview = { title: 'probe', type, scale: 1 }
const winCanvas = await P.until(() => document.querySelector('[role="dialog"][aria-label="Model preview"] canvas'), 30_000, 'the Preview window')
const preview = await loseAndRestore('Preview window', winCanvas)

// Closing releases the context (#201); nothing brings it back.
const gl = winCanvas.getContext('webgl2')
ui.modelPreview = null
await wait(1500)
const closedStaysLost = gl.isContextLost()

return { ok: asset.ok && preview.ok && closedStaysLost, type, asset, preview, closedStaysLost }

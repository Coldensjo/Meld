// The helper every probe gets as `P`. Runs in the dev page (plain JS, not type-checked).
const P = {
	/** The Engine (`window.__engine`); read it again after `scene`, which may swap the document. */
	get e() {
		return window.__engine
	},

	/** The benchmark scene (docs/TESTS.md, "Measuring performance"): Northshire, over the abbey. */
	BENCH: 'Meld scene {"v":1,"map":{"region":{"mapName":"Azeroth","x":32,"y":48,"size":1}},"view":{"target":[182,30,353],"yaw":0.5,"pitch":0.6,"distance":60,"hour":13},"prefs":{},"tool":"select","selectedIds":[],"selected":null,"area":null,"viewport":[1000,600]}',

	/** An app module by path, through the URL the page loaded it from (a bare path gives a second copy). */
	async app(path) {
		const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes(path))
		// A full resource buffer (250 entries by default; the runner raises it) drops the app's own URL.
		if (!url && performance.getEntriesByType('resource').length >= 250) throw new Error(`P.app: ${path} is not among the page's resource entries, which may be truncated`)
		return import(url ?? path)
	},

	/** Loads a scene: a `Meld scene {...}` line, or its object. */
	async scene(s) {
		await window.__loadScene(typeof s === 'string' ? s : 'Meld scene ' + JSON.stringify(s))
		await P.frames(2)
	},

	/** A macrotask without setTimeout's throttling in a hidden page. */
	tick() {
		return new Promise((r) => {
			const c = new MessageChannel()
			c.port1.onmessage = () => r()
			c.port2.postMessage(0)
		})
	},

	/**
	 * The longest `frame()` and the longest wait between frames since `resetStalls`, and when the frame
	 * came (ms after the reset). A timeout names them, so a stall doesn't look like a broken feature
	 * (#237); `frames` waiting for the GPU keeps them short (#233).
	 */
	stalls: { frame: 0, frameAt: 0, tick: 0, since: 0 },

	resetStalls() {
		const s = P.stalls
		s.frame = s.frameAt = s.tick = 0
		s.since = performance.now()
	},

	/** What `stalls` says, for an error message. */
	stallText() {
		const s = P.stalls
		const sec = (ms) => (ms / 1000).toFixed(1) + ' s'
		return `longest frame ${sec(s.frame)} at ${sec(s.frameAt)}, longest wait between frames ${sec(s.tick)}`
	},

	/** A pointer event on the viewport canvas at (`x`, `y`) as shares of it (y = 0 the top), with `opts` (`button`, `altKey`, `ctrlKey`, `shiftKey`, `buttons`). */
	pointer(type, x, y, opts = {}) {
		const c = window.__engine.renderer.domElement
		const r = c.getBoundingClientRect()
		c.dispatchEvent(new PointerEvent(type, { clientX: r.left + x * r.width, clientY: r.top + y * r.height, button: 0, pointerId: 1, bubbles: true, ...opts }))
	},

	/**
	 * Clicks the viewport at (`x`, `y`), shares of it with y = 0 the top (like `P.rect`): a move, a
	 * pointerdown and a pointerup, then `frames` frames so the handlers' messages have landed.
	 */
	async click(x, y, opts = {}, frames = 1) {
		P.pointer('pointermove', x, y, opts)
		P.pointer('pointerdown', x, y, opts)
		P.pointer('pointerup', x, y, opts)
		await P.frames(frames)
	},

	/** Drags the viewport from `from` to `to` (each `[x, y]` as for `click`) in `steps` moves, a frame after each. */
	async drag(from, to, steps = 8, opts = {}) {
		P.pointer('pointermove', from[0], from[1], opts)
		P.pointer('pointerdown', from[0], from[1], opts)
		await P.frames(1)
		for (let i = 1; i <= steps; i++) {
			const t = i / steps
			P.pointer('pointermove', from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, { buttons: 1, ...opts })
			await P.frames(1)
		}
		P.pointer('pointerup', to[0], to[1], opts)
		await P.frames(1)
	},

	/**
	 * Steps the app `n` frames (probes drive frames rather than wait on rAF), each one waiting until
	 * the GPU has drawn it. Without that wait nothing holds the probe back: `until` stepped frames as
	 * fast as the page's tasks ran while it waited on a binding, SwiftShader fell tens of seconds
	 * behind, and the next call that reads from the GPU (a shader's info log, `toDataURL`, a uniform
	 * upload) stalled 20 to 45 s while the backlog drew (#233).
	 */
	async frames(n = 1) {
		const s = P.stalls
		for (let i = 0; i < n; i++) {
			const t0 = performance.now()
			await P.tick()
			const t1 = performance.now()
			window.__engine.frame()
			const t2 = performance.now()
			if (t1 - t0 > s.tick) s.tick = t1 - t0
			if (t2 - t1 > s.frame) {
				s.frame = t2 - t1
				s.frameAt = t1 - s.since
			}
			await P.drawn()
		}
	},

	/**
	 * Resolves once the viewport's GPU has finished what it was given so far (a WebGL2 fence): at once
	 * if the context is lost, and after 30 s at most.
	 */
	async drawn() {
		const gl = window.__engine.renderer.getContext()
		const sync = gl.isContextLost() ? null : gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
		if (!sync) return
		gl.flush()
		// A fence's status changes only between tasks. A millisecond's timer, not P.tick: spinning on
		// ticks keeps a core busy that SwiftShader would draw with.
		const end = performance.now() + 30_000
		while (!gl.isContextLost() && gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED && performance.now() < end) await new Promise((r) => setTimeout(r, 1))
		gl.deleteSync(sync)
	},

	/** Steps frames until `fn()` is truthy, and returns it; throws after `timeout` ms, naming the longest stall. */
	async until(fn, timeout = 300_000, what = 'the condition') {
		P.resetStalls()
		const end = performance.now() + timeout
		for (;;) {
			const v = fn()
			if (v) return v
			if (performance.now() > end) throw new Error(`timed out waiting for ${what} (${P.stallText()})`)
			await P.frames(1)
		}
	},

	/** Steps frames until no read from the client has been open for `quietMs` (models, textures, tiles). */
	async settle(quietMs = 1500, timeout = 300_000) {
		const { readLoad } = await P.app('/src/lib/wow/loadProgress.ts')
		const b = {}
		P.resetStalls()
		let quietSince = performance.now()
		const end = performance.now() + timeout
		for (;;) {
			await P.frames(1)
			readLoad(b)
			const now = performance.now()
			if (b.started !== b.done) quietSince = now
			else if (now - quietSince > quietMs) return
			if (now > end) throw new Error(`timed out waiting for loads to finish (${b.done} of ${b.started} done, last ${b.kind} ${b.path}; ${P.stallText()})`)
		}
	},

	/**
	 * The viewport's pixels: steps one frame (or calls `draw`) and reads the canvas back in the same
	 * task, which needs no preserveDrawingBuffer. Rows run bottom-up, as `readPixels` gives them.
	 * `lit` is the share of pixels with any channel above 8, so a blank read can't pass as "the same".
	 */
	async shot(draw) {
		await P.tick()
		const e = window.__engine
		if (draw) draw()
		else e.frame()
		const gl = e.renderer.getContext()
		const w = gl.drawingBufferWidth
		const h = gl.drawingBufferHeight
		const px = new Uint8Array(w * h * 4)
		gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
		let lit = 0
		for (let i = 0; i < px.length; i += 4) if (px[i] > 8 || px[i + 1] > 8 || px[i + 2] > 8) lit++
		return { w, h, px, lit: lit / (w * h) }
	},

	/** The pixel rows and columns of `region` ({ x0, x1, y0, y1 } as shares of the image, y0 = 0 the top; default all). */
	rect(img, region) {
		const r = region ?? {}
		const x0 = Math.floor((r.x0 ?? 0) * img.w)
		const x1 = Math.ceil((r.x1 ?? 1) * img.w)
		// readPixels' row 0 is the bottom.
		const y0 = Math.floor((1 - (r.y1 ?? 1)) * img.h)
		const y1 = Math.ceil((1 - (r.y0 ?? 0)) * img.h)
		return { x0, x1, y0, y1 }
	},

	/**
	 * How two shots differ in `region`: `off`, the share of pixels whose largest RGB difference is over
	 * `threshold`, and `mean`, that difference averaged. Take two shots with nothing changed first as
	 * the noise floor (swaying trees, particles).
	 */
	diff(a, b, threshold = 10, region) {
		const { x0, x1, y0, y1 } = P.rect(a, region)
		let off = 0
		let sum = 0
		for (let y = y0; y < y1; y++)
			for (let x = x0; x < x1; x++) {
				const i = (y * a.w + x) * 4
				const d = Math.max(Math.abs(a.px[i] - b.px[i]), Math.abs(a.px[i + 1] - b.px[i + 1]), Math.abs(a.px[i + 2] - b.px[i + 2]))
				if (d > threshold) off++
				sum += d
			}
		const n = Math.max(1, (x1 - x0) * (y1 - y0))
		return { off: off / n, mean: sum / n, litA: a.lit, litB: b.lit }
	},

	/** How busy a shot is in `region`: the mean RGB difference between horizontal neighbours (shimmer, noise, detail). */
	busy(img, region) {
		const { x0, x1, y0, y1 } = P.rect(img, region)
		let sum = 0
		let n = 0
		for (let y = y0; y < y1; y++)
			for (let x = Math.max(1, x0); x < x1; x++) {
				const i = (y * img.w + x) * 4
				sum += Math.abs(img.px[i] - img.px[i - 4]) + Math.abs(img.px[i + 1] - img.px[i - 3]) + Math.abs(img.px[i + 2] - img.px[i - 2])
				n += 3
			}
		return n ? sum / n : 0
	},

	/** Runs `fn` with every visible scene child but `keep` (one object or a list) and the lights hidden, then shows them again. */
	async only(keep, fn) {
		const e = window.__engine
		const kept = Array.isArray(keep) ? keep : [keep]
		const hidden = e.scene.children.filter((c) => c.visible && !kept.includes(c) && !c.isLight)
		for (const c of hidden) c.visible = false
		try {
			return await fn()
		} finally {
			for (const c of hidden) c.visible = true
		}
	},

	/** `measurePerf()` while stepping frames (it reports after a second of frames). */
	async perf() {
		let r = null
		window.__engine.measurePerf().then((x) => (r = x))
		await P.until(() => r, 120_000, 'the performance report')
		return r
	},

	/** The editor state module (`editor`, `prefs`, `ui`), the app's own instance. */
	async state() {
		return P.app('/src/lib/state/editor.svelte.ts')
	},

	/** WebGL errors since the last call (0 = none). */
	glError() {
		const gl = window.__engine.renderer.getContext()
		let n = 0
		while (gl.getError() !== gl.NO_ERROR && n < 32) n++
		return n
	},
}

// The probes drive the frames (P.frames), so the app's own loop is stopped: on SwiftShader it kept
// about 14 cores drawing frames nobody looked at, and every probe frame waited behind them (#233).
// The previews' own loops (CreaturePreview) still run.
window.__engine.stopLoop()

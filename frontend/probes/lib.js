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

	/** Steps the app `n` frames (the headless page's rAF is throttled, so probes drive frames). */
	async frames(n = 1) {
		for (let i = 0; i < n; i++) {
			await P.tick()
			window.__engine.frame()
		}
	},

	/** Steps frames until `fn()` is truthy, and returns it; throws after `timeout` ms. */
	async until(fn, timeout = 300_000, what = 'the condition') {
		const end = performance.now() + timeout
		for (;;) {
			const v = fn()
			if (v) return v
			if (performance.now() > end) throw new Error(`timed out waiting for ${what}`)
			await P.frames(1)
		}
	},

	/** Steps frames until no read from the client has been open for `quietMs` (models, textures, tiles). */
	async settle(quietMs = 1500, timeout = 300_000) {
		const { readLoad } = await P.app('/src/lib/wow/loadProgress.ts')
		const b = {}
		let quietSince = performance.now()
		const end = performance.now() + timeout
		for (;;) {
			await P.frames(1)
			readLoad(b)
			const now = performance.now()
			if (b.started !== b.done) quietSince = now
			else if (now - quietSince > quietMs) return
			if (now > end) throw new Error('timed out waiting for loads to finish')
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

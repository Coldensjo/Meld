// The helper every probe gets as `P`. Runs in the dev page (plain JS, not type-checked).
const P = {
	/** The Engine (`window.__engine`); read it again after `scene`, which may swap the document. */
	get e() {
		return window.__engine
	},

	/**
	 * The benchmark scene (docs/TESTS.md, "Measuring performance"): Northshire, over the abbey. Its view is
	 * an orbit 60 yd out, so it turns Follow the Ground on: with the default flying camera the target is
	 * the camera itself, down on the ground (#256).
	 */
	BENCH: 'Meld scene {"v":1,"map":{"region":{"mapName":"Azeroth","x":32,"y":48,"size":1}},"view":{"target":[182,30,353],"yaw":0.5,"pitch":0.6,"distance":60,"hour":13},"prefs":{"cameraFollowGround":true},"tool":"select","selectedIds":[],"selected":null,"area":null,"viewport":[1000,600]}',

	/**
	 * Points every client read and write at a fresh throwaway copy of the client (#368), so a probe can press
	 * what writes Meld's patch: the copy's archives are links to the real ones and its patch a copy, made
	 * again at each call. Throws when it can't, so a probe never writes the real client by mistake. Returns
	 * `{ dataDir, realPatch }`. The runner ends it after the probe; `P.endSandbox()` ends it sooner and says
	 * whether the real patch kept its size and time (`realUnchanged`). While it is on, nothing closes the
	 * game, starts the servers or writes the server's tables (they answer with an error).
	 */
	async sandboxClient() {
		const sb = await window.go.main.App.StartClientSandbox()
		if (!sb?.dataDir) throw new Error('P.sandboxClient: the throwaway client did not start')
		window.__probeSandbox = true
		return sb
	},

	/** Ends the throwaway client (`P.sandboxClient`): `{ wasOn, realUnchanged, realPatch }`. */
	async endSandbox() {
		window.__probeSandbox = false
		return await window.go.main.App.EndClientSandbox()
	},

	/** Writes bytes (a Uint8Array or a Blob) as a file of the throwaway client's scratch folder, for a binding that reads a file the user picked; returns its path. */
	async sandboxFile(name, bytes) {
		if (bytes instanceof Blob) bytes = new Uint8Array(await bytes.arrayBuffer())
		let bin = ''
		for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
		return await window.go.main.App.SandboxWriteFile(name, btoa(bin))
	},

	/** The open dialog with this accessible name: `aria-label`, or the text of its `aria-labelledby` heading (Modal, #369). Null when none. */
	dialog(name) {
		return (
			[...document.querySelectorAll('[role=dialog]')].find((d) => {
				if (d.getAttribute('aria-label') === name) return true
				const id = d.getAttribute('aria-labelledby')
				return !!id && document.getElementById(id)?.textContent.trim() === name
			}) ?? null
		)
	},

	/** An app module by path, through the URL the page loaded it from (a bare path gives a second copy). */
	async app(path) {
		const url = performance
			.getEntriesByType('resource')
			.map((r) => r.name)
			.find((n) => n.includes(path))
		// A full resource buffer (250 entries by default; the runner raises it) drops the app's own URL.
		if (!url && performance.getEntriesByType('resource').length >= 250) throw new Error(`P.app: ${path} is not among the page's resource entries, which may be truncated`)
		return import(url ?? path)
	},

	/**
	 * The runner calls this before every probe: Flying View, the camera the probes were written for (the
	 * app's default before #750, which made Orbit View the default). A probe that wants Orbit View sets
	 * `cameraFollowGround: true` (its scene's prefs, as `P.BENCH` does, or the pref itself).
	 */
	async flyingStart() {
		const { prefs } = await P.state()
		prefs.cameraFollowGround = false
		await P.frames(1)
	},

	/** Loads a scene: a `Meld scene {...}` line, or its object. Its view is a flying camera unless the scene sets `cameraFollowGround` (see `lookAt`). */
	async scene(s) {
		await window.__loadScene(typeof s === 'string' ? s : 'Meld scene ' + JSON.stringify(s))
		await P.frames(2)
	},

	/**
	 * Puts the camera `back` yards from the editor point `at` ({ x, y, z }) looking at it, whatever the
	 * Follow the Ground pref. The camera flies there: a flying camera is where its target is, so a view
	 * "on" a point would put the camera inside it, and a following one lifts the target onto the
	 * terrain, above a cave (#309). `yaw` is the direction the camera sits in (0 = +z of the point).
	 */
	async lookAt(at, { yaw = 0, pitch = 0.2, back = 10 } = {}) {
		const c = window.__engine.controller
		c.setFollowGround(false)
		const cp = Math.cos(pitch)
		c.setView(at.x + Math.sin(yaw) * cp * back, at.y + Math.sin(pitch) * back, at.z + Math.cos(yaw) * cp * back, yaw, pitch, 1)
		await P.frames(2)
	},

	/**
	 * Right-clicks the viewport at (`x`, `y`), shares of it with y = 0 the top (default the centre),
	 * through `Engine.openContextMenu` (private), and returns `ui.contextMenu` (null: no menu).
	 */
	async contextMenu(x = 0.5, y = 0.5) {
		const e = window.__engine
		const r = e.renderer.domElement.getBoundingClientRect()
		e.openContextMenu(new PointerEvent('pointerup', { clientX: r.left + x * r.width, clientY: r.top + y * r.height, button: 2 }))
		const { ui } = await P.state()
		return ui.contextMenu
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
		if (typeof timeout !== 'number') throw new Error(`P.until: timeout must be a number of ms, got ${typeof timeout} (${String(timeout)}); the step name goes third`)
		P.resetStalls()
		window.__probeStep = `P.until: ${what}`
		const end = performance.now() + timeout
		for (;;) {
			const v = fn()
			if (v && typeof v.then === 'function') {
				window.__probeStep = null
				throw new Error(`P.until: the condition returned a Promise (${what}), which is always truthy; await inside the probe instead`)
			}
			if (v) {
				window.__probeStep = null
				return v
			}
			if (performance.now() > end) throw new Error(`timed out waiting for ${what} (${P.stallText()})`)
			await P.frames(1)
		}
	},

	/**
	 * Steps frames until no read from the client has been open for `quietMs` (models, textures, tiles)
	 * and the spawn layer's `version` has not changed for as long: a spawn arriving later bumps it,
	 * which redraws both shadow maps under a measurement (#393). A version that keeps changing is
	 * waited on for at most 10 s past the reads, so an animated layer can't time out.
	 */
	async settle(quietMs = 1500, timeout = 300_000) {
		const { readLoad } = await P.app('/src/lib/wow/loadProgress.ts')
		const b = {}
		P.resetStalls()
		const version = () => window.__engine?.doc?.spawnLayer?.version ?? 0
		let quietSince = performance.now()
		let readsQuietAt = 0
		let seen = version()
		const end = performance.now() + timeout
		for (;;) {
			await P.frames(1)
			readLoad(b)
			const now = performance.now()
			window.__probeStep = `P.settle: ${b.done} of ${b.started} client reads done, last ${b.kind} ${b.path}`
			const v = version()
			if (v !== seen) {
				seen = v
				quietSince = now
			}
			if (b.started !== b.done) {
				quietSince = now
				readsQuietAt = 0
			} else if (!readsQuietAt) readsQuietAt = now
			if (b.started === b.done && (now - quietSince > quietMs || now - readsQuietAt > quietMs + 10_000)) {
				window.__probeStep = null
				return
			}
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

	/**
	 * Saves a shot as a PNG: `bun run probe <name> --shot <dir>` writes it to `<dir>/<probe>-<name>.png`
	 * (without `--shot` it is dropped). The image goes through `window.__probeShots`, which the runner
	 * empties, so its pixels stay out of the probe's printed result. `region` crops (as for `P.diff`).
	 */
	save(img, name, region) {
		const { x0, x1, y0, y1 } = P.rect(img, region)
		const w = x1 - x0
		const h = y1 - y0
		const out = new ImageData(w, h)
		// readPixels' row 0 is the bottom: write the rows flipped.
		for (let y = 0; y < h; y++) {
			const src = ((y1 - 1 - y) * img.w + x0) * 4
			out.data.set(img.px.subarray(src, src + w * 4), y * w * 4)
		}
		const c = document.createElement('canvas')
		c.width = w
		c.height = h
		c.getContext('2d').putImageData(out, 0, 0)
		;(window.__probeShots ??= []).push({ name, data: c.toDataURL('image/png').split(',')[1] })
	},

	/**
	 * One of the client's textures as a picture (#317), the same `{ w, h, px, lit }` as `shot`, so `P.save`
	 * and `P.diff` take it. `path` is a client path (`Textures\\Weather\\RainDropSplash01.blp`); write it
	 * with the Write tool, not a heredoc. Reads the decoded RGBA (`fetchImage`), not the GPU texture,
	 * which is DXT where S3TC is sampled. `size` scales it to that many pixels square (default its own
	 * size). `alpha` shows the alpha channel as grey instead of the colour; otherwise alpha is kept, and
	 * a transparent texel shows as whatever its RGB holds (opaque), so use `alpha` to see the cut-out.
	 * Rows are bottom-up like `shot`'s.
	 */
	async texture(path, { size, alpha = false } = {}) {
		const { fetchImage } = await P.app('/src/lib/wow/api.ts')
		const img = await fetchImage(path)
		let w = img.width
		let h = img.height
		let src = img.pixels
		if (size && (size !== w || size !== h)) {
			const a = document.createElement('canvas')
			a.width = w
			a.height = h
			a.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(src.slice(0, w * h * 4)), w, h), 0, 0)
			const b = document.createElement('canvas')
			b.width = b.height = size
			const bc = b.getContext('2d', { willReadFrequently: true })
			bc.drawImage(a, 0, 0, size, size)
			src = bc.getImageData(0, 0, size, size).data
			w = h = size
		}
		const px = new Uint8Array(w * h * 4)
		let lit = 0
		for (let y = 0; y < h; y++) {
			// The reply's row 0 is the top; the picture's is the bottom.
			const from = (h - 1 - y) * w * 4
			for (let x = 0; x < w; x++) {
				const i = from + x * 4
				const o = (y * w + x) * 4
				if (alpha) px[o] = px[o + 1] = px[o + 2] = src[i + 3]
				else {
					px[o] = src[i]
					px[o + 1] = src[i + 1]
					px[o + 2] = src[i + 2]
				}
				px[o + 3] = 255
				if (px[o] > 8 || px[o + 1] > 8 || px[o + 2] > 8) lit++
			}
		}
		return { w, h, px, lit: lit / (w * h) }
	},

	/** Hides (or with `false` shows) the panels, so the viewport fills the window (what Tab does), and steps frames for the resize. */
	async fullView(on = true) {
		const { ui } = await P.state()
		ui.hidePanels = on
		await P.frames(3)
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

	/**
	 * Names the scene object that drew a pixel (#299). `x`, `y` are shares of the viewport, y = 0 the top
	 * (as for `P.click`; default the centre). Steps a normal frame, then renders the scene once more with
	 * every drawable's fragment shader ending in a flat colour that encodes the mesh's index (the
	 * materials keep their own vertex shaders, depth state and discards, so geometry and alpha tests are
	 * as drawn; blending is off, and a fragment the material draws with alpha under 0.1 is dropped, so a soft particle does not hide what is behind it). Returns `{ name, type, chain, batch, layer, material, id, near }` or
	 * `null` when nothing drew there (the background); `near` is true when the pixel itself was an
	 * antialiased edge and a neighbour's colour was used. Everything is put back in a `finally`. Points,
	 * lines and sprites are hidden for the pass.
	 */
	async whoDrew(x = 0.5, y = 0.5) {
		await P.frames(1)
		const e = window.__engine
		const Color = e.env.state.horizon.constructor
		const meshes = []
		const hidden = []
		e.scene.traverse((o) => {
			if (!o.visible) return
			if (o.isMesh) meshes.push(o)
			else if (o.isPoints || o.isLine || o.isSprite) hidden.push(o)
		})
		const batchKeys = new Map()
		for (const [key, b] of e.objects.batches ?? []) for (const m of [b.mesh, b.lod, b.liquid]) if (m) batchKeys.set(m, key)
		const swapped = []
		const chainOf = (o) => {
			const parts = []
			for (let p = o; p; p = p.parent) parts.push(p.name || p.type)
			return parts.join(' < ')
		}
		let ids
		try {
			// Every mesh draws with its own material that inherits from the real one (so uniforms, textures,
			// depth state and the engine's later changes are still the real material's), with a fragment
			// shader that ends in the mesh's flat colour. A shared material would not do: three uploads a
			// built-in material's uniforms only when the material changes between draws.
			let nextMatId = 1e9
			ids = meshes.map((o, i) => {
				const id = i + 1
				const rgb = [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255]
				const derive = (m) => {
					const d = Object.create(m)
					Object.defineProperty(d, 'id', { value: nextMatId++ })
					const uWho = { value: rgb }
					if (m.isShaderMaterial) d.uniforms = Object.assign(Object.create(m.uniforms), { uWho })
					d.onBeforeCompile = (shader, renderer) => {
						m.onBeforeCompile.call(d, shader, renderer)
						shader.uniforms.uWho = uWho
						const fs = shader.fragmentShader
						const end = fs.lastIndexOf('}')
						shader.fragmentShader = `uniform vec3 uWho;
${fs.slice(0, end)}
	if (gl_FragColor.a < 0.1) discard;
	gl_FragColor = vec4(uWho, 1.0);
}${fs.slice(end + 1)}`
					}
					d.customProgramCacheKey = () => m.customProgramCacheKey.call(m) + '|who'
					d.blending = 0
					d.version = 1
					return d
				}
				swapped.push({ o, material: o.material })
				o.material = Array.isArray(o.material) ? o.material.map(derive) : derive(o.material)
				return o
			})
			for (const o of hidden) o.visible = false
			const bg = e.scene.background
			const fog = e.scene.fog
			e.scene.background = new Color(0, 0, 0)
			e.scene.fog = null
			let img
			try {
				img = await P.shot(() => e.renderer.render(e.scene, e.camera))
			} finally {
				e.scene.background = bg
				e.scene.fog = fog
			}
			const px = Math.min(img.w - 1, Math.floor(x * img.w))
			const py = Math.min(img.h - 1, Math.floor((1 - y) * img.h))
			const at = (cx, cy) => {
				if (cx < 0 || cy < 0 || cx >= img.w || cy >= img.h) return 0
				const i = (cy * img.w + cx) * 4
				return img.px[i] | (img.px[i + 1] << 8) | (img.px[i + 2] << 16)
			}
			let id = at(px, py)
			let near = false
			if (!id || id > ids.length) {
				id = 0
				for (let r = 1; r <= 2 && !id; r++)
					for (let dy = -r; dy <= r && !id; dy++)
						for (let dx = -r; dx <= r && !id; dx++) {
							const c = at(px + dx, py + dy)
							if (c && c <= ids.length) id = c
						}
				near = id > 0
			}
			if (!id) return null
			const o = ids[id - 1]
			const mat = Array.isArray(o.material) ? o.material[0] : o.material
			return {
				name: o.name || '(unnamed)',
				type: o.type,
				chain: chainOf(o),
				batch: batchKeys.get(o) ?? null,
				material: `${mat.type}${mat.name ? ' ' + mat.name : ''}`,
				id,
				near,
			}
		} finally {
			for (const s of swapped) s.o.material = s.material
			for (const o of hidden) o.visible = true
		}
	},

	/**
	 * A parameter from the command line (#347): `P.env('MAP', 'creatures')` reads the environment variable
	 * `PROBE_MAP` the run was started with (`PROBE_MAP=everything bun run probe ab.js`), as a string, or
	 * `fallback` when it is unset. When `fallback` is a number or boolean the value is converted to that
	 * type. Print what it returned in the probe's result, so a mistyped name shows.
	 */
	env(name, fallback) {
		const v = window.__probeEnv?.['PROBE_' + name]
		if (v === undefined || v === '') return fallback
		if (typeof fallback === 'number') {
			const n = Number(v)
			if (Number.isNaN(n)) throw new Error(`PROBE_${name}=${v} is not a number`)
			return n
		}
		if (typeof fallback === 'boolean') return !['0', 'false', 'off', 'no'].includes(v.toLowerCase())
		return v
	},

	/**
	 * `measurePerf()` while stepping frames (it reports after a second of frames), `windows` times
	 * (default 5, or `PERF_WINDOWS` from the environment; #337). One window holds two or three
	 * SwiftShader frames and its cpuMs swings by +-3 ms, so the report returned is the last window's with
	 * `cpuSamples`, the cpuMs of every window, and `sectionNames` / `sectionReports`, the CPU section
	 * names and every window's section ms, for `perfSummary` to average.
	 */
	async perf(windows) {
		const n = Math.max(1, Math.round(windows ?? Number(window.__probeEnv?.PERF_WINDOWS) ?? 5) || 5)
		const { CPU_SECTIONS } = await P.app('/src/lib/engine/perfMeter.ts')
		const samples = []
		const reports = []
		let r = null
		for (let i = 0; i < n; i++) {
			r = null
			window.__engine.measurePerf().then((x) => (r = x))
			await P.until(() => r, 120_000, 'the performance report')
			samples.push(r.cpuMs)
			reports.push(r.sections)
			if (i < n - 1) await P.frames(2)
		}
		r.cpuSamples = samples
		r.sectionNames = CPU_SECTIONS
		r.sectionReports = reports
		return r
	},

	/**
	 * A `perf()` report as a probe's line: what compares between runs. frameMs is the mean interval
	 * between frame starts over the one-second window; on SwiftShader a frame takes most of a second, so
	 * the window holds one or two intervals and the figure swings 5x between identical runs (#226): it is
	 * given only when the window held ten or more. cpuMeanMs is the mean of the `perf()` windows with
	 * cpuMinMs to cpuMaxMs as its spread: a change shows when the means differ by more than the spreads (#337).
	 * `sections` is the mean ms of each CPU section over the same windows, so a section an issue names reads off the line (#349).
	 */
	perfSummary(r) {
		const round = (v) => Math.round(v * 100) / 100
		const s = r.cpuSamples ?? [r.cpuMs]
		const sections = {}
		r.sectionNames?.forEach((name, i) => {
			const v = r.sectionReports.map((x) => x[i])
			sections[name] = round(v.reduce((a, b) => a + b, 0) / v.length)
		})
		return {
			cpuMeanMs: round(s.reduce((a, b) => a + b, 0) / s.length),
			cpuMinMs: round(Math.min(...s)),
			cpuMaxMs: round(Math.max(...s)),
			windows: s.length,
			sections,
			frameMs: r.frames > 10 ? round(r.frameMs) : null,
			frames: r.frames,
			cpuMs: round(r.cpuMs),
			gpuMs: r.gpu ? round(r.gpu.reduce((a, b) => a + b, 0)) : null,
			calls: r.calls,
			triangles: r.triangles,
			geometries: r.geometries,
			textures: r.textures,
			heapMB: r.heapMB,
			topModels: r.models.slice(0, 5).map((m) => `${m.type.split('?')[0].split(/[\\/]/).pop()} ${m.triangles}`),
		}
	},

	/**
	 * A/Bs a run-time switch in one page (#341). `set(on)` puts the app in state `on` (true or false;
	 * await it if it is async); the two states alternate `n` times (default 8), each with `P.frames(3)`
	 * to settle and one `P.perf(1)` window. Returns `{ off, on, delta }`: per state the CPU `mean`,
	 * `min` and `max` ms, the mean `calls` and `triangles`, and `sections`, the mean ms of each
	 * `CPU_SECTIONS` entry by name (the section timings are the clear signal for a change smaller than
	 * the frame's spread); `delta` is on minus off for the CPU mean and each section, and `overlap` names
	 * the measures whose [min, max] ranges overlap. Leaves the switch off. Needs the map built first.
	 * Sixteen windows after the everything map's 100 s build outrun the default 300 s limit: run it with
	 * `PROBE_TIMEOUT=900`. `opts.sections` limits the sections reported (names or substrings). `opts.turn` (radians a frame) turns the camera during the windows (`P.turn`, #348).
	 */
	async ab(set, n = 8, opts = {}) {
		const { CPU_SECTIONS } = await P.app('/src/lib/engine/perfMeter.ts')
		const want = opts.sections
		const names = CPU_SECTIONS.filter((s) => !want || want.some((w) => s.includes(w)))
		const runs = { off: [], on: [] }
		const stopTurn = opts.turn ? P.turn(opts.turn) : null
		try {
			for (let i = 0; i < n; i++) {
				for (const on of i % 2 ? [true, false] : [false, true]) {
					await set(on)
					await P.frames(3)
					runs[on ? 'on' : 'off'].push(await P.perf(1))
				}
			}
		} finally {
			stopTurn?.()
			await set(false)
		}
		const round = (v) => Math.round(v * 100) / 100
		const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
		const stat = (rs) => {
			const cpu = rs.map((r) => r.cpuMs)
			const sections = {}
			const ranges = {}
			for (const name of names) {
				const v = rs.map((r) => r.sections[CPU_SECTIONS.indexOf(name)])
				sections[name] = round(mean(v))
				ranges[name] = [Math.min(...v), Math.max(...v)]
			}
			return {
				mean: round(mean(cpu)),
				min: round(Math.min(...cpu)),
				max: round(Math.max(...cpu)),
				calls: Math.round(mean(rs.map((r) => r.calls))),
				triangles: Math.round(mean(rs.map((r) => r.triangles))),
				sections,
				ranges: { cpu: [Math.min(...cpu), Math.max(...cpu)], ...ranges },
			}
		}
		const off = stat(runs.off)
		const on = stat(runs.on)
		const delta = { cpu: round(on.mean - off.mean) }
		for (const name of names) delta[name] = round(on.sections[name] - off.sections[name])
		const overlap = Object.keys(on.ranges).filter((k) => on.ranges[k][0] <= off.ranges[k][1] && off.ranges[k][0] <= on.ranges[k][1])
		delete off.ranges
		delete on.ranges
		return { off, on, delta, overlap }
	},

	/**
	 * Times chosen methods (#348): `spec` lists what to wrap, either `{ '/src/lib/world/ObjectLayer.ts:ObjectLayer': ['update'] }`
	 * (an app module path, a colon and the exported class, resolved through `P.app` so the wrap lands on
	 * the page's own copy) or `[[Class, 'method'], ...]` for classes already in hand. Wraps the
	 * prototype methods and returns `{ snap(), reset(), restore() }`. `snap()` gives per method
	 * `{ ms, calls }` (an outermost call only: a call nested in the same method adds nothing) and
	 * `total`, the ms and calls of the outermost wrapped call of any method (a wrapped method called by
	 * another counts once there). `reset()` zeroes the counts in place, so call it between a load and a
	 * stroke; `restore()` puts the originals back. Wrap before the work to measure (`P.benchMap`).
	 */
	async time(spec) {
		const pairs = []
		if (Array.isArray(spec)) for (const [cls, name] of spec) pairs.push([cls.name + '.' + name, cls, name])
		else
			for (const [key, names] of Object.entries(spec)) {
				const [path, cname] = key.split(':')
				const cls = (await P.app(path))[cname]
				if (!cls) throw new Error(`P.time: ${path} exports no ${cname}`)
				for (const name of names) pairs.push([cname + '.' + name, cls, name])
			}
		const stats = {}
		const total = { ms: 0, calls: 0 }
		let depth = 0
		const undo = []
		for (const [label, cls, name] of pairs) {
			const f = cls.prototype[name]
			if (typeof f !== 'function') throw new Error(`P.time: ${label} is not a method`)
			const s = (stats[label] = { ms: 0, calls: 0, depth: 0 })
			cls.prototype[name] = function (...a) {
				const outer = s.depth++ === 0
				const top = depth++ === 0
				const t0 = performance.now()
				try {
					return f.apply(this, a)
				} finally {
					const dt = performance.now() - t0
					s.depth--
					depth--
					if (outer) {
						s.ms += dt
						s.calls++
					}
					if (top) {
						total.ms += dt
						total.calls++
					}
				}
			}
			undo.push(() => (cls.prototype[name] = f))
		}
		const round = (v) => Math.round(v * 10) / 10
		return {
			snap() {
				const out = { total: { ms: round(total.ms), calls: total.calls } }
				for (const [k, s] of Object.entries(stats)) out[k] = { ms: round(s.ms), calls: s.calls }
				return out
			},
			reset() {
				total.ms = total.calls = 0
				for (const s of Object.values(stats)) s.ms = s.calls = 0
			},
			restore() {
				for (const u of undo.splice(0)) u()
			},
		}
	},

	/**
	 * Turns the camera `step` radians of yaw every frame (#348), so a measurement sees the cost that comes
	 * only with movement; `P.perf` and the `perf-*` probes look at a still camera. Wraps
	 * `controller.update` and returns a function that stops it. `P.ab(set, n, { turn: 0.05 })` does this
	 * around its windows.
	 */
	turn(step) {
		const c = window.__engine.controller
		const f = c.update
		c.update = function (...a) {
			this.yaw += step
			return f.apply(this, a)
		}
		return () => {
			c.update = f
		}
	},

	/**
	 * A scripted brush stroke (#348): `tool` is an instance (`P.e.tools.sculpt`) or its name, `from` and
	 * `to` are `{ x, z }` in editor coordinates. Presses on `from`, ticks `n` times (default 30, `dt`
	 * 0.05) along the line with a frame after each stamp, releases on `to`, and steps a last frame.
	 * Set `editor.tool`, the mode and `editor.brush` first (see `undo-sculpt`). Returns `{ tickMs, ticks }`,
	 * the ms inside the tool's `tick` calls (what a stroke costs besides its frames). History gets the stroke as one edit.
	 */
	async stroke(tool, from, to, n = 30, dt = 0.05) {
		const e = window.__engine
		const t = typeof tool === 'string' ? e.tools[tool] : tool
		if (!t) throw new Error(`P.stroke: no tool ${tool}`)
		const V3 = e.controller.target.constructor
		const at = (p) => new V3(p.x, e.terrain.heightAt(p.x, p.z), p.z)
		let tickMs = 0
		t.onDown(e.ctx, at(from))
		for (let i = 1; i <= n; i++) {
			const k = i / n
			const t0 = performance.now()
			t.tick(e.ctx, dt, at({ x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k }))
			tickMs += performance.now() - t0
			await P.frames(1)
		}
		t.onUp(e.ctx)
		await P.frames(1)
		return { tickMs: Math.round(tickMs * 10) / 10, ticks: n }
	},

	/**
	 * Builds benchmark map `kind` (lib/bench/benchMaps.ts, #322) with `count` of its main thing (its
	 * default times `scale`, `PROBE_SCALE` from the environment when left out (#349), as Help › Benchmark map size does), sets its hour, flies the camera to its view, waits for the client reads
	 * to stop and measures it. `buildMs` is the map's build, `loadMs` that plus its models' loading.
	 */
	async benchMap(kind, count, scale = P.env('SCALE', 1)) {
		const m = await P.loadBenchMap(kind, count, scale)
		await P.frames(5)
		const r = await P.perf()
		return { ...m, ...P.perfSummary(r) }
	},

	/**
	 * `P.benchMap` without the measurement: builds the map, flies to its view and waits for the client
	 * reads to stop. For a probe that only needs the map: the measurement's windows of SwiftShader
	 * frames take 25 to 70 s a map, most of such a probe's time.
	 */
	async loadBenchMap(kind, count, scale = P.env('SCALE', 1)) {
		const { buildBenchMap, benchView, benchMap } = await P.app('/src/lib/bench/benchMaps.ts')
		const { prefs } = await P.state()
		const m = benchMap(kind)
		prefs.dayCycle = false
		prefs.timeOfDay = m.hour
		const t0 = performance.now()
		const d = await buildBenchMap(P.e, kind, count, 1, scale)
		const buildMs = Math.round(performance.now() - t0)
		benchView(P.e, kind)
		await P.frames(2)
		await P.settle()
		return {
			map: kind,
			stresses: m.stresses,
			scale,
			count: count ?? Math.round(m.count * scale),
			size: d.terrain.size,
			objects: d.objects.objects.size,
			spawns: d.spawnLayer.spawns.length,
			buildMs,
			loadMs: Math.round(performance.now() - t0),
		}
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
// The previews' own loops (lib/ui/previewRenderer.ts) still run, while their model moves (#589).
window.__engine.stopLoop()

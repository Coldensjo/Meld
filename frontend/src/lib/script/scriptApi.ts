// The Lua scripting engine (#28): runs a script under wasmoon (Lua 5.4 compiled to WebAssembly, MIT; the
// Lua Noggit Red itself builds against) with Noggit Red's script API (prelude.ts) over a `ScriptHost`,
// which the Engine gives for the active map (engine/ScriptRun.ts) and the tests give over plain arrays.
// Each script gets a fresh Lua state with the base, table, string and math libraries, and a time limit.
// A script that makes brushes (`brush(name)`, #29) keeps its state as a `ScriptSession`, whose brushes
// the Script Brush tool calls on each click, hold and release, each event under the same time limit.
import { LuaFactory, LuaLibraries, type LuaEngine } from 'wasmoon'
import { PRELUDE } from './prelude'
import { noiseAlgorithm, noiseGrid, seedOf } from './scriptNoise'

/** A model as the script sees it: rotation in degrees (y the yaw, as Noggit Red gives it), position in yards. */
export interface ScriptModel {
	id: number
	/** The client path, as the map holds it (`World\...\x.m2`). */
	file: string
	x: number
	y: number
	z: number
	rx: number
	ry: number
	rz: number
	scale: number
}

/** An image's pixels, RGBA a byte each, row by row from the top. */
export interface ScriptImage {
	width: number
	height: number
	data: Uint8Array
}

/**
 * What a script reaches of the editor. Positions are the map's (x and z across, y up, in yards);
 * vertex indices are the terrain grid's, `verts` a side and `cell` yards apart. A method that
 * refuses returns the reason as a string, which the script raises as its error.
 */
export interface ScriptHost {
	print(text: string): void
	/** The vertex grid (`verts` a side, `cell` yards apart) and the paint's texels a side (`tex`). */
	terrain(): { verts: number; cell: number; tex: number }
	/** The heights of the vertex rect (inclusive), row by row. */
	heights(x0: number, z0: number, x1: number, z1: number): number[]
	/** Writes `w` by `h` heights, row by row, from vertex (x0, z0). */
	setHeights(x0: number, z0: number, w: number, h: number, hs: number[]): void
	/** The models whose position lies in the rect, in yards. */
	models(x0: number, z0: number, x1: number, z1: number): ScriptModel[]
	addModel(kind: 'm2' | 'wmo', file: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number): ScriptModel | string
	setModel(id: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number): void
	removeModel(id: number): void
	/** Puts another model in the place of model `id` (its position, turn and scale). */
	replaceModel(id: number, file: string): ScriptModel | string
	camera(): { x: number; y: number; z: number; pitch: number; yaw: number }
	target(): { x: number; y: number; z: number }
	mapId(): number
	areaId(x: number, z: number): number
	/** The area the Select tool selected, as a rect in yards, or null. */
	area(): { x0: number; z0: number; x1: number; z1: number } | null
	// Chunks (#760): 8 by 8 cells, numbered row by row; a chunk's texture layers are its textures in
	// order, the first the base. Texels are the paint's grid (`tex` a side).
	/** The textures of chunk `c`'s layers, as the map's palette names them. */
	chunkTextures(c: number): string[]
	/** Adds a texture as chunk `c`'s top layer: its layer (the one it has, if it has it), -1 when the chunk has four, or why not. */
	chunkAddTexture(c: number, file: string): number | string
	chunkRemoveTexture(c: number, layer: number): void
	chunkClearTextures(c: number): void
	/** The ground effect ID layer `layer` of chunk `c` grows. */
	chunkEffect(c: number, layer: number): number
	chunkSetHole(c: number, hole: boolean): void
	chunkArea(c: number): number
	chunkSetArea(c: number, id: number): void
	chunkSetImpassable(c: number, on: boolean): void
	/** Four alphas (0..1) a texel of the texel rect (inclusive), row by row, by the texel's chunk's layers. */
	alphas(x0: number, z0: number, x1: number, z1: number): number[]
	/** Writes `w` by `h` texels' alphas as `alphas` gives them; the layers above the base keep theirs, the base takes the rest. */
	setAlphas(x0: number, z0: number, w: number, h: number, a: number[]): void
	/** Cuts (or fills) the hole block at vertex (vx, vz). */
	setHole(vx: number, vz: number, hole: boolean): void
	/** Puts liquid `type` (a LiquidType.dbc ID; 0 or less removes it) at vertex (vx, vz), its surface at `height`. */
	setWater(vx: number, vz: number, type: number, height: number): void
	/** Reads a PNG for `load_png` (#29): the image, or why not. Missing where no files can be read. */
	loadImage?(path: string): Promise<ScriptImage | string>
}

/** How long a script may run before it is stopped, in milliseconds; each brush event gets as long. */
export const SCRIPT_TIMEOUT = 10_000

let factory: LuaFactory | null = null

/**
 * The wasm module's URL: the app's bundled copy (luaWasm.ts sets it before the first run), or none under
 * `bun test`, where wasmoon reads it from node_modules.
 */
let wasmUrl: string | undefined

/** Sets where the Lua wasm module is fetched from; call before the first run. */
export function setLuaWasmUrl(url: string) {
	wasmUrl = url
}

/** The result of a run: whether it finished, and the error if not. */
export interface ScriptResult {
	ok: boolean
	error?: string
	/** How long it ran, in milliseconds. */
	ms: number
}

/** A setting of a script brush, which its panel shows as a control (Noggit Red's tags). */
export type TagSpec =
	| { kind: 'int' | 'real'; label: string; low: number; high: number; def: number; digits: number }
	| { kind: 'string'; label: string; def: string }
	| { kind: 'bool'; label: string; def: boolean }
	| { kind: 'list'; label: string; values: string[]; def: string }
	/** An empty row (add_null_tag). */
	| { kind: 'null'; label: '' }
	/** A line of text (add_description). */
	| { kind: 'description'; label: string }

export type TagValue = number | string | boolean

/** What a brush is told: the click, the hold of each frame after it, and the release. */
export const BRUSH_EVENTS = ['left_click', 'left_hold', 'left_release', 'right_click', 'right_hold', 'right_release'] as const
export type BrushEventKind = (typeof BRUSH_EVENTS)[number]

/** A brush a script made with `brush(name)`: its settings and the events it handles. */
export interface BrushSpec {
	name: string
	tags: TagSpec[]
	handles: BrushEventKind[]
}

/** One brush event: where, the brush's radius (inner as a part of the outer, 0 to 1) and the seconds since the last. */
export interface BrushEvent {
	x: number
	y: number
	z: number
	outer: number
	inner: number
	dt: number
}

/** The keys and buttons held, for `holding_*`. */
export interface BrushKeys {
	alt: boolean
	shift: boolean
	ctrl: boolean
	space: boolean
	left: boolean
	right: boolean
}

const NO_KEYS: BrushKeys = { alt: false, shift: false, ctrl: false, space: false, left: false, right: false }

/** The most pixels an image may have (create_image, load_png): 4096 by 4096. */
export const MAX_IMAGE_PIXELS = 4096 * 4096

/**
 * A Lua state with the script API loaded and a script run in it. A one-off run closes it at once
 * (`runScript`); a script that made brushes keeps it, and the Script Brush tool sends its events
 * (`event`) with the host of the map being painted. Noise maps and images live here, on the JavaScript
 * side, and the Lua side frees them when it collects them.
 */
export class ScriptSession {
	/** The editor the script reaches; the Script Brush tool sets the active map's for each stroke. */
	host: ScriptHost
	/** The keys held, for the next event. */
	keys: BrushKeys = NO_KEYS
	/** Called when an event sets the brush's radius (`evt:set_outer_radius`, `evt:set_inner_radius`). */
	onRadius: ((outer: number, inner: number) => void) | null = null
	readonly brushes: BrushSpec[] = []
	/** Each brush's tag values, by tag index. */
	readonly values: TagValue[][] = []
	private noises = new Map<number, { w: number; h: number; data: Float32Array }>()
	private images = new Map<number, ScriptImage>()
	private nextId = 1
	private closed = false
	private fallbackNoted = false

	constructor(
		private lua: LuaEngine,
		readonly name: string,
		host: ScriptHost,
		private timeout: number,
	) {
		this.host = host
	}

	/** Runs the prelude and the script. */
	async load(code: string, start: number): Promise<ScriptResult> {
		const g = this.lua.global
		try {
			for (const lib of [LuaLibraries.Base, LuaLibraries.Table, LuaLibraries.String, LuaLibraries.Math]) g.loadLibrary(lib)
			g.set('__host', this.hostTable(code))
			await this.runChunk(PRELUDE, [])
			return { ok: true, ms: performance.now() - start }
		} catch (e) {
			return this.failure(e, start)
		}
	}

	/** Sends brush `brush` an event; the brush's handler for it runs, if it has one. Never throws. */
	async event(brush: number, kind: BrushEventKind, e: BrushEvent): Promise<ScriptResult> {
		const start = performance.now()
		if (this.closed) return { ok: false, error: `${this.name}: the brush was unloaded`, ms: 0 }
		if (!this.brushes[brush]?.handles.includes(kind)) return { ok: true, ms: 0 }
		try {
			await this.runChunk('return __meld_event(...)', [brush, kind, e.x, e.y, e.z, e.outer, e.inner, e.dt])
			return { ok: true, ms: performance.now() - start }
		} catch (err) {
			return this.failure(err, start)
		}
	}

	/** Sets a tag's value, as the brush's panel changes it. */
	setTag(brush: number, tag: number, v: TagValue) {
		const vs = this.values[brush]
		if (vs && tag < vs.length) vs[tag] = v
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.lua.global.close()
		this.noises.clear()
		this.images.clear()
	}

	/** Noise maps and images held for the Lua side (the tests check they are freed). */
	get held(): number {
		return this.noises.size + this.images.size
	}

	/** Loads `code` into a new Lua thread and runs it with `args`, under the time limit. */
	private async runChunk(code: string, args: unknown[]) {
		const g = this.lua.global
		const top = g.getTop()
		try {
			const thread = g.newThread()
			thread.loadString(code, '=meld')
			for (const a of args) thread.pushValue(a)
			await thread.run(args.length, { timeout: this.timeout })
		} finally {
			// newThread leaves the thread on the main stack: drop it, so a brush's events don't pile up there.
			if (!this.closed) g.setTop(top)
		}
	}

	private failure(e: unknown, start: number): ScriptResult {
		const msg = e instanceof Error ? e.message : String(e)
		const error = /thread timeout exceeded/.test(msg) ? `${this.name}: stopped after ${this.timeout / 1000} s (an endless loop?)` : scriptTrace(msg, this.name)
		return { ok: false, error, ms: performance.now() - start }
	}

	/** The functions the prelude calls (`__host`), each reaching the current host. */
	private hostTable(code: string) {
		// wasmoon can't push null: a JS function that returns nothing returns undefined.
		const orNil = <T>(v: T | null): T | undefined => (v === null ? undefined : v)
		const h = () => this.host
		return {
			code: () => code,
			name: () => this.name,
			print: (s: string) => h().print(s),
			now: () => Date.now(),
			terrain: () => h().terrain(),
			heights: (x0: number, z0: number, x1: number, z1: number) => h().heights(x0, z0, x1, z1),
			set_heights: (x0: number, z0: number, w: number, hh: number, hs: unknown) => h().setHeights(x0, z0, w, hh, numbers(hs, w * hh)),
			models: (x0: number, z0: number, x1: number, z1: number) => h().models(x0, z0, x1, z1),
			add_model: (kind: string, file: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number) => h().addModel(kind === 'wmo' ? 'wmo' : 'm2', file, x, y, z, rx, ry, rz, scale),
			set_model: (id: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number) => h().setModel(id, x, y, z, rx, ry, rz, scale),
			remove_model: (id: number) => h().removeModel(id),
			replace_model: (id: number, file: string) => h().replaceModel(id, file),
			camera: () => h().camera(),
			target: () => h().target(),
			map_id: () => h().mapId(),
			area_id: (x: number, z: number) => h().areaId(x, z),
			area: () => orNil(h().area()),
			holding: (k: string) => !!this.keys[k as keyof BrushKeys],
			// Chunks, texels, holes and water (#760).
			chunk_textures: (c: number) => h().chunkTextures(c),
			chunk_add_texture: (c: number, file: string) => h().chunkAddTexture(c, file),
			chunk_remove_texture: (c: number, layer: number) => h().chunkRemoveTexture(c, layer),
			chunk_clear_textures: (c: number) => h().chunkClearTextures(c),
			chunk_effect: (c: number, layer: number) => h().chunkEffect(c, layer),
			chunk_set_hole: (c: number, hole: boolean) => h().chunkSetHole(c, hole),
			chunk_area: (c: number) => h().chunkArea(c),
			chunk_set_area: (c: number, id: number) => h().chunkSetArea(c, id),
			chunk_set_impassable: (c: number, on: boolean) => h().chunkSetImpassable(c, on),
			alphas: (x0: number, z0: number, x1: number, z1: number) => h().alphas(x0, z0, x1, z1),
			set_alphas: (x0: number, z0: number, w: number, hh: number, a: unknown) => h().setAlphas(x0, z0, w, hh, numbers(a, w * hh * 4)),
			set_hole: (vx: number, vz: number, hole: boolean) => h().setHole(vx, vz, hole),
			set_water: (vx: number, vz: number, type: number, height: number) => h().setWater(vx, vz, type, height),
			// Brushes and their tags (#29).
			add_brush: (name: string) => {
				this.brushes.push({ name, tags: [], handles: [] })
				this.values.push([])
				return this.brushes.length - 1
			},
			brush_name: (b: number, name: string) => {
				if (this.brushes[b]) this.brushes[b].name = name
			},
			brush_handles: (b: number, list: string) => {
				if (this.brushes[b]) this.brushes[b].handles = BRUSH_EVENTS.filter((k) => list.split(',').includes(k))
			},
			add_tag: (b: number, kind: string, label: string, low: number, high: number, def: TagValue, digits: number, values: string) => {
				const spec = tagSpec(kind, label, low, high, def, digits, values)
				const br = this.brushes[b]
				br.tags.push(spec)
				this.values[b].push('def' in spec ? spec.def : '')
				return br.tags.length - 1
			},
			tag: (b: number, t: number) => this.values[b]?.[t],
			set_radius: (outer: number, inner: number) => this.onRadius?.(outer, inner),
			// Noise maps (make_noise).
			noise_make: (sx: number, sy: number, w: number, hh: number, freq: number, algorithm: string, seed: string) => {
				if (!(w > 0 && hh > 0) || w * hh > MAX_IMAGE_PIXELS) return `invalid noise map size: width=${w} height=${hh}`
				const algo = noiseAlgorithm(algorithm)
				if (typeof algo === 'string') return algo
				if (algo.fallback && !this.fallbackNoted) {
					this.fallbackNoted = true
					h().print("make_noise: FastNoise2's encoded node trees can't be read in Meld; FRACTAL noise is used instead.")
				}
				const id = this.nextId++
				this.noises.set(id, { w, h: hh, data: noiseGrid(algo.name, sx, sy, w, hh, freq, seedOf(seed)) })
				return id
			},
			noise_get: (id: number, x: number, y: number) => {
				const m = this.noises.get(id)
				if (!m || !(x >= 0 && x < m.w && y >= 0 && y < m.h)) return undefined
				return m.data[(y | 0) * m.w + (x | 0)]
			},
			noise_set: (id: number, x: number, y: number, v: number) => {
				const m = this.noises.get(id)
				if (!m || !(x >= 0 && x < m.w && y >= 0 && y < m.h)) return false
				m.data[(y | 0) * m.w + (x | 0)] = v
				return true
			},
			// Noggit Red's check: no point from x - r to x + r - 1 (and so for y) is higher.
			noise_highest: (id: number, x: number, y: number, r: number) => {
				const m = this.noises.get(id)
				if (!m) return 'the noise map was freed'
				const out = (px: number, py: number) => `noise coordinates out of bounds: x=${px} y=${py} width=${m.w} height=${m.h}`
				if (!(x >= 0 && x < m.w && y >= 0 && y < m.h)) return out(x, y)
				const own = m.data[y * m.w + x]
				for (let xc = x - r; xc < x + r; xc++) {
					for (let yc = y - r; yc < y + r; yc++) {
						if (xc === x && yc === y) continue
						if (!(xc >= 0 && xc < m.w && yc >= 0 && yc < m.h)) return out(xc, yc)
						if (m.data[yc * m.w + xc] > own) return false
					}
				}
				return true
			},
			noise_free: (id: number) => void this.noises.delete(id),
			// Images (create_image, load_png).
			image_new: (w: number, hh: number) => {
				if (!(w > 0 && hh > 0) || w * hh > MAX_IMAGE_PIXELS) return `invalid image size: x=${w} y=${hh}`
				return this.keepImage({ width: w | 0, height: hh | 0, data: new Uint8Array((w | 0) * (hh | 0) * 4) })
			},
			image_load: async (path: string) => {
				const load = h().loadImage
				if (!load) return 'load_png: images can only be read in the desktop app'
				const img = await load.call(h(), path)
				if (typeof img === 'string') return `load_png: ${img}`
				if (img.width * img.height > MAX_IMAGE_PIXELS) return `load_png: ${path} is ${img.width}×${img.height}, over 4096×4096`
				return { id: this.keepImage(img), w: img.width, h: img.height }
			},
			// The pixel packed as Noggit Red packs it (red in the top byte), or a channel (0 red to 3 alpha) in 0..1.
			image_get: (id: number, x: number, y: number, c: number) => {
				const at = this.pixel(id, x, y)
				if (at < 0) return undefined
				const d = this.images.get(id)!.data
				if (c >= 0) return d[at + c] / 255
				return ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0
			},
			image_set: (id: number, x: number, y: number, r: number, g: number, b: number, a: number) => {
				const at = this.pixel(id, x, y)
				if (at < 0) return false
				const d = this.images.get(id)!.data
				const byte = (v: number) => Math.max(0, Math.min(255, Math.trunc(v * 255)))
				d[at] = byte(r)
				d[at + 1] = byte(g)
				d[at + 2] = byte(b)
				d[at + 3] = byte(a)
				return true
			},
			image_free: (id: number) => void this.images.delete(id),
		}
	}

	private keepImage(img: ScriptImage): number {
		const id = this.nextId++
		this.images.set(id, img)
		return id
	}

	/** The byte offset of pixel (x, y) of image `id`, or -1 off the image. */
	private pixel(id: number, x: number, y: number): number {
		const img = this.images.get(id)
		if (!img || !(x >= 0 && x < img.width && y >= 0 && y < img.height)) return -1
		return ((y | 0) * img.width + (x | 0)) * 4
	}
}

/** A tag as the prelude gives it, its default kept to its kind and range. */
function tagSpec(kind: string, label: string, low: number, high: number, def: TagValue, digits: number, values: string): TagSpec {
	switch (kind) {
		case 'int':
		case 'real': {
			const lo = Math.min(low, high)
			const hi = Math.max(low, high)
			const d = typeof def === 'number' && Number.isFinite(def) ? Math.min(hi, Math.max(lo, def)) : lo
			return { kind, label, low: lo, high: hi, def: kind === 'int' ? Math.round(d) : d, digits: kind === 'int' ? 0 : Math.max(0, Math.min(6, digits | 0)) }
		}
		case 'bool':
			return { kind, label, def: def === true }
		case 'list': {
			const vs = values ? values.split('\x1f') : []
			return { kind, label, values: vs, def: vs[0] ?? '' }
		}
		case 'null':
			return { kind: 'null', label: '' }
		case 'description':
			return { kind: 'description', label }
		default:
			return { kind: 'string', label, def: typeof def === 'string' ? def : String(def ?? '') }
	}
}

/**
 * Runs `code` (a file named `name`) in a fresh Lua state against `host`. Never throws: an error comes
 * back in the result. A script that made brushes comes back with its session, kept open for the
 * Script Brush tool; any other closes at once.
 */
export async function openScript(code: string, name: string, host: ScriptHost, timeout = SCRIPT_TIMEOUT): Promise<{ result: ScriptResult; session: ScriptSession | null }> {
	const start = performance.now()
	factory ??= new LuaFactory(wasmUrl)
	const lua = await factory.createEngine({ openStandardLibs: false, enableProxy: false })
	const session = new ScriptSession(lua, name, host, timeout)
	const result = await session.load(code, start)
	if (result.ok && session.brushes.length) return { result, session }
	session.close()
	return { result, session: null }
}

/** Runs `code` once against `host` and closes its state, brushes or not. Never throws. */
export async function runScript(code: string, name: string, host: ScriptHost, timeout = SCRIPT_TIMEOUT): Promise<ScriptResult> {
	const { result, session } = await openScript(code, name, host, timeout)
	session?.close()
	return result
}

/**
 * A Lua error with its traceback cut to the script's own lines (`name:line`): the prelude's frames
 * (`meld:`) and the C ones mean nothing to the script's author. No traceback when it adds nothing.
 */
export function scriptTrace(msg: string, name: string): string {
	const at = msg.indexOf('\nstack traceback:')
	if (at < 0) return msg
	const head = msg.slice(0, at)
	const own = msg
		.slice(at + 1)
		.split('\n')
		.filter((l) => l.trimStart().startsWith(`${name}:`))
	if (own.length < 2) return head
	return `${head}\n${own.map((l) => `  ${l.trim()}`).join('\n')}`
}

/** A Lua table of numbers as a JS array of `n` (wasmoon gives an empty table as an object). */
function numbers(t: unknown, n: number): number[] {
	const out = new Array<number>(n)
	const src = t as ArrayLike<number> & Record<number, number>
	for (let i = 0; i < n; i++) {
		const v = src[i]
		out[i] = typeof v === 'number' ? v : NaN
	}
	return out
}

// The Lua scripting engine (#28): runs a script under wasmoon (Lua 5.4 compiled to WebAssembly, MIT; the
// Lua Noggit Red itself builds against) with Noggit Red's script API (prelude.ts) over a `ScriptHost`,
// which the Engine gives for the active map (engine/ScriptRun.ts) and the tests give over plain arrays.
// Each run gets a fresh Lua state with the base, table, string and math libraries, and a time limit.
import { LuaFactory, LuaLibraries } from 'wasmoon'
import { PRELUDE } from './prelude'

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

/**
 * What a script reaches of the editor. Positions are the map's (x and z across, y up, in yards);
 * vertex indices are the terrain grid's, `verts` a side and `cell` yards apart. A method that
 * refuses returns the reason as a string, which the script raises as its error.
 */
export interface ScriptHost {
	print(text: string): void
	terrain(): { verts: number; cell: number }
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
}

/** How long a script may run before it is stopped, in milliseconds. */
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

/** Runs `code` (a file named `name`) against `host`. Never throws: an error comes back in the result. */
export async function runScript(code: string, name: string, host: ScriptHost, timeout = SCRIPT_TIMEOUT): Promise<ScriptResult> {
	const start = performance.now()
	factory ??= new LuaFactory(wasmUrl)
	const lua = await factory.createEngine({ openStandardLibs: false, enableProxy: false })
	try {
		for (const lib of [LuaLibraries.Base, LuaLibraries.Table, LuaLibraries.String, LuaLibraries.Math]) lua.global.loadLibrary(lib)
		// wasmoon can't push null: a JS function that returns nothing returns undefined.
		const orNil = <T>(v: T | null): T | undefined => (v === null ? undefined : v)
		lua.global.set('__host', {
			code: () => code,
			name: () => name,
			print: (s: string) => host.print(s),
			now: () => Date.now(),
			terrain: () => host.terrain(),
			heights: (x0: number, z0: number, x1: number, z1: number) => host.heights(x0, z0, x1, z1),
			set_heights: (x0: number, z0: number, w: number, h: number, hs: unknown) => host.setHeights(x0, z0, w, h, numbers(hs, w * h)),
			models: (x0: number, z0: number, x1: number, z1: number) => host.models(x0, z0, x1, z1),
			add_model: (kind: string, file: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number) => host.addModel(kind === 'wmo' ? 'wmo' : 'm2', file, x, y, z, rx, ry, rz, scale),
			set_model: (id: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number) => host.setModel(id, x, y, z, rx, ry, rz, scale),
			remove_model: (id: number) => host.removeModel(id),
			replace_model: (id: number, file: string) => host.replaceModel(id, file),
			camera: () => host.camera(),
			target: () => host.target(),
			map_id: () => host.mapId(),
			area_id: (x: number, z: number) => host.areaId(x, z),
			area: () => orNil(host.area()),
		})
		const thread = lua.global.newThread()
		thread.loadString(PRELUDE, '=meld')
		await thread.run(0, { timeout })
		return { ok: true, ms: performance.now() - start }
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		const error = /thread timeout exceeded/.test(msg) ? `${name}: stopped after ${timeout / 1000} s (an endless loop?)` : scriptTrace(msg, name)
		return { ok: false, error, ms: performance.now() - start }
	} finally {
		lua.global.close()
	}
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

import type { Engine } from '../engine/Engine'
import type { Prefs, ToolId } from '../state/editor.svelte'
import { prefValueOk } from '../state/prefsPatch'
import { isWorldPath } from '../cubes/world'

// Reading a pasted scene (io/scene.ts), kept apart from the engine and the state so it can be tested:
// a scene is typed by hand or by an agent, so nothing in it is trusted until it has been checked here.

export const PREFIX = 'Meld scene '
/** Scenes copied before the rename. */
export const OLD_PREFIX = 'WorldEditor scene '

/** The preferences that change what the view looks like. Layout and input prefs stay the viewer's. */
export const VIEW_PREFS = ['renderScale', 'viewDistance', 'fog', 'timeOfDay', 'dayCycle', 'cycleMinutes', 'clouds', 'shadows', 'look', 'mood'] as const satisfies readonly (keyof Prefs)[]

export type ViewPrefs = Partial<Pick<Prefs, (typeof VIEW_PREFS)[number]>>

export interface Scene {
	v: 1
	/** The world: its .world file, saved, or the cache copy of unsaved changes. */
	map: { file: string; copy?: boolean }
	view: ReturnType<Engine['sceneView']>
	prefs: ViewPrefs
	tool: ToolId
	/** The viewport's size in CSS pixels, so the same framing can be had. */
	viewport: [number, number]
}

/** Every ToolId; the compiler checks each entry is one, a test checks the list against the tools. */
export const TOOL_IDS: readonly ToolId[] = ['select', 'cube']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Checks a scene line and returns it typed, throwing an error that names the first bad field. Nothing is
 * applied here, so a bad paste changes nothing. `current` is the preferences' current values, which
 * give each preference its type.
 */
export function parseScene(text: string, current: Record<string, unknown>): Scene {
	const at = text.indexOf('{')
	const head = text.trim()
	if (!(head.startsWith(PREFIX.trim()) || head.startsWith(OLD_PREFIX.trim())) || at < 0) throw new Error('not a Meld scene')
	let s: unknown
	try {
		s = JSON.parse(text.slice(at))
	} catch (err) {
		throw new Error(`the scene is not valid JSON (${err instanceof Error ? err.message : err})`)
	}
	if (!isObj(s)) throw new Error('the scene is not an object')
	if (s.v !== 1) throw new Error(`unknown scene version ${String(s.v)}`)

	// map
	const m = s.map
	if (!isObj(m)) throw new Error('scene field "map" is missing')
	// A scene of a Meld map (a .wmap file or a block of the client's tiles) is an older editor's.
	if (m.region !== undefined) throw new Error('the scene is of a part of the WoW client, which the editor no longer opens')
	if (typeof m.file !== 'string' || !m.file) throw new Error('scene field "map.file" must be a path')
	if (!isWorldPath(m.file)) throw new Error('the scene is of a Meld map, which the editor no longer opens: it opens .world files')
	const map: Scene['map'] = m.copy === true ? { file: m.file, copy: true } : { file: m.file }

	// view
	const v = s.view
	if (!isObj(v)) throw new Error('scene field "view" is missing')
	const t = v.target
	if (!Array.isArray(t) || t.length !== 3 || !t.every(isNum)) throw new Error('scene field "view.target" must be three numbers')
	for (const k of ['yaw', 'pitch', 'distance', 'hour'] as const) if (!isNum(v[k])) throw new Error(`scene field "view.${k}" must be a number`)
	const view = { target: [t[0], t[1], t[2]] as [number, number, number], yaw: v.yaw as number, pitch: v.pitch as number, distance: v.distance as number, hour: v.hour as number }

	// prefs: unknown keys are dropped, a known one must have its preference's type
	const p = s.prefs
	if (!isObj(p)) throw new Error('scene field "prefs" is missing')
	const prefs: Record<string, unknown> = {}
	for (const k of VIEW_PREFS) {
		if (!(k in p)) continue
		if (!prefValueOk(current[k], p[k])) throw new Error(`scene pref "${k}" has the wrong type`)
		prefs[k] = p[k]
	}

	if (typeof s.tool !== 'string' || !(TOOL_IDS as readonly string[]).includes(s.tool)) throw new Error(`scene field "tool" is not a tool (${JSON.stringify(s.tool)})`)
	const vp = s.viewport
	if (!Array.isArray(vp) || vp.length !== 2 || !vp.every(isNum)) throw new Error('scene field "viewport" must be two numbers')

	return { v: 1, map, view, prefs: prefs as ViewPrefs, tool: s.tool as ToolId, viewport: [vp[0], vp[1]] }
}

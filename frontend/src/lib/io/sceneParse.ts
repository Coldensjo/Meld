import type { Engine } from '../engine/Engine'
import type { editor, Prefs, ToolId } from '../state/editor.svelte'
import { prefValueOk } from '../state/prefsPatch'

// Reading a pasted scene (io/scene.ts), kept apart from the engine and the state so it can be tested:
// a scene is typed by hand or by an agent, so nothing in it is trusted until it has been checked here.

export const PREFIX = 'Meld scene '
/** Scenes copied before the rename. */
export const OLD_PREFIX = 'WorldEditor scene '

/** The preferences that change what the view looks like. Layout and input prefs stay the viewer's. */
export const VIEW_PREFS = [
	'wireframe',
	'climbView',
	'navView',
	'navServer',
	'showContours',
	'contourStep',
	'showBoxes',
	'clientLighting',
	'climbAngle',
	'showTerrain',
	'showWater',
	'showObjects',
	'showDoodads',
	'showBuildings',
	'showMonsters',
	'showNpcs',
	'showGameObjects',
	'renderScale',
	'viewDistance',
	'fog',
	'cameraFollowGround',
	'cameraCollision',
	'timeOfDay',
	'dayCycle',
	'cycleMinutes',
	'clouds',
	'shadows',
	'propEffects',
	'animations',
	'cullSmallModels',
] as const satisfies readonly (keyof Prefs)[]

export type ViewPrefs = Partial<Pick<Prefs, (typeof VIEW_PREFS)[number]>>

export interface Scene {
	v: 1
	/** The map: a file (saved, or the cache copy of unsaved changes), a block of the client's tiles, or a map's world view (#15). */
	map: { file: string; copy?: boolean } | { region: { mapName: string; x: number; y: number; size: number } } | { world: { mapName: string } }
	view: ReturnType<Engine['sceneView']>
	prefs: ViewPrefs
	tool: ToolId
	selectedIds: number[]
	selected: number | null
	area: typeof editor.selection
	/** The viewport's size in CSS pixels, so the same framing can be had. */
	viewport: [number, number]
}

/** Every ToolId; the compiler checks each entry is one, a test checks the list against the tools. */
export const TOOL_IDS: readonly ToolId[] = ['select', 'sculpt', 'paint', 'road', 'water', 'place', 'clear', 'doodad', 'mapdata', 'stamp', 'path', 'script']

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
	let map: Scene['map']
	if (m.region !== undefined) {
		const r = m.region
		if (!isObj(r) || typeof r.mapName !== 'string' || !isNum(r.x) || !isNum(r.y) || !isNum(r.size)) throw new Error('scene field "map.region" needs mapName, x, y and size')
		map = { region: { mapName: r.mapName, x: r.x, y: r.y, size: r.size } }
	} else if (m.world !== undefined) {
		const w = m.world
		if (!isObj(w) || typeof w.mapName !== 'string' || !w.mapName) throw new Error('scene field "map.world" needs mapName')
		map = { world: { mapName: w.mapName } }
	} else {
		if (typeof m.file !== 'string' || !m.file) throw new Error('scene field "map.file" must be a path')
		map = m.copy === true ? { file: m.file, copy: true } : { file: m.file }
	}

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
	const ids = s.selectedIds
	if (!Array.isArray(ids) || !ids.every(isNum)) throw new Error('scene field "selectedIds" must be a list of numbers')
	if (s.selected !== null && !isNum(s.selected)) throw new Error('scene field "selected" must be a number or null')

	let area: Scene['area'] = null
	if (s.area !== null && s.area !== undefined) {
		const a = s.area
		if (!isObj(a) || !isNum(a.x0) || !isNum(a.z0) || !isNum(a.x1) || !isNum(a.z1)) throw new Error('scene field "area" must be null or x0, z0, x1, z1')
		area = { x0: a.x0, z0: a.z0, x1: a.x1, z1: a.z1 }
	}
	const vp = s.viewport
	if (!Array.isArray(vp) || vp.length !== 2 || !vp.every(isNum)) throw new Error('scene field "viewport" must be two numbers')

	return { v: 1, map, view, prefs: prefs as ViewPrefs, tool: s.tool as ToolId, selectedIds: ids as number[], selected: s.selected as number | null, area, viewport: [vp[0], vp[1]] }
}

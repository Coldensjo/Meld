import type { vmangos } from '../wails/models'

// The Lights dialog's Export and Import (#945): a lights file is a `vmangos.LightsEdit` (the map's ID,
// its lights and the params rows they name), written and read by the ExportLights and ImportLights
// bindings. An import loads into the dialog as unsaved changes, written only by Save.

type Light = vmangos.MapLight
type Params = vmangos.LightParamSet

/** The lights to export and the params rows they name (the clear and storm ones the dialog reads). */
export function lightsToExport(mapId: number, lights: Light[], params: Record<number, Params>): vmangos.LightsEdit {
	const ids = new Set(lights.flatMap((l) => l.params).filter((id) => params[id]))
	return {
		mapId,
		lights: lights.map((l) => ({ ...l, borrowed: undefined })),
		params: [...ids].sort((a, b) => a - b).map((id) => params[id]),
	} as vmangos.LightsEdit
}

export interface LightsImport {
	lights: Light[]
	params: Record<number, Params>
	/** The light and params IDs the import changed or added, for the dialog's unsaved marks. */
	dirtyLights: number[]
	dirtyParams: number[]
	added: number
	replaced: number
}

/**
 * Merges a lights file into the dialog's lights. Onto the map it came from, each light and params row
 * replaces the one of its ID (or is added). Onto another map the lights keep their positions but take new
 * IDs from `next` on (Light.dbc and LightParams.dbc IDs are the client's, shared by every map), so the
 * source map's rows stay as they are. Either way the file's global light becomes the map's own: it takes
 * the map's global light's ID, or a new one when the map has none or borrows Azeroth's.
 */
export function mergeLights(mapId: number, lights: Light[], params: Record<number, Params>, file: vmangos.LightsEdit, next: { light: number; params: number }): LightsImport {
	const same = file.mapId === mapId
	let nextLight = Math.max(next.light, ...lights.map((l) => l.id + 1))
	let nextParams = Math.max(next.params, ...Object.keys(params).map((k) => Number(k) + 1))
	const ownGlobal = lights.find((l) => l.global && !l.borrowed)
	// A global light that comes in as a new light brings its params as new rows too, even onto the same
	// map: the borrowed ones are Azeroth's.
	const fresh = new Set(ownGlobal ? [] : (file.lights ?? []).filter((l) => l.global).flatMap((l) => l.params))
	const outParams = { ...params }
	const pid = new Map<number, number>()
	const dirtyParams: number[] = []
	for (const p of file.params ?? []) {
		const id = same && !fresh.has(p.id) ? p.id : nextParams++
		pid.set(p.id, id)
		outParams[id] = { ...JSON.parse(JSON.stringify(p)), id } as Params
		dirtyParams.push(id)
	}
	let out = [...lights]
	const dirtyLights: number[] = []
	let added = 0
	let replaced = 0
	for (const l of file.lights ?? []) {
		const id = l.global ? (ownGlobal?.id ?? nextLight++) : same ? l.id : nextLight++
		const slots = l.params.map((p) => pid.get(p) ?? p) as Light['params']
		const light = { ...l, id, params: slots, borrowed: undefined } as Light
		// The file's global light takes the place of the map's (its own or the borrowed one).
		const at = out.findIndex((x) => (l.global ? x.global : x.id === id))
		if (at >= 0 && !(l.global && !ownGlobal)) {
			out[at] = light
			replaced++
		} else {
			if (at >= 0) out.splice(at, 1)
			out.push(light)
			added++
		}
		dirtyLights.push(id)
	}
	return { lights: out, params: outParams, dirtyLights, dirtyParams, added, replaced }
}

export interface LightsFork {
	lights: Light[]
	params: Record<number, Params>
	/** The forked light's new ID, and the new params IDs (for the dialog's unsaved marks). */
	light: number
	dirtyParams: number[]
}

/**
 * Gives a map that borrows Azeroth's global light one of its own (#946): the borrowed light becomes a
 * new light (an ID from `next` on, past the unsaved ones) whose params rows the dialog holds are copied
 * under new IDs, so Save adds a global light row for this map and leaves Azeroth's light and params as
 * they are. A slot whose params the dialog did not read keeps its ID. Null when `id` is not a borrowed
 * light.
 */
export function forkBorrowed(lights: Light[], params: Record<number, Params>, id: number, next: { light: number; params: number }): LightsFork | null {
	const src = lights.find((l) => l.id === id)
	if (!src?.borrowed) return null
	const light = Math.max(next.light, ...lights.map((l) => l.id + 1))
	let nextParams = Math.max(next.params, ...Object.keys(params).map((k) => Number(k) + 1))
	const outParams = { ...params }
	const pid = new Map<number, number>()
	for (const p of src.params) {
		if (!p || !params[p] || pid.has(p)) continue
		const nid = nextParams++
		pid.set(p, nid)
		outParams[nid] = { ...(JSON.parse(JSON.stringify(params[p])) as Params), id: nid }
	}
	const forked = { ...src, id: light, params: src.params.map((p) => pid.get(p) ?? p) as Light['params'], borrowed: undefined } as Light
	return { lights: lights.map((l) => (l === src ? forked : l)), params: outParams, light, dirtyParams: [...pid.values()] }
}

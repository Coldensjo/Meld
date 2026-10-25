import { GroundEffects } from '../../../wailsjs/go/main/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { hasBackend } from '../io/backend'
import { setStatus, wow } from '../state/editor.svelte'
import type { GroundEffectTables } from '../world/groundEffects'

// The client's ground effect tables, read once per client. The first read of a client learns which
// effect each texture grows from the client's tiles, which takes a while and shows in the status bar.

let tables: GroundEffectTables | null = null
let loading: Promise<void> | null = null
let loadedRevision = -1
let listening = false

/** The tables, once read; null before (the layer then draws nothing). */
export function groundEffectTables(): GroundEffectTables | null {
	if (wow.loaded && loadedRevision !== wow.revision && !loading) void loadGroundEffectTables()
	return tables
}

/** Reads the tables again (after a new effect was written to the client). */
export function reloadGroundEffectTables(): Promise<void> {
	loadedRevision = -1
	return loadGroundEffectTables()
}

export function loadGroundEffectTables(): Promise<void> {
	if (!hasBackend() || !wow.loaded) return Promise.resolve()
	if (loading) return loading
	loadedRevision = wow.revision
	if (!listening) {
		listening = true
		EventsOn('effects:log', (line: string) => setStatus(line, 0))
	}
	loading = GroundEffects()
		.then((t) => {
			tables = { effects: {}, textures: t.textures ?? {}, terrains: (t.terrains ?? []).map((r) => ({ id: r.id, name: r.name, footprints: r.footprints })) }
			for (const [id, e] of Object.entries(t.effects ?? {})) {
				const row = e as { doodads?: string[]; slots?: number[]; density?: number; terrain?: number }
				const doodads = row.doodads ?? []
				const slots = row.slots?.length === 4 ? row.slots : [0, 1, 2, 3].map((i) => (i < doodads.length ? i : -1))
				tables.effects[id] = { doodads, slots, density: row.density ?? 0, terrain: row.terrain ?? 0 }
			}
			setStatus(`Ground effects: ${Object.keys(tables.effects).length} effects, ${Object.keys(tables.textures).length} textures.`, 4000)
		})
		.catch((e) => {
			console.warn('ground effects', e)
			setStatus(`Ground effects could not be read: ${e}`, 8000)
		})
		.finally(() => (loading = null))
	return loading
}

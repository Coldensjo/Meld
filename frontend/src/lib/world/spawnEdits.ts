import type { vmangos } from '../../../wailsjs/go/models'
import { vmangos as models } from '../../../wailsjs/go/models'
import { SpawnLook } from '../../../wailsjs/go/main/App'
import type { Command } from '../state/history'
import { editor, ui } from '../state/editor.svelte'
import { cloneSpawn, spawnKey, type SpawnLayer } from './SpawnLayer'
import { followersOf, leads, NO_FORMATION, type SpawnChange } from './formations'

/** The fields of a spawn the editor changes. */
export type SpawnFields = Partial<
	Pick<
		vmangos.WorldSpawn,
		| 'entry'
		| 'name'
		| 'type'
		| 'x'
		| 'y'
		| 'z'
		| 'orientation'
		| 'respawnSecs'
		| 'respawnMaxSecs'
		| 'movementType'
		| 'wanderDistance'
		| 'display'
		| 'equipment'
		| 'equipItems'
		| 'standState'
		| 'emoteState'
		| 'sheathState'
		| 'model'
		| 'look'
		| 'anim'
		| 'scale'
		| 'displayScale'
		| 'waypoints'
		| 'leader'
		| 'followDist'
		| 'followAngle'
		| 'groupFlags'
		| 'pool'
		| 'poolLimit'
		| 'poolName'
		| 'poolChance'
		| 'poolElsewhere'
		| 'motherPool'
		| 'motherLimit'
		| 'motherSize'
		| 'motherName'
	>
>

/** The fields that change how a creature looks, which Go dresses it by again (see `withLook`). */
const LOOK_FIELDS = ['display', 'equipment', 'standState', 'emoteState', 'sheathState'] as const

/** Movement types (creature.movement_type). */
export const MOVEMENT_TYPES = ['Idle', 'Random', 'Waypoints']
/** Stand states (UnitStandStateType), by value. */
export const STAND_STATES = ['Stand', 'Sit', 'Sit in chair', 'Sleep', 'Sit in low chair', 'Sit in medium chair', 'Sit in high chair', 'Dead', 'Kneel']
/** Sheath states (SheathState), by value. */
export const SHEATH_STATES = ['Weapons away', 'Melee weapons out', 'Ranged weapon out']

/**
 * The fields of `vals` plus what follows from them: when a creature's display, equipment or pose
 * changes, its model, look, animation and scale as the Go side dresses it.
 */
export async function withLook(s: vmangos.WorldSpawn, vals: SpawnFields): Promise<SpawnFields> {
	if (s.kind === 'object' || !LOOK_FIELDS.some((f) => vals[f] !== undefined && vals[f] !== s[f])) return vals
	const n = { ...s, ...vals }
	const l = await SpawnLook(n.display, n.equipment, n.standState, n.emoteState, n.sheathState)
	// The spawn's size is the template's scale times the display's; keep the template's part.
	const templateScale = s.displayScale > 0 ? s.scale / s.displayScale : s.scale
	return { ...vals, model: l.model, look: l.look, anim: l.anim, displayScale: l.displayScale, scale: templateScale * (l.displayScale || 1) }
}

/** Writes field values into the spawn with `key`, redraws it and updates the Inspector. */
export function applySpawn(layer: SpawnLayer, key: string, vals: SpawnFields, live = false) {
	const s = layer.get(key)
	if (!s) return
	layer.touch(s)
	Object.assign(s, vals)
	layer.refresh(s)
	// Mid-drag (live) only the edit count moves; the Inspector's copy catches up when the drag ends.
	if (live) ui.spawnChanges = layer.editCount()
	else syncSpawnUi(layer)
}

/**
 * Selects a spawn (a copy of it, see syncSpawnUi), or none. Another spawn than before loses the
 * picked path point and leaves path editing.
 */
export function selectSpawn(s: vmangos.WorldSpawn | null) {
	const before = editor.selectedSpawn ? spawnKey(editor.selectedSpawn) : null
	editor.selectedSpawn = s ? cloneSpawn(s) : null
	if ((s ? spawnKey(s) : null) !== before) {
		editor.selectedWaypoint = -1
		ui.pathEdit = false
		ui.spawnPick = null
	}
}

/**
 * Brings the spawn state up to date with the layer: the selected spawn's details (a copy, since
 * the panel's reactive state must not wrap the drawn spawns) and the count of unsaved edits.
 */
export function syncSpawnUi(layer: SpawnLayer, listChanged = false) {
	const sel = editor.selectedSpawn
	if (sel) {
		const s = layer.get(spawnKey(sel))
		editor.selectedSpawn = s ? cloneSpawn(s) : null
		if (!s) {
			ui.pathEdit = false
			ui.spawnPick = null
		}
		if (editor.selectedWaypoint >= (s?.waypoints?.length ?? 0)) editor.selectedWaypoint = -1
	}
	if (listChanged) editor.spawns = layer.spawns.slice()
	ui.spawnChanges = layer.editCount()
}

function pick(s: vmangos.WorldSpawn, keys: string[]): SpawnFields {
	const out: Record<string, unknown> = {}
	for (const k of keys) out[k] = s[k as keyof vmangos.WorldSpawn]
	return out as SpawnFields
}

/**
 * Changes several spawns' fields now, as one undoable command (a formation or a pool made or
 * changed). Spawns no longer in the layer are left out; null when none is.
 */
export function spawnsChange(layer: SpawnLayer, changes: readonly SpawnChange[], label: string): Command | null {
	const list = changes.filter((c) => layer.get(c.key))
	if (!list.length) return null
	const before = list.map((c) => ({ key: c.key, vals: pick(layer.get(c.key)!, Object.keys(c.vals)) }))
	const apply = (l: readonly SpawnChange[]) => {
		for (const c of l) {
			const s = layer.get(c.key)
			if (!s) continue
			layer.touch(s)
			Object.assign(s, c.vals)
			layer.refresh(s)
		}
		syncSpawnUi(layer)
	}
	apply(list)
	return { label, undo: () => apply(before.slice().reverse()), redo: () => apply(list) }
}

/** Changes a spawn's fields now, as one undoable command (`vals` with its look already resolved). */
export function spawnChange(layer: SpawnLayer, key: string, vals: SpawnFields, label: string): Command | null {
	const s = layer.get(key)
	if (!s) return null
	const before = pick(s, Object.keys(vals))
	applySpawn(layer, key, vals)
	return { label, undo: () => applySpawn(layer, key, before), redo: () => applySpawn(layer, key, vals) }
}

function addTo(layer: SpawnLayer, s: vmangos.WorldSpawn) {
	layer.add(s)
	if (!layer.batching) syncSpawnUi(layer, true)
}

function removeFrom(layer: SpawnLayer, s: vmangos.WorldSpawn) {
	if (editor.selectedSpawn && spawnKey(editor.selectedSpawn) === spawnKey(s)) selectSpawn(null)
	layer.remove(s)
	if (!layer.batching) syncSpawnUi(layer, true)
}

/**
 * Runs `fn`, whose spawn adds and deletes (a stroke's undo or redo, many commands in a row) redraw the
 * layer and refresh the spawn state once at the end instead of after each (#193).
 */
export function spawnsBatch(layer: SpawnLayer, fn: () => void) {
	layer.batch(fn)
	syncSpawnUi(layer, true)
}

/** A copy of a creature's path with point `i` replaced, inserted (`insert`) or removed (`p` null). */
export function withPoint(points: vmangos.Waypoint[], i: number, p: vmangos.Waypoint | null, insert = false): vmangos.Waypoint[] {
	const out = points.slice()
	if (p === null) out.splice(i, 1)
	else if (insert) out.splice(i, 0, p)
	else out[i] = p
	return out
}

/** A new spawn's formation and pool: none. */
const NO_GROUPS = { leader: 0, followDist: 0, followAngle: 0, groupFlags: 0, pool: 0, poolLimit: 0, poolName: '', poolChance: 0, poolElsewhere: 0, motherPool: 0, motherLimit: 0, motherSize: 0, motherName: '' }

/**
 * A new spawn of creature template `t` at a place, with guid `guid`, facing `orientation`, dressed
 * by `look` (its template's display and equipment, standing, melee weapons out), with the editor's
 * respawn time and no movement.
 */
export function newCreatureSpawn(t: vmangos.CreatureTemplate, guid: number, x: number, y: number, z: number, orientation: number, look: vmangos.LookResult): vmangos.WorldSpawn {
	return models.WorldSpawn.createFrom({
		kind: t.npcFlags ? 'npc' : 'monster',
		guid,
		entry: t.entry,
		name: t.name,
		subname: t.subname,
		levelMin: t.levelMin,
		levelMax: t.levelMax,
		faction: t.faction,
		npcFlags: t.npcFlags,
		rank: t.rank,
		type: t.type,
		x,
		y,
		z,
		orientation,
		respawnSecs: 300,
		respawnMaxSecs: 300,
		display: t.display,
		model: look.model,
		look: look.look,
		anim: look.anim,
		scale: t.scale * (look.displayScale || 1),
		displayScale: look.displayScale || 1,
		equipment: t.equipment,
		standState: 0,
		emoteState: 0,
		sheathState: 1,
		movementType: 0,
		wanderDistance: 0,
		waypoints: [],
		pathFromTemplate: false,
		...NO_GROUPS,
	})
}

/**
 * The creature template as placing needs it, from a creature_template row's values (as the
 * creature editor holds them): its first display with that display's scale.
 */
export function creatureTemplateOf(entry: number, v: Record<string, string>): vmangos.CreatureTemplate {
	const n = (col: string) => Number(v[col]) || 0
	let display = 0
	let scale = 1
	for (let i = 1; i <= 4; i++) {
		if (n(`display_id${i}`) > 0) {
			display = n(`display_id${i}`)
			scale = n(`display_scale${i}`) || 1
			break
		}
	}
	return {
		entry,
		name: v.name ?? '',
		subname: v.subname ?? '',
		levelMin: n('level_min'),
		levelMax: n('level_max'),
		faction: n('faction'),
		npcFlags: n('npc_flags'),
		rank: n('rank'),
		type: n('type'),
		display,
		scale,
		equipment: n('equipment_id'),
		model: '',
		look: '',
		displayScale: 1,
	}
}

/** A new path point at a place: no facing, no wait, no wander, no script. */
export const newWaypoint = (x: number, y: number, z: number): vmangos.Waypoint => ({ x, y, z, orientation: 0, waitMs: 0, wanderDistance: 0, scriptId: 0 })

/**
 * The fields that turn a game object spawn into template `t` (#136): its entry, name and type, and
 * the model and size of the new template's display. The server takes the size from the template.
 */
export function objectEntryFields(t: vmangos.ObjectTemplate): SpawnFields {
	return { entry: t.entry, name: t.name, type: t.type, display: t.display, model: t.model, scale: t.size || 1 }
}

/** A game object spawn of template `t` at a point, as the Place tool makes it. */
export function newObjectSpawn(t: vmangos.ObjectTemplate, guid: number, x: number, y: number, z: number, orientation: number): vmangos.WorldSpawn {
	return models.WorldSpawn.createFrom({
		kind: 'object',
		guid,
		entry: t.entry,
		name: t.name,
		subname: '',
		levelMin: 0,
		levelMax: 0,
		faction: 0,
		npcFlags: 0,
		rank: 0,
		type: t.type,
		x,
		y,
		z,
		orientation,
		respawnSecs: 300,
		respawnMaxSecs: 300,
		display: t.display,
		model: t.model,
		look: '',
		anim: 0,
		scale: t.size || 1,
		displayScale: 1,
		equipment: 0,
		equipItems: [0, 0, 0],
		standState: 0,
		emoteState: 0,
		sheathState: 0,
		movementType: 0,
		wanderDistance: 0,
		waypoints: [],
		pathFromTemplate: false,
		...NO_GROUPS,
	})
}

/** Adds a spawn now, as one undoable command. */
export function spawnAdd(layer: SpawnLayer, s: vmangos.WorldSpawn, label: string): Command {
	addTo(layer, s)
	return { label, undo: () => removeFrom(layer, s), redo: () => addTo(layer, s) }
}

/**
 * Deletes a spawn now, as one undoable command. A deleted formation leader's followers in the region
 * leave the formation with it, as the server drops a group without its leader.
 */
export function spawnDelete(layer: SpawnLayer, key: string, label: string): Command | null {
	const s = layer.get(key)
	if (!s) return null
	const orphans = leads(s) ? followersOf(layer.spawns, s.guid).map((f) => ({ key: spawnKey(f), vals: { ...NO_FORMATION } })) : []
	const ungroup = orphans.length ? spawnsChange(layer, orphans, label) : null
	removeFrom(layer, s)
	return {
		label,
		undo: () => {
			addTo(layer, s)
			ungroup?.undo()
		},
		redo: () => {
			ungroup?.redo()
			removeFrom(layer, s)
		},
	}
}

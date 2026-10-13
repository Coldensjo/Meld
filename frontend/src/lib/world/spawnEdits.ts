import type { vmangos } from '../../../wailsjs/go/models'
import { SpawnLook } from '../../../wailsjs/go/main/App'
import type { Command } from '../state/history'
import { editor, ui } from '../state/editor.svelte'
import { cloneSpawn, spawnKey, type SpawnLayer } from './SpawnLayer'

/** The fields of a spawn the editor changes. */
export type SpawnFields = Partial<
  Pick<
    vmangos.WorldSpawn,
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
    | 'standState'
    | 'emoteState'
    | 'sheathState'
    | 'model'
    | 'look'
    | 'anim'
    | 'scale'
    | 'displayScale'
    | 'waypoints'
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

/** Writes field values into the spawn with `key`, redraws it and updates the Spawns panel. */
export function applySpawn(layer: SpawnLayer, key: string, vals: SpawnFields) {
  const s = layer.get(key)
  if (!s) return
  layer.touch(s)
  Object.assign(s, vals)
  layer.refresh(s)
  syncSpawnUi(layer)
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
  }
}

/**
 * Brings the Spawns panel up to date with the layer: the selected spawn's details (a copy, since
 * the panel's reactive state must not wrap the drawn spawns) and the count of unsaved edits.
 */
export function syncSpawnUi(layer: SpawnLayer, listChanged = false) {
  const sel = editor.selectedSpawn
  if (sel) {
    const s = layer.get(spawnKey(sel))
    editor.selectedSpawn = s ? cloneSpawn(s) : null
    if (!s) ui.pathEdit = false
    if (editor.selectedWaypoint >= (s?.waypoints?.length ?? 0)) editor.selectedWaypoint = -1
  }
  if (listChanged) editor.spawns = layer.spawns.slice()
  ui.spawnChanges = layer.edits().length
}

function pick(s: vmangos.WorldSpawn, keys: string[]): SpawnFields {
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = s[k as keyof vmangos.WorldSpawn]
  return out as SpawnFields
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
  syncSpawnUi(layer, true)
}

function removeFrom(layer: SpawnLayer, s: vmangos.WorldSpawn) {
  if (editor.selectedSpawn && spawnKey(editor.selectedSpawn) === spawnKey(s)) selectSpawn(null)
  layer.remove(s)
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

/** A new path point at a place: no facing, no wait, no wander, no script. */
export const newWaypoint = (x: number, y: number, z: number): vmangos.Waypoint => ({ x, y, z, orientation: 0, waitMs: 0, wanderDistance: 0, scriptId: 0 })

/** Adds a spawn now, as one undoable command. */
export function spawnAdd(layer: SpawnLayer, s: vmangos.WorldSpawn, label: string): Command {
  addTo(layer, s)
  return { label, undo: () => removeFrom(layer, s), redo: () => addTo(layer, s) }
}

/** Deletes a spawn now, as one undoable command. */
export function spawnDelete(layer: SpawnLayer, key: string, label: string): Command | null {
  const s = layer.get(key)
  if (!s) return null
  removeFrom(layer, s)
  return { label, undo: () => addTo(layer, s), redo: () => removeFrom(layer, s) }
}

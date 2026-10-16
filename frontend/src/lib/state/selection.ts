import * as THREE from 'three'
import { editor } from './editor.svelte'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'

/**
 * Makes `ids` the selected objects (`editor.selectedIds`). `primary`, one of them, is the object the
 * gizmo and the Properties panel work on (`editor.selected`); a selection of one is its own primary.
 * Ids that no longer exist are dropped.
 */
export function selectObjects(objects: ObjectLayer, ids: Iterable<number>, primary?: number) {
  const live: number[] = []
  for (const id of ids) if (objects.objects.has(id) && !live.includes(id)) live.push(id)
  editor.selectedIds = live
  const p = primary !== undefined && live.includes(primary) ? primary : live.length === 1 ? live[0] : undefined
  const o = p !== undefined ? objects.objects.get(p) : undefined
  editor.selected = o ? { ...o } : null
}

/**
 * `ids` with every member of each selection group one of them is in, as Noggit Red selects a whole
 * group when one member is picked.
 */
export function withGroups(objects: ObjectLayer, ids: Iterable<number>): number[] {
  const out = new Set<number>(ids)
  const groups = new Set<number>()
  for (const id of out) {
    const g = objects.objects.get(id)?.group
    if (g) groups.add(g)
  }
  if (groups.size) for (const o of objects.objects.values()) if (o.group && groups.has(o.group)) out.add(o.id)
  return [...out]
}

/** The selected objects that still exist, the primary first. */
export function selectedObjects(objects: ObjectLayer): WorldObject[] {
  const out: WorldObject[] = []
  const p = editor.selected ? objects.objects.get(editor.selected.id) : undefined
  if (p) out.push(p)
  for (const id of editor.selectedIds) {
    const o = objects.objects.get(id)
    if (o && o !== p) out.push(o)
  }
  return out
}

/**
 * The selected objects that move on their own: one attached to another selected object rides along
 * with it, so it's left out.
 */
export function movableSelection(objects: ObjectLayer): WorldObject[] {
  const all = selectedObjects(objects)
  const ids = new Set(all.map((o) => o.id))
  return all.filter((o) => {
    for (const a of objects.ancestorIds(o)) if (ids.has(a)) return false
    return true
  })
}

const tmp = new THREE.Vector3()

/** The objects whose world position lies in the cell rect (corners x0..x1, z0..z1), hidden ones left out. */
export function objectsInRect(objects: ObjectLayer, cellSize: number, r: { x0: number; z0: number; x1: number; z1: number }): WorldObject[] {
  const x0 = r.x0 * cellSize
  const z0 = r.z0 * cellSize
  const x1 = r.x1 * cellSize
  const z1 = r.z1 * cellSize
  const out: WorldObject[] = []
  for (const o of objects.objects.values()) {
    if (!objects.pickable(o.id)) continue
    const p = objects.worldPosition(o, tmp)
    if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) out.push(o)
  }
  return out
}

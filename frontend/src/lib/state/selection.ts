import * as THREE from 'three'
import { editor } from './editor.svelte'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'

/**
 * Makes `ids` the selected objects (`editor.selectedIds`). `primary`, one of them, is the object the
 * gizmo and the Properties panel work on (`editor.selected`); a selection of one is its own primary.
 * Ids that no longer exist are dropped, and a look-only layer's (a world view's, #15) are never selected.
 */
export function selectObjects(objects: ObjectLayer, ids: Iterable<number>, primary?: number) {
	const live: number[] = []
	const seen = new Set<number>()
	for (const id of objects.lookOnly ? [] : ids) {
		if (seen.has(id) || !objects.objects.has(id)) continue
		seen.add(id)
		live.push(id)
	}
	editor.selectedIds = live
	const p = primary !== undefined && seen.has(primary) ? primary : live.length === 1 ? live[0] : undefined
	const o = p !== undefined ? objects.objects.get(p) : undefined
	editor.selected = o ? { ...o } : null
	movedId = -1
}

/** The id of the primary object a drag moved since the last `publishMoved`, or -1. */
let movedId = -1

/**
 * Notes that a drag moved object `id`, so `publishMoved` refreshes the Inspector's copy
 * (`editor.selected`) at most once a frame instead of on every pointer move.
 */
export function markMoved(id: number) {
	if (editor.selected?.id === id) movedId = id
}

/** Copies the object a drag moved into `editor.selected`; the engine calls it once a frame. */
export function publishMoved(objects: ObjectLayer) {
	if (movedId < 0) return
	const id = movedId
	movedId = -1
	const o = objects.objects.get(id)
	if (o && editor.selected?.id === id) editor.selected = { ...o }
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
	// Each group's members come from ObjectLayer's index (#630), not a scan of every object.
	for (const g of groups) for (const m of objects.groupMembers(g)) out.add(m)
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
const found: WorldObject[] = []

/**
 * The objects whose world position lies in the cell rect (corners x0..x1, z0..z1), and for which
 * `inside` holds when given (a free-form area's cells), hidden ones left out.
 */
export function objectsInRect(objects: ObjectLayer, cellSize: number, r: { x0: number; z0: number; x1: number; z1: number }, inside?: (x: number, z: number) => boolean): WorldObject[] {
	const x0 = r.x0 * cellSize
	const z0 = r.z0 * cellSize
	const x1 = r.x1 * cellSize
	const z1 = r.z1 * cellSize
	// The roots from the layer's cells over the rect (#512), then the attached ones by their world spot.
	const out: WorldObject[] = []
	for (const o of objects.rootsIn(x0, z0, x1, z1, found)) {
		if (objects.pickable(o.id) && (!inside || inside(o.x, o.z))) out.push(o)
	}
	for (const o of objects.attachedObjects(found)) {
		if (!objects.pickable(o.id)) continue
		const p = objects.worldPosition(o, tmp)
		if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && (!inside || inside(p.x, p.z))) out.push(o)
	}
	found.length = 0
	// In id order, so the selection's order doesn't depend on the cells (the scan gave the map's order).
	return out.sort((a, b) => a.id - b.id)
}

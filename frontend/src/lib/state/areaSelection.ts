// The shape of the selected area (#183). `editor.selection` stays the rect around it, so everything that
// reads the rect keeps working; a lasso or polygon also leaves the cells it took here. The shape counts
// only while the rect is still the one it was made with, on the same map: any code that sets another
// rect (a drag, Select All, a paste, a tab switch) makes the area a plain rect again without knowing
// of shapes.
import { editor } from './editor.svelte'
import { INSIDE, fillsRect, rectCells, shapeBounds, type CellRect } from '../terrain/areaShape'
import { objectsInRect } from './selection'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'

interface Shape {
	/** A byte per cell of the map: INSIDE where selected. */
	cells: Uint8Array
	size: number
	bounds: CellRect
	/** The map it was made on, so another tab's equal rect doesn't take it. */
	owner: object
}

let shape: Shape | null = null

/** Bumped whenever the shape changes, so the terrain shader re-uploads its cells. */
export let areaShapeVersion = 0

const sameRect = (a: CellRect, b: CellRect) => a.x0 === b.x0 && a.z0 === b.z0 && a.x1 === b.x1 && a.z1 === b.z1

/**
 * The selected cells when the area is a free-form shape on the map `owner` (size cells a side), or
 * null when it is a plain rect or there is none.
 */
export function areaShape(owner: object, size: number): Uint8Array | null {
	const s = editor.selection
	if (!shape || !s || shape.owner !== owner || shape.size !== size || !sameRect(shape.bounds, s)) return null
	return shape.cells
}

/** The selected cells as a bitmap: the shape's, or the rect's; null with no area. */
export function areaCells(owner: object, size: number): Uint8Array | null {
	const s = editor.selection
	if (!s) return null
	return areaShape(owner, size) ?? rectCells(s, size)
}

/**
 * Makes `cells` (size by size, INSIDE where selected) the selected area: its bounds become
 * `editor.selection`, and the shape is kept unless it fills them, when the area is that rect. With no
 * cell set the area is cleared. Returns the new rect.
 */
export function setAreaCells(owner: object, size: number, cells: Uint8Array): CellRect | null {
	const b = shapeBounds(cells, size)
	areaShapeVersion++
	if (!b) {
		shape = null
		editor.selection = null
		return null
	}
	shape = fillsRect(cells, size, b) ? null : { cells, size, bounds: b, owner }
	editor.selection = { ...b }
	return b
}

/** Whether cell (x, z) is in the selected area (true everywhere in a plain rect). */
export function inArea(owner: object, size: number, x: number, z: number): boolean {
	const s = editor.selection
	if (!s || x < s.x0 || z < s.z0 || x >= s.x1 || z >= s.z1) return false
	const cells = areaShape(owner, size)
	return !cells || cells[z * size + x] === INSIDE
}

/** The objects standing in the selected area: in its rect and, for a shape, on one of its cells. */
export function objectsInArea(objects: ObjectLayer, owner: object, size: number, cellSize: number): WorldObject[] {
	const s = editor.selection
	if (!s) return []
	const cells = areaShape(owner, size)
	if (!cells) return objectsInRect(objects, cellSize, s)
	return objectsInRect(objects, cellSize, s, (x, z) => {
		const cx = Math.min(size - 1, Math.max(0, Math.floor(x / cellSize)))
		const cz = Math.min(size - 1, Math.max(0, Math.floor(z / cellSize)))
		return cells[cz * size + cx] === INSIDE
	})
}

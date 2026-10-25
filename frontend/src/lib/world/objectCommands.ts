import type { Command } from '../state/history'
import type { ObjectLayer, WorldObject } from './ObjectLayer'

/**
 * The undo step for models just added to `objects`: undo removes them, redo adds them back with the
 * same ids. The models are copied now, so later edits to them don't leak into the step; the layer is
 * the map's own, which a tab switch doesn't replace.
 */
export function addedCommand(objects: ObjectLayer, added: WorldObject[], label: string): Command {
	const saved = added.map((o) => ({ ...o }))
	return {
		label,
		undo: () => removeAll(objects, saved),
		redo: () => addAll(objects, saved),
	}
}

/** The undo step for models just removed from `objects`: undo adds them back, redo removes them again. */
export function removedCommand(objects: ObjectLayer, removed: WorldObject[], label = 'Delete'): Command {
	const saved = removed.map((o) => ({ ...o }))
	return {
		label,
		undo: () => addAll(objects, saved),
		redo: () => removeAll(objects, saved),
	}
}

function addAll(objects: ObjectLayer, saved: WorldObject[]) {
	for (const o of saved) objects.add({ ...o })
}

function removeAll(objects: ObjectLayer, saved: WorldObject[]) {
	for (const o of saved) objects.remove(o.id)
}

import { editor } from '../state/editor.svelte'
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

export function transformCommand(objects: ObjectLayer, before: WorldObject, after: WorldObject): Command {
	return groupTransformCommand(objects, [before], [after], 'Transform')
}

/** One undo step for several objects' transforms: `before[i]` and `after[i]` are snapshots of the same object. */
export function groupTransformCommand(objects: ObjectLayer, before: WorldObject[], after: WorldObject[], label?: string): Command {
	const b = before.map((o) => ({ ...o }))
	const a = after.map((o) => ({ ...o }))
	const apply = (states: WorldObject[]) => {
		for (const s of states) {
			const o = objects.objects.get(s.id)
			if (!o) continue
			// Snapshots without a parent mean "on the ground", and without tilts mean upright.
			delete o.parent
			delete o.tiltX
			delete o.tiltZ
			Object.assign(o, s)
			objects.touch(s.id)
			if (editor.selected?.id === s.id) editor.selected = { ...s }
		}
	}
	return { label: label ?? (b.length > 1 ? `Move ${b.length} objects` : 'Transform'), undo: () => apply(b), redo: () => apply(a) }
}

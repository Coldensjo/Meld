// Props in the editor (#133): placing, moving, turning, scaling and removing the models standing in a
// world (CubeWorld.props, the format's PROPS record), each edit one History step. A prop is only a
// look, a model of the game's assets/models named by its path, standing anywhere in metres: nothing
// collides with it and the game does not keep it to the grid, so neither does the editor, but nothing
// is put outside the world or in the metal layers. Pure data, with no three.js, so it runs in the unit tests.

import type { CubeWorld, WorldProp } from './world'
import { editBlock } from './edit'
import { CUBE_SIZE } from './shapes'
import { layerAtHeight } from './layerMap'
import type { Command } from '../state/historyCore'

/** The layer a prop stands in: the one its origin is in (a hair above, so one standing on a cube's top is in the layer over it). */
export function propLayer(p: { y: number }): number {
	return layerAtHeight(p.y + 0.001)
}

/** Why no prop may stand at (x, y, z) metres, or '' when one may. */
export function propBlock(world: CubeWorld, x: number, y: number, z: number): string {
	if (![x, y, z].every(Number.isFinite)) return 'not a place'
	return editBlock(world, Math.floor(x / CUBE_SIZE), Math.floor(z / CUBE_SIZE), propLayer({ y }))
}

/** A turn held to 0 up to 2π, so turning round and round keeps it small. */
export function wrapTurn(turn: number): number {
	const tau = Math.PI * 2
	const t = turn % tau
	return t < 0 ? t + tau : t
}

/** Adds a prop of `model` at (x, y, z) metres, turned `turn` radians, at `scale`, at the end of the list; says why not instead. */
export function placeProp(world: CubeWorld, model: string, x: number, y: number, z: number, turn: number, scale: number): WorldProp | string {
	if (!model) return 'no model picked'
	if (!(scale > 0) || !Number.isFinite(scale)) return 'its scale is not above 0'
	const why = propBlock(world, x, y, z)
	if (why) return why
	const p: WorldProp = { model, x, y, z, turn: wrapTurn(turn), scale }
	world.props.push(p)
	return p
}

/** Moves prop `i` to (x, y, z) metres; says why not instead. */
export function moveProp(world: CubeWorld, i: number, x: number, y: number, z: number): WorldProp | string {
	const p = world.props[i]
	if (!p) return 'no such prop'
	const why = propBlock(world, x, y, z)
	if (why) return why
	p.x = x
	p.y = y
	p.z = z
	return p
}

/** Turns prop `i` to `turn` radians and gives it `scale`; says why not instead. */
export function shapeProp(world: CubeWorld, i: number, turn: number, scale: number): WorldProp | string {
	const p = world.props[i]
	if (!p) return 'no such prop'
	if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(turn)) return 'its scale is not above 0'
	p.turn = wrapTurn(turn)
	p.scale = scale
	return p
}

/** Removes prop `i`; returns it, or null when there is none. */
export function removeProp(world: CubeWorld, i: number): WorldProp | null {
	if (!world.props[i]) return null
	return world.props.splice(i, 1)[0]
}

/** A copy of a list of props. */
export function copyProps(list: readonly WorldProp[]): WorldProp[] {
	return list.map((p) => ({ ...p }))
}

const sameProps = (a: readonly WorldProp[], b: readonly WorldProp[]) =>
	a.length === b.length && a.every((p, i) => p.model === b[i].model && p.x === b[i].x && p.y === b[i].y && p.z === b[i].z && p.turn === b[i].turn && p.scale === b[i].scale)

/**
 * Runs `edit` on the world's props as one History step: a copy before and after, the undo and redo
 * putting one back (on the world itself, which the tab owns) and calling `changed` (to redraw them).
 * Returns `edit`'s result; nothing is recorded when it changed nothing.
 */
export function editProps<T>(world: CubeWorld, history: { push(cmd: Command): void }, label: string, changed: () => void, edit: () => T): T {
	const before = copyProps(world.props)
	const out = edit()
	recordProps(world, history, label, changed, before)
	return out
}

/**
 * Records the change from `before` (a copy of the world's props) to the props now as one History step,
 * as `editProps` does; for an edit made a little at a time, such as a drag. Returns whether anything changed.
 */
export function recordProps(world: CubeWorld, history: { push(cmd: Command): void }, label: string, changed: () => void, before: WorldProp[]): boolean {
	if (sameProps(before, world.props)) return false
	const after = copyProps(world.props)
	changed()
	history.push({
		label,
		bytes: (before.length + after.length) * 64,
		undo: () => {
			world.props = copyProps(before)
			changed()
		},
		redo: () => {
			world.props = copyProps(after)
			changed()
		},
	})
	return true
}

/** A prop in words: its model and where it stands. */
export function propWords(p: WorldProp): string {
	return `${p.model} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`
}

/** Degrees, for the options bar and the status line. */
export const degrees = (radians: number) => Math.round((radians * 180) / Math.PI * 10) / 10

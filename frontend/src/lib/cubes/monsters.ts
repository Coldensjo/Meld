// Monster spawn points in the editor (#91): placing, moving and removing the cubes a world's monsters
// spawn in (CubeWorld.monsters, the format's MONSTERS record), each as one History step. The kinds are
// the game's own, read from crates/gameplay/monsters.toml (monsterKinds.ts imports it), so a spawn
// point always names a kind the server knows: the server refuses a world whose spawn point names one
// it does not ("no monster kind"). The format allows several spawn points in one cube and keeps them in
// order (the server spawns them in that order); a new one goes at the end, and a move keeps its place
// in the list. Nothing goes outside the world or in the metal layers, which no one can reach. Pure
// data, with no three.js, so it runs in the unit tests.

import { parse } from 'smol-toml'
import type { CubeWorld, SpawnPoint, WorldMonster } from './world'
import { editBlock } from './edit'
import type { Command } from '../state/historyCore'

/** A kind of monster, as much of monsters.toml as the editor draws: its name, body in metres and colour (0 to 1). */
export interface MonsterKind {
	name: string
	width: number
	height: number
	colour: [number, number, number]
}

/** Reads the kinds out of monsters.toml's text, in the file's order; skips an entry without a name. */
export function parseMonsterKinds(text: string): MonsterKind[] {
	const doc = parse(text) as { kind?: unknown }
	const list = Array.isArray(doc.kind) ? doc.kind : []
	const kinds: MonsterKind[] = []
	for (const k of list as Record<string, unknown>[]) {
		if (typeof k?.name !== 'string' || !k.name) continue
		const num = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : or)
		const c = Array.isArray(k.colour) && k.colour.length === 3 && k.colour.every((v) => typeof v === 'number') ? (k.colour as [number, number, number]) : [0.6, 0.6, 0.6]
		kinds.push({ name: k.name, width: num(k.width, 0.8), height: num(k.height, 1), colour: [c[0], c[1], c[2]] })
	}
	return kinds
}

const same = (a: SpawnPoint, b: SpawnPoint) => a.x === b.x && a.z === b.z && a.layer === b.layer

/** The indices into `world.monsters` of the spawn points in cube `at`, in order. */
export function monstersAt(world: CubeWorld, at: SpawnPoint): number[] {
	const out: number[] = []
	world.monsters.forEach((m, i) => same(m.pos, at) && out.push(i))
	return out
}

/** Why no spawn point may be in cube `at`, or '' when one may. */
export function monsterBlock(world: CubeWorld, at: SpawnPoint): string {
	return editBlock(world, at.x, at.z, at.layer)
}

/** Adds a spawn point of `kind` in cube `at`, at the end of the list; says why not instead. */
export function placeMonster(world: CubeWorld, kind: string, at: SpawnPoint): WorldMonster | string {
	if (!kind) return 'no monster kind picked'
	const why = monsterBlock(world, at)
	if (why) return why
	const m: WorldMonster = { kind, pos: { x: at.x, z: at.z, layer: at.layer } }
	world.monsters.push(m)
	return m
}

/** Moves spawn point `index` to cube `to`, keeping its place in the list; says why not instead. */
export function moveMonster(world: CubeWorld, index: number, to: SpawnPoint): WorldMonster | string {
	const m = world.monsters[index]
	if (!m) return 'no such spawn point'
	const why = monsterBlock(world, to)
	if (why) return why
	m.pos = { x: to.x, z: to.z, layer: to.layer }
	return m
}

/** Removes spawn point `index`; returns it, or null when there is none. */
export function removeMonster(world: CubeWorld, index: number): WorldMonster | null {
	if (!world.monsters[index]) return null
	return world.monsters.splice(index, 1)[0]
}

/** A copy of a list of spawn points. */
export function copyMonsters(list: readonly WorldMonster[]): WorldMonster[] {
	return list.map((m) => ({ kind: m.kind, pos: { ...m.pos } }))
}

/**
 * Runs `edit` on the world's monster spawn points as one History step: a copy before and after, the
 * undo and redo putting one back (on the world itself, which the tab owns) and calling `changed` (to
 * redraw them). Returns `edit`'s result; nothing is recorded when it changed nothing.
 */
export function editMonsters<T>(world: CubeWorld, history: { push(cmd: Command): void }, label: string, changed: () => void, edit: () => T): T {
	const before = copyMonsters(world.monsters)
	const out = edit()
	const after = copyMonsters(world.monsters)
	if (JSON.stringify(before) === JSON.stringify(after)) return out
	changed()
	history.push({
		label,
		bytes: JSON.stringify(after).length * 4,
		undo: () => {
			world.monsters = copyMonsters(before)
			changed()
		},
		redo: () => {
			world.monsters = copyMonsters(after)
			changed()
		},
	})
	return out
}

/** A spawn point in words: its kind and cube. */
export function monsterWords(m: WorldMonster): string {
	return `the ${m.kind} at (${m.pos.x}, ${m.pos.z}, layer ${m.pos.layer})`
}

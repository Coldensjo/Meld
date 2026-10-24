// NPCs in the editor (#99): placing, moving and removing the NPCs of a world and the cubes of their
// routes (CubeWorld.npcs, the format's NPCS record), each edit one History step. Who an NPC is (its
// look, speed and lines) is the game's, in crates/gameplay/npcs.toml (npcNames.ts imports it); the world
// only names it, and the server refuses a world naming an NPC that file has not got ("no NPC named").
// An NPC starts in its cube, walks straight to each cube of its route in turn and comes back to its
// start, round and round (crates/server npcs.rs), so a route is drawn as a closed loop. Nothing goes
// outside the world or in the metal layers. Pure data, with no three.js, so it runs in the unit tests.

import { parse } from 'smol-toml'
import { SHAPES, type CubeWorld, type SpawnPoint, type WorldNpc } from './world'
import { editBlock } from './edit'
import { shapeHulls } from './shapes'
import type { Command } from '../state/historyCore'

/** An NPC of the game, as much of npcs.toml as the editor draws: its name, body in metres and colour (0 to 1). */
export interface NpcLook {
	name: string
	width: number
	height: number
	colour: [number, number, number]
}

/** Reads the NPCs out of npcs.toml's text, in the file's order; skips an entry without a name. */
export function parseNpcLooks(text: string): NpcLook[] {
	const doc = parse(text) as { npc?: unknown }
	const list = Array.isArray(doc.npc) ? doc.npc : []
	const looks: NpcLook[] = []
	for (const n of list as Record<string, unknown>[]) {
		if (typeof n?.name !== 'string' || !n.name) continue
		const num = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : or)
		const c = Array.isArray(n.colour) && n.colour.length === 3 && n.colour.every((v) => typeof v === 'number') ? (n.colour as [number, number, number]) : [0.6, 0.6, 0.6]
		looks.push({ name: n.name, width: num(n.width, 0.6), height: num(n.height, 1.8), colour: [c[0], c[1], c[2]] })
	}
	return looks
}

const same = (a: SpawnPoint, b: SpawnPoint) => a.x === b.x && a.z === b.z && a.layer === b.layer
const copy = (p: SpawnPoint): SpawnPoint => ({ x: p.x, z: p.z, layer: p.layer })

/** A point of an NPC: its start (`point` -1) or the cube `point` of its route. */
export interface NpcPoint {
	npc: number
	point: number
}

/** The cube of point `p`, or undefined when there is none. */
export function npcPointPos(world: CubeWorld, p: NpcPoint): SpawnPoint | undefined {
	const n = world.npcs[p.npc]
	return !n ? undefined : p.point < 0 ? n.pos : n.route[p.point]
}

/** The last NPC (its index) that starts in cube `at`, or -1. */
export function npcAt(world: CubeWorld, at: SpawnPoint): number {
	for (let i = world.npcs.length - 1; i >= 0; i--) if (same(world.npcs[i].pos, at)) return i
	return -1
}

/** The last point of NPC `npc`'s route in cube `at`, or -1. */
export function routePointAt(world: CubeWorld, npc: number, at: SpawnPoint): number {
	const r = world.npcs[npc]?.route ?? []
	for (let i = r.length - 1; i >= 0; i--) if (same(r[i], at)) return i
	return -1
}

/** Why no NPC may start or walk in cube `at`, or '' when one may. */
export function npcBlock(world: CubeWorld, at: SpawnPoint): string {
	return editBlock(world, at.x, at.z, at.layer)
}

/** Adds NPC `name` standing in cube `at`, with no route, at the end of the list; says why not instead. */
export function placeNpc(world: CubeWorld, name: string, at: SpawnPoint): WorldNpc | string {
	if (!name) return 'no NPC picked'
	const why = npcBlock(world, at)
	if (why) return why
	const n: WorldNpc = { name, pos: copy(at), route: [] }
	world.npcs.push(n)
	return n
}

/** Moves point `p` (an NPC's start or a cube of its route) to cube `to`; says why not instead. */
export function moveNpcPoint(world: CubeWorld, p: NpcPoint, to: SpawnPoint): WorldNpc | string {
	const n = world.npcs[p.npc]
	if (!n || (p.point >= 0 && !n.route[p.point])) return 'no such NPC or route cube'
	const why = npcBlock(world, to)
	if (why) return why
	if (p.point < 0) n.pos = copy(to)
	else n.route[p.point] = copy(to)
	return n
}

/**
 * Adds cube `at` to NPC `npc`'s route, after its point `after` (-1 its start, so first; undefined at the
 * end); says why not instead. A cube the same as the point before it is refused: the NPC would not move.
 */
export function addRoutePoint(world: CubeWorld, npc: number, at: SpawnPoint, after?: number): WorldNpc | string {
	const n = world.npcs[npc]
	if (!n) return 'no such NPC'
	const why = npcBlock(world, at)
	if (why) return why
	const i = after === undefined ? n.route.length : Math.max(0, Math.min(n.route.length, after + 1))
	const prev = i === 0 ? n.pos : n.route[i - 1]
	if (same(prev, at)) return 'that cube is the one before it on the route'
	n.route.splice(i, 0, copy(at))
	return n
}

/** Removes point `point` of NPC `npc`'s route; returns the NPC, or null when there is no such point. */
export function removeRoutePoint(world: CubeWorld, npc: number, point: number): WorldNpc | null {
	const n = world.npcs[npc]
	if (!n?.route[point]) return null
	n.route.splice(point, 1)
	return n
}

/** Removes NPC `npc`; returns it, or null when there is none. */
export function removeNpc(world: CubeWorld, npc: number): WorldNpc | null {
	if (!world.npcs[npc]) return null
	return world.npcs.splice(npc, 1)[0]
}

/** A copy of a list of NPCs. */
export function copyNpcs(list: readonly WorldNpc[]): WorldNpc[] {
	return list.map((n) => ({ name: n.name, pos: copy(n.pos), route: n.route.map(copy) }))
}

/**
 * Runs `edit` on the world's NPCs as one History step: a copy before and after, the undo and redo
 * putting one back (on the world itself, which the tab owns) and calling `changed` (to redraw them).
 * Returns `edit`'s result; nothing is recorded when it changed nothing.
 */
export function editNpcs<T>(world: CubeWorld, history: { push(cmd: Command): void }, label: string, changed: () => void, edit: () => T): T {
	const before = copyNpcs(world.npcs)
	const out = edit()
	const after = copyNpcs(world.npcs)
	if (JSON.stringify(before) === JSON.stringify(after)) return out
	changed()
	history.push({
		label,
		bytes: JSON.stringify(after).length * 4,
		undo: () => {
			world.npcs = copyNpcs(before)
			changed()
		},
		redo: () => {
			world.npcs = copyNpcs(after)
			changed()
		},
	})
	return out
}

/** An NPC in words: its name and where it starts. */
export function npcWords(n: WorldNpc): string {
	return `${n.name} at (${n.pos.x}, ${n.pos.z}, layer ${n.pos.layer})`
}

/** Shapes an NPC walks into like a wall; the others (half, slope, stairs, quarter, ladder) it steps up or goes through. The thin walls (named `wall*`) are tested against their hulls instead. */
const WALL_SHAPES: ReadonlySet<string> = new Set(['full', 'pillar', 'window'])

/** Heights in the cube (0 to 1, y up) an NPC's body is tested at: knee-high stuff (wall_low, 0.25) is stepped over, anything from the chest down to the floor blocks. */
const BODY_HEIGHTS = [0.3, 0.55]

/** How many steps per cube a leg is sampled at: a thin wall's panel is 0.125 of a cube, so the step is finer than that. */
const STEPS_PER_CUBE = 16

const EPS = 1e-4

/** The convex hull of the points (x, z) as a counter-clockwise polygon, by the monotone chain. */
function hull2d(pts: [number, number][]): [number, number][] {
	const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
	const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
	const half = (list: [number, number][]) => {
		const out: [number, number][] = []
		for (const q of list) {
			while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 1e-9) out.pop()
			out.push(q)
		}
		out.pop()
		return out
	}
	return [...half(p), ...half([...p].reverse())]
}

/** Each hull of a shape turned by a rotation as its height range and its outline seen from above, cached. */
const hullPrisms = new Map<number, { lo: number; hi: number; poly: [number, number][] }[]>()
function prisms(shape: number, rotation: number) {
	const key = shape * 16 + rotation
	let list = hullPrisms.get(key)
	if (!list) {
		list = shapeHulls(shape, rotation).map((h) => ({
			lo: Math.min(...h.map((p) => p[1])),
			hi: Math.max(...h.map((p) => p[1])),
			poly: hull2d(h.map((p) => [p[0], p[2]] as [number, number])),
		}))
		hullPrisms.set(key, list)
	}
	return list
}

/** Whether the point (fx, fy, fz), in a cube's unit space, lies inside one of the hulls of `shape` turned by `rotation`. */
function inHulls(shape: number, rotation: number, fx: number, fy: number, fz: number): boolean {
	for (const { lo, hi, poly } of prisms(shape, rotation)) {
		if (fy < lo - EPS || fy > hi + EPS || poly.length < 3) continue
		let inside = true
		for (let i = 0; i < poly.length && inside; i++) {
			const a = poly[i]
			const b = poly[(i + 1) % poly.length]
			if ((b[0] - a[0]) * (fz - a[1]) - (b[1] - a[1]) * (fx - a[0]) < -EPS) inside = false
		}
		if (inside) return true
	}
	return false
}

/** Whether a straight walk from cube `a` to cube `b` on one layer crosses a cube it cannot walk through. Liquids are walked through; a thin wall blocks only across its panel. */
export function legBlocked(world: CubeWorld, a: SpawnPoint, b: SpawnPoint): boolean {
	if (a.layer !== b.layer) return false // a way between layers (stairs, slopes) is not judged
	const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * STEPS_PER_CUBE))
	for (let i = 0; i <= steps; i++) {
		const px = a.x + 0.5 + ((b.x - a.x) * i) / steps
		const pz = a.z + 0.5 + ((b.z - a.z) * i) / steps
		const x = Math.floor(px)
		const z = Math.floor(pz)
		const c = world.get(x, z, a.layer)
		if (c.kind === 0 || c.kind === 5 || c.kind === 6 || c.kind === 7) continue
		const name = SHAPES[c.shape]?.name ?? ''
		if (WALL_SHAPES.has(name)) return true
		if (name.startsWith('wall') && BODY_HEIGHTS.some((y) => inHulls(c.shape, c.rotation, px - x, y, pz - z))) return true
	}
	return false
}

/** For NPC `npc`, whether each leg of its loop (start, route cubes, back to start) is blocked, in order; empty without a route. */
export function blockedLegs(world: CubeWorld, npc: WorldNpc): boolean[] {
	if (!npc.route.length) return []
	const loop = [npc.pos, ...npc.route, npc.pos]
	const out: boolean[] = []
	for (let s = 0; s + 1 < loop.length; s++) out.push(legBlocked(world, loop[s], loop[s + 1]))
	return out
}

/** ' (N legs cross solid cubes: it would stick)' for NPC `npc`, or '' when none does. */
export function blockedNote(world: CubeWorld, npc: WorldNpc | undefined): string {
	const n = npc ? blockedLegs(world, npc).filter(Boolean).length : 0
	return n ? ` ${n === 1 ? 'One leg' : `${n} legs`} of its route cross${n === 1 ? 'es' : ''} solid cubes (drawn red): it would get stuck.` : ''
}

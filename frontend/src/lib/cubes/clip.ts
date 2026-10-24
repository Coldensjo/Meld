// Boxes of cubes (#70): the box the Select tool selects in a cube world, a copy of its cubes (the
// clipboard, kept outside any document so it pastes into another world tab), turned a quarter about
// the vertical, pasted, moved and emptied, each through CubeChanges so it is one History step. A
// cube's paint goes with it (#83), its faces turned and mirrored with the box, and so does its blend
// (#84), both the faces and their edges turned and mirrored. The
// objects attached to the cubes and the groups of joined cubes go with them (#101): a copy carries
// them, a paste puts them down with new ids, a move takes them along with their ids, and emptying or
// replacing a cube drops what was attached to it and takes it out of its group. The caller records
// the groups and objects before and after (objects.ts snapshotObjects) for the undo. The monster
// spawn points (#109) and the props (#177) in the box's cells go with it too. Pure data, with no
// three.js, so it runs in the unit tests.

import { FACE_COUNT, normalize, paintFaceOf, textureOf, withPaintFace, withTexture, type CubeWorld, type Paint, type WorldObject } from './world'
import { CubeChanges, MAX_BOX_CUBES, boxSize, editBlock, fillBox } from './edit'
import { rotateFace, CUBE_HEIGHT, CUBE_SIZE, EAST, NORTH, SOUTH, WEST } from './shapes'
import { layerBottom } from './mesher'
import { GENERATED_SHAPES } from './shapes.generated'
import { propBlock, propLayer, wrapTurn } from './props'
import { detachObject, nextId, unjoin } from './objects'
import type { CubeAt } from './pick'

/** A box of cubes, inclusive: columns x0..x1 and z0..z1, layers top..bottom (top is the higher, so the smaller number). */
export interface CubeBox {
	x0: number
	x1: number
	z0: number
	z1: number
	top: number
	bottom: number
}

/**
 * An object a clip carries: its kind, face and state as `WorldObject`'s, its cube's place in the clip
 * (x, z and the layer from the top, l) and the objects of the clip it acts on, by their index in
 * `CubeClip.objects` (links to objects outside the clip are not kept).
 */
export interface ClipObject {
	kind: number
	face: number
	state: number
	/** A torch's fire colour, as `WorldObject.colour`; missing is orange. */
	colour?: number
	x: number
	z: number
	l: number
	targets: number[]
}

/** A monster spawn point a clip carries (#109): its kind and its cube's place in the clip (x, z and the layer from the top, l). */
export interface ClipMonster {
	kind: string
	x: number
	z: number
	l: number
}

/**
 * A prop a clip carries (#177): its model, turn and scale as `WorldProp`'s, and where its origin stands
 * in metres from the clip's corner (x and z from its west and north side, y above its lowest layer's bottom).
 */
export interface ClipProp {
	model: string
	x: number
	y: number
	z: number
	turn: number
	scale: number
}

/** A group a clip carries: the places [x, z, l] of its cubes in the clip, two or more. */
export type ClipJoin = Array<[number, number, number]>

/**
 * Copied cubes: w by d columns and h layers, each a packed cube (kind | shape << 8 | rotation << 16),
 * index (layer from the top * d + z) * w + x; the textures painted on them (#83), each cube's packed
 * as world.ts paintOf at the same index, none when left out; which edges of their faces blend (#84),
 * each cube's packed as world.ts blendOf, none when left out; and the objects on them and the groups
 * among them (#101), none when left out.
 */
export interface CubeClip {
	w: number
	d: number
	h: number
	cubes: Uint32Array
	paint?: Paint[]
	blend?: Float64Array
	objects?: ClipObject[]
	joins?: ClipJoin[]
	/** The monster spawn points in the box, in any cell, empty or not (#109). */
	monsters?: ClipMonster[]
	/** The props whose origin stands in a cell of the box (#177). */
	props?: ClipProp[]
}

const pack = (kind: number, shape: number, rotation: number) => kind | (shape << 8) | (rotation << 16)

/** The box with these sizes whose lowest layer is `bottom` and whose corner is (x0, z0). */
export function boxAt(x0: number, z0: number, bottom: number, w: number, d: number, h: number): CubeBox {
	return { x0, x1: x0 + w - 1, z0, z1: z0 + d - 1, top: bottom - h + 1, bottom }
}

/** The box moved by dx and dz columns and dl layers (positive dl is down). */
export const moveBoxBy = (b: CubeBox, dx: number, dz: number, dl: number): CubeBox => ({
	x0: b.x0 + dx,
	x1: b.x1 + dx,
	z0: b.z0 + dz,
	z1: b.z1 + dz,
	top: b.top + dl,
	bottom: b.bottom + dl,
})

/** Whether two boxes are the same. */
export const sameBox = (a: CubeBox | null, b: CubeBox | null) =>
	a === b || (!!a && !!b && a.x0 === b.x0 && a.x1 === b.x1 && a.z0 === b.z0 && a.z1 === b.z1 && a.top === b.top && a.bottom === b.bottom)

/** The box's size in words: columns across, columns deep and layers high. */
export const boxWords = (b: CubeBox) => `${b.x1 - b.x0 + 1} × ${b.z1 - b.z0 + 1} × ${b.bottom - b.top + 1}`

/** Copies the cubes of a box; outside the world they are empty. */
export function copyBox(world: CubeWorld, box: CubeBox): CubeClip {
	const w = box.x1 - box.x0 + 1
	const d = box.z1 - box.z0 + 1
	const h = box.bottom - box.top + 1
	const cubes = new Uint32Array(w * d * h)
	const paint = new Array<Paint>(w * d * h).fill(0n)
	const blend = new Float64Array(w * d * h)
	for (let l = 0; l < h; l++) {
		for (let z = 0; z < d; z++) {
			for (let x = 0; x < w; x++) {
				const c = world.get(box.x0 + x, box.z0 + z, box.top + l)
				cubes[(l * d + z) * w + x] = pack(c.kind, c.shape, c.rotation)
				paint[(l * d + z) * w + x] = world.paintOf(box.x0 + x, box.z0 + z, box.top + l)
				blend[(l * d + z) * w + x] = world.blendOf(box.x0 + x, box.z0 + z, box.top + l)
			}
		}
	}
	// The objects on the box's cubes that are not empty, and the part of each group made of them.
	const at = (p: CubeAt): [number, number, number] | null => {
		const x = p.x - box.x0
		const z = p.z - box.z0
		const l = p.layer - box.top
		return x >= 0 && x < w && z >= 0 && z < d && l >= 0 && l < h && cubes[(l * d + z) * w + x] & 0xff ? [x, z, l] : null
	}
	const taken = world.objects.filter((o) => at(o.pos))
	const index = new Map(taken.map((o, i) => [o.id, i]))
	const objects = taken.map((o): ClipObject => {
		const [x, z, l] = at(o.pos)!
		return { kind: o.kind, face: o.face, state: o.state, colour: o.colour ?? 0, x, z, l, targets: o.targets.filter((t) => index.has(t)).map((t) => index.get(t)!) }
	})
	const joins: ClipJoin[] = []
	for (const j of world.joins) {
		const inside = j.cubes.map(at).filter((p) => p !== null)
		if (inside.length >= 2) joins.push(inside)
	}
	const monsters = monstersIn(world, box).map((i): ClipMonster => {
		const m = world.monsters[i]
		return { kind: m.kind, x: m.pos.x - box.x0, z: m.pos.z - box.z0, l: m.pos.layer - box.top }
	})
	const props = propsIn(world, box).map((i): ClipProp => {
		const p = world.props[i]
		return { model: p.model, x: p.x - box.x0 * CUBE_SIZE, y: p.y - layerBottom(box.bottom), z: p.z - box.z0 * CUBE_SIZE, turn: p.turn, scale: p.scale }
	})
	return { w, d, h, cubes, paint, blend, objects, joins, monsters, props }
}

/** The indices into `world.props` of the props whose origin stands in a cell of the box (props.ts propLayer). */
export function propsIn(world: CubeWorld, box: CubeBox): number[] {
	const out: number[] = []
	world.props.forEach((p, i) => {
		const x = Math.floor(p.x / CUBE_SIZE)
		const z = Math.floor(p.z / CUBE_SIZE)
		const l = propLayer(p)
		if (x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1 && l >= box.top && l <= box.bottom) out.push(i)
	})
	return out
}

/** The indices into `world.monsters` of the spawn points in the box's cells. */
function monstersIn(world: CubeWorld, box: CubeBox): number[] {
	const out: number[] = []
	world.monsters.forEach((m, i) => {
		const p = m.pos
		if (p.x >= box.x0 && p.x <= box.x1 && p.z >= box.z0 && p.z <= box.z1 && p.layer >= box.top && p.layer <= box.bottom) out.push(i)
	})
	return out
}

/** A cube's packed paint with its faces moved by `face` (old face to new; each face's texture goes where it maps). */
function movePaint(paint: Paint, face: (f: number) => number): Paint {
	if (!paint) return 0n
	let out = 0n
	for (let f = 0; f < FACE_COUNT; f++) out = withTexture(out, face(f), textureOf(paint, f))
	return out
}

/** A cube's packed blend with its faces and their edges moved by `face` (old face to new): face f's edge towards e becomes face(f)'s edge towards face(e). */
function moveBlend(blend: number, face: (f: number) => number): number {
	if (!blend) return 0
	let out = 0
	for (let f = 0; f < FACE_COUNT; f++) {
		const b = paintFaceOf(blend, f)
		let moved = 0
		for (let e = 0; e < FACE_COUNT; e++) if (b & (1 << e)) moved |= 1 << face(e)
		out = withPaintFace(out, face(f), moved)
	}
	return out
}

/** How many cubes of a clip are not empty. */
export function clipCount(clip: CubeClip): number {
	let n = 0
	for (const c of clip.cubes) if (c & 0xff) n++
	return n
}

/**
 * The clip turned a quarter clockwise seen from above, as a cube's rotation turns (shapes.ts
 * rotatePoint: (x, z) to (1 - z, x)): each cube moves to its turned place and is turned itself.
 */
export function turnClip(clip: CubeClip): CubeClip {
	const { w, d, h } = clip
	const out = new Uint32Array(clip.cubes.length)
	const paint = clip.paint ? new Array<Paint>(clip.cubes.length).fill(0n) : undefined
	const blend = clip.blend ? new Float64Array(clip.cubes.length) : undefined
	const turn = (f: number) => rotateFace(1, f)
	// The turned clip is d columns across and w deep.
	for (let l = 0; l < h; l++) {
		for (let z = 0; z < d; z++) {
			for (let x = 0; x < w; x++) {
				const c = clip.cubes[(l * d + z) * w + x]
				// Paint lies on the world's faces, which turn with the box: north to east, a top stays.
				if (paint) paint[(l * w + x) * d + (d - 1 - z)] = movePaint(clip.paint![(l * d + z) * w + x], turn)
				// So does blend, and its edges with it: a top's north edge becomes its east edge.
				if (blend) blend[(l * w + x) * d + (d - 1 - z)] = moveBlend(clip.blend![(l * d + z) * w + x], turn)
				const kind = c & 0xff
				const shape = (c >> 8) & 0xff
				const rot = (c >> 16) & 0xff
				const t = kind ? normalize(kind, shape, (rot & 4) | ((rot + 1) & 3)) : { kind: 0, shape: 0, rotation: 0 }
				out[(l * w + x) * d + (d - 1 - z)] = pack(t.kind, t.shape, t.rotation)
			}
		}
	}
	// An object turns with its cube: its place as the cube's, its face a quarter (a top or bottom stays).
	const place = (x: number, z: number, l: number): [number, number, number] => [d - 1 - z, x, l]
	return {
		w: d,
		d: w,
		h,
		cubes: out,
		paint,
		blend,
		objects: clip.objects?.map((o) => {
			const [x, z, l] = place(o.x, o.z, o.l)
			return { ...o, x, z, l, face: rotateFace(1, o.face), targets: [...o.targets] }
		}),
		joins: clip.joins?.map((j) => j.map(([x, z, l]) => place(x, z, l))),
		monsters: clip.monsters?.map((m) => {
			const [x, z, l] = place(m.x, m.z, m.l)
			return { ...m, x, z, l }
		}),
		// A prop's place turns in metres as a cell's does, and the prop a quarter clockwise with it (its turn is counter-clockwise).
		props: clip.props?.map((p) => ({ ...p, x: d * CUBE_SIZE - p.z, z: p.x, turn: wrapTurn(p.turn - Math.PI / 2) })),
	}
}

/**
 * The clip mirrored east to west (`x`: the place (x, z) goes to (w - 1 - x, z)) or north to south (`z`:
 * to (x, d - 1 - z)). A shape mirrored east to west is a shape turned (its `mirror` in
 * shapes.generated.ts: itself, or a mirrored twin such as wall_diagonal_inner's, turned t quarter
 * turns), so a cube of shape s at quarter turn k becomes that shape at t - k for an east-west mirror
 * and t + 2 - k for a north-south one (a z mirror is an x mirror and a half turn); upside down is
 * untouched. A shape that does not turn drops the change (normalize).
 */
export function mirrorClip(clip: CubeClip, axis: 'x' | 'z'): CubeClip {
	const { w, d, h } = clip
	const out = new Uint32Array(clip.cubes.length)
	const paint = clip.paint ? new Array<Paint>(clip.cubes.length).fill(0n) : undefined
	const blend = clip.blend ? new Float64Array(clip.cubes.length) : undefined
	const swap: Record<number, number> = axis === 'x' ? { [EAST]: WEST, [WEST]: EAST } : { [NORTH]: SOUTH, [SOUTH]: NORTH }
	const mirror = (f: number) => swap[f] ?? f
	for (let l = 0; l < h; l++) {
		for (let z = 0; z < d; z++) {
			for (let x = 0; x < w; x++) {
				const c = clip.cubes[(l * d + z) * w + x]
				const kind = c & 0xff
				const shape = (c >> 8) & 0xff
				const rot = (c >> 16) & 0xff
				const [mirrored, mirrorTurns] = GENERATED_SHAPES[shape]?.mirror ?? [shape, 0]
				const turn = (axis === 'x' ? 0 : 2) + mirrorTurns - (rot & 3)
				const t = kind ? normalize(kind, mirrored, (rot & 4) | (turn & 3)) : { kind: 0, shape: 0, rotation: 0 }
				const nx = axis === 'x' ? w - 1 - x : x
				const nz = axis === 'z' ? d - 1 - z : z
				out[(l * d + nz) * w + nx] = pack(t.kind, t.shape, t.rotation)
				// Paint goes with its face: an east face's to the west (x), a north face's to the south (z).
				if (paint) paint[(l * d + nz) * w + nx] = movePaint(clip.paint![(l * d + z) * w + x], mirror)
				// Blend likewise, its edges mirrored too: a top's east edge becomes its west edge (x).
				if (blend) blend[(l * d + nz) * w + nx] = moveBlend(clip.blend![(l * d + z) * w + x], mirror)
			}
		}
	}
	// An object goes with its cube, an east or west face (x) or a north or south one (z) to the other side.
	const place = (x: number, z: number, l: number): [number, number, number] => (axis === 'x' ? [w - 1 - x, z, l] : [x, d - 1 - z, l])
	return {
		w,
		d,
		h,
		cubes: out,
		paint,
		blend,
		objects: clip.objects?.map((o) => {
			const [x, z, l] = place(o.x, o.z, o.l)
			return { ...o, x, z, l, face: swap[o.face] ?? o.face, targets: [...o.targets] }
		}),
		joins: clip.joins?.map((j) => j.map(([x, z, l]) => place(x, z, l))),
		monsters: clip.monsters?.map((m) => {
			const [x, z, l] = place(m.x, m.z, m.l)
			return { ...m, x, z, l }
		}),
		// A model cannot be mirrored, so a prop is turned to face the mirrored way: a model faces north at
		// turn 0 (models.toml), so an east-west mirror turns it to -turn and a north-south one to π - turn.
		props: clip.props?.map((p) =>
			axis === 'x' ? { ...p, x: w * CUBE_SIZE - p.x, turn: wrapTurn(-p.turn) } : { ...p, z: d * CUBE_SIZE - p.z, turn: wrapTurn(Math.PI - p.turn) },
		),
	}
}

/** What a paste did: the cubes it set, and those it could not (outside the world or in the metal layers). */
export interface PasteResult {
	placed: number
	refused: number
}

const cellKey = (p: CubeAt) => `${p.x},${p.z},${p.layer}`

/**
 * Drops the objects attached to `cells` and takes the cells out of their groups (a group left with one
 * cube goes): what a cube emptied or replaced loses. Returns whether anything changed.
 */
export function clearCells(world: CubeWorld, cells: CubeAt[]): boolean {
	if (!cells.length) return false
	const set = new Set(cells.map(cellKey))
	const gone = world.objects.filter((o) => set.has(cellKey(o.pos)))
	for (const o of gone) detachObject(world, o.id)
	const joined = () => world.joins.reduce((n, j) => n + j.cubes.length, 0)
	const before = joined()
	unjoin(world, cells)
	return gone.length > 0 || joined() !== before
}

/** The cubes of a clip that are not empty, packed, with their paint, their blend and their place in the world when put at `box`. */
function clipCells(clip: CubeClip, box: CubeBox): Array<{ c: number; paint: Paint; blend: number; at: CubeAt }> {
	const out: Array<{ c: number; paint: Paint; blend: number; at: CubeAt }> = []
	const { w, d, h } = clip
	for (let l = 0; l < h; l++) {
		for (let z = 0; z < d; z++) {
			for (let x = 0; x < w; x++) {
				const i = (l * d + z) * w + x
				const c = clip.cubes[i]
				if (c & 0xff) out.push({ c, paint: clip.paint?.[i] ?? 0n, blend: clip.blend?.[i] ?? 0, at: { x: box.x0 + x, z: box.z0 + z, layer: box.top + l } })
			}
		}
	}
	return out
}

/**
 * Puts the clip's cubes into `box`'s place (its corner and lowest layer); empty cubes of the clip leave
 * the world's cubes be. Each cube put down replaces what was attached to the one there and takes it
 * out of its group; then the clip's objects and groups are added on the cubes put down, with new ids,
 * an object's links kept to the objects put down with it.
 */
export function pasteClip(changes: CubeChanges, clip: CubeClip, box: CubeBox): PasteResult {
	const r = { placed: 0, refused: 0 }
	const world = changes.world
	const down: CubeAt[] = []
	for (const { c, paint, blend, at } of clipCells(clip, box)) {
		if (editBlock(world, at.x, at.z, at.layer)) r.refused++
		else {
			down.push(at)
			if (changes.set(at.x, at.z, at.layer, c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff, paint, blend)) r.placed++
		}
	}
	clearCells(world, down)
	const put = (x: number, z: number, l: number): CubeAt | null => {
		const at = { x: box.x0 + x, z: box.z0 + z, layer: box.top + l }
		return editBlock(world, at.x, at.z, at.layer) ? null : at
	}
	const made = new Map<number, WorldObject>()
	let id = nextId(world.objects)
	clip.objects?.forEach((o, i) => {
		const pos = put(o.x, o.z, o.l)
		if (!pos) return
		const n: WorldObject = { id: id++, kind: o.kind, face: o.face, pos, targets: [], state: o.state, colour: o.colour ?? 0 }
		made.set(i, n)
		world.objects.push(n)
	})
	clip.objects?.forEach((o, i) => {
		const n = made.get(i)
		if (n) n.targets = o.targets.filter((t) => made.has(t)).map((t) => made.get(t)!.id)
	})
	let gid = nextId(world.joins)
	for (const j of clip.joins ?? []) {
		const cubes = j.map(([x, z, l]) => put(x, z, l)).filter((p) => p !== null)
		if (cubes.length >= 2) world.joins.push({ id: gid++, cubes })
	}
	// Spawn points go in any cell of the box, at the end of the list; the world's own stay (#109).
	for (const m of clip.monsters ?? []) {
		const pos = put(m.x, m.z, m.l)
		if (pos) world.monsters.push({ kind: m.kind, pos })
	}
	// Props likewise (#177): at the end of the list, one outside the world or in the metal left out.
	for (const p of clip.props ?? []) {
		const x = box.x0 * CUBE_SIZE + p.x
		const y = layerBottom(box.bottom) + p.y
		const z = box.z0 * CUBE_SIZE + p.z
		if (!propBlock(world, x, y, z)) world.props.push({ model: p.model, x, y, z, turn: p.turn, scale: p.scale })
	}
	return r
}

/** Why a box's cubes cannot be copied, emptied or moved, or '' when they can: its size. */
export function boxBlock(box: CubeBox): string {
	const n = boxSize(box)
	return n > MAX_BOX_CUBES ? `the box holds ${n} cubes; one step changes at most ${MAX_BOX_CUBES}` : ''
}

/**
 * Empties every cube of a box, dropping the objects attached to them and taking them out of their
 * groups. Returns how many cubes changed.
 */
export function emptyBox(changes: CubeChanges, box: CubeBox): number {
	const world = changes.world
	const cells: CubeAt[] = []
	for (let layer = box.top; layer <= box.bottom; layer++) {
		for (let z = box.z0; z <= box.z1; z++) for (let x = box.x0; x <= box.x1; x++) if (!editBlock(world, x, z, layer)) cells.push({ x, z, layer })
	}
	clearCells(world, cells)
	const gone = new Set(monstersIn(world, box))
	if (gone.size) world.monsters = world.monsters.filter((_, i) => !gone.has(i))
	const props = new Set(propsIn(world, box))
	if (props.size) world.props = world.props.filter((_, i) => !props.has(i))
	return fillBox(changes, box, 0)
}

/**
 * Moves a box's cubes by dx, dz and dl (positive dl is down): the box is emptied and its cubes that
 * are not empty are put at the new place, over what is there. Refused (with why, nothing changed)
 * when a cube that is not empty would land outside the world or in the metal layers, so a move never
 * loses cubes. The objects on the moved cubes go with them, keeping their ids and links, and the
 * moved cubes keep their groups; a cube landed on loses what was attached to it and leaves its group.
 * The changes are added to `changes`, so a run of moves is one step.
 */
export function moveBox(changes: CubeChanges, box: CubeBox, dx: number, dz: number, dl: number): string {
	const world = changes.world
	const clip = copyBox(world, box)
	const moving = clipCells(clip, box)
	const shift = (p: CubeAt): CubeAt => ({ x: p.x + dx, z: p.z + dz, layer: p.layer + dl })
	for (const { at } of moving) {
		const to = shift(at)
		const why = editBlock(world, to.x, to.z, to.layer)
		if (why) return `a cube would land ${why}`
		const here = editBlock(world, at.x, at.z, at.layer)
		if (here) return `a cube of the box is ${here}`
	}
	// The box's spawn points move with it, in any cell; none may land outside the world or in the metal.
	const spawns = monstersIn(world, box)
	for (const i of spawns) {
		const to = shift({ x: world.monsters[i].pos.x, z: world.monsters[i].pos.z, layer: world.monsters[i].pos.layer })
		const why = editBlock(world, to.x, to.z, to.layer)
		if (why) return `a spawn point would land ${why}`
	}
	// So do its props (#177), by whole cubes.
	const props = propsIn(world, box)
	for (const i of props) {
		const p = world.props[i]
		const why = propBlock(world, p.x + dx * CUBE_SIZE, p.y - dl * CUBE_HEIGHT, p.z + dz * CUBE_SIZE)
		if (why) return `a prop would land ${why}`
	}
	const from = new Set(moving.map(({ at }) => cellKey(at)))
	const landing = new Set(moving.map(({ at }) => cellKey(shift(at))))
	const stays = (p: CubeAt) => !from.has(cellKey(p))
	for (const o of world.objects.filter((o) => stays(o.pos) && landing.has(cellKey(o.pos)))) detachObject(world, o.id)
	for (const o of world.objects) if (!stays(o.pos)) o.pos = shift(o.pos)
	for (const j of world.joins) j.cubes = j.cubes.filter((c) => !stays(c) || !landing.has(cellKey(c))).map((c) => (stays(c) ? c : shift(c)))
	world.joins = world.joins.filter((j) => j.cubes.length >= 2)
	for (const i of spawns) world.monsters[i].pos = shift(world.monsters[i].pos)
	for (const i of props) {
		const p = world.props[i]
		p.x += dx * CUBE_SIZE
		p.y -= dl * CUBE_HEIGHT
		p.z += dz * CUBE_SIZE
	}
	fillBox(changes, box, 0)
	for (const { c, paint, blend, at } of moving) {
		const to = shift(at)
		changes.set(to.x, to.z, to.layer, c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff, paint, blend)
	}
	return ''
}

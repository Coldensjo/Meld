import { parse } from 'smol-toml'
import { BLEND_EDGES, FACE_COUNT, FIRE_COLOURS, KINDS, OBJECT_KINDS, SHAPES, TEXTURES, normalize, normalizeBlend, normalizePaint, paintFaceOf, textureOf, withPaintFace, withTexture, type Paint } from './world'
import type { ClipJoin, ClipMonster, ClipObject, ClipProp, CubeClip } from './clip'
import { FACE_WORDS, TELEPORTER, TORCH } from './objects'
import { CUBE_HEIGHT, CUBE_SIZE, UP } from './shapes'
import { wrapTurn } from './props'
import { MAX_BOX_CUBES } from './edit'

// Prefabs of cubes (3dgame #73): a box of cubes (a door frame, a staircase, a tree) kept in a TOML
// file of the author's prefab folder (prefs.prefabDir, shared with the WoW prefabs of #170) and
// placed again as a paste of the Select tool (CubeSelectTool.startPaste), turned with R. The file is
// the editor's own, not the game's world format: each cube that is not empty as a `[[cube]]` table
// with its place in the box, its kind and shape by name, its quarter turns and whether it is upside
// down, the textures painted on its faces (#83) as `paint = { top = 'grass' }` by face name, and the
// edges of its faces that blend into the texture beside them (#84) as `blend = { top = ['north', 'east'] }`,
// so it reads and edits by hand. The objects attached to its cubes and its groups of joined
// cubes (#101) follow as `[[object]]` tables (`id`, `at`, `kind`, `face` by name, `on`, `acts_on` the
// ids of the objects it acts on) and `[[join]]` tables (`cubes`, a list of places). The monster
// spawn points in its box (#109) are `[[monster]]` tables (`at`, any cell of the box, and `kind`),
// and its props (#177) `[[prop]]` tables (`model`, `at` = [x, z, y] in metres from the box's
// north-west corner and its lowest layer's bottom, `turn` in radians and `scale`).

export interface CubePrefab {
	name: string
	clip: CubeClip
}

export const CUBE_PREFAB_FILE_HEADER = '# 3dgame cube prefab: a box of cubes placed together'

/** Whether a prefab file's text is a cube prefab (it has `[[cube]]` tables) rather than a WoW one of models. */
export const isCubePrefabText = (text: string) => /^\s*\[\[\s*cube\s*\]\]/m.test(text)

/** A TOML string: literal unless it holds a single quote or a line break. */
const tomlString = (s: string) => (!s.includes("'") && !/[\n\r]/.test(s) ? `'${s}'` : JSON.stringify(s))

/**
 * The prefab as TOML: its name and size (columns across, columns deep, layers high), then a `[[cube]]`
 * table per cube that is not empty, `at = [x, z, y]` with y the height above the box's lowest layer.
 */
export function formatCubePrefab(p: CubePrefab): string {
	const { w, d, h, cubes, paint, blend } = p.clip
	const lines = [CUBE_PREFAB_FILE_HEADER, `name = ${tomlString(p.name)}`, `size = [${w}, ${d}, ${h}]`]
	for (let y = 0; y < h; y++) {
		const l = h - 1 - y
		for (let z = 0; z < d; z++) {
			for (let x = 0; x < w; x++) {
				const c = cubes[(l * d + z) * w + x]
				const kind = c & 0xff
				if (!kind) continue
				const shape = (c >> 8) & 0xff
				const rot = (c >> 16) & 0xff
				lines.push('', '[[cube]]', `at = [${x}, ${z}, ${y}]`, `kind = '${KINDS[kind]}'`, `shape = '${SHAPES[shape].name}'`)
				if (rot & 3) lines.push(`turn = ${rot & 3}`)
				if (rot & 4) lines.push('upside_down = true')
				const painted = paint?.[(l * d + z) * w + x] ?? 0n
				const faces: string[] = []
				for (let f = 0; f < FACE_COUNT; f++) {
					const t = textureOf(painted, f)
					// A texture this editor does not know (3dgame #215) has no name to write, so the face goes unpainted.
					if (t && t < TEXTURES.length) faces.push(`${FACE_WORDS[f]} = '${TEXTURES[t]}'`)
				}
				if (faces.length) lines.push(`paint = { ${faces.join(', ')} }`)
				const blended = blend?.[(l * d + z) * w + x] ?? 0
				const edges: string[] = []
				for (let f = 0; f < FACE_COUNT; f++) {
					const b = paintFaceOf(blended, f)
					if (b) edges.push(`${FACE_WORDS[f]} = [${FACE_WORDS.filter((_, e) => b & (1 << e)).map((e) => `'${e}'`).join(', ')}]`)
				}
				if (edges.length) lines.push(`blend = { ${edges.join(', ')} }`)
			}
		}
	}
	const at = (x: number, z: number, l: number) => `[${x}, ${z}, ${h - 1 - l}]`
	p.clip.objects?.forEach((o, i) => {
		lines.push('', '[[object]]', `id = ${i + 1}`, `at = ${at(o.x, o.z, o.l)}`, `kind = '${OBJECT_KINDS[o.kind]}'`, `face = '${FACE_WORDS[o.face]}'`)
		if (o.state === 1) lines.push('on = true')
		if (o.kind === TORCH && o.colour) lines.push(`fire = '${FIRE_COLOURS[o.colour]}'`)
		if (o.targets.length) lines.push(`acts_on = [${o.targets.map((t) => t + 1).join(', ')}]`)
	})
	for (const j of p.clip.joins ?? []) lines.push('', '[[join]]', `cubes = [${j.map(([x, z, l]) => at(x, z, l)).join(', ')}]`)
	for (const m of p.clip.monsters ?? []) lines.push('', '[[monster]]', `at = ${at(m.x, m.z, m.l)}`, `kind = ${tomlString(m.kind)}`)
	for (const r of p.clip.props ?? []) {
		lines.push('', '[[prop]]', `model = ${tomlString(r.model)}`, `at = [${r.x}, ${r.z}, ${r.y}]`)
		if (r.turn) lines.push(`turn = ${r.turn}`)
		if (r.scale !== 1) lines.push(`scale = ${r.scale}`)
	}
	return lines.join('\n') + '\n'
}

export interface ParsedCubePrefab {
	prefab: CubePrefab | null
	/** One message per thing that couldn't be read; a cube that can't be read is left out. */
	errors: string[]
}


const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Reads a prefab written by `formatCubePrefab` (or by hand). */
export function parseCubePrefab(text: string, fallbackName = 'Prefab', knownKind: (kind: string) => boolean = () => true): ParsedCubePrefab {
	let doc: Record<string, unknown>
	try {
		doc = parse(text)
	} catch (e) {
		return { prefab: null, errors: [`not valid TOML: ${e instanceof Error ? e.message : e}`] }
	}
	const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : fallbackName
	const size = doc.size
	if (!Array.isArray(size) || size.length !== 3 || !size.every((n) => int(n) && n > 0)) return { prefab: null, errors: ['size must be [across, deep, high], whole numbers above 0'] }
	const [w, d, h] = size as number[]
	if (w * d * h > MAX_BOX_CUBES) return { prefab: null, errors: [`the box holds ${w * d * h} cubes, more than the ${MAX_BOX_CUBES} a box may`] }
	const list = doc.cube
	if (!Array.isArray(list)) return { prefab: null, errors: ['no [[cube]] tables'] }
	const errors: string[] = []
	const cubes = new Uint32Array(w * d * h)
	const paint = new Array<Paint>(w * d * h).fill(0n)
	const blend = new Float64Array(w * d * h)
	list.forEach((v, i) => {
		const where = `cube ${i + 1}`
		const t = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
		const at = t.at
		if (!Array.isArray(at) || at.length !== 3 || !at.every(int)) return errors.push(`${where}: at must be [x, z, y], whole numbers`)
		const [x, z, y] = at as number[]
		if (x < 0 || x >= w || z < 0 || z >= d || y < 0 || y >= h) return errors.push(`${where}: at [${x}, ${z}, ${y}] is outside the size`)
		const kind = KINDS.indexOf(t.kind as (typeof KINDS)[number])
		if (kind <= 0) return errors.push(`${where}: kind must be one of ${KINDS.slice(1).join(', ')}`)
		const shape = t.shape === undefined ? 0 : SHAPES.findIndex((s) => s.name === t.shape)
		if (shape < 0) return errors.push(`${where}: shape must be one of ${SHAPES.map((s) => s.name).join(', ')}`)
		const turn = int(t.turn) ? t.turn & 3 : 0
		const c = normalize(kind, shape, turn | (t.upside_down === true ? 4 : 0))
		cubes[((h - 1 - y) * d + z) * w + x] = c.kind | (c.shape << 8) | (c.rotation << 16)
		if (t.blend !== undefined) blend[((h - 1 - y) * d + z) * w + x] = parseBlend(t.blend, c.kind, where, errors)
		if (t.paint === undefined) return
		if (typeof t.paint !== 'object' || t.paint === null || Array.isArray(t.paint)) return errors.push(`${where}: paint must be a table of face = 'texture'`)
		let painted: Paint = 0n
		for (const [face, texture] of Object.entries(t.paint as Record<string, unknown>)) {
			const f = FACE_WORDS.indexOf(face as (typeof FACE_WORDS)[number])
			const id = TEXTURES.indexOf(texture as (typeof TEXTURES)[number])
			if (f < 0) errors.push(`${where}: paint's face must be one of ${FACE_WORDS.join(', ')}`)
			else if (id < 0) errors.push(`${where}: paint's texture must be one of ${TEXTURES.join(', ')}`)
			else painted = withTexture(painted, f, id)
		}
		paint[((h - 1 - y) * d + z) * w + x] = normalizePaint(c.kind, painted)
	})
	if (!cubes.some((c) => c & 0xff)) return { prefab: null, errors: errors.length ? errors : ['no cubes'] }
	return { prefab: { name, clip: { w, d, h, cubes, paint, blend, ...parseAttached(doc, w, d, h, cubes, errors), monsters: parseMonsters(doc, w, d, h, knownKind, errors), props: parseProps(doc, w, d, h, errors) } }, errors }
}

/**
 * A cube's `blend` table (#84), face name to the list of the names of its edges that blend, packed as
 * world.ts blendOf; an edge that is not one of its face's (the face itself or its opposite) is reported
 * in `errors` and left out.
 */
function parseBlend(v: unknown, kind: number, where: string, errors: string[]): number {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) {
		errors.push(`${where}: blend must be a table of face = ['edge', ...]`)
		return 0
	}
	let blend = 0
	for (const [face, edges] of Object.entries(v as Record<string, unknown>)) {
		const f = FACE_WORDS.indexOf(face as (typeof FACE_WORDS)[number])
		if (f < 0) {
			errors.push(`${where}: blend's face must be one of ${FACE_WORDS.join(', ')}`)
			continue
		}
		if (!Array.isArray(edges)) {
			errors.push(`${where}: blend's ${face} must be a list of edges, such as ['north', 'east']`)
			continue
		}
		let b = 0
		for (const edge of edges) {
			const e = FACE_WORDS.indexOf(edge as (typeof FACE_WORDS)[number])
			if (e < 0 || !(BLEND_EDGES[f] & (1 << e))) errors.push(`${where}: blend's ${face} edges must be among ${FACE_WORDS.filter((_, i) => BLEND_EDGES[f] & (1 << i)).join(', ')}`)
			else b |= 1 << e
		}
		blend = withPaintFace(blend, f, b)
	}
	return normalizeBlend(kind, blend)
}

/** The `[[object]]` and `[[join]]` tables of a prefab on its cubes; what can't be read is reported in `errors` and left out. */
function parseAttached(doc: Record<string, unknown>, w: number, d: number, h: number, cubes: Uint32Array, errors: string[]): { objects: ClipObject[]; joins: ClipJoin[] } {
	// A place [x, z, y] in the box as [x, z, l], or why not: it must hold a cube.
	const place = (v: unknown): [number, number, number] | string => {
		if (!Array.isArray(v) || v.length !== 3 || !v.every(int)) return 'must be [x, z, y], whole numbers'
		const [x, z, y] = v as number[]
		if (x < 0 || x >= w || z < 0 || z >= d || y < 0 || y >= h) return `[${x}, ${z}, ${y}] is outside the size`
		const l = h - 1 - y
		return cubes[(l * d + z) * w + x] & 0xff ? [x, z, l] : `[${x}, ${z}, ${y}] has no cube`
	}
	const objects: ClipObject[] = []
	const ids: unknown[] = []
	const acts: unknown[] = []
	const faces = new Set<string>()
	;(Array.isArray(doc.object) ? doc.object : []).forEach((v, i) => {
		const where = `object ${i + 1}`
		const t = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
		const p = place(t.at)
		if (typeof p === 'string') return errors.push(`${where}: at ${p}`)
		const kind = OBJECT_KINDS.indexOf(t.kind as (typeof OBJECT_KINDS)[number])
		if (kind < 0) return errors.push(`${where}: kind must be one of ${OBJECT_KINDS.join(', ')}`)
		const face = kind === TELEPORTER ? UP : FACE_WORDS.indexOf(t.face as (typeof FACE_WORDS)[number])
		if (face < 0) return errors.push(`${where}: face must be one of ${FACE_WORDS.join(', ')}`)
		const key = `${p.join(',')},${face}`
		if (faces.has(key)) return errors.push(`${where}: that face of its cube has an object already`)
		faces.add(key)
		const colour = t.fire === undefined ? 0 : FIRE_COLOURS.indexOf(t.fire as (typeof FIRE_COLOURS)[number])
		if (colour < 0 || (colour > 0 && kind !== TORCH)) return errors.push(`${where}: fire is a torch's, one of ${FIRE_COLOURS.join(', ')}`)
		objects.push({ kind, face, state: t.on === true ? 1 : 0, colour, x: p[0], z: p[1], l: p[2], targets: [] })
		ids.push(t.id)
		acts.push(t.acts_on)
	})
	// What each object acts on, by the others' ids, as the editor's links allow (objects.ts toggleLink).
	objects.forEach((o, i) => {
		const list = acts[i]
		if (list === undefined) return
		if (!Array.isArray(list)) return errors.push(`object ${i + 1}: acts_on must be a list of object ids`)
		for (const id of list) {
			const t = ids.findIndex((x) => x !== undefined && x === id)
			if (t < 0) errors.push(`object ${i + 1}: no object ${id} to act on`)
			else if (t === i || o.targets.includes(t)) errors.push(`object ${i + 1}: acts on itself, or on object ${id} twice`)
			else if (o.kind === TORCH || objects[t].kind === TORCH) errors.push(`object ${i + 1}: a torch acts on nothing, and nothing acts on it`)
			else if ((o.kind === TELEPORTER) !== (objects[t].kind === TELEPORTER) || (o.kind === TELEPORTER && o.targets.length)) {
				errors.push(`object ${i + 1}: a teleporter leads to one other teleporter, and the other kinds never act on one`)
			} else o.targets.push(t)
		}
	})
	const joins: ClipJoin[] = []
	const joined = new Set<string>()
	;(Array.isArray(doc.join) ? doc.join : []).forEach((v, i) => {
		const t = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
		const j: ClipJoin = []
		for (const c of Array.isArray(t.cubes) ? t.cubes : []) {
			const p = place(c)
			if (typeof p === 'string') errors.push(`join ${i + 1}: a cube ${p}`)
			else if (joined.has(p.join(','))) errors.push(`join ${i + 1}: a cube is in another group already`)
			else {
				joined.add(p.join(','))
				j.push(p)
			}
		}
		if (j.length >= 2) joins.push(j)
		else errors.push(`join ${i + 1}: a group needs two cubes or more`)
	})
	return { objects, joins }
}

/** The `[[monster]]` tables of a prefab: a spawn point in any cell of the box, of a kind `knownKind` accepts; what can't be read is reported in `errors` and left out. */
function parseMonsters(doc: Record<string, unknown>, w: number, d: number, h: number, knownKind: (kind: string) => boolean, errors: string[]): ClipMonster[] {
	const out: ClipMonster[] = []
	;(Array.isArray(doc.monster) ? doc.monster : []).forEach((v, i) => {
		const where = `monster ${i + 1}`
		const t = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
		const at = t.at
		if (!Array.isArray(at) || at.length !== 3 || !at.every(int)) return errors.push(`${where}: at must be [x, z, y], whole numbers`)
		const [x, z, y] = at as number[]
		if (x < 0 || x >= w || z < 0 || z >= d || y < 0 || y >= h) return errors.push(`${where}: at [${x}, ${z}, ${y}] is outside the size`)
		if (typeof t.kind !== 'string' || !knownKind(t.kind)) return errors.push(`${where}: kind must be a monster kind of the game`)
		out.push({ kind: t.kind, x, z, l: h - 1 - y })
	})
	return out
}

/** The `[[prop]]` tables of a prefab: a prop standing in any cell of the box; what can't be read is reported in `errors` and left out. */
function parseProps(doc: Record<string, unknown>, w: number, d: number, h: number, errors: string[]): ClipProp[] {
	const out: ClipProp[] = []
	const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
	;(Array.isArray(doc.prop) ? doc.prop : []).forEach((v, i) => {
		const where = `prop ${i + 1}`
		const t = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
		if (typeof t.model !== 'string' || !t.model) return errors.push(`${where}: model must be a model's name, such as 'nature/pine_1'`)
		const at = t.at
		if (!Array.isArray(at) || at.length !== 3 || !at.every(num)) return errors.push(`${where}: at must be [x, z, y], metres`)
		const [x, z, y] = at as number[]
		// As props.ts propLayer: a prop a hair below the box's bottom stands on it.
		if (x < 0 || x >= w * CUBE_SIZE || z < 0 || z >= d * CUBE_SIZE || y < -0.001 || y >= h * CUBE_HEIGHT - 0.001) return errors.push(`${where}: at [${x}, ${z}, ${y}] is outside the box`)
		if (t.turn !== undefined && !num(t.turn)) return errors.push(`${where}: turn must be radians`)
		if (t.scale !== undefined && !(num(t.scale) && t.scale > 0)) return errors.push(`${where}: scale must be above 0`)
		out.push({ model: t.model, x, y, z, turn: wrapTurn((t.turn as number | undefined) ?? 0), scale: (t.scale as number | undefined) ?? 1 })
	})
	return out
}

/** The prefab's cubes by kind name, most first, for the palette's side panel. */
export function prefabContents(clip: CubeClip): Array<[string, number]> {
	const counts = new Map<string, number>()
	for (const c of clip.cubes) if (c & 0xff) counts.set(KINDS[c & 0xff], (counts.get(KINDS[c & 0xff]) ?? 0) + 1)
	return [...counts].sort((a, b) => b[1] - a[1])
}

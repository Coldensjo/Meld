// The asset browser's palette in a cube world's tab (#63): the shapes, the materials and the liquids
// a cube is built from, and the objects attached to cubes (#32), found by a search over
// their names and words and drawn as small pictures. Pure data, with no DOM, so it runs in the tests;
// components/CubePalette.svelte draws it.

import { KINDS, OBJECT_KINDS, ROTATION_COUNT, SHAPES } from './world'
import { OBJECT_COLOURS } from './objects'
import { cubeColour, SOLID, THEMES, themeOf } from './mesher'
import { FACE_NORMALS, shapeFaces } from './shapes'
import type { CubeClip } from './clip'

/** The palette's categories, in the order its facets list them. */
export const CUBE_CATEGORIES = ['Shapes', 'Materials', 'Liquids', 'Objects'] as const
export type CubeCategory = (typeof CUBE_CATEGORIES)[number]

/** One tile of the palette: a shape (`shape:<id>`), a kind (`kind:<id>`) or an object (`object:<id>`). */
export interface CubeItem {
	key: string
	name: string
	category: CubeCategory
	/** What it sets on the Cubes tool. */
	sets: 'shape' | 'kind' | 'object'
	id: number
	/** A line about it, for the preview. */
	about: string
	/** The words a search matches, lower case. */
	words: string[]
}

const SHAPE_ABOUT: Record<string, string> = {
	full: 'A whole cube.',
	half: 'The lower half of a cube; upside down, the upper half.',
	slope: 'A ramp from the floor up to the top, to walk up.',
	stairs: 'Eight steps rising one layer, solid underneath, to walk up.',
	quarter: 'A quarter of a cube, a corner block.',
	pillar: 'A post in the middle of the cell.',
	ladder: 'A thin panel against one side, to climb.',
	doorway: 'A wall with a doorway through it, to walk through.',
	window: 'A wall with a square window hole through its middle.',
	wall: 'A thin wall, an eighth of a cube thick, against one side, so a room is the size of its cubes.',
	wall_inner_corner: 'Two thin walls meeting along an edge: the corner of a room, seen from inside it.',
	wall_outer_corner: 'The post that closes the outside corner where two thin walls turn away from each other.',
	wall_middle: 'A thin wall through the middle of the cell, between two rooms that share a row of cubes.',
	wall_middle_corner: 'Two middle walls meeting in the middle of the cell.',
	wall_middle_t: 'A middle wall with another meeting it from one side.',
	wall_middle_cross: 'Two middle walls crossing.',
	wall_half: 'A thin wall half a cube high, for parapets and railings; upside down, the upper half.',
	wall_low: 'A thin wall a quarter of a cube high, for the base of a fence; upside down, the top quarter.',
	wall_doorway: 'A thin wall with a doorway through it, which a door shuts.',
	wall_window: 'A thin wall with a square window hole, which a window shuts.',
	wall_tall_window: 'A thin wall with a tall window hole, which a window shuts.',
	floor_slab: 'A thin floor, an eighth of a cube thick, so a storey needs no whole cube of floor; upside down, a ceiling.',
	wall_diagonal: 'A thin wall at 45 degrees from corner to corner, its outer side through the corners; turn it for the other diagonal.',
	wall_diagonal_half: 'A diagonal thin wall half a cube high, for angled parapets; upside down, the upper half.',
	wall_diagonal_post: 'Fills the notch where two diagonal walls meet in a line, on their inner side.',
	wall_diagonal_inner: 'A thin wall whose end meets a diagonal wall in the cell beside it: the inside of a corner cut at 45 degrees.',
	wall_diagonal_inner_mirrored: 'The mirrored inner join: a thin wall whose other end meets a diagonal wall.',
	wall_diagonal_outer: 'The end of a thin wall where it turns away along a diagonal: closes the outside of the bend.',
	wall_diagonal_outer_mirrored: 'The mirrored outer join of a thin wall and a diagonal wall.',
	wall_shallow_near: 'The first of two cells of a thin wall at a shallow angle (1 in 2), from a corner to the middle of a side.',
	wall_shallow_far: 'The second cell of a shallow thin wall, from the middle of a side to a corner.',
	wall_shallow_near_mirrored: 'The first cell of a shallow thin wall bending the other way.',
	wall_shallow_far_mirrored: 'The second cell of a shallow thin wall bending the other way.',
	wall_shallow_post: 'Fills the notch at a corner a shallow wall passes through, where it goes on or turns straight.',
	wall_shallow_post_mirrored: 'The mirrored filler for a shallow wall bending the other way.',
	thin_stairs: 'Steps rising one layer as treads with nothing under them, so a stair in a hall leaves room below.',
	corner_stairs: 'A quarter turn of steps round one corner, rising one layer: up from one side, off over the next, turning left; four round a corner make a spiral.',
	corner_stairs_mirrored: 'Corner stairs turning right.',
	wall_round_outer: 'A quarter-round thin wall round one corner, from the middle of one side to the middle of the next; four round a corner make a round tower, middle walls between them a larger ring.',
	wall_round_inner: 'The inside corner of a room of thin walls, rounded off between the walls against two sides.',
	wall_round_half: 'A quarter-round thin wall half the height, for a well or a parapet round a tower.',
	column: 'A thick eight-sided column, its flat sides on the middles of the four sides.',
	column_thin: 'A thin eight-sided column through the middle, as wide as a pillar.',
	wall_octagon_window: 'A thin wall with an eight-sided window hole, which a window attaches to.',
	slope_steep_low: 'The lower piece of a steep slope, rising two layers over one cube, too steep to walk up; a steep slope high piece goes above it.',
	slope_steep_high: 'The upper piece of a steep slope, above a steep slope low piece.',
	roof_thin: 'Only the surface of a slope, an eighth of a cube thick, so the attic under a roof is room.',
	roof_steep_low_thin: 'The lower piece of a thin steep roof: only the surface of a steep slope.',
	roof_steep_high_thin: 'The upper piece of a thin steep roof, above the lower piece.',
	slope_outer: 'The outer corner of a hipped roof: two slopes meeting in a hip, high at one corner.',
	slope_inner: 'The inner corner (a valley) of a roof: two slopes, high along two sides, low at one corner.',
	roof_outer_thin: 'The outer corner of a hipped thin roof.',
	roof_inner_thin: 'The inner corner (a valley) of a thin roof.',
	ridge: 'The ridge along the top of a roof an odd number of cubes wide: two slopes meeting in the middle, half a cube up.',
	ridge_steep: 'The ridge of a steep roof: two steep slopes meeting in the middle of the top.',
	gable: 'The end of a thin roof: the roof with a triangular thin wall under it, closing the attic.',
	gable_mirrored: 'The end of a thin roof, its wall on the other side.',
	gable_steep_low: 'The end of the lower piece of a thin steep roof, with a thin wall under it.',
	gable_steep_low_mirrored: 'The end of the lower piece of a thin steep roof, its wall on the other side.',
	gable_steep_high: 'The end of the upper piece of a thin steep roof, with a triangular thin wall under it.',
	gable_steep_high_mirrored: 'The end of the upper piece of a thin steep roof, its wall on the other side.',
	spire_pyramid: 'A pyramid spire cap for a square tower, too steep to walk up.',
	spire_cone: 'An eight-sided cone spire cap for a round tower or a column.',
	crenellation: 'Battlements: a thin wall half high with a merlon at each end, so a row shows merlons and gaps.',
	arch_pointed: 'A wall with a pointed arch through it, which a door shuts below the point.',
	wall_arch_pointed: 'A thin wall with a pointed arch through it, which a door shuts below the point.',
}
const SHAPE_WORDS: Record<string, string[]> = {
	full: ['block', 'cube', 'whole'],
	half: ['slab', 'step'],
	slope: ['ramp', 'wedge', 'incline'],
	stairs: ['steps', 'staircase', 'stair'],
	quarter: ['corner', 'quarter'],
	pillar: ['post', 'column', 'pole'],
	ladder: ['climb', 'panel'],
	doorway: ['door', 'opening', 'arch', 'entrance'],
	window: ['opening', 'hole', 'glass'],
	wall: ['thin', 'panel', 'partition'],
	wall_inner_corner: ['thin', 'corner', 'inner'],
	wall_outer_corner: ['thin', 'corner', 'outer', 'post'],
	wall_middle: ['thin', 'partition', 'divider'],
	wall_middle_corner: ['thin', 'corner', 'partition'],
	wall_middle_t: ['thin', 'junction', 'partition'],
	wall_middle_cross: ['thin', 'junction', 'partition', 'cross'],
	wall_half: ['thin', 'parapet', 'railing'],
	wall_low: ['thin', 'fence', 'kerb', 'curb'],
	wall_doorway: ['thin', 'door', 'opening', 'entrance'],
	wall_window: ['thin', 'opening', 'hole', 'glass'],
	wall_tall_window: ['thin', 'opening', 'hole', 'glass'],
	floor_slab: ['thin', 'floor', 'ceiling', 'slab', 'storey'],
	wall_diagonal: ['thin', 'angled', 'diagonal', '45'],
	wall_diagonal_half: ['thin', 'angled', 'diagonal', 'parapet', 'railing'],
	wall_diagonal_post: ['thin', 'angled', 'diagonal', 'post', 'filler'],
	wall_diagonal_inner: ['thin', 'angled', 'diagonal', 'corner', 'inner', 'join'],
	wall_diagonal_inner_mirrored: ['thin', 'angled', 'diagonal', 'corner', 'inner', 'join'],
	wall_diagonal_outer: ['thin', 'angled', 'diagonal', 'corner', 'outer', 'join'],
	wall_diagonal_outer_mirrored: ['thin', 'angled', 'diagonal', 'corner', 'outer', 'join'],
	wall_shallow_near: ['thin', 'angled', 'shallow', 'bend'],
	wall_shallow_far: ['thin', 'angled', 'shallow', 'bend'],
	wall_shallow_near_mirrored: ['thin', 'angled', 'shallow', 'bend'],
	wall_shallow_far_mirrored: ['thin', 'angled', 'shallow', 'bend'],
	wall_shallow_post: ['thin', 'angled', 'shallow', 'post', 'filler'],
	wall_shallow_post_mirrored: ['thin', 'angled', 'shallow', 'post', 'filler'],
	thin_stairs: ['steps', 'staircase', 'stair', 'thin', 'treads', 'open'],
	corner_stairs: ['steps', 'staircase', 'stair', 'corner', 'turn', 'spiral', 'winding'],
	corner_stairs_mirrored: ['steps', 'staircase', 'stair', 'corner', 'turn', 'spiral', 'winding'],
	wall_round_outer: ['thin', 'round', 'curved', 'arc', 'tower', 'ring', 'convex'],
	wall_round_inner: ['thin', 'round', 'curved', 'arc', 'corner', 'room', 'concave'],
	wall_round_half: ['thin', 'round', 'curved', 'arc', 'well', 'parapet', 'low'],
	column: ['pillar', 'octagon', 'eight', 'round', 'post', 'thick'],
	column_thin: ['pillar', 'octagon', 'eight', 'round', 'post'],
	wall_octagon_window: ['thin', 'window', 'octagon', 'round', 'opening', 'hole'],
	slope_steep_low: ['steep', 'slope', 'roof', 'ramp', 'gothic', 'lower'],
	slope_steep_high: ['steep', 'slope', 'roof', 'ramp', 'gothic', 'upper'],
	roof_thin: ['roof', 'slope', 'thin', 'panel', 'attic'],
	roof_steep_low_thin: ['roof', 'steep', 'thin', 'panel', 'attic', 'gothic', 'lower'],
	roof_steep_high_thin: ['roof', 'steep', 'thin', 'panel', 'attic', 'gothic', 'upper'],
	slope_outer: ['roof', 'hip', 'corner', 'outer', 'slope'],
	slope_inner: ['roof', 'valley', 'corner', 'inner', 'slope'],
	roof_outer_thin: ['roof', 'hip', 'corner', 'outer', 'thin'],
	roof_inner_thin: ['roof', 'valley', 'corner', 'inner', 'thin'],
	ridge: ['roof', 'ridge', 'peak', 'top', 'cap'],
	ridge_steep: ['roof', 'ridge', 'peak', 'top', 'cap', 'steep', 'gothic'],
	gable: ['roof', 'gable', 'end', 'wall', 'thin', 'triangle'],
	gable_mirrored: ['roof', 'gable', 'end', 'wall', 'thin', 'triangle'],
	gable_steep_low: ['roof', 'gable', 'end', 'wall', 'thin', 'steep', 'gothic'],
	gable_steep_low_mirrored: ['roof', 'gable', 'end', 'wall', 'thin', 'steep', 'gothic'],
	gable_steep_high: ['roof', 'gable', 'end', 'wall', 'thin', 'steep', 'gothic', 'triangle'],
	gable_steep_high_mirrored: ['roof', 'gable', 'end', 'wall', 'thin', 'steep', 'gothic', 'triangle'],
	spire_pyramid: ['spire', 'pyramid', 'cap', 'tower', 'turret', 'gothic'],
	spire_cone: ['spire', 'cone', 'cap', 'tower', 'turret', 'round', 'gothic'],
	crenellation: ['battlement', 'merlon', 'crenel', 'parapet', 'castle', 'wall'],
	arch_pointed: ['arch', 'pointed', 'doorway', 'door', 'gothic', 'opening'],
	wall_arch_pointed: ['arch', 'pointed', 'doorway', 'door', 'gothic', 'opening', 'thin'],
}
const KIND_ABOUT: Record<string, string> = {
	dirt: 'Earth: the ground and the dirt layers.',
	stone: 'Rock: the stone layers, and walls.',
	metal: 'The metal of the bottom layers, which no player reaches; it can be built with elsewhere.',
	wood: 'Planks, for houses, bridges and ladders.',
	water: 'Fresh water: swum in, safe.',
	sea: 'Sea water: swum in, safe.',
	lava: 'Lava: kills on contact.',
}
const KIND_WORDS: Record<string, string[]> = {
	dirt: ['earth', 'soil', 'ground', 'mud'],
	stone: ['rock', 'brick', 'cobble'],
	metal: ['iron', 'steel'],
	wood: ['plank', 'timber', 'log'],
	water: ['liquid', 'lake', 'river', 'pool'],
	sea: ['liquid', 'ocean', 'salt'],
	lava: ['liquid', 'fire', 'magma'],
}
const OBJECT_ABOUT: Record<string, string> = {
	door: 'Shuts an opening in a cube; opened by a lever or button it is linked to.',
	window: 'A pane that fills an opening in a cube; opened by a lever or button it is linked to.',
	lever: 'A lever on a cube face; it opens the doors and windows linked to it.',
	button: 'A button on a cube face; it opens the doors and windows linked to it.',
	teleporter: 'A pad on the top of a cube that leads to the teleporter it is linked to.',
	torch: 'Burns and lights what is around it.',
}
const OBJECT_WORDS: Record<string, string[]> = {
	door: ['opening', 'gate'],
	window: ['opening', 'glass', 'pane'],
	lever: ['switch', 'pull'],
	button: ['switch', 'press'],
	teleporter: ['portal', 'pad', 'warp'],
	torch: ['light', 'fire', 'flame'],
}
/** Kind ids that are liquids (crates/world KindClass::Liquid). */
const LIQUIDS = new Set(['water', 'sea', 'lava'])

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Every tile of the palette, shapes first, then the materials and the liquids by kind id. */
export const CUBE_ITEMS: readonly CubeItem[] = [
	...SHAPES.map((s, id): CubeItem => ({
		key: `shape:${id}`,
		name: cap(s.name.replaceAll('_', ' ')),
		category: 'Shapes',
		sets: 'shape',
		id,
		about: `${SHAPE_ABOUT[s.name] ?? ''}${s.turns ? ' Turns with R.' : ''}${s.flips ? ' Upside down with Shift+R.' : ''}`.trim(),
		words: [s.name, 'shape', ...(SHAPE_WORDS[s.name] ?? [])],
	})),
	...KINDS.flatMap((k, id): CubeItem[] =>
		id === 0
			? []
			: [
					{
						key: `kind:${id}`,
						name: cap(k),
						category: LIQUIDS.has(k) ? 'Liquids' : 'Materials',
						sets: 'kind',
						id,
						about: KIND_ABOUT[k] ?? '',
						words: [k, LIQUIDS.has(k) ? 'liquid' : 'material', ...(KIND_WORDS[k] ?? [])],
					},
				],
	),
	...OBJECT_KINDS.map((k, id): CubeItem => ({
		key: `object:${id}`,
		name: cap(k),
		category: 'Objects',
		sets: 'object',
		id,
		about: `${OBJECT_ABOUT[k] ?? ''} Attached with the Cubes tool's Object mode.`.trim(),
		words: [k, 'object', ...(OBJECT_WORDS[k] ?? [])],
	})),
]

/** The colour of an object tile's mark, `#rrggbb`. */
export const objectColour = (id: number) => `#${(OBJECT_COLOURS[id] ?? 0x808080).toString(16).padStart(6, '0')}`

/** The item of a key, or undefined. */
export const cubeItem = (key: string) => CUBE_ITEMS.find((it) => it.key === key)

/**
 * The items of `category` (every one with '') whose words start with each word of `query`, in the
 * palette's order, and how many of the query's matches each category has.
 */
export function searchCubes(query: string, category: CubeCategory | ''): { items: CubeItem[]; counts: Record<CubeCategory, number> } {
	const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
	const hits = CUBE_ITEMS.filter((it) => terms.every((t) => it.words.some((w) => w.startsWith(t)) || it.name.toLowerCase().startsWith(t)))
	const counts = { Shapes: 0, Materials: 0, Liquids: 0, Objects: 0 } as Record<CubeCategory, number>
	for (const it of hits) counts[it.category]++
	return { items: category ? hits.filter((it) => it.category === category) : hits, counts }
}

/** Puts `key` first in the recent picks, at most `max` long. */
export const withRecent = (recent: readonly string[], key: string, max = 12) => [key, ...recent.filter((k) => k !== key)].slice(0, max)

/** The theme a layer tints its cubes by, by name. */
export const themeName = (layer: number) => THEMES[themeOf(layer)]

/** A face of a picture: its corners in pixels and its fill, `rgba(...)`. */
export interface ThumbFace {
	points: [number, number][]
	fill: string
}

const toSrgb = (c: number) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055))
/** The picture is seen from above the south-east (+x, +y, +z) corner, lit from above. */
const VIEW: readonly [number, number, number] = [1, 1, 1]
const LIGHT = (() => {
	const l = [0.45, 1, 0.25]
	const n = Math.hypot(l[0], l[1], l[2])
	return l.map((v) => v / n)
})()
const COS30 = Math.cos(Math.PI / 6)

/**
 * The faces of a cube of `kind`, `shape` and `rotation` as the game colours it in `layer`, drawn
 * isometric into a square of `size` pixels: the faces turned to the viewer, farthest first, so a
 * painter's fill in order draws the cube.
 */
export function thumbFaces(kind: number, shape: number, rotation: number, layer: number, size: number): ThumbFace[] {
	const [r, g, b, a] = cubeColour(kind, layer)
	// A unit cube spans sqrt(3) * cos30 across and 2 high in these units; fit it with a margin.
	const scale = size / 2.3
	const cx = size / 2
	const cy = size / 2
	const project = (p: readonly number[]): [number, number] => {
		const x = p[0] - 0.5
		const y = p[1] - 0.5
		const z = p[2] - 0.5
		return [cx + (x - z) * COS30 * scale, cy + ((x + z) * 0.5 - y) * scale]
	}
	const faces: { depth: number; face: ThumbFace }[] = []
	for (const f of shapeFaces(shape, rotation)) {
		const n = f.normal
		if (n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2] <= 1e-6) continue
		const light = 0.45 + 0.55 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2])
		let depth = 0
		for (const p of f.polygon) depth += p[0] + p[1] + p[2]
		depth /= f.polygon.length
		faces.push({ depth, face: { points: f.polygon.map(project), fill: `rgba(${toSrgb(r * light)},${toSrgb(g * light)},${toSrgb(b * light)},${a})` } })
	}
	faces.sort((p, q) => p.depth - q.depth)
	return faces.map((f) => f.face)
}

/**
 * The faces of a box of cubes (a prefab of #73) as `thumbFaces` draws one cube, fitted into a square of
 * `size` pixels: each cube's faces turned to the viewer and not hidden by a neighbour of the clip (as
 * the mesher hides them), farthest first.
 */
export function clipThumbFaces(clip: CubeClip, layer: number, size: number): ThumbFace[] {
	const { w, d, h, cubes } = clip
	const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d ? 0 : cubes[((h - 1 - y) * d + z) * w + x])
	const raw: { depth: number; points: [number, number][]; fill: string }[] = []
	let minX = Infinity
	let maxX = -Infinity
	let minY = Infinity
	let maxY = -Infinity
	for (let y = 0; y < h; y++) {
		for (let z = 0; z < d; z++) {
			for (let x = 0; x < w; x++) {
				const c = at(x, y, z)
				const kind = c & 0xff
				if (!kind) continue
				const [r, g, b, a] = cubeColour(kind, layer)
				for (const f of shapeFaces((c >> 8) & 0xff, (c >> 16) & 0xff)) {
					const n = f.normal
					if (n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2] <= 1e-6) continue
					if (f.boundary >= 0) {
						const o = FACE_NORMALS[f.boundary]
						const nb = at(x + o[0], y + o[1], z + o[2])
						const nk = nb & 0xff
						if (nk && (SOLID[nk] || nk === kind) && f.hiddenBy[((nb >> 8) & 0xff) * ROTATION_COUNT + ((nb >> 16) & 0xff)]) continue
					}
					const light = 0.45 + 0.55 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2])
					let depth = 0
					const points = f.polygon.map((p): [number, number] => {
						const px = x + p[0]
						const py = y + p[1]
						const pz = z + p[2]
						depth += px + py + pz
						const sx = (px - pz) * COS30
						const sy = (px + pz) * 0.5 - py
						minX = Math.min(minX, sx)
						maxX = Math.max(maxX, sx)
						minY = Math.min(minY, sy)
						maxY = Math.max(maxY, sy)
						return [sx, sy]
					})
					raw.push({ depth: depth / f.polygon.length, points, fill: `rgba(${toSrgb(r * light)},${toSrgb(g * light)},${toSrgb(b * light)},${a})` })
				}
			}
		}
	}
	if (!raw.length) return []
	const scale = (size * 0.9) / Math.max(maxX - minX, maxY - minY, 1e-6)
	const ox = size / 2 - ((minX + maxX) / 2) * scale
	const oy = size / 2 - ((minY + maxY) / 2) * scale
	raw.sort((p, q) => p.depth - q.depth)
	return raw.map((f) => ({ points: f.points.map(([sx, sy]): [number, number] => [ox + sx * scale, oy + sy * scale]), fill: f.fill }))
}

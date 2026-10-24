// Chunk meshes of a cube world, ported from crates/client/src/mesher.rs so a world looks alike in the
// editor and the game: each cube is drawn with its shape's own faces (shapes.ts), and a face lying on
// the cube's boundary is left out when the neighbour across it is solid or the same liquid and covers
// it, with a full face or a partial face of its own that holds all of it (ShapeFace.hiddenBy), and a
// shape's faces against another of its hulls are left out (shapes.ts). Faces on the world's edge are
// always drawn. Each face shows a texture of the atlas (textures.ts, the client's textures.rs): the
// one painted on the cube face it belongs to, else the kind's own; a face on the cube's boundary
// belongs to that cube face, one inside it to the face its normal points most towards (shapes.ts
// paintSideOf, the client's paint_face), and the texture is projected straight onto that face's plane
// (faceUv, the client's face_uv), so it lines up from one cube to the next (#83). Vertex colours tint
// it by the layer's theme and carry a liquid's alpha (faceColour, the client's face_colour); the
// kind's own colour (cubeColour) is what the minimap and the palette's pictures use.
//
// A face's edges can blend into the texture of the face beside them (#84, CubeWorld.blend): for each
// edge of a drawn face of a solid cube that blends, where the solid cube beyond the edge shows another
// texture on that face, an overlay copy of the face shows that texture, faded by the blend mask
// (textures.ts blendMask) from fully at the edge to nothing about a third of the way in (PART_BLEND).
//
// The client makes one mesh per kind; here the kinds are grouped by how they are drawn (PART_*), so
// a chunk is at most four meshes. Pure data, with no three.js, so it runs in the unit tests.

import { CHUNK_AREA, CHUNK_SIZE, GROUND_LAYER, KIND_TEXTURE, LAYER_COUNT, ROTATION_COUNT, TEXTURES, type CubeWorld } from './world'
import { CUBE_HEIGHT, CUBE_SIZE, DOWN, EAST, NORTH, SOUTH, UP, WEST, shapeFaces } from './shapes'

/**
 * The parts a chunk's mesh is split into: opaque cubes, see-through liquids, lava, which glows, the
 * blended edges' overlays (#84), and the solid faces that show a picture of the world's own (a Tibia
 * item's sprite, 3dgame #224), drawn from the world's sprite sheet (sprites.ts) rather than the atlas.
 */
export const PART_SOLID = 0
export const PART_LIQUID = 1
export const PART_GLOW = 2
export const PART_BLEND = 3
export const PART_SPRITE = 4
/** The overlays over cubes' tops (a Tibia map's borders, 3dgame #226), cut out of the sprite sheet by their pictures' alpha. */
export const PART_OVERLAY = 5
export const PART_COUNT = 6

/** Pictures a row of a world's sprite sheet holds (sprites.ts), placed by CubeWorld.spriteSlot. */
export const SPRITE_COLS = 32
/** The side of a picture in the sprite sheet, in pixels: one Tibia tile. */
export const SPRITE_SIZE = 32
/** Pixels of a picture's own image, wrapped round, framing it in the sheet, as ATLAS_PAD the atlas's tiles. */
export const SPRITE_PAD = 8
/** The side of a picture's cell in the sheet, its frame included. */
export const SPRITE_CELL = SPRITE_SIZE + 2 * SPRITE_PAD
/** The sheet's mip levels (sprites.ts): down to the one where a cell's frame is one pixel, 48, 24, 12 and 6 pixels a cell (3dgame #228). */
export const SPRITE_LEVELS = 4

/** The rows of the sprite sheet of a world with `n` pictures; at least one. */
export const spriteRows = (n: number) => Math.max(1, Math.ceil(n / SPRITE_COLS))

/** Where a point `s` (0..1 across a face) falls across its picture's cell, past the frame. */
const inSprite = (s: number) => (SPRITE_PAD + Math.min(1, Math.max(0, s)) * SPRITE_SIZE) / SPRITE_CELL

/** Cubes along an edge the blend mask spans before it repeats (make_textures.py BLEND_SPAN), so its ragged line runs on unbroken from cube to cube. */
export const BLEND_SPAN = 4

/** The axis (0 x, 1 y, 2 z) each face's normal lies along, by face id. */
const FACE_AXIS = [2, 0, 2, 0, 1, 1] as const
/** Whether each face points along + of its axis, by face id (east +x, south +z, up +y). */
const FACE_PLUS = [false, true, true, false, true, false] as const

/** Kind ids that are solid (crates/world KindClass::Solid): dirt, stone, metal, wood. */
export const SOLID = [false, true, true, true, true, false, false, false]
/** The part each kind is drawn in, by kind id. */
const KIND_PART = [-1, PART_SOLID, PART_SOLID, PART_SOLID, PART_SOLID, PART_LIQUID, PART_LIQUID, PART_GLOW]

/** How each kind looks, as sRGB and alpha (kind_look in the client), by kind id. */
const KIND_LOOK: readonly (readonly [number, number, number, number])[] = [
	[0, 0, 0, 0], // empty
	[0.45, 0.32, 0.2, 1], // dirt
	[0.5, 0.5, 0.52, 1], // stone
	[0.62, 0.66, 0.72, 1], // metal
	[0.6, 0.42, 0.22, 1], // wood
	[0.2, 0.45, 0.85, 0.6], // water
	[0.1, 0.3, 0.6, 0.7], // sea
	[1.0, 0.35, 0.05, 1], // lava
]

/** How a layer's theme tints its cubes (theme_tint in the client): sky, ground, dirt, stone, lava cavern, metal. */
const THEME_TINT: readonly (readonly [number, number, number])[] = [
	[1, 1, 1],
	[1, 1, 1],
	[0.88, 0.84, 0.8],
	[0.78, 0.8, 0.84],
	[0.9, 0.7, 0.62],
	[0.75, 0.78, 0.85],
]

/** Theme names, by the index `themeOf` gives. */
export const THEMES = ['sky', 'ground', 'dirt', 'stone', 'lava cavern', 'metal'] as const

/** The theme of a layer (crates/world/src/layer.rs THEMES), as an index into THEMES. */
export function themeOf(layer: number) {
	if (layer < GROUND_LAYER) return 0
	if (layer === GROUND_LAYER) return 1
	if (layer <= 14) return 2
	if (layer <= 20) return 3
	if (layer <= 25) return 4
	return 5
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

/** The colour of a cube of `kind` in `layer`, in linear RGBA (cube_colour in the client). */
export function cubeColour(kind: number, layer: number): [number, number, number, number] {
	const [r, g, b, a] = KIND_LOOK[kind]
	const t = THEME_TINT[themeOf(layer)]
	return [toLinear(r) * t[0], toLinear(g) * t[1], toLinear(b) * t[2], a]
}

/** The vertex colour of a cube of `kind` in `layer`, which its texture is multiplied by: the theme's tint, with the kind's alpha (face_colour in the client). */
export function faceColour(kind: number, layer: number): [number, number, number, number] {
	const t = THEME_TINT[themeOf(layer)]
	return [t[0], t[1], t[2], KIND_LOOK[kind][3]]
}

/** Every kind's face colour in every layer, `[layer][kind]`. */
const COLOURS = Array.from({ length: LAYER_COUNT }, (_, layer) => KIND_LOOK.map((_, kind) => faceColour(kind, layer)))

/** The side of every tile of the atlas, in pixels (TEXTURE_SIZE); a smaller image is scaled up to it. */
export const TEXTURE_SIZE = 64
/**
 * The tiles of the atlas: every texture but 'default', then the missing texture (MISSING_TILE), which a
 * face painted with an id past TEXTURES shows (3dgame #215), then the plain tile (PLAIN_TILE), which one
 * the world has a hint for shows in the hint's colour (3dgame #218).
 */
export const ATLAS_TILES = TEXTURES.length + 1
/** The missing texture's tile. */
export const MISSING_TILE = TEXTURES.length - 1
/** The plain tile, light grey with a little grain, the atlas's last. */
export const PLAIN_TILE = TEXTURES.length

/**
 * The atlas tile that shows `texture`: 'default' is drawn as the first, an unknown id as MISSING_TILE, or
 * as PLAIN_TILE when the world has a hint for it (`hinted`).
 */
const atlasTile = (texture: number, hinted = false) => (texture >= TEXTURES.length ? (hinted ? PLAIN_TILE : MISSING_TILE) : Math.max(0, texture - 1))

/**
 * A shape face's normal in the world, where a cube is CUBE_HEIGHT tall and CUBE_SIZE wide (3dgame #221):
 * the unit-cube normal scaled by the inverse of that stretch and made unit length again, so a stretched
 * slope is lit as the steeper face it is. Made once per normal.
 */
const worldNormals = new Map<readonly number[], readonly number[]>()
function worldNormal(n: readonly number[]): readonly number[] {
	let w = worldNormals.get(n)
	if (!w) {
		const x = n[0] / CUBE_SIZE
		const y = n[1] / CUBE_HEIGHT
		const z = n[2] / CUBE_SIZE
		const len = Math.hypot(x, y, z) || 1
		w = [x / len, y / len, z / len]
		worldNormals.set(n, w)
	}
	return w
}

/** Each hint colour (0xRRGGBB, sRGB) as a linear RGBA vertex colour with alpha 1, made once each. */
const hintColours = new Map<number, [number, number, number, number]>()
function hintColour(rgb: number): [number, number, number, number] {
	let c = hintColours.get(rgb)
	if (!c) {
		c = [toLinear(((rgb >> 16) & 0xff) / 255), toLinear(((rgb >> 8) & 0xff) / 255), toLinear((rgb & 0xff) / 255), 1]
		hintColours.set(rgb, c)
	}
	return c
}
/**
 * How many texels of a tile's own image, wrapped round, frame it on every side in the atlas (the client's
 * PAD), so a face's edge, sampled smoothed or from a smaller mip level, reads the texture's own
 * continuation rather than the tile beside it.
 */
export const ATLAS_PAD = 8
/** The side of a tile in the atlas, its frame included (the client's TILE). */
export const ATLAS_TILE = TEXTURE_SIZE + 2 * ATLAS_PAD

/** Where a point `s` (0..1 across a face) falls across its tile, past the frame. */
const inTile = (s: number) => (ATLAS_PAD + Math.min(1, Math.max(0, s)) * TEXTURE_SIZE) / ATLAS_TILE

/**
 * Where in the atlas a face's point at (u, v) (each 0..1 across the face, v down) samples `texture`
 * (atlas_uv in the client): the atlas is the textures one above the other in id order, each in its
 * frame (ATLAS_PAD), v down from its top (textures.ts sets flipY off to match). 'default' is not in it, and is drawn as the first (atlasTile).
 */
export function atlasUv(texture: number, u: number, v: number): [number, number] {
	return [inTile(u), (atlasTile(texture) + inTile(v)) / ATLAS_TILES]
}

/**
 * Where point p (cube unit space) of a face showing the paint of `side` lies on that side's texture,
 * (u, v) each 0..1 with v down (face_uv in the client): as seen from outside the cube, upright on the
 * sides, north at the top of the top face. Written into `out`.
 */
export function faceUv(side: number, p: readonly number[], out: [number, number]): [number, number] {
	const [x, y, z] = p
	switch (side) {
		case UP:
			out[0] = x
			out[1] = z
			break
		case DOWN:
			out[0] = x
			out[1] = 1 - z
			break
		case NORTH:
			out[0] = 1 - x
			out[1] = 1 - y
			break
		case SOUTH:
			out[0] = x
			out[1] = 1 - y
			break
		case EAST:
			out[0] = 1 - z
			out[1] = 1 - y
			break
		default:
			out[0] = z
			out[1] = 1 - y
	}
	return out
}

const uvScratch: [number, number] = [0, 0]

/** The height in metres of the bottom of a layer: the ground's is 0, each layer up adds a cube (Layer::bottom_y). */
export const layerBottom = (layer: number) => (GROUND_LAYER - layer) * CUBE_HEIGHT

/** The geometry of one part of a chunk, in metres from the chunk's minimum corner. */
export interface MeshPart {
	positions: Float32Array
	normals: Float32Array
	/** Each vertex's place in the texture atlas (textures.ts). */
	uvs: Float32Array
	/** PART_BLEND only: each vertex's place on the blend mask (uv channel 1): along the edge over BLEND_SPAN, and across from it in cubes. */
	uvs1?: Float32Array
	colours: Float32Array
	indices: Uint32Array
}

/** Which faces a mesh holds: all that show, or only the caps a layer slice opens (CubeLayer). */
export const CAP_NONE = 0
/** Only the up faces the cube above hides: the top of the slice's layer when the layers above it are hidden. */
export const CAP_TOP = 1
/** Only the down faces the cube below hides: the bottom of the slice's layer when the layers below it are hidden. */
export const CAP_BOTTOM = 2

/** A growable scratch buffer, reused from chunk to chunk. */
class Scratch {
	f = new Float32Array(1024)
	n = 0
	reserve(k: number) {
		if (this.n + k <= this.f.length) return
		const g = new Float32Array(Math.max(this.f.length * 2, this.n + k))
		g.set(this.f.subarray(0, this.n))
		this.f = g
	}
}
class IndexScratch {
	f = new Uint32Array(1024)
	n = 0
	reserve(k: number) {
		if (this.n + k <= this.f.length) return
		const g = new Uint32Array(Math.max(this.f.length * 2, this.n + k))
		g.set(this.f.subarray(0, this.n))
		this.f = g
	}
}
const scratch = Array.from({ length: PART_COUNT }, () => ({ pos: new Scratch(), nor: new Scratch(), uv: new Scratch(), uv1: new Scratch(), col: new Scratch(), idx: new IndexScratch() }))
/** The paint of the chunks around a chunk being meshed, by face id, while it has something blending; reused. */
const nearPaint: (Uint16Array | undefined)[] = [undefined, undefined, undefined, undefined, undefined, undefined]
/** The cube being meshed in world cubes (x, y up from the ground layer's bottom, z), reused. */
const cubeAt = [0, 0, 0]

/**
 * The mesh of chunk (cx, cz) of `layer`: one part per PART_* index, null where it has nothing to draw.
 * `cap` picks the faces: CAP_NONE all that show, CAP_TOP or CAP_BOTTOM only the up or down faces the
 * layer above or below hides, which a layer slice shows in their place.
 */
export function meshChunk(world: CubeWorld, cx: number, cz: number, layer: number, cap = CAP_NONE): (MeshPart | null)[] {
	const out: (MeshPart | null)[] = [null, null, null, null]
	const planes = world.chunk(cx, cz, layer)
	if (!planes) return out
	// The chunks a face can touch, by face id; undefined outside the world or not stored (all empty).
	const near = [world.chunk(cx, cz - 1, layer), world.chunk(cx + 1, cz, layer), world.chunk(cx, cz + 1, layer), world.chunk(cx - 1, cz, layer), world.chunk(cx, cz, layer - 1), world.chunk(cx, cz, layer + 1)]
	for (const s of scratch) s.pos.n = s.nor.n = s.uv.n = s.uv1.n = s.col.n = s.idx.n = 0
	const colours = COLOURS[layer]
	// The chunk's paint planes (face * 256 + index), undefined when none of its cubes is painted.
	const paint = world.paint.get(world.chunkKey(cx, cz, layer))
	// What lies over its cubes' tops (#226), undefined when nothing does or the world has no pictures to draw it with.
	const overlay = world.images.size ? world.overlay.get(world.chunkKey(cx, cz, layer)) : undefined
	// Its blend planes (#84), laid out as paint, undefined when nothing in it blends; then the paint of
	// the chunks around it, where the cubes beyond a blended edge may lie.
	const blend = world.blend.get(world.chunkKey(cx, cz, layer))
	if (blend) {
		nearPaint[NORTH] = world.hasChunk(cx, cz - 1, layer) ? world.paint.get(world.chunkKey(cx, cz - 1, layer)) : undefined
		nearPaint[EAST] = world.hasChunk(cx + 1, cz, layer) ? world.paint.get(world.chunkKey(cx + 1, cz, layer)) : undefined
		nearPaint[SOUTH] = world.hasChunk(cx, cz + 1, layer) ? world.paint.get(world.chunkKey(cx, cz + 1, layer)) : undefined
		nearPaint[WEST] = world.hasChunk(cx - 1, cz, layer) ? world.paint.get(world.chunkKey(cx - 1, cz, layer)) : undefined
		nearPaint[UP] = world.hasChunk(cx, cz, layer - 1) ? world.paint.get(world.chunkKey(cx, cz, layer - 1)) : undefined
		nearPaint[DOWN] = world.hasChunk(cx, cz, layer + 1) ? world.paint.get(world.chunkKey(cx, cz, layer + 1)) : undefined
	}
	for (let z = 0; z < CHUNK_SIZE; z++) {
		for (let x = 0; x < CHUNK_SIZE; x++) {
			const i = z * CHUNK_SIZE + x
			const kind = planes[i]
			if (kind === 0) continue
			const shape = planes[CHUNK_AREA + i]
			const rotation = planes[2 * CHUNK_AREA + i]
			const part = KIND_PART[kind]
			const kindScratch = scratch[part]
			const colour = colours[kind]
			for (const face of shapeFaces(shape, rotation)) {
				const b = face.boundary
				let hidden = false
				if (b >= 0) {
					// The neighbour across face b: its chunk's planes and its index there.
					let np: Uint8Array | undefined
					let ni = 0
					if (b === UP || b === DOWN) {
						np = near[b]
						ni = i
					} else {
						const nx = x + (b === EAST ? 1 : b === WEST ? -1 : 0)
						const nz = z + (b === SOUTH ? 1 : b === NORTH ? -1 : 0)
						const inside = nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE
						np = inside ? planes : near[b]
						ni = ((nz + CHUNK_SIZE) % CHUNK_SIZE) * CHUNK_SIZE + ((nx + CHUNK_SIZE) % CHUNK_SIZE)
					}
					if (np) {
						const nk = np[ni]
						hidden = nk !== 0 && (SOLID[nk] || nk === kind) && face.hiddenBy[np[CHUNK_AREA + ni] * ROTATION_COUNT + np[2 * CHUNK_AREA + ni]] !== 0
					}
				}
				const keep = cap === CAP_NONE ? !hidden : hidden && b === (cap === CAP_TOP ? UP : DOWN)
				if (!keep) continue
				const poly = face.polygon
				// The texture painted on the cube face this face belongs to, else the kind's own.
				const side = face.paintFace
				const texture = (paint && paint[side * CHUNK_AREA + i]) || KIND_TEXTURE[kind]
				// An id the editor does not know shows its picture from the world's sprite sheet when the world
				// has one (#224), else the plain tile in its hint's colour, when it has that (#218).
				const slot = texture >= TEXTURES.length && part === PART_SOLID ? world.spriteSlot(texture) : -1
				const hint = slot < 0 && texture >= TEXTURES.length ? world.hints.get(texture) : undefined
				const col = hint ? hintColour(hint.colour) : colour
				const s = slot >= 0 ? scratch[PART_SPRITE] : kindScratch
				const rows = slot >= 0 ? spriteRows(world.images.size) : 1
				const base = s.pos.n / 3
				const normal = worldNormal(face.normal)
				s.pos.reserve(poly.length * 3)
				s.nor.reserve(poly.length * 3)
				s.uv.reserve(poly.length * 2)
				s.col.reserve(poly.length * 4)
				s.idx.reserve((poly.length - 2) * 3)
				for (const p of poly) {
					s.pos.f[s.pos.n++] = (x + p[0]) * CUBE_SIZE
					s.pos.f[s.pos.n++] = p[1] * CUBE_HEIGHT
					s.pos.f[s.pos.n++] = (z + p[2]) * CUBE_SIZE
					s.nor.f[s.nor.n++] = normal[0]
					s.nor.f[s.nor.n++] = normal[1]
					s.nor.f[s.nor.n++] = normal[2]
					const uv = faceUv(side, p, uvScratch)
					if (slot >= 0) {
						s.uv.f[s.uv.n++] = ((slot % SPRITE_COLS) + inSprite(uv[0])) / SPRITE_COLS
						s.uv.f[s.uv.n++] = (Math.floor(slot / SPRITE_COLS) + inSprite(uv[1])) / rows
					} else {
						s.uv.f[s.uv.n++] = inTile(uv[0])
						s.uv.f[s.uv.n++] = (atlasTile(texture, !!hint) + inTile(uv[1])) / ATLAS_TILES
					}
					s.col.f[s.col.n++] = col[0]
					s.col.f[s.col.n++] = col[1]
					s.col.f[s.col.n++] = col[2]
					s.col.f[s.col.n++] = col[3]
				}
				for (let k = 1; k < poly.length - 1; k++) {
					s.idx.f[s.idx.n++] = base
					s.idx.f[s.idx.n++] = base + k
					s.idx.f[s.idx.n++] = base + k + 1
				}
				// What lies over the cube's top (#226): its picture over the top face, cut out by its alpha.
				if (overlay && overlay[i] && cap === CAP_NONE && side === UP && face.normal[1] > 0.99) {
					const at = world.spriteSlot(overlay[i])
					if (at >= 0) emitOverlay(poly, x, z, at, spriteRows(world.images.size), colour)
				}
				// The face's edges that blend (#84): only a solid cube's, into a solid cube beyond the edge.
				const edges = blend && SOLID[kind] ? blend[side * CHUNK_AREA + i] : 0
				if (!edges) continue
				cubeAt[0] = cx * CHUNK_SIZE + x
				cubeAt[1] = GROUND_LAYER - layer
				cubeAt[2] = cz * CHUNK_SIZE + z
				for (let e = 0; e < 6; e++) {
					if (!(edges & (1 << e))) continue
					// The cube beyond edge e: its chunk's planes and paint, its index there, and its layer.
					let np: Uint8Array | undefined
					let npaint: Uint16Array | undefined
					let ni = i
					let nl = layer
					if (e === UP || e === DOWN) {
						np = near[e]
						npaint = nearPaint[e]
						nl = e === UP ? layer - 1 : layer + 1
					} else {
						const nx = x + (e === EAST ? 1 : e === WEST ? -1 : 0)
						const nz = z + (e === SOUTH ? 1 : e === NORTH ? -1 : 0)
						const inside = nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE
						np = inside ? planes : near[e]
						npaint = inside ? paint : nearPaint[e]
						ni = ((nz + CHUNK_SIZE) % CHUNK_SIZE) * CHUNK_SIZE + ((nx + CHUNK_SIZE) % CHUNK_SIZE)
					}
					if (!np) continue
					const nk = np[ni]
					if (nk === 0 || !SOLID[nk]) continue
					// The texture that cube shows on the same side; nothing to blend into when it is this face's own.
					const into = (npaint && npaint[side * CHUNK_AREA + ni]) || KIND_TEXTURE[nk]
					if (into === texture) continue
					emitBlend(poly, worldNormal(face.normal), side, into, COLOURS[nl][nk], e)
				}
			}
		}
	}
	for (let p = 0; p < PART_COUNT; p++) {
		const s = scratch[p]
		if (s.idx.n === 0) continue
		const part: MeshPart = { positions: s.pos.f.slice(0, s.pos.n), normals: s.nor.f.slice(0, s.nor.n), uvs: s.uv.f.slice(0, s.uv.n), colours: s.col.f.slice(0, s.col.n), indices: s.idx.f.slice(0, s.idx.n) }
		if (p === PART_BLEND) part.uvs1 = s.uv1.f.slice(0, s.uv1.n)
		out[p] = part
	}
	return out
}

/**
 * Adds to PART_OVERLAY the top face `poly` (unit space) of the cube at (x, z) of the chunk, showing the
 * picture in sprite sheet cell `slot` of a sheet `rows` high, in the cube's `colour` (#226).
 */
function emitOverlay(poly: readonly (readonly number[])[], x: number, z: number, slot: number, rows: number, colour: readonly number[]) {
	const s = scratch[PART_OVERLAY]
	const base = s.pos.n / 3
	s.pos.reserve(poly.length * 3)
	s.nor.reserve(poly.length * 3)
	s.uv.reserve(poly.length * 2)
	s.col.reserve(poly.length * 4)
	s.idx.reserve((poly.length - 2) * 3)
	for (const p of poly) {
		s.pos.f[s.pos.n++] = (x + p[0]) * CUBE_SIZE
		s.pos.f[s.pos.n++] = p[1] * CUBE_HEIGHT
		s.pos.f[s.pos.n++] = (z + p[2]) * CUBE_SIZE
		s.nor.f[s.nor.n++] = 0
		s.nor.f[s.nor.n++] = 1
		s.nor.f[s.nor.n++] = 0
		const uv = faceUv(UP, p, uvScratch)
		s.uv.f[s.uv.n++] = ((slot % SPRITE_COLS) + inSprite(uv[0])) / SPRITE_COLS
		s.uv.f[s.uv.n++] = (Math.floor(slot / SPRITE_COLS) + inSprite(uv[1])) / rows
		s.col.f[s.col.n++] = colour[0]
		s.col.f[s.col.n++] = colour[1]
		s.col.f[s.col.n++] = colour[2]
		s.col.f[s.col.n++] = 1
	}
	for (let k = 1; k < poly.length - 1; k++) {
		s.idx.f[s.idx.n++] = base
		s.idx.f[s.idx.n++] = base + k
		s.idx.f[s.idx.n++] = base + k + 1
	}
}

/**
 * Adds to PART_BLEND an overlay of a face (its polygon and normal, in the cube's unit space; the cube is
 * `cubeAt`, at its place in the chunk) whose edge towards face `edge` blends into `texture`, the one the
 * cube beyond that edge shows on the face's side: the same corners showing that texture as a face of it
 * would, in that cube's `colour`, and on uv channel 1 the place on the blend mask: along the edge, in
 * cubes over BLEND_SPAN and running on from cube to cube, and across, 0 at the edge to 1 at the far side.
 */
function emitBlend(poly: readonly (readonly number[])[], normal: readonly number[], side: number, texture: number, colour: readonly number[], edge: number) {
	const s = scratch[PART_BLEND]
	const across = FACE_AXIS[edge]
	const plus = FACE_PLUS[edge]
	// The axis along the edge: neither the face's nor the edge's.
	const along = 3 - FACE_AXIS[side] - across
	const ox = cubeAt[0] - Math.floor(cubeAt[0] / CHUNK_SIZE) * CHUNK_SIZE
	const oz = cubeAt[2] - Math.floor(cubeAt[2] / CHUNK_SIZE) * CHUNK_SIZE
	const base = s.pos.n / 3
	s.pos.reserve(poly.length * 3)
	s.nor.reserve(poly.length * 3)
	s.uv.reserve(poly.length * 2)
	s.uv1.reserve(poly.length * 2)
	s.col.reserve(poly.length * 4)
	s.idx.reserve((poly.length - 2) * 3)
	for (const p of poly) {
		s.pos.f[s.pos.n++] = (ox + p[0]) * CUBE_SIZE
		s.pos.f[s.pos.n++] = p[1] * CUBE_HEIGHT
		s.pos.f[s.pos.n++] = (oz + p[2]) * CUBE_SIZE
		s.nor.f[s.nor.n++] = normal[0]
		s.nor.f[s.nor.n++] = normal[1]
		s.nor.f[s.nor.n++] = normal[2]
		const uv = faceUv(side, p, uvScratch)
		s.uv.f[s.uv.n++] = inTile(uv[0])
		s.uv.f[s.uv.n++] = (atlasTile(texture) + inTile(uv[1])) / ATLAS_TILES
		s.uv1.f[s.uv1.n++] = (cubeAt[along] + p[along]) / BLEND_SPAN
		s.uv1.f[s.uv1.n++] = plus ? 1 - p[across] : p[across]
		s.col.f[s.col.n++] = colour[0]
		s.col.f[s.col.n++] = colour[1]
		s.col.f[s.col.n++] = colour[2]
		s.col.f[s.col.n++] = 1
	}
	for (let k = 1; k < poly.length - 1; k++) {
		s.idx.f[s.idx.n++] = base
		s.idx.f[s.idx.n++] = base + k
		s.idx.f[s.idx.n++] = base + k + 1
	}
}

/** The triangles of a chunk's mesh, over its parts. */
export const triangles = (parts: (MeshPart | null)[]) => parts.reduce((n, p) => n + (p ? p.indices.length / 3 : 0), 0)

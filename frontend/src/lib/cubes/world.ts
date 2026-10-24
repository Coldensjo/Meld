// A cube world of the game (the world format, ../../../../docs/world-format.md), held for editing.
// Go reads and writes the file (internal/worldfile, app_world.go); this module keeps the cubes and
// mirrors the tables of crates/world it needs: the kinds, the shapes (from shapes.generated.ts) and the layer themes. Ids are
// rows of those tables and are never renumbered, so keep these lists in step with the Rust ones.

import { base64ToBytes, bytesToBase64 } from '../io/base64'
import { GENERATED_SHAPES } from './shapes.generated'

/** Cubes a chunk has a side; a chunk is one layer high. */
export const CHUNK_SIZE = 16
/** Cubes in a chunk. */
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE
/** Layers, 0 at the top to 30 at the bottom. */
export const LAYER_COUNT = 31
/** The base ground, where the player starts. */
export const GROUND_LAYER = 10

/** Cube kinds by id (crates/world/src/cube.rs, KINDS). */
export const KINDS = ['empty', 'dirt', 'stone', 'metal', 'wood', 'water', 'sea', 'lava'] as const
export type KindName = (typeof KINDS)[number]

/** Cube shapes by id, and whether quarter turns and turning upside down change them: crates/world/src/shape.rs' SHAPES, through shapes.generated.ts, so a new shape needs no row here. */
export const SHAPES: readonly { readonly name: string; readonly turns: boolean; readonly flips: boolean }[] = GENERATED_SHAPES.map(({ name, turns, flips }) => ({ name, turns, flips }))

/** Rotation ids are 0 to 7: bits 0-1 quarter turns clockwise seen from above, bit 2 upside down. */
export const ROTATION_COUNT = 8

/**
 * Textures by id (crates/world/src/texture.rs, TEXTURES). A face painted 0 ('default') shows its
 * kind's own texture. Their images are `assets/textures/<name>.png` (textures.ts).
 */
export const TEXTURES = ['default', 'grass', 'dirt', 'path', 'stone', 'wood', 'planks', 'metal', 'water', 'sea', 'lava', 'lawn', 'soil', 'cobble', 'rock', 'wall_stone', 'stone_brick', 'timber', 'roof', 'window_lit', 'shutters', 'plaster', 'thatch', 'dark_planks', 'mossy_stone', 'glow_moss', 'runes', 'sand', 'snow'] as const

/** Each kind's own texture, which its faces show unless painted, by kind id (KINDS' `texture`). */
export const KIND_TEXTURE = [0, 2, 4, 7, 5, 8, 9, 10] as const

/**
 * Six bytes packed in one number, byte f times 256^f (so it stays an exact integer), as a cube's blend
 * keeps its faces' (normalizeBlend); 0 is none. paintFaceOf reads one, withPaintFace writes one.
 */
export const paintFaceOf = (packed: number, face: number) => Math.floor(packed / 256 ** face) % 256

/** The packed bytes with `face`'s byte set to `value`. */
export const withPaintFace = (packed: number, face: number, value: number) => packed + (value - paintFaceOf(packed, face)) * 256 ** face

/**
 * A cube's paint: the texture id of each face, 16 bits each (3dgame #217), packed in one bigint, the id
 * of face f shifted by 16 f bits; 0n is nothing painted. textureOf reads a face's, withTexture writes it.
 */
export type Paint = bigint

/** The texture id painted on `face` of the packed paint; 0 when none is. */
export const textureOf = (paint: Paint, face: number) => Number((paint >> BigInt(16 * face)) & 0xffffn)

/** The packed paint with `face` painted `texture` (0 to clear it). */
export const withTexture = (paint: Paint, face: number, texture: number): Paint => (paint & ~(0xffffn << BigInt(16 * face))) | (BigInt(texture & 0xffff) << BigInt(16 * face))

/** The packed paint as Cube::painted keeps it on a cube of `kind`: none on an empty cube, and a face painted the kind's own texture unpainted. */
export function normalizePaint(kind: number, paint: Paint): Paint {
	if (!kind || !paint) return 0n
	const own = KIND_TEXTURE[kind]
	for (let f = 0; f < FACE_COUNT; f++) if (textureOf(paint, f) === own) paint = withTexture(paint, f, 0)
	return paint
}

/** Faces by id (crates/world Face): north, east, south, west, up, down. */
export const FACE_COUNT = 6

/** A chunk's paint as planes (a Uint16Array): per face in id order, the texture id of each of its cubes, at `z * 16 + x`. */
export const PAINT_LEN = FACE_COUNT * CHUNK_AREA

/**
 * A chunk's blend as planes (#84), laid out as its paint: per face in id order, a byte for each of its
 * cubes at `z * 16 + x`, bit e set when that face's edge towards face e fades into the texture of the
 * face beside it.
 */
export const BLEND_LEN = PAINT_LEN

/**
 * The bits a face's blend byte may hold, by face id: its edges, the four faces perpendicular to it (never
 * the face itself or its opposite, nor bits 6 and 7, which the Go writer refuses).
 */
export const BLEND_EDGES = [0x3a, 0x35, 0x3a, 0x35, 0x0f, 0x0f] as const

/**
 * A cube's blend packed in one number, as its paint (paintFaceOf, withPaintFace read and write it): the
 * blend byte of face f times 256^f. 0 is nothing blending.
 */
export function normalizeBlend(kind: number, blend: number): number {
	if (!kind || !blend) return 0
	let out = 0
	for (let f = FACE_COUNT - 1; f >= 0; f--) out = out * 256 + (paintFaceOf(blend, f) & BLEND_EDGES[f])
	return out
}

/** The id of a kind by name. */
export const kindId = (name: KindName) => KINDS.indexOf(name)

/** One cube: kind, shape and rotation ids. */
export interface Cube {
	kind: number
	shape: number
	rotation: number
}

/**
 * The cube as the game keeps it (Cube::shaped): an empty cube has the full shape and no rotation, and
 * the parts of the rotation that do not change the shape are dropped. Throws on an unknown id.
 */
export function normalize(kind: number, shape: number, rotation: number): Cube {
	if (!(kind >= 0 && kind < KINDS.length) || !(shape >= 0 && shape < SHAPES.length) || !(rotation >= 0 && rotation < ROTATION_COUNT)) {
		throw new Error(`unknown cube ${kind}/${shape}/${rotation}`)
	}
	if (kind === 0) return { kind: 0, shape: 0, rotation: 0 }
	const s = SHAPES[shape]
	return { kind, shape, rotation: (s.turns ? rotation & 3 : 0) | (s.flips ? rotation & 4 : 0) }
}

/** What a layer of a new world is filled with, by its theme (crates/world/src/generate.rs, base_fill). */
export function baseFill(layer: number): number {
	if (layer < GROUND_LAYER) return kindId('empty') // the sky
	if (layer <= 14) return kindId('dirt') // the ground and the dirt
	if (layer <= 20) return kindId('stone')
	if (layer < 25) return kindId('empty') // the lava cavern's open air
	if (layer === 25) return kindId('lava') // its floor
	return kindId('metal')
}

/** A name and a colour (0xRRGGBB, sRGB) for a texture id the game does not have yet (app_world.go WorldHintData, 3dgame #218). */
export interface TextureHint {
	id: number
	colour: number
	name: string
}

/** A world over the Wails bridge (app_world.go WorldData): chunks' cubes as base64 planes. */
export interface WorldData {
	chunksX: number
	chunksZ: number
	/**
	 * Each chunk's cubes as base64 planes, its paint (`PAINT_LEN` bytes) as base64, empty or missing when
	 * none is painted, and its blend (`BLEND_LEN` bytes, #84) as base64, empty or missing when nothing blends.
	 */
	chunks: { cx: number; cz: number; layer: number; cubes: string; paint?: string; blend?: string; overlay?: string }[]
	/** The cube a player starts in; null or missing when the world has none. */
	spawn?: SpawnPoint | null
	/** Where monsters spawn (the format's MONSTERS); missing when the world has none. */
	monsters?: WorldMonster[] | null
	/** Where NPCs stand and walk (the format's NPCS); missing when the world has none. */
	npcs?: WorldNpc[] | null
	/** The models standing in the world (the format's PROPS, #133); missing when the world has none. */
	props?: WorldProp[] | null
	/** The places with a mood of their own (the format's MOODS, #143); missing when the world has none. */
	moods?: WorldMood[] | null
	/** Names and colours for texture ids the game does not have yet (the format's TEXTURE_HINTS, 3dgame #218); missing when the world has none. */
	hints?: TextureHint[] | null
	/** Pictures for texture ids the game does not have yet, PNG as base64 (TEXTURE_IMAGES, 3dgame #224); missing when the world has none. */
	images?: { id: number; png: string }[] | null
	/** Groups of joined cubes (the format's JOINS); missing when the world has none. */
	joins?: WorldJoin[] | null
	/** Objects attached to cubes, with their states (OBJECTS, OBJECT_STATE); missing when the world has none. */
	objects?: WorldObject[] | null
	/** The optional records the editor does not know (#147), carried through unread; missing when none. */
	kept?: WorldRecord[] | null
}

/** A record of the world file the editor keeps without reading it (app_world.go WorldRecordData): its tag, flags and body as base64. */
export interface WorldRecord {
	tag: number
	flags: number
	body: string
}

/** Where a monster spawns (crates/world MonsterSpawn): its kind's name (the game's monster kinds) and the cube it stands in. */
export interface WorldMonster {
	kind: string
	pos: SpawnPoint
}

/** Where an NPC stands and walks (crates/world NpcPlacement): its name (the game's NPCs), the cube it starts in and the cubes it walks to in turn, empty when it stands. */
export interface WorldNpc {
	name: string
	pos: SpawnPoint
	route: SpawnPoint[]
}

/**
 * A model standing in the world (crates/world Prop, #133): its model's name (its path under the
 * repository's assets/models without .glb, `nature/pine_1`), where its origin stands in metres (y 0 at
 * the ground layer's bottom, as the cubes' metres), its turn in radians about the vertical
 * (counter-clockwise seen from above) and its scale (above 0). Only a look: nothing collides with it.
 */
export interface WorldProp {
	model: string
	x: number
	y: number
	z: number
	turn: number
	scale: number
}

/**
 * A place with a mood of its own (crates/world MoodRegion, #143): the name of a mood in the game's
 * moods file (`crates/gameplay/moods.toml`) and the box of cubes it covers, from `min` (the least x
 * and z and the top layer, the least index) to `max`, both held. The client wears the mood of the
 * innermost region its camera is in instead of its layer's.
 */
export interface WorldMood {
	mood: string
	min: SpawnPoint
	max: SpawnPoint
}

/** A group of cubes that act as one object, such as a wall (crates/world World::join). */
export interface WorldJoin {
	id: number
	cubes: SpawnPoint[]
}

/**
 * An object attached to a cube's face (crates/world Object): its kind (`OBJECT_KINDS`), the face it
 * is on (0 north, 1 east, 2 south, 3 west, 4 up, 5 down), the ids of the objects it acts on, and its
 * state (0 off or closed, 1 on or open), and for a torch the colour its fire burns (`FIRE_COLOURS`;
 * missing or 0 is orange, and every other kind leaves it so).
 */
export interface WorldObject {
	id: number
	kind: number
	face: number
	pos: SpawnPoint
	targets: number[]
	state: number
	colour?: number
}

/** Object kinds by id (crates/world/src/object.rs, OBJECT_KINDS). */
export const OBJECT_KINDS = ['door', 'window', 'lever', 'button', 'teleporter', 'torch'] as const

/** The colours a torch's fire burns, by id (crates/world FireColour, #137). */
export const FIRE_COLOURS = ['orange', 'green', 'blue', 'purple'] as const

/** A world's spawn point: the cube a player starts in (x and z in cubes from the corner, and its layer). */
export interface SpawnPoint {
	x: number
	z: number
	layer: number
}

/**
 * The cubes of a world `chunksX` by `chunksZ` chunks, on every layer. Each stored chunk is 768 bytes
 * of planes, as the file has them: the 256 kinds, then the 256 shapes, then the 256 rotations, each
 * at index `z * 16 + x`. A chunk not stored is all empty.
 */
export class CubeWorld {
	readonly chunks = new Map<number, Uint8Array>()
	/**
	 * The textures painted on the faces of each chunk's cubes (`PAINT_LEN` 16-bit ids, by the same keys as
	 * `chunks`), for the chunks that have any. `setPaint` paints (the Cubes tool's Paint mode, #83);
	 * `set` keeps a cube's paint (normalized for its new kind), and emptying a cube clears it.
	 */
	readonly paint = new Map<number, Uint16Array>()
	/**
	 * Which edges of each chunk's cubes' faces fade into the texture beside them (#84; `BLEND_LEN` bytes,
	 * by the same keys as `chunks`), for the chunks where anything blends. `setBlend` sets it (the Cubes
	 * tool's Paint mode); `set` keeps a cube's blend, and emptying a cube clears it. Like paint, it
	 * belongs to the faces as they lie in the world, so turning a cube leaves it where it is.
	 */
	readonly blend = new Map<number, Uint8Array>()
	/**
	 * The texture drawn over the top of each chunk's cubes, see-through where its picture is (a Tibia
	 * map's borders, 3dgame #226; the format's OVERLAY record): a 16-bit id per cube at `z * 16 + x`, 0
	 * for none, for the chunks where a cube has one. `setOverlay` sets it; emptying a cube clears it.
	 */
	readonly overlay = new Map<number, Uint16Array>()
	/** The cube a player starts in; null when the world has none (the server then uses the middle). */
	spawn: SpawnPoint | null = null
	/**
	 * Where the world's monsters spawn, in order, kept as the file has them so a saved world keeps
	 * them. The Cubes tool's Monster mode places, moves and removes them (#91, monsters.ts); moving or
	 * removing cubes leaves them where they are.
	 */
	monsters: WorldMonster[] = []
	/**
	 * Where the world's NPCs stand and walk, in order, kept as the file has them so a saved world
	 * keeps them. The Cubes tool's NPC mode places, moves and removes them and edits their routes (#99,
	 * npcs.ts); moving or removing cubes leaves them where they are.
	 */
	npcs: WorldNpc[] = []
	/**
	 * The models standing in the world, in order, kept as the file has them so a saved world keeps
	 * them. The Cubes tool's Prop mode places, moves, turns and removes them (#133, props.ts); moving
	 * or removing cubes leaves them where they are.
	 */
	props: WorldProp[] = []
	/**
	 * The places with a mood of their own, in order, kept as the file has them so a saved world keeps
	 * them. The Cubes tool's Mood mode paints, changes and removes them (#143, moodRegions.ts); moving
	 * or removing cubes leaves them where they are.
	 */
	moods: WorldMood[] = []
	/**
	 * A name and a colour for texture ids the game does not have yet, by id (the format's TEXTURE_HINTS,
	 * 3dgame #218), as a world imported from a Tibia map gives each item id it paints: a face painted
	 * with one shows the atlas's plain tile in its colour instead of the missing texture (mesher.ts), and
	 * Edit › Textures in This World names it. Kept as the file has them, so a saved world keeps them.
	 */
	hints = new Map<number, TextureHint>()
	/**
	 * A picture for texture ids the game does not have yet, by id, PNG as base64 (the format's
	 * TEXTURE_IMAGES, 3dgame #224): a Tibia map's flat item sprites. A face painted with one shows it from
	 * the world's sprite sheet (sprites.ts), where `spriteSlot` places it. Set through `setImages`.
	 */
	images = new Map<number, string>()
	/** Each pictured texture's place in the sprite sheet, in id order; made again when the pictures change. */
	private slots: Map<number, number> | null = null

	/** Where texture `id`'s picture lies in the world's sprite sheet (sprites.ts), -1 when it has none. */
	spriteSlot(id: number): number {
		if (!this.images.size) return -1
		if (!this.slots) {
			this.slots = new Map()
			for (const t of [...this.images.keys()].sort((a, b) => a - b)) this.slots.set(t, this.slots.size)
		}
		return this.slots.get(id) ?? -1
	}

	/**
	 * A texture's name: the game's, or for an id the editor does not know the world's hint (a Tibia
	 * item's, "grass (item 4526)", #227), else "texture <id>".
	 */
	textureName(id: number): string {
		if (id < TEXTURES.length) return TEXTURES[id]
		return this.hints.get(id)?.name ?? `texture ${id}`
	}

	/** Whether faces can be painted `id`: one of the game's textures, or one the world has a picture or a name for (#227). */
	paintable(id: number): boolean {
		return id < TEXTURES.length || this.images.has(id) || this.hints.has(id)
	}

	/** Puts `images` in place of the world's pictures. */
	setImages(images: Map<number, string>) {
		this.images = new Map(images)
		this.slots = null
	}
	/**
	 * The world's groups of joined cubes and its objects, kept as the file has them so a saved world
	 * keeps them. The Cubes tool's Object and Link modes and the Select tool's Join edit them (#32,
	 * objects.ts); moving or removing cubes leaves them where they are.
	 */
	joins: WorldJoin[] = []
	objects: WorldObject[] = []
	/**
	 * The file's optional records the editor does not know (#147), kept as
	 * read so a saved world loses nothing. Nothing edits them.
	 */
	kept: WorldRecord[] = []

	constructor(
		readonly chunksX: number,
		readonly chunksZ: number,
	) {
		if (!Number.isInteger(chunksX) || !Number.isInteger(chunksZ) || chunksX < 1 || chunksZ < 1) {
			throw new Error(`world bounds ${chunksX} x ${chunksZ} chunks`)
		}
	}

	/** The world's size in cubes along x and z. */
	get sizeX() {
		return this.chunksX * CHUNK_SIZE
	}
	get sizeZ() {
		return this.chunksZ * CHUNK_SIZE
	}

	/** Whether chunk (cx, cz) of `layer` lies inside the world. */
	hasChunk(cx: number, cz: number, layer: number) {
		return Number.isInteger(cx) && Number.isInteger(cz) && Number.isInteger(layer) && cx >= 0 && cz >= 0 && cx < this.chunksX && cz < this.chunksZ && layer >= 0 && layer < LAYER_COUNT
	}

	/** Whether `s` is a spawn point inside this world. */
	spawnInside(s: SpawnPoint) {
		return this.contains(s.x, s.z, s.layer)
	}

	/** Whether cube (x, z) of `layer` lies inside the world. */
	contains(x: number, z: number, layer: number) {
		return this.hasChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer) && Number.isInteger(x) && Number.isInteger(z)
	}

	chunkKey(cx: number, cz: number, layer: number) {
		return (layer * this.chunksZ + cz) * this.chunksX + cx
	}

	/** The stored planes of a chunk, or undefined when it is all empty or outside the world (whose keys would name another chunk). */
	chunk(cx: number, cz: number, layer: number): Uint8Array | undefined {
		if (!this.hasChunk(cx, cz, layer)) return undefined
		return this.chunks.get(this.chunkKey(cx, cz, layer))
	}

	/** The cube at (x, z) of `layer`; empty outside the world. */
	get(x: number, z: number, layer: number): Cube {
		if (!this.contains(x, z, layer)) return { kind: 0, shape: 0, rotation: 0 }
		const planes = this.chunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer)
		if (!planes) return { kind: 0, shape: 0, rotation: 0 }
		const i = (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)
		return { kind: planes[i], shape: planes[CHUNK_AREA + i], rotation: planes[2 * CHUNK_AREA + i] }
	}

	/** Sets the cube at (x, z) of `layer`, normalized. Throws outside the world or on an unknown id. */
	set(x: number, z: number, layer: number, kind: number, shape = 0, rotation = 0) {
		if (!this.contains(x, z, layer)) throw new Error(`cube (${x}, ${z}, layer ${layer}) is outside the world`)
		const c = normalize(kind, shape, rotation)
		const cx = Math.floor(x / CHUNK_SIZE)
		const cz = Math.floor(z / CHUNK_SIZE)
		const key = this.chunkKey(cx, cz, layer)
		let planes = this.chunks.get(key)
		if (!planes) {
			if (c.kind === 0) return
			planes = new Uint8Array(3 * CHUNK_AREA)
			this.chunks.set(key, planes)
		}
		const i = (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)
		planes[i] = c.kind
		planes[CHUNK_AREA + i] = c.shape
		planes[2 * CHUNK_AREA + i] = c.rotation
		// An empty cube has no paint, and a face painted the new kind's own texture is not painted.
		const paint = this.paint.get(key)
		if (paint) {
			const own = c.kind === 0 ? -1 : KIND_TEXTURE[c.kind]
			for (let f = 0; f < FACE_COUNT; f++) {
				const j = f * CHUNK_AREA + i
				if (own < 0 || paint[j] === own) paint[j] = 0
			}
		}
		// An empty cube has no overlay.
		if (c.kind === 0) {
			const over = this.overlay.get(key)
			if (over && over[i]) {
				over[i] = 0
				if (!over.some((t) => t !== 0)) this.overlay.delete(key)
			}
		}
		// An empty cube has no blend.
		if (c.kind === 0 && this.blend.has(key)) this.clearBlend(key, i)
	}

	/** Clears the blend of cube `i` of chunk `key`, dropping the chunk's planes when nothing in it blends any more. */
	private clearBlend(key: number, i: number) {
		const planes = this.blend.get(key)
		if (!planes) return
		let had = false
		for (let f = 0; f < FACE_COUNT; f++) {
			const j = f * CHUNK_AREA + i
			had ||= planes[j] !== 0
			planes[j] = 0
		}
		if (had && !planes.some((b) => b !== 0)) this.blend.delete(key)
	}

	/** The blend byte of `face` (0 north to 5 down) of the cube at (x, z) of `layer` (#84): bit e set when its edge towards face e blends; 0 outside the world. */
	blendAt(x: number, z: number, layer: number, face: number): number {
		if (!this.contains(x, z, layer)) return 0
		const planes = this.blend.get(this.chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer))
		return planes ? planes[face * CHUNK_AREA + (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)] : 0
	}

	/** The blend of the cube at (x, z) of `layer`, packed as paint is (paintFaceOf reads a face's byte); 0 when nothing blends or outside the world. */
	blendOf(x: number, z: number, layer: number): number {
		if (!this.contains(x, z, layer)) return 0
		const planes = this.blend.get(this.chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer))
		if (!planes) return 0
		const i = (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)
		let b = 0
		for (let f = FACE_COUNT - 1; f >= 0; f--) b = b * 256 + planes[f * CHUNK_AREA + i]
		return b
	}

	/**
	 * Sets the blend of the cube at (x, z) of `layer` to `blend` (packed) in place of what it had,
	 * normalized (normalizeBlend: none on an empty cube, only a face's own edges). Throws outside the world.
	 */
	setBlend(x: number, z: number, layer: number, blend: number) {
		if (!this.contains(x, z, layer)) throw new Error(`cube (${x}, ${z}, layer ${layer}) is outside the world`)
		blend = normalizeBlend(this.get(x, z, layer).kind, blend)
		const key = this.chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer)
		const i = (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)
		if (!blend) return this.clearBlend(key, i)
		let planes = this.blend.get(key)
		if (!planes) {
			planes = new Uint8Array(BLEND_LEN)
			this.blend.set(key, planes)
		}
		for (let f = 0; f < FACE_COUNT; f++) planes[f * CHUNK_AREA + i] = paintFaceOf(blend, f)
	}

	/** The texture over the top of the cube at (x, z) of `layer` (#226); 0 when none or outside the world. */
	overlayAt(x: number, z: number, layer: number): number {
		if (!this.contains(x, z, layer)) return 0
		const over = this.overlay.get(this.chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer))
		return over ? over[(z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)] : 0
	}

	/** Puts `texture` over the top of the cube at (x, z) of `layer` (0 takes it off); an empty cube takes none. Throws outside the world. */
	setOverlay(x: number, z: number, layer: number, texture: number) {
		if (!this.contains(x, z, layer)) throw new Error(`cube (${x}, ${z}, layer ${layer}) is outside the world`)
		if (this.get(x, z, layer).kind === 0) texture = 0
		const key = this.chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer)
		let over = this.overlay.get(key)
		if (!over) {
			if (!texture) return
			over = new Uint16Array(CHUNK_AREA)
			this.overlay.set(key, over)
		}
		over[(z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)] = texture
		if (!texture && !over.some((t) => t !== 0)) this.overlay.delete(key)
	}

	/** The texture id painted on `face` (0 north to 5 down) of the cube at (x, z) of `layer`; 0 when none is. */
	paintAt(x: number, z: number, layer: number, face: number): number {
		if (!this.contains(x, z, layer)) return 0
		const paint = this.paint.get(this.chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer))
		return paint ? paint[face * CHUNK_AREA + (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)] : 0
	}

	/** The paint of the cube at (x, z) of `layer`, packed (textureOf); 0n when none is painted or outside the world. */
	paintOf(x: number, z: number, layer: number): Paint {
		if (!this.contains(x, z, layer)) return 0n
		const paint = this.paint.get(this.chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer))
		if (!paint) return 0n
		const i = (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)
		let p = 0n
		for (let f = FACE_COUNT - 1; f >= 0; f--) p = (p << 16n) | BigInt(paint[f * CHUNK_AREA + i])
		return p
	}

	/**
	 * Paints the cube at (x, z) of `layer` with `paint` (packed) in place of what it had, normalized as
	 * Cube::painted (normalizePaint): an empty cube takes none. Throws outside the world.
	 */
	setPaint(x: number, z: number, layer: number, paint: Paint) {
		if (!this.contains(x, z, layer)) throw new Error(`cube (${x}, ${z}, layer ${layer}) is outside the world`)
		paint = normalizePaint(this.get(x, z, layer).kind, paint)
		const key = this.chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer)
		let planes = this.paint.get(key)
		if (!planes) {
			if (!paint) return
			planes = new Uint16Array(PAINT_LEN)
			this.paint.set(key, planes)
		}
		const i = (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)
		for (let f = 0; f < FACE_COUNT; f++) planes[f * CHUNK_AREA + i] = textureOf(paint, f)
	}

	/** Fills a whole layer with one cube kind (full, unturned); empty drops its chunks. */
	fillLayer(layer: number, kind: number) {
		const c = normalize(kind, 0, 0)
		for (let cz = 0; cz < this.chunksZ; cz++) {
			for (let cx = 0; cx < this.chunksX; cx++) {
				const key = this.chunkKey(cx, cz, layer)
				this.paint.delete(key)
				this.blend.delete(key)
				this.overlay.delete(key)
				if (c.kind === 0) {
					this.chunks.delete(key)
					continue
				}
				const planes = new Uint8Array(3 * CHUNK_AREA)
				planes.fill(c.kind, 0, CHUNK_AREA)
				this.chunks.set(key, planes)
			}
		}
	}

	/** The world for the bridge. Chunks that are all empty are left out. */
	toData(): WorldData {
		const chunks: WorldData['chunks'] = []
		for (const [key, planes] of this.chunks) {
			if (!planes.subarray(0, CHUNK_AREA).some((k) => k !== 0)) continue
			const cx = key % this.chunksX
			const rest = Math.floor(key / this.chunksX)
			const paint = this.paint.get(key)
			const blend = this.blend.get(key)
			const over = this.overlay.get(key)
			chunks.push({
				cx,
				cz: rest % this.chunksZ,
				layer: Math.floor(rest / this.chunksZ),
				cubes: bytesToBase64(planes),
				paint: paint && paint.some((t) => t !== 0) ? bytesToBase64(new Uint8Array(paint.buffer, paint.byteOffset, paint.byteLength)) : '',
				blend: blend && blend.some((b) => b !== 0) ? bytesToBase64(blend) : '',
				overlay: over && over.some((t) => t !== 0) ? bytesToBase64(new Uint8Array(over.buffer, over.byteOffset, over.byteLength)) : '',
			})
		}
		return {
			chunksX: this.chunksX,
			chunksZ: this.chunksZ,
			chunks,
			spawn: this.spawn ? { ...this.spawn } : null,
			monsters: this.monsters.map((m) => ({ kind: m.kind, pos: { ...m.pos } })),
			npcs: this.npcs.map((n) => ({ name: n.name, pos: { ...n.pos }, route: n.route.map((c) => ({ ...c })) })),
			props: this.props.map((p) => ({ ...p })),
			moods: this.moods.map((r) => ({ mood: r.mood, min: { ...r.min }, max: { ...r.max } })),
			hints: [...this.hints.values()].map((h) => ({ ...h })),
			images: [...this.images].map(([id, png]) => ({ id, png })),
			joins: this.joins.map((j) => ({ id: j.id, cubes: j.cubes.map((c) => ({ ...c })) })),
			objects: this.objects.map((o) => ({ ...o, pos: { ...o.pos }, targets: [...o.targets] })),
			kept: this.kept.map((k) => ({ ...k })),
		}
	}

	/** A world from the bridge, as Go read it. Throws on a chunk outside the bounds or of the wrong size. */
	static fromData(d: WorldData): CubeWorld {
		const w = new CubeWorld(d.chunksX, d.chunksZ)
		for (const c of d.chunks ?? []) {
			if (!w.hasChunk(c.cx, c.cz, c.layer)) throw new Error(`chunk (${c.cx}, ${c.cz}, layer ${c.layer}) is outside the world`)
			const planes = base64ToBytes(c.cubes)
			if (planes.length !== 3 * CHUNK_AREA) throw new Error(`chunk (${c.cx}, ${c.cz}, layer ${c.layer}) has ${planes.length} bytes of cubes`)
			w.chunks.set(w.chunkKey(c.cx, c.cz, c.layer), planes)
			if (c.paint) {
				// Two bytes an id, little-endian as this machine (#217); copied, so the planes are aligned.
				const bytes = base64ToBytes(c.paint)
				if (bytes.length !== 2 * PAINT_LEN) throw new Error(`chunk (${c.cx}, ${c.cz}, layer ${c.layer}) has ${bytes.length} bytes of paint`)
				w.paint.set(w.chunkKey(c.cx, c.cz, c.layer), new Uint16Array(bytes.slice().buffer))
			}
			if (c.overlay) {
				const bytes = base64ToBytes(c.overlay)
				if (bytes.length !== 2 * CHUNK_AREA) throw new Error(`chunk (${c.cx}, ${c.cz}, layer ${c.layer}) has ${bytes.length} bytes of overlay`)
				const over = new Uint16Array(bytes.slice().buffer)
				for (let i = 0; i < CHUNK_AREA; i++) if (!planes[i]) over[i] = 0
				if (over.some((t) => t !== 0)) w.overlay.set(w.chunkKey(c.cx, c.cz, c.layer), over)
			}
			if (c.blend) {
				const blend = base64ToBytes(c.blend)
				if (blend.length !== BLEND_LEN) throw new Error(`chunk (${c.cx}, ${c.cz}, layer ${c.layer}) has ${blend.length} bytes of blend`)
				// Go refuses bits that are no edge of their face and clears an empty cube's; kept to that here too.
				let any = false
				for (let f = 0; f < FACE_COUNT; f++) {
					for (let i = 0; i < CHUNK_AREA; i++) {
						const j = f * CHUNK_AREA + i
						blend[j] = planes[i] ? blend[j] & BLEND_EDGES[f] : 0
						any ||= blend[j] !== 0
					}
				}
				if (any) w.blend.set(w.chunkKey(c.cx, c.cz, c.layer), blend)
			}
		}
		if (d.spawn) {
			if (!w.spawnInside(d.spawn)) throw new Error(`the spawn point (${d.spawn.x}, ${d.spawn.z}, layer ${d.spawn.layer}) is outside the world`)
			w.spawn = { x: d.spawn.x, z: d.spawn.z, layer: d.spawn.layer }
		}
		const inside = (p: SpawnPoint, what: string) => {
			if (!w.spawnInside(p)) throw new Error(`${what} (${p.x}, ${p.z}, layer ${p.layer}) is outside the world`)
			return { x: p.x, z: p.z, layer: p.layer }
		}
		w.monsters = (d.monsters ?? []).map((m) => ({ kind: m.kind, pos: inside(m.pos, `the ${m.kind} spawn point`) }))
		w.npcs = (d.npcs ?? []).map((n) => ({ name: n.name, pos: inside(n.pos, `NPC ${n.name}`), route: (n.route ?? []).map((c) => inside(c, `a cube of NPC ${n.name}'s route`)) }))
		w.props = (d.props ?? []).map((p) => ({ model: p.model, x: p.x, y: p.y, z: p.z, turn: p.turn, scale: p.scale }))
		w.moods = (d.moods ?? []).map((r) => {
			const min = inside(r.min, `the ${r.mood} mood region's corner`)
			const max = inside(r.max, `the ${r.mood} mood region's corner`)
			if (min.x > max.x || min.z > max.z || min.layer > max.layer) throw new Error(`the ${r.mood} mood region's corners are out of order`)
			return { mood: r.mood, min, max }
		})
		for (const h of d.hints ?? []) w.hints.set(h.id, { id: h.id, colour: h.colour, name: h.name })
		if (d.images?.length) w.setImages(new Map(d.images.map((im) => [im.id, im.png])))
		w.joins = (d.joins ?? []).map((j) => ({ id: j.id, cubes: j.cubes.map((c) => inside(c, `a cube of group ${j.id}`)) }))
		w.objects = (d.objects ?? []).map((o) => ({ id: o.id, kind: o.kind, face: o.face, pos: inside(o.pos, `object ${o.id}`), targets: [...(o.targets ?? [])], state: o.state, colour: o.colour ?? 0 }))
		w.kept = (d.kept ?? []).map((k) => ({ tag: k.tag, flags: k.flags, body: k.body }))
		return w
	}

	/** A new world, empty, or with each layer filled by its theme (`baseFill`) as the game's generator starts. */
	static create(chunksX: number, chunksZ: number, themed: boolean): CubeWorld {
		const w = new CubeWorld(chunksX, chunksZ)
		if (themed) for (let layer = 0; layer < LAYER_COUNT; layer++) w.fillLayer(layer, baseFill(layer))
		return w
	}

	/** How many stored chunks hold any cube. */
	get chunkCount() {
		let n = 0
		for (const planes of this.chunks.values()) if (planes.subarray(0, CHUNK_AREA).some((k) => k !== 0)) n++
		return n
	}
}

/** Whether `path` names a cube world file rather than a Meld map. */
export const isWorldPath = (path: string) => /\.world$/i.test(path)

/** The largest world New Cube World makes, in chunks a side (1.5 km at 3 m cubes). */
export const MAX_NEW_CHUNKS = 32

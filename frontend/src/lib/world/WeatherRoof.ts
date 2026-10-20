import * as THREE from 'three'

// The weather's roofs (#315): the client's drops die where they meet the ground or a roof (its ground
// oracle, `0x67c760`, the higher of the terrain and the models' surface on a 1.04 yd cell), so rain
// never falls inside a building or under a bridge. Meld's drops are wrapped in a box in the vertex
// shader and never land, so this grid holds the models' highest surface on each cell round the eye
// (probed straight down from 30 yd over it, as the splashes are), and the drop shaders hide a drop
// under the roof of its cell. The grid is a texture wrapped on itself (a cell's texel is its index
// mod the side), so it follows the eye without moving what it holds; a few cells a frame are probed,
// nearest first, and a still camera with every cell probed costs nothing. The splashes and settled
// flakes land on the same cells.

/**
 * Where a drop lands: the terrain right under a point, and the models' highest surface under a point
 * from `fromY` down; -Infinity for none. The Engine's; the models' probe is a raycast, so its answers
 * are kept on the client's 1.04 yd grid and only a few are asked for a frame.
 */
export interface SplashGround {
	terrain(x: number, z: number): number
	/** Readies `models` for the square `x0`..`x1`, `z0`..`z1`: the models that can reach into it. */
	near(x0: number, z0: number, x1: number, z1: number): void
	models(x: number, fromY: number, z: number): number
	/** What the models' answers come from, and its change counter: a change forgets them. */
	source(): { version: number }
}

/** The client's weather ground grid (`0x80ff98`). */
export const ROOF_CELL = 1.0416666
/** The grid's side in cells: 75 yd each way from the eye, as far as a drop is drawn. */
export const ROOF_SIDE = 144
/** A cell no model covers: drops fall through it to the terrain. Also a cell not probed yet. */
export const NO_ROOF = -1e6
/** The probes start this far above the eye, so a roof over the camera takes the rain. */
export const PROBE_ABOVE = 30
/** The grid is forgotten when the probes' start moves a story: it decides which roofs they see. */
const STORY = 8
/** `near` is asked for this much more than the grid, and again once the eye has moved this far. */
const NEAR_SLACK = 16
/** At least this many cells are probed a frame, however long they take. */
const MIN_PROBES = 4

const HALF = ROOF_SIDE / 2

/** The grid's cells round the eye's, as (dx, dz) pairs, nearest first. */
let order: Int16Array | null = null
function scanOrder(): Int16Array {
	if (order) return order
	const cells: [number, number, number][] = []
	for (let dz = -HALF; dz < HALF; dz++) for (let dx = -HALF; dx < HALF; dx++) cells.push([dx, dz, (dx + 0.5) * (dx + 0.5) + (dz + 0.5) * (dz + 0.5)])
	cells.sort((a, b) => a[2] - b[2])
	order = new Int16Array(cells.length * 2)
	for (let i = 0; i < cells.length; i++) {
		order[i * 2] = cells[i][0]
		order[i * 2 + 1] = cells[i][1]
	}
	return order
}

/** A cell's texel: its index mod the side, on each axis. */
function wrap(c: number): number {
	return ((c % ROOF_SIDE) + ROOF_SIDE) % ROOF_SIDE
}

/** A cell's key: cells are 1.04 yd, so 65536 a row covers any map's 17066 yd (and the cells below 0). */
function key(cx: number, cz: number): number {
	return (cx + 32768) * 65536 + (cz + 32768)
}

/** The texture's lookup in GLSL: whether a point is under the roof of its cell. */
export const roofChunk = /* glsl */ `
uniform sampler2D roof;
bool roofed(vec3 w) {
	vec2 c = mod(floor(w.xz / ${ROOF_CELL.toFixed(7)}), ${ROOF_SIDE.toFixed(1)});
	return w.y < texelFetch(roof, ivec2(c), 0).r;
}
`

export class WeatherRoof {
	/** Each texel's models' height, NO_ROOF for none; the texture's data. */
	readonly heights = new Float32Array(ROOF_SIDE * ROOF_SIDE).fill(NO_ROOF)
	/** The cell each texel was probed for, -1 for none. */
	private owner = new Float64Array(ROOF_SIDE * ROOF_SIDE).fill(-1)
	readonly texture: THREE.DataTexture
	/** How long the probes may take a frame (ms). */
	budget = 1
	/** The scan's place in `scanOrder` from the eye's cell; the whole grid is probed at its end. */
	private cursor = 0
	private cx = NaN
	private cz = NaN
	private from = NaN
	private src: { version: number } | null = null
	private srcVersion = -1
	private nearX = NaN
	private nearZ = NaN

	constructor() {
		const t = new THREE.DataTexture(this.heights, ROOF_SIDE, ROOF_SIDE, THREE.RedFormat, THREE.FloatType)
		t.minFilter = THREE.NearestFilter
		t.magFilter = THREE.NearestFilter
		t.generateMipmaps = false
		t.needsUpdate = true
		this.texture = t
	}

	/** How far round the eye every cell is probed (yd); Infinity once all are. */
	get reach(): number {
		const o = scanOrder()
		if (this.cursor * 2 >= o.length) return Infinity
		return Math.max(0, Math.hypot(o[this.cursor * 2], o[this.cursor * 2 + 1]) - 1) * ROOF_CELL
	}

	/** Forgets every cell. */
	private clear() {
		this.heights.fill(NO_ROOF)
		this.owner.fill(-1)
		this.cursor = 0
		this.nearX = NaN
		this.texture.needsUpdate = true
	}

	/**
	 * Moves the grid's centre to the eye's cell (`cx`, `cz`): the rows and columns that came in still
	 * hold the cells a side away, so they are emptied until probed.
	 */
	private follow(cx: number, cz: number) {
		const dx = cx - this.cx
		const dz = cz - this.cz
		this.cx = cx
		this.cz = cz
		this.cursor = 0
		if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.abs(dx) >= ROOF_SIDE || Math.abs(dz) >= ROOF_SIDE) {
			this.heights.fill(NO_ROOF)
			this.texture.needsUpdate = true
			return
		}
		const h = this.heights
		// The new columns: from the old window's edge on the side it moved to.
		for (let k = 0; k < Math.abs(dx); k++) {
			const col = wrap(dx > 0 ? cx + HALF - 1 - k : cx - HALF + k)
			for (let r = 0; r < ROOF_SIDE; r++) h[r * ROOF_SIDE + col] = NO_ROOF
		}
		for (let k = 0; k < Math.abs(dz); k++) {
			const row = wrap(dz > 0 ? cz + HALF - 1 - k : cz - HALF + k) * ROOF_SIDE
			h.fill(NO_ROOF, row, row + ROOF_SIDE)
		}
		if (dx || dz) this.texture.needsUpdate = true
	}

	/**
	 * Per frame, with a drop kind shown: follows `eye` and probes the cells round it nearest first, for
	 * at most `budget` ms (and at least a few cells). Nothing once all are probed and the eye's cell,
	 * story and the models are as they were.
	 */
	update(eye: { x: number; y: number; z: number }, ground: SplashGround) {
		const from = eye.y + PROBE_ABOVE
		const src = ground.source()
		if (Math.abs(from - this.from) > STORY || src !== this.src || src.version !== this.srcVersion) {
			this.clear()
			this.from = from
			this.src = src
			this.srcVersion = src.version
		}
		const cx = Math.floor(eye.x / ROOF_CELL)
		const cz = Math.floor(eye.z / ROOF_CELL)
		if (cx !== this.cx || cz !== this.cz) this.follow(cx, cz)
		const o = scanOrder()
		if (this.cursor * 2 >= o.length) return
		if (!(Math.abs(eye.x - this.nearX) <= NEAR_SLACK && Math.abs(eye.z - this.nearZ) <= NEAR_SLACK)) {
			const r = HALF * ROOF_CELL + NEAR_SLACK
			ground.near(eye.x - r, eye.z - r, eye.x + r, eye.z + r)
			this.nearX = eye.x
			this.nearZ = eye.z
		}
		const t0 = performance.now()
		let probes = 0
		let changed = false
		while (this.cursor * 2 < o.length) {
			const x = cx + o[this.cursor * 2]
			const z = cz + o[this.cursor * 2 + 1]
			const k = key(x, z)
			const i = wrap(z) * ROOF_SIDE + wrap(x)
			if (this.owner[i] === k) {
				this.cursor++
				continue
			}
			if (probes >= MIN_PROBES && performance.now() - t0 > this.budget) break
			const y = ground.models((x + 0.5) * ROOF_CELL, from, (z + 0.5) * ROOF_CELL)
			this.heights[i] = y === -Infinity ? NO_ROOF : y
			this.owner[i] = k
			probes++
			changed = true
			this.cursor++
		}
		if (changed) this.texture.needsUpdate = true
	}

	/** The models' height on (`x`, `z`)'s cell (-Infinity for none), or undefined while it isn't probed. */
	get(x: number, z: number): number | undefined {
		const cx = Math.floor(x / ROOF_CELL)
		const cz = Math.floor(z / ROOF_CELL)
		const i = wrap(cz) * ROOF_SIDE + wrap(cx)
		if (this.owner[i] !== key(cx, cz)) return undefined
		const y = this.heights[i]
		return y === NO_ROOF ? -Infinity : y
	}

	dispose() {
		this.texture.dispose()
	}
}

// The 1.12 client's sky clouds (B-179), ported from Benilla's clouds/ (MIT/Apache: kernel.rs,
// tables.rs, layer.rs), which cites the client's own functions: a 128x128 byte tile of four octaves of
// scrolling value noise (0x6cffc0), thresholded by the light's cloud density (float band 3), shaped by
// a fixed tone curve and coloured per texel (0x6cfb00) from the light's cloud bands (10 the sun glow,
// 11 the slope, 12 the base) with a glow toward the sun (or the moon at night). The tile is redrawn a
// quarter at a time ten times a second, and the dome (`domeMesh`) maps it over the sky from the zenith
// to 45° below, its rim faded. Directions are in the editor's frame, which is Benilla's. Kept free of
// three.js so it can be tested on its own; the arithmetic keeps the client's float rounding where it
// moves bytes.

/** Tile side. */
export const COLS = 128
const SHIFT = 7
/** Rows redrawn per fire, and fires a second. */
const ROWS_PER_TICK = 32
const REGEN_PERIOD = 0.1
const OCTAVES = 4
/** Each octave's lattice frequency. */
const BASE_FREQ = [16, 32, 64, 128]

/** The permutation table (0x86f2d0), as dumped from the client. */
// prettier-ignore
const PERM = new Uint8Array([
  225, 155, 210, 108, 175, 199, 221, 144, 203, 116, 70, 213, 69, 158, 33, 252,
  5, 82, 173, 133, 222, 139, 174, 27, 9, 71, 90, 246, 75, 130, 91, 191,
  169, 138, 2, 151, 194, 235, 81, 7, 25, 113, 228, 159, 205, 253, 134, 142,
  248, 65, 224, 217, 22, 121, 229, 63, 89, 103, 96, 104, 156, 17, 201, 129,
  36, 8, 165, 110, 237, 117, 231, 56, 132, 211, 152, 20, 181, 111, 239, 218,
  170, 163, 51, 172, 157, 47, 80, 212, 176, 250, 87, 49, 99, 242, 136, 189,
  162, 115, 44, 43, 124, 94, 150, 16, 141, 247, 32, 10, 198, 223, 255, 72,
  53, 131, 84, 57, 220, 197, 58, 50, 208, 11, 241, 28, 3, 192, 62, 202,
  18, 215, 153, 24, 76, 41, 15, 179, 39, 46, 55, 6, 128, 167, 23, 188,
  106, 34, 187, 140, 164, 73, 112, 182, 244, 195, 227, 13, 35, 77, 196, 185,
  26, 200, 226, 119, 31, 123, 168, 125, 249, 68, 183, 230, 177, 135, 160, 180,
  12, 1, 243, 148, 102, 166, 38, 238, 251, 37, 240, 126, 64, 74, 161, 40,
  184, 149, 171, 178, 101, 66, 29, 59, 146, 61, 254, 107, 42, 86, 154, 4,
  236, 232, 120, 21, 233, 209, 45, 98, 193, 114, 78, 19, 206, 14, 118, 127,
  48, 79, 147, 85, 30, 207, 219, 54, 88, 234, 190, 122, 95, 67, 143, 109,
  137, 214, 145, 93, 92, 100, 245, 0, 216, 186, 60, 83, 105, 97, 204, 52,
])

/** The tone curve (0xce91d8), frozen to the client's bytes. */
// prettier-ignore
const CURVE = new Uint8Array([
  0, 6, 12, 18, 23, 29, 34, 40, 45, 50, 55, 60, 65, 69, 74, 78,
  82, 87, 91, 95, 98, 102, 106, 110, 113, 116, 120, 123, 126, 129, 132, 135,
  138, 141, 144, 147, 149, 152, 154, 157, 159, 161, 164, 166, 168, 170, 172, 174,
  176, 178, 180, 182, 183, 185, 187, 188, 190, 192, 193, 195, 196, 197, 199, 200,
  202, 203, 204, 205, 206, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218,
  219, 220, 220, 221, 222, 223, 224, 224, 225, 226, 227, 227, 228, 229, 229, 230,
  230, 231, 232, 232, 233, 233, 234, 234, 235, 235, 236, 236, 237, 237, 237, 238,
  238, 239, 239, 239, 240, 240, 240, 241, 241, 241, 242, 242, 242, 243, 243, 243,
  243, 244, 244, 244, 245, 245, 245, 245, 245, 246, 246, 246, 246, 247, 247, 247,
  247, 247, 247, 248, 248, 248, 248, 248, 248, 249, 249, 249, 249, 249, 249, 249,
  249, 250, 250, 250, 250, 250, 250, 250, 250, 250, 251, 251, 251, 251, 251, 251,
  251, 251, 251, 251, 251, 252, 252, 252, 252, 252, 252, 252, 252, 252, 252, 252,
  252, 252, 252, 252, 252, 252, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253,
  253, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253,
  253, 253, 253, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254,
  254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254,
])

const f32 = Math.fround
const perm = (i: number) => PERM[i & 0xff]

/** The gradient table (0xce92d8): 1 - 2·rand()/32767 on MSVC's rand, seeded 1 (the client's seed varies; any uniform table looks the same). */
function gradientTable(): Float32Array {
	const t = new Float32Array(256)
	let seed = 1
	for (let i = 0; i < 256; i++) {
		seed = (Math.imul(seed, 214013) + 2531011) >>> 0
		t[i] = f32(1 - f32((2 * ((seed >>> 16) & 0x7fff)) / 32767))
	}
	return t
}

/** The fade table (0xce8dd8): a raised cosine. */
function fadeTable(): Float32Array {
	const t = new Float32Array(256)
	for (let i = 0; i < 256; i++) t[i] = f32(0.5 * (1 - Math.cos(f32(f32(i * f32(Math.PI)) / 256))))
	return t
}

// Float bits, for the client's packing tricks.
const bitsF = new Float32Array(1)
const bitsU = new Uint32Array(bitsF.buffer)
function f32Bits(x: number): number {
	bitsF[0] = x
	return bitsU[0]
}

/** The client's inverse square root seed (0x456330), without its Newton step: its error shapes the glow. */
function fisr(x: number): number {
	bitsU[0] = (0x5f3997bb - ((f32Bits(x) >>> 1) & 0x3fffffff)) >>> 0
	return bitsF[0]
}

/** A colour channel packed as the client packs it: clamped above only, then floored through the float bits. */
function packChannel(ch: number): number {
	return (f32Bits((ch < 1 ? ch : 1) * 255 + 512) >>> 14) & 0xff
}

/** `1/255` as the client stores it (0x8026c8). */
const INV_255 = (() => {
	bitsU[0] = 0x3b808081
	return bitsF[0]
})()

/** The colour pass's inputs for one frame. */
export interface CloudFrame {
	/** The light's cloud bands as raw sRGB 0..1: 10 the sun glow, 11 the slope, 12 the base. */
	sun: ArrayLike<number>
	slope: ArrayLike<number>
	base: ArrayLike<number>
	/** The weather's storm blend (0 in clear weather). */
	storm: number
	/** The way to the glowing body (the sun by day, the moon by night), editor frame. */
	glowDir: ArrayLike<number>
	/** The day envelope of the glow (`cloudGlowTrack`). */
	glowTrack: number
}

/**
 * The tile point `d` (a direction from the camera, not necessarily unit) falls on (0x6cf870): the
 * zenith at the centre, the radius growing with the angle off an axis shifted up by cos 45° to the
 * 45° rim, lower directions clamped to it. Null for no direction.
 */
export function projectCells(dx: number, dy: number, dz: number): [number, number] | null {
	const len = Math.hypot(dx, dy, dz)
	if (len < 1e-6) return null
	const quarter = f32(Math.PI / 4)
	const c = dy + f32(Math.cos(quarter))
	const theta = Math.acos(Math.min(1, Math.max(-1, c / len)))
	const phase = (Math.min(theta, quarter) / quarter) * 0.5
	const hyp = Math.sqrt(dx * dx + dz * dz)
	let cx = 0
	let cy = 0
	if (hyp > 1e-5) {
		const inv = f32(1 / hyp)
		cx = inv * dx
		cy = inv * dz
	}
	return [f32((cx * phase + 0.5) * COLS), f32((cy * phase + 0.5) * COLS)]
}

/** The larger root of a·t² + b·t + c, rounded as the client's solver does (0x454f40). */
function largerRoot(a: number, b: number, c: number): number | null {
	const g = a * c * 4
	const h = b * b
	if (Number.isNaN(h) || Number.isNaN(g) || h <= g) return null
	const q = Math.sqrt(h - g)
	const s = (b > 0 ? b + q : b - q) * -0.5
	const inv = 1 / (a * s)
	const rootB = f32(inv * s * s)
	const rootA = f32(f32(inv) * a * c)
	return Number.isNaN(rootB) || rootB >= rootA ? rootB : rootA
}

/** The glowing body's tile cell: the camera→body ray's far hit on the unit dome shifted down by cos 45°, projected. */
export function bodyCells(dx: number, dy: number, dz: number): [number, number] | null {
	const k = -Math.cos(f32(0.25) * f32(Math.PI))
	const a = f32(dx * dx + dy * dy + dz * dz)
	const nk = -k * dy
	const t = largerRoot(a, f32(nk + nk), f32(k * k - 1))
	if (t === null) return null
	return projectCells(f32(t * dx), f32(t * dy), f32(t * dz))
}

/** One octave's lattice walk. */
interface Octave {
	freq: number
	rowKey: number
	colKey: number
	amp: number
	x0: number
	x1: number
	y0: number
	y1: number
	g: Float32Array // g00, g00d, g10, g10d, g01, g01d, g11, g11d
	cached: number
}

/** The cloud coverage field and its coloured texels. */
export class CloudKernel {
	/** Coverage bytes, COLS² row-major. */
	readonly tile = new Uint8Array(COLS * COLS)
	/** The coloured texels the dome draws: raw gamma RGBA, alpha the coverage. */
	readonly rgba = new Uint8Array(COLS * COLS * 4)
	private accum = new Float32Array(COLS * COLS)
	private deriv = new Float32Array(COLS * COLS * 2)
	private prevRow = new Float32Array(COLS)
	private scroll = 0
	private phase = 0
	private countdown = 0
	private gradient = gradientTable()
	private fade = fadeTable()
	private oct: Octave[] = BASE_FREQ.map((freq, c) => ({ freq, rowKey: 0, colKey: 0, amp: 1 / (1 << c), x0: 0, x1: 0, y0: 0, y1: 0, g: new Float32Array(8), cached: -1 }))

	constructor() {
		// White and see-through until the first build.
		this.rgba.fill(255)
		for (let i = 3; i < this.rgba.length; i += 4) this.rgba[i] = 0
	}

	/** Redraws a band when the countdown runs out; true when the texels changed. */
	tick(dt: number, density: number, frame: CloudFrame): boolean {
		this.countdown -= dt
		if (this.countdown > 0) return false
		this.countdown = REGEN_PERIOD
		this.regen(density, ROWS_PER_TICK, frame)
		return true
	}

	/** Redraws the whole tile, as the client does on start and zone changes. */
	rebuild(density: number, frame: CloudFrame) {
		this.scroll = 0
		this.regen(density, COLS, frame)
		this.countdown = REGEN_PERIOD
	}

	private regen(density: number, rows: number, frame: CloudFrame) {
		const threshold = Math.trunc((1 - Math.min(1, Math.max(0, density))) * 255)
		const seed = this.phase >> 8
		const sliceA = perm(seed)
		const sliceB = perm(seed + 1)
		const fadeT = this.fade[this.phase & 0xff]
		const scroll = this.scroll
		const end = Math.min(scroll + rows, COLS)
		for (const o of this.oct) o.rowKey = (scroll * o.freq) & 0xffff
		this.accum.fill(0, scroll * COLS, end * COLS)
		const { gradient, fade, accum, deriv, prevRow } = this
		for (let row = scroll; row < end; row++) {
			const base = row * COLS
			for (const o of this.oct) {
				const bv = o.rowKey >> 8
				o.x0 = perm(sliceA + bv)
				o.x1 = perm(sliceA + bv + 1)
				o.y0 = perm(bv + sliceB)
				o.y1 = perm(bv + 1 + sliceB)
				o.colKey = this.phase
				o.cached = -1
			}
			let prevAccum = 0
			for (let col = 0; col < COLS; col++) {
				const cell = base + col
				for (let oi = 0; oi < OCTAVES; oi++) {
					const o = this.oct[oi]
					const fadeRow = fade[o.rowKey & 0xff]
					const cz = o.colKey >> 8
					const g = o.g
					if (cz !== o.cached) {
						o.cached = cz
						const s0 = o.x0 + cz
						const s1 = o.x1 + cz
						const s2 = o.y0 + cz
						const s3 = o.y1 + cz
						g[0] = gradient[perm(s0)]
						g[1] = gradient[perm(s0 + 1)] - g[0]
						g[2] = gradient[perm(s1)]
						g[3] = gradient[perm(s1 + 1)] - g[2]
						g[4] = gradient[perm(s2)]
						g[5] = gradient[perm(s2 + 1)] - g[4]
						g[6] = gradient[perm(s3)]
						g[7] = gradient[perm(s3 + 1)] - g[6]
					}
					// The client's double chain, with its one float round trip.
					const fx = fade[o.colKey & 0xff]
					const v7 = fx * g[1] + g[0]
					const v8 = f32(fx * g[5] + g[4])
					const v7b = (fx * g[3] + g[2] - v7) * fadeRow + v7
					const v8b = (fx * g[7] + g[6] - v8) * fadeRow + v8
					o.colKey = (o.colKey + o.freq) & 0xffff
					const stored = f32(((v8b - v7b) * fadeT + v7b) * o.amp + accum[cell])
					accum[cell] = stored
					// The third octave keeps the running sum's slopes: the glow's normal.
					if (oi === 2) {
						const scale = 1 << ((SHIFT - 7) & 0x1f)
						deriv[cell * 2] = f32((prevAccum - stored) * scale)
						deriv[cell * 2 + 1] = f32((prevRow[col] - stored) * scale)
						prevAccum = stored
						prevRow[col] = stored
					}
				}
			}
			for (const o of this.oct) o.rowKey = (o.rowKey + o.freq) & 0xffff
		}
		for (let cell = scroll * COLS; cell < end * COLS; cell++) {
			const idx = ((f32Bits(accum[cell] * 64 + 128 + 512) >>> 14) & 0xff) - threshold
			this.tile[cell] = idx >= 0 ? CURVE[idx] : 0
		}
		this.colorBand(scroll, end, frame)
		this.scroll = end
		if (this.scroll >= COLS) {
			this.phase = (this.phase + 1) & 0xffff
			this.scroll = 0
		}
	}

	/**
	 * The colour pass (0x6cfb00): a hole takes the previous texel's colour at alpha 0; a covered texel
	 * is the slope times its coverage plus the base, and a glow by the angle between its slope's normal
	 * and the way to the body.
	 */
	private colorBand(start: number, end: number, frame: CloudFrame) {
		const zBias = f32(frame.storm * 192 + 64)
		const intensity = f32(frame.glowTrack * (1 - frame.storm * 0.75))
		const body = bodyCells(frame.glowDir[0], frame.glowDir[1], frame.glowDir[2])
		const { tile, rgba, deriv } = this
		const ch = [0, 0, 0]
		for (let row = start; row < end; row++) {
			for (let col = 0; col < COLS; col++) {
				const gi = row * COLS + col
				const t = tile[gi]
				const o = gi * 4
				if (t === 0) {
					if (col !== 0) {
						rgba[o] = rgba[o - 4]
						rgba[o + 1] = rgba[o - 3]
						rgba[o + 2] = rgba[o - 2]
						rgba[o + 3] = 0
					}
					continue
				}
				const n = (((255 - t) & 0xff) >> 1) + 0x40
				const p = INV_255 * n
				for (let k = 0; k < 3; k++) ch[k] = f32(frame.slope[k] * p + frame.base[k])
				if (body) {
					const vx = f32(body[0] - col)
					const vy = f32(body[1] - row)
					const vz = zBias
					const sx = deriv[gi * 2]
					const sy = deriv[gi * 2 + 1]
					const lenV = f32(vz * vz + vy * vy + vx * vx)
					const lenS = f32(sx * sx + sy * sy + 1)
					const cos = (vx * sx + vy * sy + vz) * (fisr(lenV) * fisr(lenS))
					if (cos > 0) {
						const m = cos * intensity
						for (let k = 0; k < 3; k++) ch[k] = f32(frame.sun[k] * m + ch[k])
					}
				}
				rgba[o] = packChannel(ch[0])
				rgba[o + 1] = packChannel(ch[1])
				rgba[o + 2] = packChannel(ch[2])
				rgba[o + 3] = t
			}
		}
	}

	/** The coverage (0 to 1) toward a direction from the camera, as the sun's glare samples it. */
	coverage(dx: number, dy: number, dz: number): number {
		const c = projectCells(dx, dy, dz)
		if (!c) return this.tile[(COLS / 2) * COLS + COLS / 2] / 255
		return this.tile[((c[1] | 0) & (COLS - 1)) * COLS + ((c[0] | 0) & (COLS - 1))] / 255
	}
}

/** The dome's rings: co-latitudes in units of π (0x811570), from the zenith to the 45° rim. */
const RING_COLAT = [0, 0.025, 0.05, 0.075, 0.1, 0.125, 0.15, 0.175, 0.205, 0.23, 0.245, 0.25]
/** Each ring's alpha (0x8115a0): opaque inside, half on ring 10, see-through at the rim. */
const RING_ALPHA = [1, 1, 1, 1, 1, 1, 1, 1, 1, 128 / 255, 0, 0]
const AZ_STEPS = 16

/**
 * The client's cloud dome (0x6d0530): unit positions, the tile's polar uvs and the rings' alphas,
 * shifted down by cos 45° so its rim sits at eye level, and a triangle list.
 */
export function domeMesh(): { positions: Float32Array; uvs: Float32Array; alphas: Float32Array; indices: Uint16Array } {
	const shift = Math.cos(Math.PI / 4)
	const n = RING_COLAT.length * AZ_STEPS
	const positions = new Float32Array(n * 3)
	const uvs = new Float32Array(n * 2)
	const alphas = new Float32Array(n)
	RING_COLAT.forEach((colat, ring) => {
		const phi = colat * Math.PI
		const r = ring / 24
		for (let j = 0; j < AZ_STEPS; j++) {
			const az = (j / AZ_STEPS) * Math.PI * 2
			const sa = Math.sin(az)
			const ca = Math.cos(az)
			const x = Math.sin(phi) * sa
			const y = Math.cos(phi) - shift
			const z = Math.sin(phi) * ca
			const l = Math.hypot(x, y, z)
			const v = ring * AZ_STEPS + j
			positions.set([x / l, y / l, z / l], v * 3)
			uvs.set([sa * r + 0.5, ca * r + 0.5], v * 2)
			alphas[v] = RING_ALPHA[ring]
		}
	})
	const indices = new Uint16Array((RING_COLAT.length - 1) * AZ_STEPS * 6)
	let k = 0
	for (let ring = 0; ring < RING_COLAT.length - 1; ring++) {
		for (let j = 0; j < AZ_STEPS; j++) {
			const jn = (j + 1) % AZ_STEPS
			const a = ring * AZ_STEPS + j
			const b = (ring + 1) * AZ_STEPS + j
			const c = ring * AZ_STEPS + jn
			const d = (ring + 1) * AZ_STEPS + jn
			indices.set([a, b, c, c, b, d], k)
			k += 6
		}
	}
	return { positions, uvs, alphas, indices }
}

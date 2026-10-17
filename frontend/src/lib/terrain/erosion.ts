// Sculpt › Erode and Terrain › Erode (#165): hydraulic and thermal erosion over a patch of heights, so
// hand-made mountains get the gullies, scree and sediment flats that water and gravity carve into real
// slopes. The hydraulic part is the classic droplet model (as in Sebastian Lague's Hydraulic-Erosion,
// MIT, reimplemented here): a drop of water runs downhill with some inertia, picks up ground while it
// speeds up and has room for more, and drops it where it slows or climbs. The thermal part moves ground
// from a vertex to its lower neighbours wherever the slope between them is steeper than a talus angle,
// as loose rock slides, which also rounds off spiky noise.
//
// Both work on a patch: a row-major Float32Array of `w` by `h` heights in cell units (yards divided by
// the cell size), so a slope of 1 is 45 degrees whatever the grid. The caller copies the patch out of
// the map, erodes it and blends the change back under its brush or area. Seeded and free of three.js,
// so a run is the same for the same seed and can be tested on its own; nothing here allocates per call
// once the scratch buffers have grown.

/** The droplet model's settings, in cell units. */
export interface DropletParams {
	/** How much of its direction a drop keeps each step (0 follows the slope, 1 never turns). */
	inertia: number
	/** Sediment a drop may carry per unit of drop, speed and water. */
	capacity: number
	/** What a drop may carry on flat ground, so it still erodes a little there. */
	minCapacity: number
	/** How much of its spare capacity a drop takes up each step. */
	erodeSpeed: number
	/** How much of its excess sediment a drop leaves each step. */
	depositSpeed: number
	/** How much of its water a drop loses each step. */
	evaporate: number
	gravity: number
	/** Steps a drop lives at most. */
	lifetime: number
	/** Cells around a drop that it erodes from, so it carves a gully rather than a pit a vertex wide. */
	radius: number
}

/**
 * Tuned to Meld's grid (a cell is 4.17 yd, the client's outer vertex spacing, so detail finer than that
 * is lost on export): a drop erodes from two cells around it, and carries less than Lague's 0..1 maps
 * call for, since a hand-made hill's slopes are around 1 in these units.
 */
export const DROPLETS: DropletParams = {
	inertia: 0.05,
	capacity: 2,
	minCapacity: 0.01,
	erodeSpeed: 0.3,
	depositSpeed: 0.3,
	evaporate: 0.02,
	gravity: 4,
	lifetime: 60,
	radius: 2,
}

/** Erodes a patch of heights; keeps its own seeded random numbers and scratch space. */
export class Eroder {
	private state = 1
	/** The erosion brush: offsets (dx, dz) and weights summing to 1, for a drop at a vertex. */
	private offX: Int32Array
	private offZ: Int32Array
	private offW: Float32Array
	private delta = new Float32Array(0)
	params: DropletParams

	constructor(params: DropletParams = DROPLETS) {
		this.params = params
		const r = Math.max(1, params.radius)
		const ri = Math.ceil(r)
		const xs: number[] = []
		const zs: number[] = []
		const ws: number[] = []
		let sum = 0
		for (let dz = -ri; dz <= ri; dz++) {
			for (let dx = -ri; dx <= ri; dx++) {
				const d = Math.sqrt(dx * dx + dz * dz)
				if (d >= r) continue
				const w = 1 - d / r
				xs.push(dx)
				zs.push(dz)
				ws.push(w)
				sum += w
			}
		}
		this.offX = Int32Array.from(xs)
		this.offZ = Int32Array.from(zs)
		this.offW = Float32Array.from(ws, (w) => w / sum)
	}

	/** Starts the random numbers over from `seed`, so the same seed erodes the same way. */
	seed(seed: number) {
		this.state = seed >>> 0 || 1
	}

	/** The next random number in [0, 1) (mulberry32). */
	random(): number {
		let t = (this.state = (this.state + 0x6d2b79f5) | 0)
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}

	/**
	 * Runs `count` drops over the patch `hs` (`w` by `h`). Each starts at a random point where `spawn`
	 * (a weight per vertex of the patch, 0 to 1) lets it, picked against that weight, or anywhere with
	 * no `spawn`; a drop that runs off the patch is gone. Returns how many drops ran.
	 */
	droplets(hs: Float32Array, w: number, h: number, count: number, spawn: Float32Array | null = null): number {
		if (w < 3 || h < 3) return 0
		const p = this.params
		let ran = 0
		for (let n = 0; n < count; n++) {
			let x = 0
			let z = 0
			let found = false
			// A few tries for a start the spawn weights allow; a thin brush edge may refuse all of them.
			for (let k = 0; k < 8 && !found; k++) {
				x = this.random() * (w - 1)
				z = this.random() * (h - 1)
				found = !spawn || this.random() < spawn[Math.round(z) * w + Math.round(x)]
			}
			if (!found) continue
			ran++
			this.drop(hs, w, h, x, z, p)
		}
		return ran
	}

	private drop(hs: Float32Array, w: number, h: number, x: number, z: number, p: DropletParams) {
		let dirX = 0
		let dirZ = 0
		let speed = 1
		let water = 1
		let sediment = 0
		for (let life = 0; life < p.lifetime; life++) {
			const nx = Math.floor(x)
			const nz = Math.floor(z)
			const u = x - nx
			const v = z - nz
			const i = nz * w + nx
			// The height and its gradient, bilinear over the cell the drop is in.
			const h00 = hs[i]
			const h10 = hs[i + 1]
			const h01 = hs[i + w]
			const h11 = hs[i + w + 1]
			const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v
			const gz = (h01 - h00) * (1 - u) + (h11 - h10) * u
			const height = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v
			dirX = dirX * p.inertia - gx * (1 - p.inertia)
			dirZ = dirZ * p.inertia - gz * (1 - p.inertia)
			const len = Math.sqrt(dirX * dirX + dirZ * dirZ)
			if (len < 1e-9) break
			dirX /= len
			dirZ /= len
			x += dirX
			z += dirZ
			if (x < 0 || z < 0 || x >= w - 1 || z >= h - 1) {
				// Off the patch, it takes what it carries with it.
				sediment = 0
				break
			}
			const dh = sample(hs, w, x, z) - height
			const capacity = Math.max(-dh * speed * water * p.capacity, p.minCapacity)
			if (sediment > capacity || dh > 0) {
				// Uphill it fills the pit it came from (at most what it carries); else it leaves its excess.
				const put = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * p.depositSpeed
				sediment -= put
				hs[i] += put * (1 - u) * (1 - v)
				hs[i + 1] += put * u * (1 - v)
				hs[i + w] += put * (1 - u) * v
				hs[i + w + 1] += put * u * v
			} else {
				// Never more than the drop fell, so it doesn't dig a pit below where it goes.
				sediment -= this.spread(hs, w, h, nx, nz, -Math.min((capacity - sediment) * p.erodeSpeed, -dh))
			}
			speed = Math.sqrt(Math.max(0, speed * speed - dh * p.gravity))
			water *= 1 - p.evaporate
		}
		// A drop that dries up or comes to rest leaves the rest of its load where it stops, so the ground
		// keeps its volume instead of sinking as a whole.
		if (sediment > 0) this.spread(hs, w, h, Math.round(x), Math.round(z), sediment)
	}

	/** Adds `amount` to the heights around vertex (x, z), by the erosion brush's weights; returns what landed on the patch. */
	private spread(hs: Float32Array, w: number, h: number, x: number, z: number, amount: number): number {
		const ox = this.offX
		const oz = this.offZ
		const ow = this.offW
		let put = 0
		for (let k = 0; k < ow.length; k++) {
			const xx = x + ox[k]
			const zz = z + oz[k]
			if (xx < 0 || zz < 0 || xx >= w || zz >= h) continue
			const a = amount * ow[k]
			hs[zz * w + xx] += a
			put += a
		}
		return put
	}

	/**
	 * One thermal pass over the patch: wherever a vertex stands higher above a neighbour than the talus
	 * slope `talus` (rise over run, in cell units) allows, `amount` (0 to 1) of half its largest excess
	 * slides to its lower neighbours, shared by how far each is past the talus. All moves are worked out
	 * from the heights before the pass, so the order doesn't matter, and the ground's volume is kept.
	 * Returns how much ground moved.
	 */
	thermal(hs: Float32Array, w: number, h: number, talus: number, amount: number): number {
		const n = w * h
		if (this.delta.length < n) this.delta = new Float32Array(n)
		const d = this.delta
		d.fill(0, 0, n)
		const diag = talus * Math.SQRT2
		const k = Math.min(1, Math.max(0, amount)) * 0.5
		let moved = 0
		for (let z = 0; z < h; z++) {
			for (let x = 0; x < w; x++) {
				const i = z * w + x
				const hi = hs[i]
				let sum = 0
				let most = 0
				for (let dz = -1; dz <= 1; dz++) {
					const zz = z + dz
					if (zz < 0 || zz >= h) continue
					for (let dx = -1; dx <= 1; dx++) {
						const xx = x + dx
						if ((dx === 0 && dz === 0) || xx < 0 || xx >= w) continue
						const e = hi - hs[zz * w + xx] - (dx !== 0 && dz !== 0 ? diag : talus)
						if (e > 0) {
							sum += e
							if (e > most) most = e
						}
					}
				}
				if (sum <= 0) continue
				const out = most * k
				d[i] -= out
				moved += out
				for (let dz = -1; dz <= 1; dz++) {
					const zz = z + dz
					if (zz < 0 || zz >= h) continue
					for (let dx = -1; dx <= 1; dx++) {
						const xx = x + dx
						if ((dx === 0 && dz === 0) || xx < 0 || xx >= w) continue
						const j = zz * w + xx
						const e = hi - hs[j] - (dx !== 0 && dz !== 0 ? diag : talus)
						if (e > 0) d[j] += (out * e) / sum
					}
				}
			}
		}
		for (let i = 0; i < n; i++) hs[i] += d[i]
		return moved
	}
}

/** The bilinear height at (x, z), inside the patch. */
function sample(hs: Float32Array, w: number, x: number, z: number): number {
	const nx = Math.floor(x)
	const nz = Math.floor(z)
	const u = x - nx
	const v = z - nz
	const i = nz * w + nx
	return hs[i] * (1 - u) * (1 - v) + hs[i + 1] * u * (1 - v) + hs[i + w] * (1 - u) * v + hs[i + w + 1] * u * v
}

/** The talus slope (rise over run) of an angle in degrees. */
export function talusSlope(deg: number): number {
	return Math.tan((Math.min(89, Math.max(1, deg)) * Math.PI) / 180)
}

// Vertex edit, after noggit3's terrain Vertex mode (World::selectVertices, moveVertices, orientVertices and
// flattenVertices): the brush selects heightmap vertices, and the selection is moved, flattened or laid
// onto a sloped plane. Kept free of three.js and the terrain class so it can be tested on its own.

export interface VertexRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

/** A set of heightmap vertices, by index into the (size+1)^2 height array. */
export class VertexSelection {
	readonly ids: number[] = []
	/** Bumped by every add, remove and clear, so a drawing of the selection can tell when it is stale. */
	version = 0
	readonly verts: number
	private mark: Uint8Array

	constructor(verts: number) {
		this.verts = verts
		this.mark = new Uint8Array(verts * verts)
	}

	get size() {
		return this.ids.length
	}

	has(i: number) {
		return this.mark[i] === 1
	}

	add(i: number) {
		if (this.mark[i]) return
		this.mark[i] = 1
		this.version++
		this.ids.push(i)
	}

	remove(i: number) {
		if (!this.mark[i]) return
		this.mark[i] = 0
		this.version++
		const k = this.ids.indexOf(i)
		this.ids[k] = this.ids[this.ids.length - 1]
		this.ids.pop()
	}

	clear() {
		for (const i of this.ids) this.mark[i] = 0
		this.ids.length = 0
		this.version++
	}

	/** The vertex rect the selection spans, or null when it is empty. */
	rect(): VertexRect | null {
		if (!this.ids.length) return null
		const V = this.verts
		let x0 = V,
			z0 = V,
			x1 = -1,
			z1 = -1
		for (const i of this.ids) {
			const x = i % V
			const z = (i - x) / V
			if (x < x0) x0 = x
			if (x > x1) x1 = x
			if (z < z0) z0 = z
			if (z > z1) z1 = z
		}
		return { x0, z0, x1, z1 }
	}

	/** Mean world position of the selected vertices, written into `out`. */
	center(heights: Float32Array, cellSize: number, out: { x: number; y: number; z: number }) {
		const V = this.verts
		let x = 0,
			y = 0,
			z = 0
		for (const i of this.ids) {
			const vx = i % V
			x += vx * cellSize
			z += ((i - vx) / V) * cellSize
			y += heights[i]
		}
		const n = this.ids.length || 1
		out.x = x / n
		out.y = y / n
		out.z = z / n
		return out
	}
}

/** Moves every selected vertex up by `dh`. */
export function moveVertices(heights: Float32Array, sel: VertexSelection, dh: number) {
	for (const i of sel.ids) heights[i] += dh
}

/** Sets every selected vertex to height `h`. */
export function flattenVertices(heights: Float32Array, sel: VertexSelection, h: number) {
	for (const i of sel.ids) heights[i] = h
}

/**
 * Lays the selected vertices onto the plane through `ref` that rises at `angle` degrees toward direction
 * `dir` degrees (0 is +x, 90 is +z), as noggit3's misc::angledHeight does.
 */
export function orientVertices(heights: Float32Array, sel: VertexSelection, cellSize: number, ref: { x: number; y: number; z: number }, angle: number, dir: number) {
	const V = sel.verts
	const a = (Math.max(-89, Math.min(89, angle)) * Math.PI) / 180
	const d = (dir * Math.PI) / 180
	const c = Math.cos(d)
	const s = Math.sin(d)
	const t = Math.tan(a)
	for (const i of sel.ids) {
		const vx = i % V
		const x = vx * cellSize
		const z = ((i - vx) / V) * cellSize
		heights[i] = ref.y + ((x - ref.x) * c + (z - ref.z) * s) * t
	}
}

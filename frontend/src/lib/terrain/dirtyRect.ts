// Dirty-rect bookkeeping for the terrain's textures, kept free of three.js so it can be tested on its
// own. A texture that changed in one spot is uploaded in that spot only (see Terrain.update), and the
// rects marked between two uploads merge into one.

/** An inclusive rect of texels or vertices. */
export interface DirtyRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

/** Grows `r` to cover `add`. */
export function growRect(r: DirtyRect, add: DirtyRect): DirtyRect {
	r.x0 = Math.min(r.x0, add.x0)
	r.z0 = Math.min(r.z0, add.z0)
	r.x1 = Math.max(r.x1, add.x1)
	r.z1 = Math.max(r.z1, add.z1)
	return r
}

/**
 * What changed in one texture since its last upload: nothing, a rect, or (rect null while dirty) all
 * of it. A mark without a rect means the whole texture, and so does any mark after one.
 */
export class DirtyRegion {
	dirty = false
	rect: DirtyRect | null = null

	mark(rect?: DirtyRect | null) {
		if (this.dirty) {
			if (rect && this.rect) growRect(this.rect, rect)
			else this.rect = null
			return
		}
		this.dirty = true
		this.rect = rect ? { ...rect } : null
	}

	clear() {
		this.dirty = false
		this.rect = null
	}
}

/**
 * The part of a `res` texels square texture that an inclusive `rect` asks to upload: the rect clipped
 * to the texture, null when nothing of it is inside, or 'whole' when it covers at least half of the
 * texture, since a sub-rect that large costs about as much as all of it.
 */
export function uploadRect(rect: DirtyRect, res: number): DirtyRect | null | 'whole' {
	const x0 = Math.max(0, rect.x0)
	const z0 = Math.max(0, rect.z0)
	const x1 = Math.min(res - 1, rect.x1)
	const z1 = Math.min(res - 1, rect.z1)
	if (x1 < x0 || z1 < z0) return null
	if ((x1 - x0 + 1) * (z1 - z0 + 1) * 2 > res * res) return 'whole'
	return { x0, z0, x1, z1 }
}

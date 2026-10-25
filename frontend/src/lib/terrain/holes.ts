/**
 * Holes in the ground: one byte per terrain cell, non-zero where the cell is cut out (a cave mouth, a
 * pit into a building's basement). A cell is two triangles, and a hole can be either of them:
 *
 *   0  solid
 *   1  the whole cell (both triangles; what the client's holes and older maps say)
 *   2  only the first triangle
 *   3  only the second triangle
 *
 * The first triangle is the one written first by writeCellIndex: on a cell whose x+z is odd the
 * diagonal runs from (1,0) to (0,1) and the first triangle holds the (0,0) corner; on an even cell
 * it runs from (0,0) to (1,1) and the first triangle holds the (0,1) corner. A hole triangle is not
 * drawn and the cursor's ray passes through it.
 */

export const HOLE_NONE = 0
export const HOLE_CELL = 1
export const HOLE_FIRST = 2
export const HOLE_SECOND = 3

/** Which triangle (1 or 2) of cell (x, z) the point at local fraction (fx, fz) of the cell lies in. */
export function holeTriangle(x: number, z: number, fx: number, fz: number): 1 | 2 {
	return ((x + z) & 1 ? fx + fz < 1 : fz > fx) ? 1 : 2
}

/** Whether triangle `tri` of a cell with hole value `v` is cut out. */
export const triangleIsHole = (v: number, tri: 1 | 2) => v === HOLE_CELL || v === (tri === 1 ? HOLE_FIRST : HOLE_SECOND)

/** The hole value of a cell now `v` with triangle `tri` cut (`hole` true) or restored. */
export function withTriangle(v: number, tri: 1 | 2, hole: boolean): number {
	const first = tri === 1 ? hole : triangleIsHole(v, 1)
	const second = tri === 2 ? hole : triangleIsHole(v, 2)
	return first && second ? HOLE_CELL : first ? HOLE_FIRST : second ? HOLE_SECOND : HOLE_NONE
}

/**
 * Writes the triangle indices of a render chunk into `idx`, leaving out the cells that are holes, and
 * returns how many indices were written. The chunk is `cells` x `cellsZ` cells starting at map cell
 * (ox, oz), with `vx` vertices a row; `holes` is the map's hole byte per cell, `size` cells a side.
 * Diagonals alternate per cell so the surface doesn't look combed, by the map cell's own x+z (not
 * the chunk's), so every caller (the terrain's chunks, the navmesh's tiles) cuts a half-cell hole
 * out of the same triangle whatever its origin.
 */
export function writeCellIndex(idx: Uint32Array, cells: number, cellsZ: number, vx: number, ox: number, oz: number, holes: Uint8Array, size: number): number {
	let k = 0
	const parity = (ox + oz) & 1
	for (let z = 0; z < cellsZ; z++) {
		for (let x = 0; x < cells; x++) {
			const v = holes[(oz + z) * size + ox + x]
			if (v === HOLE_CELL) continue
			const a = z * vx + x
			const b = a + 1
			const c = a + vx
			const d = c + 1
			const first = v !== HOLE_FIRST
			const second = v !== HOLE_SECOND
			if ((x + z + parity) & 1) {
				if (first) {
					idx[k++] = a
					idx[k++] = c
					idx[k++] = b
				}
				if (second) {
					idx[k++] = b
					idx[k++] = c
					idx[k++] = d
				}
			} else {
				if (first) {
					idx[k++] = a
					idx[k++] = c
					idx[k++] = d
				}
				if (second) {
					idx[k++] = a
					idx[k++] = d
					idx[k++] = b
				}
			}
		}
	}
	return k
}

/**
 * Sets the cells of the rect (x0..x1, z0..z1 as cell corners, exclusive at x1/z1, clipped to the map)
 * to `value`. Returns the number of cells that changed.
 */
export function fillHoles(holes: Uint8Array, size: number, x0: number, z0: number, x1: number, z1: number, value: 0 | 1): number {
	const cx0 = Math.max(0, x0)
	const cz0 = Math.max(0, z0)
	const cx1 = Math.min(size, x1)
	const cz1 = Math.min(size, z1)
	let n = 0
	for (let z = cz0; z < cz1; z++) {
		for (let x = cx0; x < cx1; x++) {
			const i = z * size + x
			if (holes[i] !== value) {
				holes[i] = value
				n++
			}
		}
	}
	return n
}

/**
 * Cells a side of a hole block. A 1.12 tile keeps a chunk's holes as a 4x4 bitmap, a bit per 2x2 cells,
 * so Meld cuts and fills holes by whole blocks (the owner's decision, B-145, issue #76): what the editor
 * shows is what the game gets.
 */
export const HOLE_BLOCK = 2

/** Grows an inclusive cell rect outward to whole hole blocks, clipped to the map, in place. */
export function snapToBlocks<R extends CellRect>(r: R, size: number): R {
	r.x0 = Math.max(0, r.x0 - (r.x0 % HOLE_BLOCK))
	r.z0 = Math.max(0, r.z0 - (r.z0 % HOLE_BLOCK))
	r.x1 = Math.min(size - 1, r.x1 - (r.x1 % HOLE_BLOCK) + HOLE_BLOCK - 1)
	r.z1 = Math.min(size - 1, r.z1 - (r.z1 % HOLE_BLOCK) + HOLE_BLOCK - 1)
	return r
}

/** How many cells of the rect (cell corners, exclusive at x1/z1) are holes, a half-cut cell counting as one. */
export function countHoles(holes: Uint8Array, size: number, x0: number, z0: number, x1: number, z1: number): number {
	let n = 0
	for (let z = Math.max(0, z0); z < Math.min(size, z1); z++) {
		for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) if (holes[z * size + x]) n++
	}
	return n
}

// ---- The holes' edges as walls (see tools/HoleWalls.ts) ----

/** A straight run of hole boundary on grid line `line` (x = line for axis 'x', z = line for 'z'), over [from, to) along the other axis. The hole lies on `side` (-1 the lower coordinates, +1 the higher). */
export interface Wall {
	axis: 'x' | 'z'
	line: number
	from: number
	to: number
	side: -1 | 1
}

/** Walls from the hole bytes: every boundary edge between a hole cell and a ground cell, in maximal straight runs. */
export function findWalls(holes: Uint8Array, size: number): Wall[] {
	const walls: Wall[] = []
	const hole = (x: number, z: number) => holes[z * size + x] !== HOLE_NONE
	// Vertical lines x = L separate cells (L-1, z) and (L, z); horizontal lines z = L separate (x, L-1) and (x, L).
	for (const axis of ['x', 'z'] as const) {
		for (let line = 1; line < size; line++) {
			let run: Wall | null = null
			for (let t = 0; t < size; t++) {
				const lo = axis === 'x' ? hole(line - 1, t) : hole(t, line - 1)
				const hi = axis === 'x' ? hole(line, t) : hole(t, line)
				const side: -1 | 1 | 0 = lo === hi ? 0 : lo ? -1 : 1
				if (run && (side === 0 || side !== run.side)) {
					walls.push(run)
					run = null
				}
				if (side !== 0) {
					if (run) run.to = t + 1
					else run = { axis, line, from: t, to: t + 1, side }
				}
			}
			if (run) walls.push(run)
		}
	}
	return walls
}

/**
 * The walls fade out with the camera's distance (world units), so a hole's edges don't show from
 * across the map (#249; tools/HoleWalls.ts draws them): drawn whole up to WALL_FADE_NEAR, gone past
 * WALL_FADE_FAR. Near the cursor they show at any distance (within `revealRadius` of where it meets
 * the ground), so a far hole's walls can still be found and grabbed by pointing at it.
 */
export const WALL_FADE_NEAR = 90
export const WALL_FADE_FAR = 150

/** How far round the cursor's ground point (world units) the walls show whatever the camera's distance, for a cursor `dist` from the camera. */
export function revealRadius(dist: number): number {
	return Math.max(16, dist * 0.12)
}

const smooth = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}

/**
 * A wall's opacity factor at a point `camDist` from the camera and `cursorDist` (on the ground plane)
 * from the cursor's ground point, or `cursorDist` null with no ground under the cursor. The ribbon
 * shader does the same per fragment.
 */
export function wallFade(camDist: number, cursorDist: number | null, radius: number): number {
	const far = 1 - smooth(WALL_FADE_NEAR, WALL_FADE_FAR, camDist)
	const near = cursorDist === null ? 0 : 1 - smooth(radius, radius * 1.5, cursorDist)
	return Math.max(far, near)
}

/** A rect of cells, inclusive. */
export interface CellRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

/** The `depth` cells across wall `w` over its run: outward (into the ground) or inward (into the hole), clipped to the map. */
export function bandOf(w: Wall, depth: number, outward: boolean, size: number): CellRect | null {
	if (depth <= 0) return null
	// The hole is on `side`; outward goes the other way.
	const dir = outward ? -w.side : w.side
	// The first cell across the line in direction dir: line for +1, line-1 for -1.
	const first = dir === 1 ? w.line : w.line - 1
	const last = first + dir * (depth - 1)
	const a0 = Math.max(0, Math.min(first, last))
	const a1 = Math.min(size - 1, Math.max(first, last))
	if (a0 > a1) return null
	return w.axis === 'x' ? { x0: a0, z0: w.from, x1: a1, z1: w.to - 1 } : { x0: w.from, z0: a0, x1: w.to - 1, z1: a1 }
}

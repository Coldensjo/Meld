/**
 * Ids filed by a point on the ground in square cells of `cell` yards (#512), so "what stands near
 * here" reads the cells around a spot rather than every id. A cell holds the ids whose point is in
 * it; the caller checks each id's exact spot.
 */
export class CellGrid {
	private cells = new Map<number, Set<number>>()
	/** The cell each id is filed in. */
	private at = new Map<number, number>()

	constructor(readonly cell = 32) {}

	private static key(ix: number, iz: number): number {
		return (ix + 32768) * 65536 + (iz + 32768)
	}

	/** How many ids are filed. */
	get size(): number {
		return this.at.size
	}

	/** Files `id` at (x, z), moving it from the cell it was in. */
	set(id: number, x: number, z: number) {
		const k = CellGrid.key(Math.floor(x / this.cell), Math.floor(z / this.cell))
		const was = this.at.get(id)
		if (was === k) return
		if (was !== undefined) this.unfile(id, was)
		let s = this.cells.get(k)
		if (!s) this.cells.set(k, (s = new Set()))
		s.add(id)
		this.at.set(id, k)
	}

	delete(id: number) {
		const was = this.at.get(id)
		if (was !== undefined) this.unfile(id, was)
	}

	has(id: number): boolean {
		return this.at.has(id)
	}

	clear() {
		this.cells.clear()
		this.at.clear()
	}

	private unfile(id: number, k: number) {
		this.at.delete(id)
		const s = this.cells.get(k)
		s?.delete(id)
		if (s && !s.size) this.cells.delete(k)
	}

	/**
	 * Fills `out` with the cells that meet the rect (x0, z0)..(x1, z1), or with every cell when the
	 * rect spans more cells than are filled (a query over the whole map).
	 */
	cellsIn(x0: number, z0: number, x1: number, z1: number, out: Set<number>[]): Set<number>[] {
		out.length = 0
		const ix0 = Math.floor(x0 / this.cell)
		const iz0 = Math.floor(z0 / this.cell)
		const ix1 = Math.floor(x1 / this.cell)
		const iz1 = Math.floor(z1 / this.cell)
		// A NaN or reversed rect meets nothing.
		if (!(ix1 >= ix0 && iz1 >= iz0)) return out
		if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > this.cells.size) {
			for (const s of this.cells.values()) out.push(s)
			return out
		}
		for (let iz = iz0; iz <= iz1; iz++) {
			for (let ix = ix0; ix <= ix1; ix++) {
				const s = this.cells.get(CellGrid.key(ix, iz))
				if (s) out.push(s)
			}
		}
		return out
	}
}

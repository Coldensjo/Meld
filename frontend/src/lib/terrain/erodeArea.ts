// Terrain › Erode (#165): erosion over the selected area or the whole map, run a slice at a time between
// frames so the editor stays live and the run can be cancelled. The Engine copies the heights out into a
// patch (cell units, terrain/erosion.ts), runs this, and blends the result back as one undo step. Kept
// free of three.js so it can be tested on its own.
import { Eroder, talusSlope } from './erosion'
import { INSIDE } from './areaShape'

/** Terrain › Erode's settings (editor.erode). */
export interface ErodeSettings {
	/** Water drops a cell of the area. */
	density: number
	/** Thermal passes after the drops. */
	passes: number
	/** The slope in degrees steeper than which thermal erosion moves ground. */
	talus: number
	seed: number
}

/** An inclusive vertex rect. */
export interface VertexRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

/**
 * Writes into `out` (a weight per vertex of the rect `r`, row-major) 1 where the vertex may change and 0
 * where not: with `cells` (the area's cells, `size` a side, INSIDE where selected), a vertex changes
 * only when every cell of the map around it is in the area, so the ground outside isn't pulled at its
 * edge; with none, every vertex changes.
 */
export function areaVertexWeights(cells: Uint8Array | null, size: number, r: VertexRect, out: Float32Array) {
	const w = r.x1 - r.x0 + 1
	for (let z = r.z0; z <= r.z1; z++) {
		for (let x = r.x0; x <= r.x1; x++) {
			let ok = true
			if (cells) {
				for (let dz = -1; dz <= 0 && ok; dz++) {
					const cz = z + dz
					if (cz < 0 || cz >= size) continue
					for (let dx = -1; dx <= 0; dx++) {
						const cx = x + dx
						if (cx < 0 || cx >= size) continue
						if (cells[cz * size + cx] !== INSIDE) {
							ok = false
							break
						}
					}
				}
			}
			out[(z - r.z0) * w + (x - r.x0)] = ok ? 1 : 0
		}
	}
}

/** A thermal pass costs about as much as this many drops a cell (measured: 65k drops 120 ms, a pass over 65k cells 2 ms). */
const PASS_COST = 1 / 50

/** Gives the editor a turn: a message, not a timeout, since a hidden window throttles timeouts to one a second. */
export function nextTurn(): Promise<void> {
	return new Promise<void>((done) => {
		const ch = new MessageChannel()
		ch.port1.onmessage = () => {
			ch.port1.close()
			done()
		}
		ch.port2.postMessage(0)
	})
}

/**
 * Erodes the patch `hs` (`w` by `h`, cell units) in place: `density` drops a cell started where `spawn`
 * allows, then `passes` thermal passes, about `sliceMs` of work between turns for the editor. Reports
 * the share done (0 to 1) to `progress` and stops, returning false, as soon as `cancelled` says so;
 * returns true when it ran to the end.
 */
export async function erodePatch(
	hs: Float32Array,
	w: number,
	h: number,
	spawn: Float32Array | null,
	o: ErodeSettings,
	progress: (f: number) => void,
	cancelled: () => boolean,
	sliceMs = 30,
	turn: () => Promise<void> = nextTurn,
): Promise<boolean> {
	const e = new Eroder()
	e.seed(o.seed)
	const cells = w * h
	const drops = Math.max(0, Math.round(o.density * cells))
	const passes = Math.max(0, Math.round(o.passes))
	const total = drops + passes * cells * PASS_COST || 1
	const talus = talusSlope(o.talus)
	let done = 0
	let start = performance.now()
	const pause = async () => {
		if (performance.now() - start < sliceMs) return true
		progress(Math.min(1, done / total))
		await turn()
		start = performance.now()
		return !cancelled()
	}
	if (cancelled()) return false
	const BATCH = 500
	for (let d = 0; d < drops; d += BATCH) {
		const n = Math.min(BATCH, drops - d)
		e.droplets(hs, w, h, n, spawn)
		done += n
		if (!(await pause())) return false
	}
	for (let p = 0; p < passes; p++) {
		e.thermal(hs, w, h, talus, 1)
		done += cells * PASS_COST
		if (!(await pause())) return false
	}
	progress(1)
	return true
}

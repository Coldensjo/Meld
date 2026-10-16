// Check Map (#176): chunks without a zone or with one the client doesn't know, the texture palette
// (entries nothing uses, textures the client lacks) and painted water that lies under the ground.
import { capped, type Finding } from './findings'
import { NO_TEXTURE, SLOTS } from '../terrain/chunkPaint'

/**
 * Chunks with no zone (area ID 0) in a map whose other chunks have one, and chunks whose zone isn't
 * among `known` (the client's AreaTable rows; null when they aren't read). `areaIds` is a chunk per
 * entry, `side` chunks a side, each `chunkWorld` yards.
 */
export function checkZones(areaIds: ArrayLike<number>, side: number, chunkWorld: number, known: ((id: number) => boolean) | null): Finding[] {
	let any = false
	for (let c = 0; c < areaIds.length; c++) if (areaIds[c]) any = true
	if (!any) return []
	const none: Finding[] = []
	const unknown: Finding[] = []
	const at = (c: number) => ({ x: ((c % side) + 0.5) * chunkWorld, z: (Math.floor(c / side) + 0.5) * chunkWorld })
	for (let c = 0; c < areaIds.length; c++) {
		const id = areaIds[c]
		if (!id) none.push({ check: 'Chunks without a zone', severity: 'warning', message: `Chunk ${c % side}, ${Math.floor(c / side)} has no zone (the game names it after none).`, ...at(c), target: { kind: 'chunk', chunk: c } })
		else if (known && !known(id)) unknown.push({ check: 'Unknown zones', severity: 'error', message: `Chunk ${c % side}, ${Math.floor(c / side)} has zone ${id}, which the client's AreaTable lacks.`, ...at(c), target: { kind: 'chunk', chunk: c } })
	}
	return [...capped('Chunks without a zone', none), ...capped('Unknown zones', unknown)]
}

/**
 * Palette entries no chunk uses (tidying only: they cost nothing in the game), and textures the client
 * doesn't have (`known`, null when the client's list isn't read), which the game draws as missing.
 * Colours (`#rrggbb`) are the editor's own and left out of the second.
 */
export function checkPalette(palette: readonly string[], chunkSlots: ArrayLike<number>, known: ((path: string) => boolean) | null, chunkAt: (c: number) => { x: number; z: number }): Finding[] {
	const firstChunk = new Array<number>(palette.length).fill(-1)
	const chunks = Math.floor(chunkSlots.length / SLOTS)
	for (let c = 0; c < chunks; c++) {
		for (let k = 0; k < SLOTS; k++) {
			const t = chunkSlots[c * SLOTS + k]
			if (t !== NO_TEXTURE && t < palette.length && firstChunk[t] < 0) firstChunk[t] = c
		}
	}
	const out: Finding[] = []
	const name = (p: string) => p.slice(p.lastIndexOf('\\') + 1)
	const unused = palette.map((p, i) => (firstChunk[i] < 0 && p ? name(p) : '')).filter(Boolean)
	if (unused.length) out.push({ check: 'Texture palette', severity: 'info', message: `${unused.length} palette ${unused.length === 1 ? 'texture is' : 'textures are'} painted nowhere: ${unused.slice(0, 6).join(', ')}${unused.length > 6 ? '…' : ''}.`, x: NaN, z: NaN, target: { kind: 'none' } })
	if (known) {
		palette.forEach((p, i) => {
			if (!p || p.startsWith('#') || known(p)) return
			const c = firstChunk[i]
			const where = c >= 0 ? chunkAt(c) : { x: NaN, z: NaN }
			out.push({ check: 'Texture palette', severity: 'error', message: `${p} isn't in the client, so the game shows it as missing.`, ...where, target: c >= 0 ? { kind: 'chunk', chunk: c } : { kind: 'none' } })
		})
	}
	return out
}

/** A chunk's liquid layers as the water check reads them. */
export interface CheckLiquidLayer {
	/** 8x8 cells, set where the layer is. */
	cells: ArrayLike<number>
	/** 9x9 surface heights. */
	heights: ArrayLike<number>
}

/**
 * Painted water that lies wholly under the ground: in every cell of the layer, all four surface corners
 * below the ground there, so it never shows. One finding per chunk, whose fix is Crop water there.
 * `layers(c)` gives chunk c's layers, `groundAt(gx, gz)` the ground at a vertex of the map's cell grid.
 */
export function checkHiddenWater(side: number, layers: (c: number) => readonly CheckLiquidLayer[], groundAt: (gx: number, gz: number) => number, chunkWorld: number): Finding[] {
	const N = 8
	const V = N + 1
	const out: Finding[] = []
	for (let c = 0; c < side * side; c++) {
		const list = layers(c)
		if (!list.length) continue
		const cx = c % side
		const cz = Math.floor(c / side)
		let hidden = 0
		for (const l of list) {
			let cells = 0
			let under = 0
			for (let z = 0; z < N; z++) {
				for (let x = 0; x < N; x++) {
					if (!l.cells[z * N + x]) continue
					cells++
					let below = true
					for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
						if (l.heights[(z + dz) * V + x + dx] >= groundAt(cx * N + x + dx, cz * N + z + dz)) below = false
					}
					if (below) under++
				}
			}
			if (cells && under === cells) hidden++
		}
		if (hidden) out.push({ check: 'Hidden water', severity: 'warning', message: `Chunk ${cx}, ${cz} has ${hidden === 1 ? 'a liquid layer' : `${hidden} liquid layers`} wholly under the ground.`, x: (cx + 0.5) * chunkWorld, z: (cz + 0.5) * chunkWorld, target: { kind: 'chunk', chunk: c }, fix: 'cropWater' })
	}
	return capped('Hidden water', out)
}

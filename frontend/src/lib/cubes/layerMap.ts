// What the camera's layer looks like from above (#62): the layer the camera is in, and the Minimap
// window's picture of a cube world, one pixel a column of cubes. Pure data, so it runs in the tests.

import { CHUNK_SIZE, GROUND_LAYER, LAYER_COUNT, type CubeWorld } from './world'
import { CUBE_HEIGHT } from './shapes'
import { cubeColour } from './mesher'

/** The layer a height in metres lies in (a layer's bottom is `layerBottom`), held to the world's 0 to 30. */
export function layerAtHeight(y: number): number {
	const layer = GROUND_LAYER - Math.floor(y / CUBE_HEIGHT)
	return Math.max(0, Math.min(LAYER_COUNT - 1, layer))
}

/** How much darker each layer further below the camera's is drawn; the first cube below is at `BELOW`. */
const BELOW = 0.6
const DEEPER = 0.88
/** A column with no cube from the layer down, and the square's part outside a world that is not square. */
const NOTHING: readonly [number, number, number] = [18, 18, 22]
const OUTSIDE: readonly [number, number, number] = [6, 6, 8]

const toSrgb = (c: number) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055))

/**
 * Draws `layer` of `world` from above into `out` (RGBA, `side` x `side` pixels, `side` at least the
 * world's larger size in cubes; x right, z down, as the minimap shows the map): each column's colour
 * is its cube in `layer`, or, where that is empty, the first cube below it, darker the deeper it lies.
 */
export function drawLayerMap(world: CubeWorld, layer: number, side: number, out: Uint8ClampedArray) {
	const sx = world.sizeX
	const sz = world.sizeZ
	for (let i = 0; i < side * side; i++) {
		out[i * 4] = OUTSIDE[0]
		out[i * 4 + 1] = OUTSIDE[1]
		out[i * 4 + 2] = OUTSIDE[2]
		out[i * 4 + 3] = 255
	}
	const top = Math.max(0, Math.min(LAYER_COUNT - 1, layer))
	// The colour of each kind in each layer, in sRGB bytes, worked out once.
	const colours = new Map<number, [number, number, number]>()
	const colour = (kind: number, l: number) => {
		const key = l * 256 + kind
		let c = colours.get(key)
		if (!c) {
			const [r, g, b] = cubeColour(kind, l)
			c = [toSrgb(r), toSrgb(g), toSrgb(b)]
			colours.set(key, c)
		}
		return c
	}
	for (let cz = 0; cz < world.chunksZ; cz++) {
		for (let cx = 0; cx < world.chunksX; cx++) {
			// The chunk's planes in each layer from the camera's down, undefined where all empty.
			const stack: (Uint8Array | undefined)[] = []
			for (let l = top; l < LAYER_COUNT; l++) stack.push(world.chunk(cx, cz, l))
			for (let z = 0; z < CHUNK_SIZE; z++) {
				for (let x = 0; x < CHUNK_SIZE; x++) {
					const i = z * CHUNK_SIZE + x
					const px = cx * CHUNK_SIZE + x
					const pz = cz * CHUNK_SIZE + z
					if (px >= sx || pz >= sz || px >= side || pz >= side) continue
					let rgb: readonly [number, number, number] = NOTHING
					let shade = 1
					for (let d = 0; d < stack.length; d++) {
						const planes = stack[d]
						const kind = planes ? planes[i] : 0
						if (kind === 0) continue
						rgb = colour(kind, top + d)
						shade = d === 0 ? 1 : BELOW * Math.pow(DEEPER, d - 1)
						break
					}
					const o = (pz * side + px) * 4
					out[o] = rgb[0] * shade
					out[o + 1] = rgb[1] * shade
					out[o + 2] = rgb[2] * shade
				}
			}
		}
	}
}

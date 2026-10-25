import { fbm, ridged } from '../engine/noise'

// The starting shapes a new world can have. Every preset but Flat land is an island: the ground
// falls away to the sea towards the map's edge, so a world is always bounded by water, which the
// client renders as endless ocean beyond the map.

export type PresetId = 'ocean' | 'flat' | 'island' | 'archipelago' | 'hills' | 'mountains' | 'highlands' | 'lakeland'

export interface Preset {
	id: PresetId
	name: string
	blurb: string
	/** Whether the world starts with water, and at what height. */
	water: boolean
	waterLevel: number
}

/** Seabed height of an empty ("ocean") map; water sits at 0. */
export const OCEAN_FLOOR = -12

export const PRESETS: readonly Preset[] = [
	{ id: 'ocean', name: 'Open sea', blurb: 'Nothing but water. Raise land wherever you like.', water: true, waterLevel: 0 },
	{ id: 'island', name: 'Island', blurb: 'One rugged island with beaches and a hilly middle.', water: true, waterLevel: 0 },
	{ id: 'archipelago', name: 'Archipelago', blurb: 'A scatter of small islands in a shallow sea.', water: true, waterLevel: 0 },
	{ id: 'hills', name: 'Rolling hills', blurb: 'Soft green hills, ringed by the sea.', water: true, waterLevel: 0 },
	{ id: 'lakeland', name: 'Lakeland', blurb: 'Low hills with lakes and ponds between them.', water: true, waterLevel: 0 },
	{ id: 'highlands', name: 'Highlands', blurb: 'A high plateau with cliffs down to the shore.', water: true, waterLevel: 0 },
	{ id: 'mountains', name: 'Mountains', blurb: 'Steep ridged peaks, snow on top, sea all round.', water: true, waterLevel: 0 },
	{ id: 'flat', name: 'Flat land', blurb: 'Level ground to the edge of the map, and no water.', water: false, waterLevel: -2 },
]

export const presetById = (id: PresetId) => PRESETS.find((p) => p.id === id) ?? PRESETS[0]

const smoothstep = (e0: number, e1: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
	return t * t * (3 - 2 * t)
}

/**
 * How much of the land stands at (u, v) in 0..1 of the map: 1 well inside, 0 at the edge, with a
 * ragged coastline. Every island preset multiplies its land by this.
 */
function coast(u: number, v: number, seed: number): number {
	const dx = u - 0.5
	const dz = v - 0.5
	// Between a circle and a square, so the island fills the map without touching its edges.
	const round = Math.sqrt(dx * dx + dz * dz) * 2
	const square = Math.max(Math.abs(dx), Math.abs(dz)) * 2
	const d = round * 0.65 + square * 0.35 + (fbm(u * 3 + 11, v * 3 + 7, 3, seed + 101) - 0.5) * 0.3
	return 1 - smoothstep(0.6, 0.95, d)
}

/** Ground height at (u, v) in 0..1 of the map for a preset. */
export function presetHeight(id: PresetId, u: number, v: number, seed: number): number {
	switch (id) {
		case 'ocean':
			return OCEAN_FLOOR
		case 'flat':
			return 0
		case 'island': {
			const c = coast(u, v, seed)
			const n = fbm(u * 5, v * 5, 5, seed)
			const r = ridged(u * 3, v * 3, 5, seed + 3)
			return c * (8 + n * 14 + r * r * 40) - 6
		}
		case 'archipelago': {
			// Low broad noise decides where islands rise; the sea between them is shallow.
			const c = coast(u, v, seed)
			const where = smoothstep(0.5, 0.64, fbm(u * 4, v * 4, 4, seed + 5))
			const n = fbm(u * 9, v * 9, 4, seed)
			return c * where * (10 + n * 16) - 5
		}
		case 'hills': {
			const c = coast(u, v, seed)
			const n = fbm(u * 4, v * 4, 5, seed)
			return c * (10 + (n - 0.5) * 28) - 7
		}
		case 'lakeland': {
			const c = coast(u, v, seed)
			const n = fbm(u * 4, v * 4, 5, seed)
			// Lakes: dips where a second noise runs high, cut below the water line.
			const lake = smoothstep(0.58, 0.7, fbm(u * 6 + 3, v * 6 + 9, 4, seed + 17))
			return c * (9 + (n - 0.5) * 16 - lake * 24) - 6
		}
		case 'highlands': {
			const c = coast(u, v, seed)
			// A plateau with a steep rim: the coast mask squared and stepped makes the cliffs.
			const rim = smoothstep(0.25, 0.6, c)
			const n = fbm(u * 6, v * 6, 4, seed)
			const r = ridged(u * 4, v * 4, 4, seed + 9)
			return rim * (22 + (n - 0.5) * 10 + r * 6) + c * 3 - 8
		}
		case 'mountains': {
			const c = coast(u, v, seed)
			const base = fbm(u * 3, v * 3, 5, seed)
			const r = ridged(u * 2.5, v * 2.5, 6, seed + 7)
			const mask = smoothstep(0.4, 0.75, base)
			return c * (8 + (base - 0.45) * 20 + r * r * 90 * mask) - 6
		}
	}
}

/**
 * Paints a bird's-eye picture of a preset onto a canvas: sea by depth, land from sand through green
 * to rock and snow, lit from the north-west. `px` pixels a side.
 */
export function drawPresetPreview(canvas: HTMLCanvasElement, id: PresetId, seed: number, px = 96) {
	canvas.width = canvas.height = px
	const ctx = canvas.getContext('2d')
	if (!ctx) return
	const img = ctx.createImageData(px, px)
	const h = new Float32Array((px + 1) * (px + 1))
	for (let y = 0; y <= px; y++) for (let x = 0; x <= px; x++) h[y * (px + 1) + x] = presetHeight(id, x / px, y / px, seed)
	const water = presetById(id).water
	for (let y = 0; y < px; y++) {
		for (let x = 0; x < px; x++) {
			const v = h[y * (px + 1) + x]
			let r: number, g: number, b: number
			if (water && v < 0) {
				const d = Math.min(1, -v / 14)
				r = 70 - d * 50
				g = 140 - d * 80
				b = 190 - d * 70
			} else {
				if (v < 1.2) [r, g, b] = [196, 182, 128]
				else if (v < 16) [r, g, b] = [86 + v * 2, 128 + v, 56]
				else if (v < 34) [r, g, b] = [120, 108, 92]
				else [r, g, b] = [230, 232, 236]
				// Shade by the slope towards the light.
				const slope = h[y * (px + 1) + x + 1] - v + (h[(y + 1) * (px + 1) + x] - v)
				const light = Math.min(1.25, Math.max(0.6, 1 - slope * 0.08))
				r *= light
				g *= light
				b *= light
			}
			const i = (y * px + x) * 4
			img.data[i] = r
			img.data[i + 1] = g
			img.data[i + 2] = b
			img.data[i + 3] = 255
		}
	}
	ctx.putImageData(img, 0, 0)
}

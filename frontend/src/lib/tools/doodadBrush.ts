import { parse } from 'smol-toml'
import type { FalloffCurve } from './falloff'
import { brushWeight } from './falloff'

// A doodad brush scatters models over the ground the way the paint brush lays down textures: a brush
// is a named list of models with weights, and each placement draws one model by weight. This module
// holds the brush itself, its text form (TOML, so an author can share and edit brushes by hand) and
// the scatter arithmetic. The tool that drives it is DoodadBrushTool.ts.

/** One model of a brush and how it comes out. */
export interface DoodadEntry {
	/** The model type, "m2:<path>" or "wmo:<path>". */
	type: string
	/** Its share of the placements, relative to the other entries' weights. */
	weight: number
	/** The random scale is drawn between these (1 and 1 for the model's own size). */
	scaleMin: number
	scaleMax: number
	/** Height offset from the ground in yards: negative sinks a stone into the soil. */
	sink: number
	/** Random tilt each way, in degrees (0 stands straight). Align to ground replaces it. */
	tilt: number
	/** How far the model leans with the slope it stands on: 0 upright, 1 square to the ground (#169). Follow ground makes it 1. */
	align: number
}

/**
 * Where a brush may put its models (#169), checked for every placement besides the options bar's
 * Max slope and Avoid water. A brush without rules (`rules` missing) places anywhere.
 */
export interface PlacementRules {
	/** The ground's slope in degrees, at least the first and at most the second. */
	slope: [number, number]
	/** The ground's height in yards, from the first to the second; null for any height. */
	height: [number, number] | null
	/** The height range is above the sea level (`editor.waterLevel`) rather than absolute. */
	aboveSea: boolean
	/** Only where one of these textures (palette paths) weighs at least `textureMin`; empty for any. */
	onTextures: string[]
	/** Never where one of these textures weighs at least `textureMin` (a road). */
	offTextures: string[]
	/** The weight, 0 to 1, at which a texture counts as being there. */
	textureMin: number
	/** Not in a painted liquid or under the sea. */
	avoidWater: boolean
	/** Not on a hole. */
	avoidHoles: boolean
}

export interface DoodadBrush {
	name: string
	/**
	 * Spacing between placements as a multiple of each model's footprint: 1 lets models stand side by
	 * side, 2 leaves a model's width between them, 0.5 lets them overlap.
	 */
	spacing: number
	entries: DoodadEntry[]
	/** Where the brush may place; missing for anywhere. */
	rules?: PlacementRules
}

export const DEFAULT_ENTRY: Omit<DoodadEntry, 'type'> = { weight: 10, scaleMin: 0.9, scaleMax: 1.1, sink: 0, tilt: 0, align: 0 }

export function newBrush(name = 'New brush'): DoodadBrush {
	return { name, spacing: 1, entries: [] }
}

export function newRules(): PlacementRules {
	return { slope: [0, 90], height: null, aboveSea: false, onTextures: [], offTextures: [], textureMin: 0.5, avoidWater: false, avoidHoles: true }
}

/** Whether `r` lets the brush place anywhere, so it needn't be kept or written. */
export function rulesEmpty(r: PlacementRules | undefined): boolean {
	if (!r) return true
	return r.slope[0] <= 0 && r.slope[1] >= 90 && r.height === null && !r.onTextures.length && !r.offTextures.length && !r.avoidWater && !r.avoidHoles
}

/**
 * The ground at one point, as the rules see it. The tool fills one and reuses it, so a check
 * allocates nothing; the slope and the textures are only worked out when a rule asks.
 */
export interface GroundProbe {
	height: number
	/** The sea level, or null for a map without a sea. */
	sea: number | null
	hole: boolean
	/** A painted liquid covers the point. */
	liquid: boolean
	slope(): number
	/** The weight (0 to 1) of the palette texture at `path` at the point; 0 when it isn't there. */
	textureWeight(path: string): number
}

/** Whether the rules let a model stand on the ground `g` describes. */
export function rulesAllow(r: PlacementRules, g: GroundProbe): boolean {
	if (r.avoidHoles && g.hole) return false
	if (r.avoidWater && (g.liquid || (g.sea !== null && g.height < g.sea))) return false
	if (r.height) {
		const h = r.aboveSea ? g.height - (g.sea ?? 0) : g.height
		if (h < r.height[0] || h > r.height[1]) return false
	}
	for (const t of r.offTextures) if (g.textureWeight(t) >= r.textureMin) return false
	if (r.onTextures.length && !r.onTextures.some((t) => g.textureWeight(t) >= r.textureMin)) return false
	if (r.slope[0] > 0 || r.slope[1] < 90) {
		const s = g.slope()
		if (s < r.slope[0] || s > r.slope[1]) return false
	}
	return true
}

/**
 * The spacing check for a fill over a whole area (#169): the models in buckets of `cell` yards, so a
 * placement looks at its neighbours only, not at every model of the map as `fits` does.
 */
export class SpacingGrid {
	private buckets = new Map<number, number[]>()
	/** The widest footprint added, which bounds how far a neighbour can keep a placement away. */
	private widest = 0

	private readonly cell: number

	constructor(cell = 8) {
		this.cell = cell
	}

	private key(ix: number, iz: number) {
		return (ix + 32768) * 65536 + (iz + 32768)
	}

	add(x: number, z: number, size: number) {
		const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))
		let b = this.buckets.get(k)
		if (!b) this.buckets.set(k, (b = []))
		b.push(x, z, size)
		if (size > this.widest) this.widest = size
	}

	/** `fits` against every model added. */
	fits(x: number, z: number, size: number, spacing: number): boolean {
		const reach = ((this.widest + size) / 2) * spacing
		const x0 = Math.floor((x - reach) / this.cell)
		const x1 = Math.floor((x + reach) / this.cell)
		const z0 = Math.floor((z - reach) / this.cell)
		const z1 = Math.floor((z + reach) / this.cell)
		for (let iz = z0; iz <= z1; iz++) {
			for (let ix = x0; ix <= x1; ix++) {
				const b = this.buckets.get(this.key(ix, iz))
				if (!b) continue
				for (let i = 0; i < b.length; i += 3) {
					const dx = b[i] - x
					const dz = b[i + 1] - z
					const min = ((b[i + 2] + size) / 2) * spacing
					if (dx * dx + dz * dz < min * min) return false
				}
			}
		}
		return true
	}
}

/**
 * How many attempts a fill makes over `area` square yards: as many as a held brush of the same
 * strength makes over that area in `FILL_SECONDS`, which the spacing settles into a full cover.
 */
export function fillAttempts(area: number, strength: number): number {
	return Math.min(MAX_FILL_ATTEMPTS, Math.ceil(attemptRate(Math.sqrt(area / Math.PI), strength) * FILL_SECONDS))
}

const FILL_SECONDS = 2
/** Most attempts a fill makes, so a fill over a whole continent block still ends. */
export const MAX_FILL_ATTEMPTS = 400_000

export function newEntry(type: string, weight = DEFAULT_ENTRY.weight): DoodadEntry {
	return { ...DEFAULT_ENTRY, type, weight }
}

/** A name not yet in `taken`: `base`, else `base 2`, `base 3`… */
export function uniqueName(base: string, taken: Iterable<string>): string {
	const set = new Set(taken)
	if (!set.has(base)) return base
	for (let i = 2; ; i++) if (!set.has(`${base} ${i}`)) return `${base} ${i}`
}

export function totalWeight(brush: DoodadBrush): number {
	let t = 0
	for (const e of brush.entries) t += Math.max(0, e.weight)
	return t
}

/** The index of the entry drawn by weight for a uniform random `u` in [0, 1); -1 for a brush with no weight. */
export function pickEntry(brush: DoodadBrush, u: number): number {
	const total = totalWeight(brush)
	if (total <= 0) return -1
	let acc = 0
	const target = u * total
	for (let i = 0; i < brush.entries.length; i++) {
		acc += Math.max(0, brush.entries[i].weight)
		if (target < acc) return i
	}
	return brush.entries.length - 1
}

/**
 * How many placements the brush tries per second: `strength` 1 fills a 10-yard brush with about 60
 * attempts a second, and the count grows with the brush's area so a wide brush fills as densely as a
 * small one. The spacing rejects most attempts once the ground is full, so a held brush settles.
 */
export function attemptRate(radius: number, strength: number): number {
	return Math.max(0, strength) * 60 * (radius / 10) ** 2
}

/** Most attempts one frame makes, so a huge brush can't stall a frame. */
export const MAX_ATTEMPTS = 256

/**
 * A candidate point of one attempt: uniformly random in the brush circle, kept with the probability of
 * the brush weight there, so the falloff band thins out toward the edge as a paint stroke fades.
 * Returns false when the point is dropped. The point is written to `out` as [x, z].
 */
export function candidate(cx: number, cz: number, radius: number, falloff: number, curve: FalloffCurve, rand: () => number, out: Float32Array): boolean {
	const t = Math.sqrt(rand())
	if (rand() >= brushWeight(t, falloff, curve)) return false
	const a = 2 * Math.PI * rand()
	const r = t * radius
	out[0] = cx + r * Math.cos(a)
	out[1] = cz + r * Math.sin(a)
	return true
}

/**
 * Whether a model of footprint `size` (its wider side, scaled) fits at (x, z) with the brush's spacing:
 * no point of `near` (x, z, footprint triples, `count` of them) is closer than half of both footprints
 * times `spacing`.
 */
export function fits(x: number, z: number, size: number, spacing: number, near: Float32Array, count: number): boolean {
	for (let i = 0; i < count; i++) {
		const dx = near[i * 3] - x
		const dz = near[i * 3 + 1] - z
		const min = ((near[i * 3 + 2] + size) / 2) * spacing
		if (dx * dx + dz * dz < min * min) return false
	}
	return true
}

/**
 * `fits` for a placement on a prop: `nearOn` holds x, z, footprint and parent id quadruples, and only
 * the models standing on the same prop (`parent`) keep the placement away.
 */
export function fitsOn(x: number, z: number, size: number, spacing: number, nearOn: Float32Array, count: number, parent: number): boolean {
	for (let i = 0; i < count; i++) {
		if (nearOn[i * 4 + 3] !== parent) continue
		const dx = nearOn[i * 4] - x
		const dz = nearOn[i * 4 + 1] - z
		const min = ((nearOn[i * 4 + 2] + size) / 2) * spacing
		if (dx * dx + dz * dz < min * min) return false
	}
	return true
}

// ---- text form -------------------------------------------------------------------------------------

export const BRUSH_FILE_HEADER = '# Meld doodad brush: the models it scatters and their weights'

/** A TOML string for `s`: literal (single quotes, as client paths have backslashes) unless it holds one. */
export function tomlString(s: string): string {
	if (!s.includes("'") && !/[\n\r]/.test(s)) return `'${s}'`
	return JSON.stringify(s)
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))

/** The brush as TOML: the name and spacing, then a `[[model]]` table per entry. */
export function formatBrush(brush: DoodadBrush): string {
	const lines = [BRUSH_FILE_HEADER, `name = ${tomlString(brush.name)}`, `spacing = ${num(brush.spacing)}`]
	for (const e of brush.entries) {
		lines.push('', '[[model]]', `type = ${tomlString(e.type)}`, `weight = ${num(e.weight)}`, `scale = [${num(e.scaleMin)}, ${num(e.scaleMax)}]`)
		if (e.sink !== 0) lines.push(`sink = ${num(e.sink)}`)
		if (e.tilt !== 0) lines.push(`tilt = ${num(e.tilt)}`)
		if (e.align) lines.push(`align = ${num(e.align)}`)
	}
	const r = brush.rules
	if (r && !rulesEmpty(r)) {
		lines.push('', '[rules]')
		if (r.slope[0] > 0 || r.slope[1] < 90) lines.push(`slope = [${num(r.slope[0])}, ${num(r.slope[1])}]`)
		if (r.height) lines.push(`height = [${num(r.height[0])}, ${num(r.height[1])}]`, `above_sea = ${r.aboveSea}`)
		if (r.onTextures.length) lines.push(`on_textures = [${r.onTextures.map(tomlString).join(', ')}]`)
		if (r.offTextures.length) lines.push(`not_on_textures = [${r.offTextures.map(tomlString).join(', ')}]`)
		if (r.onTextures.length || r.offTextures.length) lines.push(`texture_min = ${num(r.textureMin)}`)
		lines.push(`avoid_water = ${r.avoidWater}`, `avoid_holes = ${r.avoidHoles}`)
	}
	return lines.join('\n') + '\n'
}

/** Reads a `[rules]` table into `brush`, reporting what it can't read. */
function parseRules(t: unknown, brush: DoodadBrush, errors: string[]) {
	if (typeof t !== 'object' || t === null || Array.isArray(t)) return errors.push('rules must be a [rules] table')
	const doc = t as Record<string, unknown>
	const r = newRules()
	const range = (v: unknown, lo: number, hi: number): [number, number] | null => (Array.isArray(v) && v.length === 2 && v.every((x) => finite(x) && x >= lo && x <= hi) ? [Math.min(v[0], v[1]), Math.max(v[0], v[1])] : null)
	if (doc.slope !== undefined) {
		const s = range(doc.slope, 0, 90)
		if (s) r.slope = s
		else errors.push('rules: slope must be [min, max] in degrees, 0 to 90')
	}
	if (doc.height !== undefined) {
		const h = range(doc.height, -Infinity, Infinity)
		if (h) r.height = h
		else errors.push('rules: height must be [min, max] in yards')
	}
	const texList = (key: string): string[] => {
		const v = doc[key]
		if (v === undefined) return []
		if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[]
		errors.push(`rules: ${key} must be a list of texture paths`)
		return []
	}
	r.onTextures = texList('on_textures')
	r.offTextures = texList('not_on_textures')
	if (doc.texture_min !== undefined) {
		if (finite(doc.texture_min) && doc.texture_min >= 0 && doc.texture_min <= 1) r.textureMin = doc.texture_min
		else errors.push('rules: texture_min must be a number from 0 to 1')
	}
	for (const [key, set] of [
		['above_sea', (b: boolean) => (r.aboveSea = b)],
		['avoid_water', (b: boolean) => (r.avoidWater = b)],
		['avoid_holes', (b: boolean) => (r.avoidHoles = b)],
	] as const) {
		const v = doc[key]
		if (v === undefined) continue
		if (typeof v === 'boolean') set(v)
		else errors.push(`rules: ${key} must be true or false`)
	}
	brush.rules = r
}

export interface ParsedBrush {
	brush: DoodadBrush | null
	/** One message per thing that couldn't be read. A brush with a bad entry is still returned without it. */
	errors: string[]
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Reads a brush written by `formatBrush` (or by hand). */
export function parseBrush(text: string): ParsedBrush {
	const errors: string[] = []
	let doc: Record<string, unknown>
	try {
		doc = parse(text)
	} catch (e) {
		return { brush: null, errors: [`not valid TOML: ${e instanceof Error ? e.message : e}`] }
	}
	const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : ''
	if (!name) errors.push('the brush has no name')
	const brush = newBrush(name || 'Imported brush')
	if (doc.spacing !== undefined) {
		if (finite(doc.spacing) && doc.spacing >= 0) brush.spacing = doc.spacing
		else errors.push('spacing must be a number of 0 or more')
	}
	const models = doc.model
	if (models !== undefined && !Array.isArray(models)) {
		errors.push('model must be a list of [[model]] tables')
	} else {
		;(models ?? []).forEach((m, i) => {
			const where = `model ${i + 1}`
			if (typeof m !== 'object' || m === null) return errors.push(`${where}: not a table`)
			const t = m as Record<string, unknown>
			if (typeof t.type !== 'string' || !(t.type.startsWith('m2:') || t.type.startsWith('wmo:'))) {
				return errors.push(`${where}: type must be "m2:<path>" or "wmo:<path>"`)
			}
			const e = newEntry(t.type)
			if (t.weight !== undefined) {
				if (finite(t.weight) && t.weight >= 0) e.weight = t.weight
				else return errors.push(`${where}: weight must be a number of 0 or more`)
			}
			if (t.scale !== undefined) {
				const s = Array.isArray(t.scale) ? t.scale : [t.scale, t.scale]
				if (s.length !== 2 || !s.every((v) => finite(v) && v > 0)) return errors.push(`${where}: scale must be a number or [min, max], above 0`)
				e.scaleMin = Math.min(s[0], s[1])
				e.scaleMax = Math.max(s[0], s[1])
			}
			if (t.sink !== undefined) {
				if (finite(t.sink)) e.sink = t.sink
				else return errors.push(`${where}: sink must be a number`)
			}
			if (t.tilt !== undefined) {
				if (finite(t.tilt) && t.tilt >= 0) e.tilt = t.tilt
				else return errors.push(`${where}: tilt must be a number of degrees, 0 or more`)
			}
			if (t.align !== undefined) {
				if (finite(t.align) && t.align >= 0 && t.align <= 1) e.align = t.align
				else return errors.push(`${where}: align must be a number from 0 to 1`)
			}
			brush.entries.push(e)
		})
	}
	if (doc.rules !== undefined) parseRules(doc.rules, brush, errors)
	return { brush: name || brush.entries.length ? brush : null, errors }
}

/** A plain copy of a brush (the stored one is a reactive proxy), with a new name when given. */
export function cloneBrush(b: DoodadBrush, name?: string): DoodadBrush {
	const r = b.rules
	const copy: DoodadBrush = { name: name ?? b.name, spacing: b.spacing, entries: b.entries.map((e) => ({ ...e, align: e.align ?? 0 })) }
	if (r)
		copy.rules = {
			...r,
			slope: [r.slope[0], r.slope[1]],
			height: r.height ? [r.height[0], r.height[1]] : null,
			onTextures: [...r.onTextures],
			offTextures: [...r.offTextures],
		}
	return copy
}

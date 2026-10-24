// The game's moods (3dgame #142): the look of a place, its sky, fog, light and colour grade, read from
// the repository's crates/gameplay/moods.toml, the same file the client's mood.rs eases between, so
// the editor's viewport wears what the game will. Vite imports the file's text (`?raw`), as it does
// monsters.toml. This is the editor's copy of gameplay::Moods (crates/gameplay/src/moods.rs: surface
// moods, the moods under the ground taking the keys they leave out from the surface mood picked, the
// themes' moods and the day's phases) and of mood.rs's day_mood and sky_light; the particles and the
// mist are the client's alone. Pure data, with no three.js.

import { parse } from 'smol-toml'
import text from '../../../../../crates/gameplay/moods.toml?raw'

type V3 = [number, number, number]
type V4 = [number, number, number, number]
/** A colour grade's section: [saturation, contrast, gamma, gain, lift]. */
type Section = [number, number, number, number, number]

/** One mood, as much of moods.toml's `[[mood]]` as the editor draws; colours are sRGB, 0 to 1. */
export interface Mood {
	zenith: V3
	horizon: V3
	aurora: V4
	stars: number
	cloud: V4
	moon_dir: V3
	moon_size: number
	moon: V4
	fog_density: number
	ambient: V3
	ambient_brightness: number
	light: V3
	light_lux: number
	exposure: number
	temperature: number
	shadows: Section
	midtones: Section
	highlights: Section
	glow: number
	sky: number
	/** The lamps' light (3dgame #178). */
	lamp: V3
	/** How much bright parts glow, Bevy's bloom intensity; 0 for none. */
	bloom: number
}

/** The keys of a mood and how many numbers each holds (1 for a number). */
const KEYS: Record<keyof Mood, number> = {
	zenith: 3,
	horizon: 3,
	aurora: 4,
	stars: 1,
	cloud: 4,
	moon_dir: 3,
	moon_size: 1,
	moon: 4,
	fog_density: 1,
	ambient: 3,
	ambient_brightness: 1,
	light: 3,
	light_lux: 1,
	exposure: 1,
	temperature: 1,
	shadows: 5,
	midtones: 5,
	highlights: 5,
	glow: 1,
	sky: 1,
	lamp: 3,
	bloom: 1,
}
const MOOD_KEYS = Object.keys(KEYS) as (keyof Mood)[]

/** The day and night above ground (moods.toml's `[day]`). */
export interface Day {
	/** [lowest, highest] degrees the sun and the moon stand over the horizon. */
	sun: [number, number]
	moon: [number, number]
	fade: number
	/** The phases in the order of their times, each a surface mood's index. */
	phases: { at: number; mood: number }[]
}

/** The moods of moods.toml. */
export interface Moods {
	/** The surface moods' names, in the file's order. */
	surfaceNames: string[]
	/** Each surface mood. */
	surface: Mood[]
	/** Each theme's key ([themes]) to `'surface'` or a mood's name. */
	themes: Record<string, string>
	/** Each mood's keys as the file gives them, by name. */
	raw: Map<string, Partial<Mood>>
	day: Day
}

/** One key of a mood out of the file's table, or undefined when it is missing or of the wrong shape. */
function readKey(v: unknown, n: number): number | number[] | undefined {
	if (n === 1) return typeof v === 'number' && Number.isFinite(v) ? v : undefined
	if (!Array.isArray(v) || v.length !== n || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return undefined
	return [...(v as number[])]
}

/** Reads moods.toml's text; throws when a surface mood leaves a key out or nothing is a surface mood. */
export function parseMoods(src: string): Moods {
	const doc = parse(src) as Record<string, unknown>
	const list = (Array.isArray(doc.mood) ? doc.mood : []) as Record<string, unknown>[]
	const raw = new Map<string, Partial<Mood>>()
	const surfaceNames: string[] = []
	const surface: Mood[] = []
	for (const m of list) {
		if (typeof m?.name !== 'string') continue
		const mood: Partial<Mood> = {}
		for (const k of MOOD_KEYS) {
			const v = readKey(m[k], KEYS[k])
			if (v !== undefined) (mood as Record<string, unknown>)[k] = v
		}
		raw.set(m.name, mood)
		if (m.surface === true) {
			const missing = MOOD_KEYS.filter((k) => mood[k] === undefined)
			if (missing.length) throw new Error(`moods.toml: the surface mood ${m.name} has no ${missing.join(', ')}`)
			surfaceNames.push(m.name)
			surface.push(mood as Mood)
		}
	}
	if (!surface.length) throw new Error('moods.toml: no surface mood')
	const themes: Record<string, string> = {}
	if (doc.themes && typeof doc.themes === 'object') for (const [k, v] of Object.entries(doc.themes)) if (typeof v === 'string') themes[k] = v
	const d = (doc.day ?? {}) as Record<string, unknown>
	const pair = (v: unknown, or: [number, number]) => (readKey(v, 2) as [number, number] | undefined) ?? or
	const phases: Day['phases'] = []
	for (const p of (Array.isArray(d.phases) ? d.phases : []) as Record<string, unknown>[]) {
		const i = surfaceNames.indexOf(String(p?.mood))
		if (typeof p?.at === 'number' && i >= 0) phases.push({ at: p.at, mood: i })
	}
	const day: Day = { sun: pair(d.sun, [8, 50]), moon: pair(d.moon, [8, 30]), fade: typeof d.fade === 'number' ? d.fade : 0, phases }
	return { surfaceNames, surface, themes, raw, day }
}

/** The game's moods. */
export const MOODS: Moods = parseMoods(text)

/** A copy of `m`, its arrays new. */
export function cloneMood(m: Mood): Mood {
	const out = {} as Record<string, unknown>
	for (const k of MOOD_KEYS) {
		const v = m[k]
		out[k] = Array.isArray(v) ? [...v] : v
	}
	return out as unknown as Mood
}

/** Eases `out` `t` of the way towards `b`, in place (mood.rs ease_mood). */
export function easeMood(out: Mood, b: Mood, t: number): Mood {
	const o = out as unknown as Record<string, number | number[]>
	const r = b as unknown as Record<string, number | number[]>
	for (const k of MOOD_KEYS) {
		const a = o[k]
		const v = r[k]
		if (Array.isArray(a)) for (let i = 0; i < a.length; i++) a[i] += ((v as number[])[i] - a[i]) * t
		else o[k] = a + ((v as number) - a) * t
	}
	return out
}

/** Writes the keys `own` gives over `out`. */
function overlay(out: Mood, own: Partial<Mood>) {
	const o = out as unknown as Record<string, number | number[]>
	for (const k of MOOD_KEYS) {
		const v = own[k] as number | number[] | undefined
		if (v === undefined) continue
		if (Array.isArray(v)) for (let i = 0; i < v.length; i++) (o[k] as number[])[i] = v[i]
		else o[k] = v
	}
}

/** Writes into `out` the mood of the theme `theme` (a [themes] key) with surface mood `pick` picked: the surface mood, or the theme's own over it. */
export function themeMood(moods: Moods, theme: string, pick: number, out: Mood): Mood {
	const base = moods.surface[pick] ?? moods.surface[0]
	easeMood(out, base, 1)
	const name = moods.themes[theme]
	if (!name || name === 'surface') return out
	const own = moods.raw.get(name)
	if (own) overlay(out, own)
	return out
}

/** Every mood's name, in the file's order: the ones a mood region (3dgame #143) may name. */
export function moodNames(moods: Moods): string[] {
	return [...moods.raw.keys()]
}

/**
 * Writes into `out` the mood named `name` with surface mood `pick` picked (Moods::named): a surface
 * mood whole, any other over the surface mood picked. False, and `out` unchanged, when there is none.
 */
export function namedMood(moods: Moods, name: string, pick: number, out: Mood): boolean {
	const own = moods.raw.get(name)
	if (!own) return false
	easeMood(out, moods.surface[pick] ?? moods.surface[0], 1)
	overlay(out, own)
	return true
}

/** A colour to draw a mood region of `name` in (sRGB, 0 to 1): its ambient light's, else its horizon's or its light's; grey for a mood the file has not got. */
export function regionColour(moods: Moods, name: string): [number, number, number] {
	const m = moods.raw.get(name)
	return [...(m?.ambient ?? m?.horizon ?? m?.light ?? [0.6, 0.6, 0.6])] as [number, number, number]
}

/** Whether the theme with key `theme` takes the surface mood. */
export function themeIsSurface(moods: Moods, theme: string): boolean {
	return moods.themes[theme] === 'surface'
}

const smoothstep01 = (x: number) => x * x * (3 - 2 * x)

/** The surface moods eased between at time of day `time` (0 to 1): from, to and how far (Moods::day_phase), or null without a day. */
export function dayPhase(moods: Moods, time: number): [number, number, number] | null {
	const ph = moods.day.phases
	const n = ph.length
	if (!n) return null
	time = ((time % 1) + 1) % 1
	let i = n - 1
	while (i > 0 && ph[i].at > time) i--
	if (ph[i].at > time) i = n - 1
	const j = (i + 1) % n
	const wrap = (x: number) => ((x % 1) + 1) % 1
	let span = wrap(ph[j].at - ph[i].at)
	if (!(span > 0)) span = 1
	const w = Math.min(1, Math.max(0, wrap(time - ph[i].at) / span))
	return [ph[i].mood, ph[j].mood, smoothstep01(w)]
}

/**
 * Where the day's sun or moon stands at time of day `time` (mood.rs sky_light): writes the direction
 * towards it into `dir` and returns how much of its light shows, 0 to 1. The sun by day (0.25 to
 * 0.75), the moon by night, each rising in the east (+x), crossing the northern sky (-z) and setting
 * in the west.
 */
export function skyLight(day: Day, time: number, dir: V3): number {
	time = ((time % 1) + 1) % 1
	const byDay = time >= 0.25 && time < 0.75
	const across = byDay ? (time - 0.25) / 0.5 : (((time + 0.25) % 1) + 1) % 1 / 0.5
	const [lo, hi] = (byDay ? day.sun : day.moon).map((d) => (d * Math.PI) / 180)
	const up = lo + (hi - lo) * Math.sin(Math.PI * across)
	const round = Math.PI * across
	dir[0] = Math.cos(round) * Math.cos(up)
	dir[1] = Math.sin(up)
	dir[2] = -Math.sin(round) * Math.cos(up)
	if (!(day.fade > 0)) return 1
	const ease = (x: number) => smoothstep01(Math.min(1, Math.max(0, x / day.fade)))
	return ease(across) * ease(1 - across)
}

/**
 * Writes into `out` the surface mood at time of day `time` (mood.rs day_mood), its light from the
 * day's sun or moon; false without a day. With `over`, a mood that is not a surface mood (a mood
 * region's, 3dgame #143), that mood's keys over the hour's.
 */
export function dayMood(moods: Moods, time: number, out: Mood, over?: Partial<Mood>): boolean {
	const p = dayPhase(moods, time)
	if (!p) return false
	easeMood(out, moods.surface[p[0]], 1)
	easeMood(out, moods.surface[p[1]], p[2])
	if (over) overlay(out, over)
	const shown = skyLight(moods.day, time, out.moon_dir)
	out.light_lux *= shown
	for (let i = 0; i < 4; i++) out.moon[i] *= shown
	return true
}

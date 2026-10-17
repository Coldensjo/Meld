// The client's weather laws for Lighting › Weather Preview (#185), as Benilla's weather/precip ports
// them (MIT/Apache): a grade's effect density and storm blend, the boxes the drops fill around the eye
// and how many fill them. Kept free of three.js so it can be tested on its own; world/WeatherLayer.ts
// draws them.

export type WeatherKind = 'clear' | 'rain' | 'snow' | 'sand'
export type WeatherGrade = 'light' | 'medium' | 'heavy'

/**
 * The grade the server sends for each (VMaNGOS `Weather::SetWeather` calls below 0.40 light and below
 * 0.70 medium; below 0.27 it is fine): the middle of each band.
 */
export const WEATHER_GRADE: Record<WeatherGrade, number> = { light: 0.3, medium: 0.55, heavy: 0.85 }

/** How thick the drops fall at a grade: nothing below a quarter, then up to 1 (the client's `0x67be40`). */
export function effectDensity(grade: number): number {
	return Math.max(0, ((grade - 0.25) * 4) / 3)
}

/**
 * How far the storm light is blended over the clear one: the sky density (the grade, clamped to a
 * quarter) times four, so any weather from a quarter up is the full storm light (`0x6d4500`).
 */
export function stormBlend(kind: WeatherKind, grade: number): number {
	return kind === 'clear' ? 0 : Math.min(1, Math.min(grade, 0.25) * 4)
}

/** The boxes (yards: across, tall, deep) the drops fill around the eye: the client's spawn boxes and slabs. */
export const RAIN_BOX = [130, 75, 130] as const
export const SNOW_BOX = [90, 60, 90] as const
export const MIST_BOX = [44, 25, 44] as const
/** The drop populations (the shader leg's rain 35000 and snow 14000 a second at full density, at 30 fps). */
const RAIN_RATE = 35000 * 0.5
const SNOW_RATE = 14000 * 0.5
/** Mist puffs a second at full density, and how long one lives. */
const MIST_RATE = { rain: 38, snow: 48, sand: 38 }
const MIST_LIFE = 2.7
export const MAX_RAIN = 32768
export const MAX_SNOW = 65536
export const MAX_MIST = 128

/**
 * How many drops and mist puffs fill the boxes at `density`: the client's spawn rate times the time a
 * drop takes to fall through its box (or a puff lives). Rain and snow mist only past half density;
 * a sandstorm is all mist, without that knee.
 */
export function weatherCounts(kind: WeatherKind, density: number): { drops: number; mist: number } {
	if (kind === 'clear' || density <= 0) return { drops: 0, mist: 0 }
	if (kind === 'sand') return { drops: 0, mist: Math.min(MAX_MIST, Math.round(density * MIST_RATE.sand * MIST_LIFE)) }
	const mist = Math.min(MAX_MIST, Math.round(2 * Math.max(0, density - 0.5) * MIST_RATE[kind] * MIST_LIFE))
	if (kind === 'rain') return { drops: Math.min(MAX_RAIN, Math.round((RAIN_RATE * density * RAIN_BOX[1]) / (28 + 5 * density))), mist }
	return { drops: Math.min(MAX_SNOW, Math.round((SNOW_RATE * density * SNOW_BOX[1]) / (2 + 4 * density))), mist }
}

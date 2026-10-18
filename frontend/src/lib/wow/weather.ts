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

// The rain's ground splashes (#244), the client's patters: one where each drop lands, living 0.25 s
// (`0x675280`). The wrapped box has no landing, so the splashes are their own field: a square around
// the eye, as wide as SPLASH_FIELD, filled at the rate the box's drops land on that much ground.
// Farther splashes are a pixel or two tall, so the field stops short of the box's 130 yd.
export const SPLASH_LIFE = 0.25
export const SPLASH_FIELD = 64
export const MAX_SPLASH = 2048

/** Splashes a second in the field at `density`: rain's spawn rate over the box's ground, times the field's. */
export function splashRate(kind: WeatherKind, density: number): number {
	if (kind !== 'rain' || density <= 0) return 0
	return (RAIN_RATE * density * SPLASH_FIELD * SPLASH_FIELD) / (RAIN_BOX[0] * RAIN_BOX[2])
}

// The weather's wind (#244), the client's `0x67c150` as Benilla's `wind.rs` ports it: the viewer's
// own planar velocity averaged over 149 ms, so the weather blows past a moving camera. It leads the
// drops' box by 1.75 x itself (`0x8680f8`) and tips the streaks' tails into it, up to 45 degrees at
// 30 yd/s (`0x674a70`). The client also tilts its spawn slab with the run (up to 65 degrees at 18
// yd/s) so that a runner still meets drops head-on; the wrapped box is full everywhere, so a moving
// camera meets them anyway and there is no slab to tilt. The mist's yaw by the wind's heading is left
// out too: it turns each new puff, and the wrapped puffs have no birth to turn at.
export const WIND_LEAD = 1.75
const WIND_WINDOW = 0.149
const WIND_SLOTS = 64
const TILT_SPEED = 30
const TILT_MAX = (45 * Math.PI) / 180
/** How far a box may be led, as a share of its width: the eye stays well inside its unfaded core. */
const LEAD_SHARE = 0.3

/** The streaks' tail tilt (radians) at a wind of `speed` yd/s. */
export function streakTilt(speed: number): number {
	return speed * speed < 0.001 ? 0 : Math.min(1, speed / TILT_SPEED) * TILT_MAX
}

/** The viewer's planar velocity, averaged over the client's 149 ms window; no allocation per update. */
export class WeatherWind {
	/** The averaged velocity, yd/s, in the editor's X and Z. */
	vx = 0
	vz = 0
	private dts = new Float64Array(WIND_SLOTS)
	private dxs = new Float64Array(WIND_SLOTS)
	private dzs = new Float64Array(WIND_SLOTS)
	private head = 0
	private count = 0
	private lastX = 0
	private lastZ = 0
	private started = false

	get speed(): number {
		return Math.hypot(this.vx, this.vz)
	}

	/** Forgets the motion, as after a jump: the next update starts the window afresh. */
	reset() {
		this.count = 0
		this.started = false
		this.vx = this.vz = 0
	}

	/** Takes the viewer at (`x`, `z`) after `dt` seconds. */
	update(x: number, z: number, dt: number) {
		if (dt <= 0) return
		let dx = 0
		let dz = 0
		if (this.started) {
			dx = x - this.lastX
			dz = z - this.lastZ
			// A jump (a teleport, a scene loaded) is not wind: the window starts again.
			const jump = Math.max(100 * dt, 10)
			if (dx * dx + dz * dz > jump * jump) {
				this.count = 0
				dx = dz = 0
			}
		}
		this.started = true
		this.lastX = x
		this.lastZ = z
		const n = WIND_SLOTS
		this.dts[this.head] = dt
		this.dxs[this.head] = dx
		this.dzs[this.head] = dz
		this.head = (this.head + 1) % n
		this.count = Math.min(n, this.count + 1)
		// The oldest entries go while the rest still span the window.
		let total = 0
		for (let i = 0; i < this.count; i++) total += this.dts[(this.head - 1 - i + n) % n]
		while (this.count > 1) {
			const oldest = this.dts[(this.head - this.count + n) % n]
			if (total - oldest < WIND_WINDOW) break
			total -= oldest
			this.count--
		}
		let sx = 0
		let sz = 0
		for (let i = 0; i < this.count; i++) {
			const k = (this.head - 1 - i + n) % n
			sx += this.dxs[k]
			sz += this.dzs[k]
		}
		// The client's Σ(Δpos) / ((Σ(Δms) + 1) · 0.001), its extra millisecond included.
		const s = (total * 1000 + 1) * 0.001
		this.vx = sx / s
		this.vz = sz / s
	}

	/**
	 * How far a box `width` yd across is led ahead of the eye (x and z into `out`): 1.75 x the wind, held
	 * to LEAD_SHARE of the width, since Meld's camera flies far faster than the client's player runs
	 * and an unheld lead would leave the eye outside its own weather.
	 */
	lead(width: number, out: { x: number; z: number }): { x: number; z: number } {
		let x = this.vx * WIND_LEAD
		let z = this.vz * WIND_LEAD
		const d = Math.hypot(x, z)
		const max = width * LEAD_SHARE
		if (d > max) {
			x *= max / d
			z *= max / d
		}
		out.x = x
		out.z = z
		return out
	}
}

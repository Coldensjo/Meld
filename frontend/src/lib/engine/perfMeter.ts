// View › Performance overlay (#179): where a frame's time goes. `Engine.frame()` calls `mark` after
// each subsystem, which books the time since the previous mark to that subsystem, so the sections
// add up to the frame's CPU time without nesting. Everything is summed into preallocated arrays and
// read out once a second (`take`), so the meter allocates nothing per frame, and with `on` false a
// mark is one branch.

/** The CPU sections, in the order `Engine.frame()` runs them. */
export const CPU_SECTIONS = [
	'Camera and sky',
	'Shadow fit',
	'Picking',
	'Tool',
	'Cubes',
	'Render (CPU)',
	'Shadow maps (CPU)',
] as const

export type CpuSection = (typeof CPU_SECTIONS)[number]

/** A section's index, for `mark`: looked up once, so the frame passes numbers. */
export const SECTION = Object.fromEntries(CPU_SECTIONS.map((n, i) => [n, i])) as Record<CpuSection, number>

export interface PerfWindow {
	/** Frames drawn in the window, and per second. */
	frames: number
	fps: number
	/** The average and the longest time from one frame's start to the next, in ms. */
	frameMs: number
	worstMs: number
	/** The average CPU time of `frame()` in ms, and of each section, in `CPU_SECTIONS` order. */
	cpuMs: number
	sections: number[]
}

export class PerfMeter {
	/** Off, every call returns at once. */
	on = false
	private readonly acc = new Float64Array(CPU_SECTIONS.length)
	private last = 0
	private prevStart = -1
	private frames = 0
	private intervals = 0
	private intervalSum = 0
	private worst = 0
	private windowStart = -1

	/** The start of a frame. */
	begin(now = performance.now()) {
		if (!this.on) return
		if (this.windowStart < 0) this.windowStart = now
		if (this.prevStart >= 0) {
			const d = now - this.prevStart
			this.intervalSum += d
			this.intervals++
			if (d > this.worst) this.worst = d
		}
		this.prevStart = now
		this.last = now
	}

	/** Books the time since the last mark (or the frame's start) to `section`. */
	mark(section: number, now = performance.now()) {
		if (!this.on) return
		this.acc[section] += now - this.last
		this.last = now
	}

	/** The end of a frame: true once a second has gone by since the window opened, time to `take`. */
	end(now = performance.now()): boolean {
		if (!this.on) return false
		this.frames++
		return now - this.windowStart >= 1000
	}

	/** The window's averages, and a new window from `now`. */
	take(now = performance.now()): PerfWindow {
		const n = Math.max(1, this.frames)
		const sections = Array.from(this.acc, (v) => v / n)
		const span = now - this.windowStart
		const w: PerfWindow = {
			frames: this.frames,
			fps: span > 0 ? (this.frames * 1000) / span : 0,
			frameMs: this.intervals ? this.intervalSum / this.intervals : 0,
			worstMs: this.worst,
			cpuMs: sections.reduce((a, b) => a + b, 0),
			sections,
		}
		this.acc.fill(0)
		this.frames = this.intervals = this.intervalSum = this.worst = 0
		this.windowStart = now
		return w
	}

	/** Turns the meter on or off; a new window starts with the next frame. */
	setOn(on: boolean) {
		if (on === this.on) return
		this.on = on
		this.acc.fill(0)
		this.frames = this.intervals = this.intervalSum = this.worst = 0
		this.prevStart = this.windowStart = -1
	}
}

/** The everything-in-one report Help › Copy Performance Report puts on the clipboard. */
export interface PerfReport extends PerfWindow {
	/** GPU ms per pass (`GPU_PASSES` order), or null where the browser has no timer queries. */
	gpu: number[] | null
	calls: number
	triangles: number
	geometries: number
	textures: number
	programs: number
	/** The JS heap in MB, where the browser tells it (Chromium). */
	heapMB: number | null
}

export const GPU_PASSES = ['Shadow maps', 'Scene'] as const

/** The report as plain text, a line a number, for pasting into an issue. */
export function formatReport(r: PerfReport): string {
	const ms = (v: number) => v.toFixed(2)
	const lines = [
		`Meld performance, averaged over ${r.frames} frames`,
		`Frame ${ms(r.frameMs)} ms (worst ${ms(r.worstMs)} ms), ${r.fps.toFixed(1)} FPS`,
		`CPU ${ms(r.cpuMs)} ms:`,
		...CPU_SECTIONS.map((name, i) => `  ${name}: ${ms(r.sections[i])} ms`),
	]
	if (r.gpu) lines.push(`GPU ${ms(r.gpu.reduce((a, b) => a + b, 0))} ms:`, ...GPU_PASSES.map((name, i) => `  ${name}: ${ms(r.gpu![i])} ms`))
	else lines.push('GPU: n/a (no timer queries in this browser)')
	lines.push(
		`Draw calls ${r.calls}, triangles ${r.triangles}`,
		`Geometries ${r.geometries}, textures ${r.textures}, shader programs ${r.programs}`,
		`JS heap ${r.heapMB === null ? 'n/a' : `${r.heapMB.toFixed(0)} MB`}`,
	)
	return lines.join('\n')
}

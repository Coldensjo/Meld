import { GPU_PASSES } from './perfMeter'

// The GPU side of the performance overlay (#179): WebGL2 timer queries (EXT_disjoint_timer_query_webgl2)
// around the frame's passes. Only one query can run at a time, so `begin` ends the running one: the
// Engine begins Scene before its render, the shadow map hook switches to Shadow maps and back, and
// Outlines runs last. Results come a few frames late and are read by `poll`; a frame the driver
// marks disjoint (a context switch, a clock change) is dropped. Browsers without the extension
// (WebKitGTK, often) have `supported` false and the overlay shows n/a.

interface TimerExt {
	TIME_ELAPSED_EXT: number
	GPU_DISJOINT_EXT: number
}

export class GpuTimer {
	readonly supported: boolean
	private readonly ext: TimerExt | null
	private readonly free: WebGLQuery[] = []
	/** The queries ended and not yet read, oldest first, with their pass and whether a frame ended with it. */
	private readonly pending: WebGLQuery[] = []
	private readonly pendingPass: number[] = []
	private readonly pendingLast: boolean[] = []
	private current: WebGLQuery | null = null
	private currentPass = 0
	private readonly acc = new Float64Array(GPU_PASSES.length)
	private frames = 0

	constructor(private readonly gl: WebGL2RenderingContext | WebGLRenderingContext) {
		const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
		this.ext = webgl2 ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null) : null
		this.supported = !!this.ext
	}

	/** Whether a pass is being timed, so the shadow hook knows to switch passes. */
	get active() {
		return this.current !== null
	}

	/** The pass being timed, to go back to after a nested one. */
	get pass() {
		return this.currentPass
	}

	/** Starts timing `pass` (a `GPU_PASSES` index), ending the pass that was running. */
	begin(pass: number) {
		if (!this.ext) return
		this.stop(false)
		const gl = this.gl as WebGL2RenderingContext
		const q = this.free.pop() ?? gl.createQuery()
		if (!q) return
		gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
		this.current = q
		this.currentPass = pass
	}

	/** Ends the frame's last pass. */
	endFrame() {
		this.stop(true)
	}

	private stop(last: boolean) {
		if (!this.ext || !this.current) return
		;(this.gl as WebGL2RenderingContext).endQuery(this.ext.TIME_ELAPSED_EXT)
		this.pending.push(this.current)
		this.pendingPass.push(this.currentPass)
		this.pendingLast.push(last)
		this.current = null
	}

	/** Reads the queries whose results have come in. Call it outside a pass. */
	poll() {
		if (!this.ext || !this.pending.length) return
		const gl = this.gl as WebGL2RenderingContext
		const disjoint = !!gl.getParameter(this.ext.GPU_DISJOINT_EXT)
		while (this.pending.length) {
			const q = this.pending[0]
			if (!disjoint && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
			if (!disjoint) {
				this.acc[this.pendingPass[0]] += (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6
				if (this.pendingLast[0]) this.frames++
			}
			this.pending.shift()
			this.pendingPass.shift()
			this.pendingLast.shift()
			this.free.push(q)
		}
	}

	/** The average ms per pass over the frames read since the last take, or null if there are none. */
	take(): number[] | null {
		if (!this.supported || !this.frames) return null
		const out = Array.from(this.acc, (v) => v / this.frames)
		this.acc.fill(0)
		this.frames = 0
		return out
	}

	dispose() {
		if (!this.ext) return
		const gl = this.gl as WebGL2RenderingContext
		if (this.current) gl.endQuery(this.ext.TIME_ELAPSED_EXT)
		for (const q of [...this.free, ...this.pending]) gl.deleteQuery(q)
		if (this.current) gl.deleteQuery(this.current)
		this.free.length = this.pending.length = this.pendingPass.length = this.pendingLast.length = 0
		this.current = null
	}
}

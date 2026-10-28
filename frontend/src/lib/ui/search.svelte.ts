// A search box's debounced lookup (#594), shared by the editors' and tabs' find fields: a component's
// `$effect` reads what the search depends on and calls `set`, which waits `delay` ms after the last
// call before running it. Only the latest call's answer (or error) is kept, so a slow reply to an
// older query never overwrites a newer one.

export interface SearchOptions<R> {
	/** The results before any search, and after `set(null)`. */
	empty: R
	/** Milliseconds to wait after the last `set` (default 250). */
	delay?: number
	/** Called with the latest search's error, besides `error` (a panel's own error line). */
	onError?: (err: unknown) => void
}

export class Search<K, R> {
	results: R
	searching = $state(false)
	error = $state('')
	private readonly run: (key: K) => Promise<R>
	private readonly opts: SearchOptions<R>
	private timer: ReturnType<typeof setTimeout> | undefined
	private asking = 0

	constructor(run: (key: K) => Promise<R>, opts: SearchOptions<R>) {
		this.run = run
		this.opts = opts
		this.results = $state(opts.empty)
	}

	/** Searches for `key` after the delay (`delay` overrides it, 0 for a local list); null clears the results now. */
	set(key: K | null, delay = this.opts.delay ?? 250) {
		clearTimeout(this.timer)
		const ask = ++this.asking
		if (key === null) {
			this.results = this.opts.empty
			this.searching = false
			return
		}
		this.timer = setTimeout(async () => {
			this.searching = true
			try {
				const r = await this.run(key)
				if (ask !== this.asking) return
				this.results = r
				this.error = ''
			} catch (err) {
				if (ask !== this.asking) return
				this.error = String(err)
				this.opts.onError?.(err)
			} finally {
				if (ask === this.asking) this.searching = false
			}
		}, delay)
	}
}

/** A debounced search running `run` for each key `set` is given. */
export function createSearch<K, R>(run: (key: K) => Promise<R>, opts: SearchOptions<R>): Search<K, R> {
	return new Search(run, opts)
}

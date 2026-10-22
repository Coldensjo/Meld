/** How long a client file that failed to load waits before the next ask tries it again. */
export const RETRY_MS = 30000

/**
 * Values read from the client once per key (#515: a WMO's room data, a model's collision faces).
 * `get` gives the value, or null while it loads and after it failed. A failure (the server's error
 * or the decoder's) is warned in the console with the key, counted in `failed` and handed to
 * `onFail`, and the first ask after RETRY_MS loads it again, so it neither passes silently nor
 * sticks for the session.
 */
export class LoadCache<T> {
	/** Counts the loads that ended, either way, so a caller can tell when to look again. */
	settled = 0
	/** The loads under way. */
	loading = 0
	/** Called with the load's `arg` (the path) and the error when a load fails. */
	onFail: ((key: string, err: unknown) => void) | null = null
	/** Called when a load ends, either way, after the value is stored. */
	onSettle: (() => void) | null = null
	private values = new Map<string, T | null>()
	private failedAt = new Map<string, number>()

	/** `what` names the data in the console's warning; `load` reads it from the `arg` of `get`. */
	constructor(
		private what: string,
		private load: (arg: string) => Promise<T>,
		private now: () => number = () => performance.now(),
	) {}

	/** The keys whose last load failed (and that were not forgotten since). */
	get failed(): number {
		return this.failedAt.size
	}

	/** The value at `key`, or null while it loads or failed; starts its load (from `arg`) on the first ask. */
	get(key: string, arg: string = key): T | null {
		const v = this.values.get(key)
		if (v !== undefined) return v
		const t = this.failedAt.get(key)
		if (t !== undefined && this.now() - t < RETRY_MS) return null
		this.values.set(key, null)
		this.loading++
		this.load(arg)
			.then(
				(value) => {
					// Forgotten while it loaded: dropped rather than kept for nothing (#505).
					if (this.values.has(key)) this.values.set(key, value)
					this.failedAt.delete(key)
				},
				(err) => {
					console.warn(`${this.what} failed`, arg, err)
					if (!this.values.has(key)) return
					this.values.delete(key)
					this.failedAt.set(key, this.now())
					this.onFail?.(arg, err)
				},
			)
			.finally(() => {
				this.loading--
				this.settled++
				this.onSettle?.()
			})
		return null
	}

	/** Forgets the value at `key`, and any failure there. */
	forget(key: string) {
		this.values.delete(key)
		this.failedAt.delete(key)
	}
}

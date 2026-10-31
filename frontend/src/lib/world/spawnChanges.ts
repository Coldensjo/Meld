/**
 * Which spawns differ from their saved state, kept up to date by comparing only the spawns marked
 * since the last count, so counting the edits mid-drag does not stringify every edited spawn.
 */
export class SpawnChanges<S> {
	/** Keys that differed (or were added) at the last `settle`. */
	private changed = new Set<string>()
	/** Keys marked since: the ones to compare again. */
	private marked = new Set<string>()

	/** `key` may have changed (touched, refreshed, rebased, added or removed). */
	mark(key: string) {
		this.marked.add(key)
	}

	clear() {
		this.changed.clear()
		this.marked.clear()
	}

	/** Forgets `key`: its edit was saved on its own (#960). */
	forget(key: string) {
		this.changed.delete(key)
		this.marked.delete(key)
	}

	/** Compares the marked spawns with their originals; `created` spawns always count. */
	settle(spawn: (key: string) => S | undefined, original: (key: string) => S | undefined, created: (key: string) => boolean) {
		for (const key of this.marked) {
			const s = spawn(key)
			const o = original(key)
			if (s && o && (created(key) || JSON.stringify(s) !== JSON.stringify(o))) this.changed.add(key)
			else this.changed.delete(key)
		}
		this.marked.clear()
	}

	has(key: string) {
		return this.changed.has(key)
	}

	get size() {
		return this.changed.size
	}
}

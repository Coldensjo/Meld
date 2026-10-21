/**
 * What a cached result (a brush's plan, a paste's landings) was built from, compared value by value
 * instead of joined into a string key, which allocated a string every frame (#452). Each frame:
 * `begin()`, `add` every input in the same order, then `changed()`. Nothing is allocated once the
 * list has grown to its length.
 */
export class InputsKey {
	private vals: (string | number | boolean | object | null)[] = []
	private n = 0
	private diff = false

	begin(): this {
		this.n = 0
		this.diff = false
		return this
	}

	add(v: string | number | boolean | object | null): this {
		if (this.n >= this.vals.length) {
			this.vals.push(v)
			this.diff = true
		} else if (this.vals[this.n] !== v) {
			this.vals[this.n] = v
			this.diff = true
		}
		this.n++
		return this
	}

	/** Whether an input differs from the last `begin()`..`changed()`; the new inputs are kept either way. */
	changed(): boolean {
		if (this.n !== this.vals.length) {
			this.vals.length = this.n
			this.diff = true
		}
		return this.diff
	}

	/** Forgets the inputs, so the next `changed()` is true. */
	reset() {
		this.vals.length = 0
	}
}

/** Where a DocOverlay reads from and draws to. */
export interface OverlaySource<D extends { readonly id: number }, T> {
	/** What it reads, for the console's warning when a read fails ("area triggers"). */
	readonly what: string
	/** The active document, which a read that comes back late must still be. */
	current(): D
	/** Starts the read of `doc`'s data, or returns null when it can't start yet (the map's ID not known): tried again next frame. */
	load(doc: D): Promise<T> | null
	/** Draws what was read for `doc`, the active document; null after a failed read, which draws nothing. */
	apply(doc: D, data: T | null): void
	/** Tells the user a read failed (the status line), after the console's warning; the read is tried again only after `reset`. */
	failed?(err: unknown): void
}

/**
 * Something the client holds for the open map, drawn over it (the area triggers, the flight paths):
 * read once per document while it is shown, unless a window draws its own edited copy (`edited`).
 * `update` runs every frame; the callbacks are the source's, so a frame allocates nothing.
 */
export class DocOverlay<D extends { readonly id: number }, T> {
	/** The document the data was read for, -1 for none. */
	private readFor = -1
	private loading = false
	/** Set while a window draws its own (edited) copy: no read starts, and a late one is dropped. */
	edited = false

	constructor(private source: OverlaySource<D, T>) {}

	/** Forgets the read, so the next `update` reads the open map's again (it may have been saved). */
	reset() {
		this.readFor = -1
	}

	/** Reads the active document's data when shown (`on`) and not read yet, nor being read, nor edited. */
	update(on: boolean) {
		const s = this.source
		const doc = s.current()
		if (!on || this.edited || this.loading || this.readFor === doc.id) return
		const read = s.load(doc)
		if (!read) return
		this.loading = true
		read.then((data) => {
			if (doc === s.current() && !this.edited) s.apply(doc, data)
		})
			.catch((err) => {
				console.warn(`${s.what} not read`, err)
				s.failed?.(err)
				if (doc === s.current() && !this.edited) s.apply(doc, null)
			})
			.finally(() => {
				this.loading = false
				this.readFor = doc.id
			})
	}
}

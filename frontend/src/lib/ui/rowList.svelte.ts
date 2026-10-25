import { startSaving } from '../state/saving'

// The rows of a database editor's list tab (#577): the Spells, Shop, Quests and Messages tabs of the
// creature editor, the Contents and Quests tabs of the game object editor and the quest editor's
// Givers tab. Each edits a copy of some world database rows and tells an edit by comparing a key of
// them (the fields that count, as one string) with the key as last read or saved. The world database
// keeps no undo, so these are not History edits: Revert reads the rows again.

export interface RowListOptions<T> {
	/** The rows before the first read. */
	empty: T
	/** Reads the rows from the database; a list fed by `set` needs none. */
	read?: () => Promise<T>
	/** The fields that count as an edit, as one string (default: all of them, as JSON). */
	key?: (rows: T) => string
}

export class RowList<T> {
	/** The rows being edited. */
	rows = $state() as T
	loading = $state(false)
	saving = $state(false)
	error = $state('')
	/** The key of the rows as last read or saved. */
	saved = $state('')
	/** What `follow` last read the rows for. */
	followed: unknown = undefined

	readonly key: (rows: T) => string
	readonly #read?: () => Promise<T>
	/** Counts the reads, so a slow read that a later one overtook is dropped. */
	#token = 0

	constructor(o: RowListOptions<T>) {
		this.key = o.key ?? ((r) => JSON.stringify(r))
		this.#read = o.read
		this.rows = o.empty
		this.saved = this.key(o.empty)
	}

	/** Whether the rows differ from the ones last read or saved. */
	get dirty(): boolean {
		return this.key(this.rows) !== this.saved
	}

	/** Puts `rows` in as the saved ones. */
	set(rows: T) {
		this.#token++
		this.rows = rows
		this.markSaved()
	}

	/** The rows as they are now are the saved ones. */
	markSaved() {
		this.saved = this.key(this.rows)
	}

	/** Reads the rows again; false when the read failed or a later one overtook it. */
	async load(): Promise<boolean> {
		if (!this.#read) return false
		const mine = ++this.#token
		this.loading = true
		this.error = ''
		try {
			const rows = await this.#read()
			if (mine !== this.#token) return false
			this.rows = rows
			this.markSaved()
			return true
		} catch (err) {
			if (mine === this.#token) this.error = String(err)
			return false
		} finally {
			if (mine === this.#token) this.loading = false
		}
	}

	/** Drops the unsaved edits (the tab's Revert, the editor's Discard). */
	revert(): Promise<boolean> {
		return this.load()
	}

	/** Reads the rows whenever `id` (the creature, object or quest) changes. Call it while the component starts. */
	follow(id: () => unknown) {
		$effect(() => {
			const k = id()
			if (k === this.followed) return
			this.followed = k
			void this.load()
		})
	}

	/**
	 * Runs a tab's own Save button: `write` stores the rows, and the Saving bar shows `label`
	 * meanwhile. A failure lands in `error`; returns whether it saved.
	 */
	async save(label: string, write: (rows: T) => Promise<void>): Promise<boolean> {
		this.saving = true
		const end = startSaving(label)
		this.error = ''
		try {
			await write(this.rows)
			this.markSaved()
			return true
		} catch (err) {
			this.error = String(err)
			return false
		} finally {
			this.saving = false
			end()
		}
	}
}

/** `rows` with row `i` swapped with the one `d` places away; `rows` itself when that is past an end. */
export function moveRow<R>(rows: R[], i: number, d: number): R[] {
	const j = i + d
	if (i < 0 || i >= rows.length || j < 0 || j >= rows.length || d === 0) return rows
	const l = [...rows]
	;[l[i], l[j]] = [l[j], l[i]]
	return l
}

/** `rows` without row `i`. */
export function removeRow<R>(rows: R[], i: number): R[] {
	return rows.filter((_, k) => k !== i)
}

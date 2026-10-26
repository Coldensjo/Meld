import { untrack } from 'svelte'
import { startSaving } from '../state/saving'
import { changedValues } from '../world/creatureFields'

// The flow the database editors share (#576): the creature, game object, quest, item and spell
// editors each edit one template row of the world database (its columns as strings, `values`, beside
// the row as last read or saved, `saved`). Opening another target reads its row, dropping a read that
// a later opening or a close overtook; leaving it (closing, opening another, starting a new one) asks
// about unsaved changes first, through the Discard bar of EditorFrame.svelte; Save runs on the Saving
// bar, and a value the server's rules refuse shows the tab it is on. The world database keeps no undo,
// so these are not History edits: Revert drops the unsaved values.

/** What a template row read from the world database has: its columns, as strings. */
export interface TemplateRow {
	values: Record<string, string>
}

export interface TemplateEditorOptions<T, R extends TemplateRow> {
	/** What a target is, as one string: the editor opens afresh when it changes. */
	id: (t: T) => string
	/** The template a target reads (0 or less: none, the editor's find or new page). */
	entry: (t: T) => number
	/** Reads a template row. */
	read: (entry: number) => Promise<R>
	/** Clears what the editor is open on (its `ui` slot), which closes it. */
	clear: () => void
	/** Unsaved edits besides the values (a tab's rows, a picked icon), which leaving asks about too. */
	dirty?: () => boolean
	/** Resets the editor's own fields when it opens on `t`; `before` is the id it was open on ('' for none). */
	onopen?: (t: T, before: string) => void
	/** Drops the editor's own unsaved edits besides the values on Revert (and Discard). */
	onrevert?: () => void
	/** Drops the rest on Discard: edits Revert leaves, such as a tab with a Save of its own. */
	ondiscard?: () => void
	/** Runs once the editor has closed. */
	onclose?: () => void
}

/** What EditorFrame.svelte needs of an editor: the Discard bar, the error and note bars, and Close. */
export interface EditorFlow {
	confirmClose: boolean
	readonly unsaved: boolean
	readonly error: string
	readonly note: string
	close(force?: boolean): void
	discard(): void
}

export class TemplateEditor<T, R extends TemplateRow> implements EditorFlow {
	/** The row as read, with its columns' kinds; null until read, and on a find or new page. */
	record = $state<R | null>(null)
	/** The columns being edited. */
	values = $state<Record<string, string>>({})
	/** The columns as last read or saved. */
	saved = $state<Record<string, string>>({})
	error = $state('')
	/** What the last action did (saved, made, imported), shown under the header. */
	note = $state('')
	loading = $state(false)
	saving = $state(false)
	/** The Discard bar is up: leaving waits for Keep editing or Discard them. */
	confirmClose = $state(false)

	readonly #o: TemplateEditorOptions<T, R>
	/** The id of the target last opened, '' when closed. */
	#opened = ''
	/** Counts the openings, closes and reads, so a read that one of them overtook is dropped. */
	#token = 0
	/** What to do once the unsaved changes are discarded, instead of closing. */
	#after: (() => void) | null = null

	constructor(o: TemplateEditorOptions<T, R>) {
		this.#o = o
	}

	/** The values that differ from the saved ones: what Save writes. */
	get changes(): Record<string, string> {
		return changedValues(this.values, this.saved)
	}

	get changeCount(): number {
		return Object.keys(this.changes).length
	}

	/** Anything unsaved at all: what leaving asks about. */
	get unsaved(): boolean {
		return this.changeCount > 0 || (this.#o.dirty?.() ?? false)
	}

	/** Opens the editor on whatever `target` gives, whenever that changes. Call it while the component starts. */
	follow(target: () => T | null) {
		$effect(() => this.open(target()))
	}

	/** Opens the editor on `t` (null: it was closed), reading its row unless it is open on it already. */
	open(t: T | null) {
		if (!t) {
			// Closed from outside (a probe, a scene): the next opening reads its target afresh.
			this.#opened = ''
			this.#token++
			this.loading = false
			return
		}
		const id = this.#o.id(t)
		if (id === this.#opened) return
		untrack(() => {
			const before = this.#opened
			this.#opened = id
			this.#token++
			this.record = null
			this.values = {}
			this.saved = {}
			this.error = ''
			this.loading = false
			this.confirmClose = false
			this.#after = null
			this.#o.onopen?.(t, before)
			const entry = this.#o.entry(t)
			if (entry > 0) void this.load(entry)
		})
	}

	/** Reads `entry`'s row into the editor; false when the read failed or something overtook it. */
	async load(entry: number): Promise<boolean> {
		const mine = ++this.#token
		this.loading = true
		try {
			const r = await this.#o.read(entry)
			if (mine !== this.#token) return false
			this.record = r
			this.values = { ...r.values }
			this.saved = { ...r.values }
			return true
		} catch (err) {
			if (mine === this.#token) this.error = String(err)
			return false
		} finally {
			if (mine === this.#token) this.loading = false
		}
	}

	/** Makes the next opening of the same target read it again (an import that rewrote it). */
	reopen() {
		this.#opened = ''
	}

	/** Runs `go` now, or once the unsaved changes are discarded (Keep editing drops it). */
	leave(go: () => void) {
		if (!this.unsaved) {
			go()
			return
		}
		this.#after = go
		this.confirmClose = true
	}

	/** Closes the editor; with unsaved changes, unless `force`, it asks first. */
	close(force = false) {
		if (this.unsaved && !force) {
			this.#after = null
			this.confirmClose = true
			return
		}
		this.#opened = ''
		this.#token++
		this.loading = false
		this.note = ''
		this.confirmClose = false
		this.#o.clear()
		this.#o.onclose?.()
	}

	/** The Discard bar's Discard them: drops every unsaved edit, then does what was asked (else closes). */
	discard() {
		this.revert()
		this.#o.ondiscard?.()
		this.confirmClose = false
		const then = this.#after
		this.#after = null
		if (then) then()
		else this.close(true)
	}

	/** Drops the unsaved values (and the editor's own edits, `onrevert`). */
	revert() {
		this.values = { ...this.saved }
		this.#o.onrevert?.()
	}

	/** The values as they are now are the saved ones. */
	markSaved() {
		this.saved = { ...this.values }
	}

	/**
	 * Runs an editor's Save: `write` stores what changed, with `label` on the Saving bar meanwhile. A
	 * failure lands in `error`, and for a refused value (`write` threw a RefusedError, `checkRefused`)
	 * `refused` gets its column, to show the tab it is on. Returns whether it saved.
	 */
	async save(label: string, write: () => Promise<void>, refused?: (column: string) => void): Promise<boolean> {
		this.saving = true
		const end = startSaving(label)
		this.error = ''
		this.note = ''
		try {
			await write()
			return true
		} catch (err) {
			this.error = String(err)
			if (err instanceof RefusedError) refused?.(err.column)
			return false
		} finally {
			this.saving = false
			end()
		}
	}
}

/** A value a Save refused: `column` is the column Go named for it (vmangos.ColumnError, #597). Its text reads as a plain Error's. */
export class RefusedError extends Error {
	readonly column: string
	constructor(column: string, message: string) {
		super(message)
		this.column = column
	}
}

/**
 * Throws the value a save binding refused (its result's `refused`; Wails passes a returned error as
 * its message only, so Go hands the column over in the result), and returns the result otherwise.
 */
export function checkRefused<T extends { refused?: { column: string; message: string } }>(result: T): T {
	if (result.refused) throw new RefusedError(result.refused.column, result.refused.message)
	return result
}

/** How many of `changes` each tab's fields hold, for the tabs' labels. */
export function tabChangeCounts(tabs: { id: string; groups: { fields: { col: string }[] }[] }[], changes: Record<string, string>): Map<string, number> {
	return new Map(tabs.map((t) => [t.id, t.groups.reduce((n, g) => n + g.fields.filter((f) => changes[f.col] !== undefined).length, 0)]))
}

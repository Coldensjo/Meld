// The undo stack, apart from the editor's runes state, so the node tests can load it: what it
// reports (the map is dirty, whether undo and redo are possible) goes to a sink, which history.ts
// points at `editor` and `ui`.

/** Where the history reports what changed. */
export interface HistorySink {
	/** A step was done, undone or redone: the map has unsaved changes. */
	dirty(): void
	/** Whether a step can be undone and redone now; called after every change of the stack. */
	sync(canUndo: boolean, canRedo: boolean): void
}

export interface Command {
	label: string
	/** About how many bytes the step holds (its saved terrain), for the history's byte budget. */
	bytes?: number
	undo(): void
	redo(): void
}

/** The most steps kept; the oldest goes when another comes. */
export const HISTORY_LIMIT = 100

/**
 * The most bytes the steps may hold together (#444): past it the oldest steps go, though the newest
 * always stays. Whole-map steps (a mask wand click on a big region, Erode map) can hold tens of MB each.
 */
export const HISTORY_BYTES = 256 * 1024 * 1024

/** A step of the history as the History window lists it: its label and when it was made. */
export interface HistoryStep {
	label: string
	at: number
}

/** Linear undo/redo stack. Commands are pushed already-applied. */
export class History {
	private readonly sink: HistorySink

	constructor(sink: HistorySink) {
		this.sink = sink
	}

	private stack: Command[] = []
	/** When each command was pushed (or last replaced), in step with stack. */
	private times: number[] = []
	private index = 0
	/** The bytes the steps hold together (each Command's `bytes`). */
	private held = 0
	/** Whether older steps were dropped, past HISTORY_LIMIT or the budget, since the stack was cleared. */
	trimmed = false

	/** The most bytes the steps may hold together; past it the oldest go. */
	budget = HISTORY_BYTES

	/** The bytes the steps hold together. */
	get bytes() {
		return this.held
	}

	push(cmd: Command) {
		for (let i = this.index; i < this.stack.length; i++) this.held -= this.stack[i].bytes ?? 0
		this.stack.length = this.index
		this.times.length = this.index
		this.stack.push(cmd)
		this.times.push(Date.now())
		this.held += cmd.bytes ?? 0
		this.trim()
		this.index = this.stack.length
		this.changed()
		this.sync()
	}

	/** The most recent command still on the undo side, if any. */
	peek(): Command | null {
		return this.index > 0 && this.index === this.stack.length ? this.stack[this.index - 1] : null
	}

	/** Replace the most recent command (used to merge rapid repeated edits). */
	replaceTop(cmd: Command) {
		if (this.index === 0 || this.index !== this.stack.length) return this.push(cmd)
		this.held += (cmd.bytes ?? 0) - (this.stack[this.index - 1].bytes ?? 0)
		this.stack[this.index - 1] = cmd
		this.times[this.index - 1] = Date.now()
		this.trim()
		this.index = this.stack.length
		this.changed()
		this.sync()
	}

	undo() {
		if (this.index === 0) return null
		const cmd = this.stack[--this.index]
		cmd.undo()
		this.changed()
		this.sync()
		return cmd
	}

	redo() {
		if (this.index >= this.stack.length) return null
		const cmd = this.stack[this.index++]
		cmd.redo()
		this.changed()
		this.sync()
		return cmd
	}

	/** Drops the oldest steps past HISTORY_LIMIT or the byte budget, keeping the newest. Call it with every step done. */
	private trim() {
		while (this.stack.length > 1 && (this.stack.length > HISTORY_LIMIT || this.held > this.budget)) {
			this.held -= this.stack.shift()!.bytes ?? 0
			this.times.shift()
			this.trimmed = true
		}
	}

	clear() {
		this.stack = []
		this.times = []
		this.index = 0
		this.held = 0
		this.trimmed = false
		this.sync()
	}

	/** Every step, oldest first. */
	steps(): HistoryStep[] {
		return this.stack.map((c, i) => ({ label: c.label, at: this.times[i] }))
	}

	/** How many steps are done: the steps before it can be undone, the rest redone. */
	get position() {
		return this.index
	}

	/**
	 * Undoes or redoes steps until `position` is done: 0 undoes everything. Returns whether anything
	 * changed. Each step runs as Undo and Redo run it, so the History window's jump is many undo steps.
	 */
	goTo(position: number) {
		const target = Math.max(0, Math.min(this.stack.length, position))
		if (target === this.index) return false
		while (this.index > target) this.stack[--this.index].undo()
		while (this.index < target) this.stack[this.index++].redo()
		this.changed()
		this.sync()
		return true
	}

	/**
	 * Runs `fn` against a scratch history and returns the steps it pushed as one command labelled
	 * `label` (undone last first), or null when it pushed none: an edit made of several (Apply Biome,
	 * #957) becomes one undo step.
	 */
	static batch(label: string, fn: (h: History) => void): Command | null {
		const h = new History({ dirty() {}, sync() {} })
		h.budget = Infinity
		fn(h)
		const cmds = h.stack.slice(0, h.index)
		if (!cmds.length) return null
		return {
			label,
			bytes: cmds.reduce((s, c) => s + (c.bytes ?? 0), 0),
			undo: () => {
				for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo()
			},
			redo: () => {
				for (const c of cmds) c.redo()
			},
		}
	}

	/** Re-publish undo/redo availability (after switching documents). */
	refresh() {
		this.sync()
	}

	/** Counts the map's changes (a step pushed, replaced, undone or redone), so autosave can tell it changed since its last copy. */
	changes = 0

	private changed() {
		this.changes++
		this.sink.dirty()
	}

	private sync() {
		this.sink.sync(this.index > 0, this.index < this.stack.length)
	}
}

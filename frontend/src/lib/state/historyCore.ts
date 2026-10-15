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
  undo(): void
  redo(): void
}

/** The most steps kept; the oldest goes when another comes. */
export const HISTORY_LIMIT = 100

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

  push(cmd: Command) {
    this.stack.length = this.index
    this.times.length = this.index
    this.stack.push(cmd)
    this.times.push(Date.now())
    if (this.stack.length > HISTORY_LIMIT) {
      this.stack.shift()
      this.times.shift()
    }
    this.index = this.stack.length
    this.sink.dirty()
    this.sync()
  }

  /** The most recent command still on the undo side, if any. */
  peek(): Command | null {
    return this.index > 0 && this.index === this.stack.length ? this.stack[this.index - 1] : null
  }

  /** Replace the most recent command (used to merge rapid repeated edits). */
  replaceTop(cmd: Command) {
    if (this.index === 0 || this.index !== this.stack.length) return this.push(cmd)
    this.stack[this.index - 1] = cmd
    this.times[this.index - 1] = Date.now()
    this.sink.dirty()
    this.sync()
  }

  undo() {
    if (this.index === 0) return null
    const cmd = this.stack[--this.index]
    cmd.undo()
    this.sink.dirty()
    this.sync()
    return cmd
  }

  redo() {
    if (this.index >= this.stack.length) return null
    const cmd = this.stack[this.index++]
    cmd.redo()
    this.sink.dirty()
    this.sync()
    return cmd
  }

  clear() {
    this.stack = []
    this.times = []
    this.index = 0
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
    this.sink.dirty()
    this.sync()
    return true
  }

  /** Re-publish undo/redo availability (after switching documents). */
  refresh() {
    this.sync()
  }

  private sync() {
    this.sink.sync(this.index > 0, this.index < this.stack.length)
  }
}

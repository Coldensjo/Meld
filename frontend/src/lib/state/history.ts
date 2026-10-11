import { editor, ui } from './editor.svelte'

export interface Command {
  label: string
  undo(): void
  redo(): void
}

const LIMIT = 100

/** Linear undo/redo stack. Commands are pushed already-applied. */
export class History {
  private stack: Command[] = []
  private index = 0

  push(cmd: Command) {
    this.stack.length = this.index
    this.stack.push(cmd)
    if (this.stack.length > LIMIT) this.stack.shift()
    this.index = this.stack.length
    editor.dirty = true
    this.sync()
  }

  undo() {
    if (this.index === 0) return null
    const cmd = this.stack[--this.index]
    cmd.undo()
    editor.dirty = true
    this.sync()
    return cmd
  }

  redo() {
    if (this.index >= this.stack.length) return null
    const cmd = this.stack[this.index++]
    cmd.redo()
    editor.dirty = true
    this.sync()
    return cmd
  }

  clear() {
    this.stack = []
    this.index = 0
    this.sync()
  }

  private sync() {
    ui.canUndo = this.index > 0
    ui.canRedo = this.index < this.stack.length
  }
}

import { editor, ui } from './editor.svelte'
import { History as HistoryCore, type HistorySink } from './historyCore'

export { HISTORY_BYTES, HISTORY_LIMIT, type Command, type HistorySink, type HistoryStep } from './historyCore'

/** The editor's sink: a change marks the open map dirty and republishes undo and redo. */
const runes: HistorySink = {
	dirty() {
		editor.dirty = true
	},
	sync(canUndo, canRedo) {
		ui.canUndo = canUndo
		ui.canRedo = canRedo
		ui.historyVersion++
	},
}

/** A map's undo stack (historyCore.ts), reporting to the editor's state. */
export class History extends HistoryCore {
	constructor() {
		super(runes)
	}
}

// The doodad brush editor in its own OS window (#911, components/toolwin/DoodadBrushToolWindow.svelte):
// the view the main page publishes and the commands the window sends back. The brushes are preferences
// (`prefs.doodadBrushes`, `prefs.doodadBrush`), and the main page stays their one writer: the window edits
// its own copy and sends the whole list with each change (`set`, a few kilobytes, throttled), which the
// main page takes into `prefs` and saves as it saves any preference. A second page saving prefs would race
// the main page's baseline (prefs.ts) and leave its Doodad Brush tool on the old brushes until a reload.
import type { ToolCommand } from './channel'
import { prefShapeOk } from '../state/prefsPatch'
import type { BrushStore, DoodadBrush } from '../tools/doodadBrush'

/** The tool window kind of the doodad brush editor (app_toolwindows.go's toolWindowKinds). */
export const BRUSHES_KIND = 'doodad-brushes'

export interface BrushesView {
	brushes: DoodadBrush[]
	/** The brush picked (`prefs.doodadBrush`). */
	active: string
	/** The last `set` the main page took, so the window drops a view older than its own edits. */
	ack: number
	/** Whether the client is open, and its revision (the model list is read again when it changes). */
	wowLoaded: boolean
	wowRevision: number
	/** The preferences the picker reads: the names under the tiles, and the preview's frame limit. */
	browserNames: boolean
	fpsLimit: number
}

/** The window's commands to the main page. */
export type BrushesCommand =
	/** The window's brushes after an edit, numbered so a view sent before the main page took it is dropped. */
	| { type: 'set'; seq: number; brushes: DoodadBrush[]; active: string }
	/** Render the thumbnail of a model missing from the disk cache; answered with a `thumb` reply. */
	| { type: 'thumb'; key: string }
	/** Close the window and paint with the brush. */
	| { type: 'paint' }
	/** Import brushes from files, or export the picked one (the main page's file dialogs). */
	| { type: 'import' }
	| { type: 'export' }
	/** A line for the main window's status bar. */
	| { type: 'status'; text: string }

/** The main page's answer to a `thumb` command: whether the thumbnail is in the disk cache now. */
export interface ThumbReply {
	type: 'thumb'
	key: string
	ok: boolean
}

export function brushesView(store: BrushStore, ack: number, wow: { loaded: boolean; revision: number }, view: { browserNames: boolean; fpsLimit: number }): BrushesView {
	return {
		brushes: store.doodadBrushes,
		active: store.doodadBrush,
		ack,
		wowLoaded: wow.loaded,
		wowRevision: wow.revision,
		browserNames: view.browserNames,
		fpsLimit: view.fpsLimit,
	}
}

/** The command if `cmd` is one of the window's, with its fields of the right shape (a `set`'s brushes as prefs.ts checks them); else null. */
export function readBrushesCommand(cmd: ToolCommand): BrushesCommand | null {
	const c = cmd as Record<string, unknown>
	switch (cmd.type) {
		case 'set':
			if (typeof c.seq !== 'number' || !Number.isInteger(c.seq) || typeof c.active !== 'string' || !Array.isArray(c.brushes)) return null
			if (!prefShapeOk('doodadBrushes', c.brushes)) return null
			return { type: 'set', seq: c.seq, brushes: c.brushes as DoodadBrush[], active: c.active }
		case 'thumb':
			return typeof c.key === 'string' && /^(m2|wmo):/.test(c.key) ? { type: 'thumb', key: c.key } : null
		case 'status':
			return typeof c.text === 'string' ? { type: 'status', text: c.text.slice(0, 500) } : null
		case 'paint':
		case 'import':
		case 'export':
			return { type: cmd.type }
	}
	return null
}

/** The reply if `r` is the answer to a `thumb` command, else null. */
export function readThumbReply(r: Record<string, unknown>): ThumbReply | null {
	return r.type === 'thumb' && typeof r.key === 'string' && typeof r.ok === 'boolean' ? { type: 'thumb', key: r.key, ok: r.ok } : null
}

const storeJson = (brushes: DoodadBrush[], active: string) => JSON.stringify([brushes, active])

/**
 * The window's side of the brushes' sync: which of its edits went out, so a view from the main page that
 * was sent before it took the last one (its `ack` lower) doesn't undo an edit still on its way.
 */
export class BrushSync {
	/** The number of the last edit sent. */
	sent = 0
	/** The brushes as last taken from a view or sent, as JSON. */
	private last = ''

	/** Whether to show the main page's view: false when it predates an edit sent since. */
	take(view: BrushesView): boolean {
		if (view.ack < this.sent) return false
		this.last = storeJson(view.brushes, view.active)
		return true
	}

	/** After the window's store changed (or may have): the edit's number when it differs from the last taken or sent, else null. */
	edit(store: BrushStore): number | null {
		const json = storeJson(store.doodadBrushes, store.doodadBrush)
		if (json === this.last) return null
		this.last = json
		return ++this.sent
	}
}

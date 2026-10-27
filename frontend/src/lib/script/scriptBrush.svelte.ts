// What the UI shows of Lua scripting (#28, #29): the Scripts window's output, which a brush's strokes
// print into too, and the brush script the Script Brush tool holds (engine/ScriptBrushes.ts), with its
// brushes' settings for the options bar. Written when a script loads, a setting changes or a script
// prints, never each frame.
import type { BrushEventKind, TagSpec, TagValue } from './scriptApi'

export interface ScriptLine {
	text: string
	kind: 'out' | 'err' | 'info'
}

/** The Scripts window's output, the newest 500 lines. */
export const scriptLog = $state({ lines: [] as ScriptLine[] })

export function scriptSay(text: string, kind: ScriptLine['kind'] = 'out') {
	const lines = scriptLog.lines
	lines.push({ text, kind })
	// The newest lines only: a print in a loop over every vertex must not grow the page without end.
	if (lines.length > 500) lines.splice(0, lines.length - 500)
}

export function clearScriptLog() {
	scriptLog.lines = []
}

/** A brush of the loaded script, as the options bar shows it. */
export interface LoadedBrush {
	name: string
	tags: TagSpec[]
	/** The tags' values, by index. */
	values: TagValue[]
	handles: BrushEventKind[]
}

/** The brush script the Script Brush tool holds. */
export const scriptBrush = $state({
	/** The script's name, '' with none loaded. */
	name: '',
	/** Its file in the scripts folder, '' for a script run from the Scripts window unsaved. */
	file: '',
	brushes: [] as LoadedBrush[],
	/** The brush a stroke paints with, an index of `brushes`. */
	active: 0,
})

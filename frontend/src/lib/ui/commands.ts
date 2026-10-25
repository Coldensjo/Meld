// The editor's keyboard shortcuts in one table (#583). App.svelte's key handler matches a key press
// against the rows that carry `chords` and runs that command (lib/ui/runCommand.ts), the menu bar
// takes its shortcut text and its action from the same row by id, and Help › Keyboard Shortcuts
// lists every row. A row without chords is a key the engine, a tool or the camera reads itself (or a
// mouse action): it is listed, and a menu may show its keys, but App doesn't bind it.
import type { ToolId } from '../state/editor.svelte'
import { TOOLS } from './tools'

/** One key with its modifiers. `key` is `KeyboardEvent.key` lowercased ('z', 'f1', 'pagedown', '['). */
export interface Chord {
	readonly key: string
	/** Ctrl (or Cmd). Every Ctrl chord is read before the engine and the tool get the key. */
	readonly ctrl?: boolean
	/** Shift, for letters, digits and named keys; a symbol key ('[', '{', '=') is told by its own character. */
	readonly shift?: boolean
	/** Matched, but left out of the shortcut text (Ctrl++ beside Ctrl+=). */
	readonly hidden?: boolean
}

export type ShortcutGroup = 'File' | 'Camera' | 'Tools'

export interface Shortcut {
	readonly id: string
	readonly group: ShortcutGroup
	/** What it does, as the Shortcuts dialog says it. */
	readonly desc: string
	/** The keys App's key handler binds to this command. */
	readonly chords?: readonly Chord[]
	/** The text shown, for a row without chords; a bound row's text is made from its chords. */
	readonly keys?: string
}

const ctrl = (key: string, shift = false): Chord => ({ key, ctrl: true, shift })
const shift = (key: string): Chord => ({ key, shift: true })
const key = (k: string): Chord => ({ key: k })

const GENERAL = [
	// File, the tabs, the window and editing.
	{ id: 'newMap', group: 'File', desc: 'New map', chords: [ctrl('n')] },
	{ id: 'open', group: 'File', desc: 'Open map', chords: [ctrl('o')] },
	{ id: 'save', group: 'File', desc: 'Save (a map made for the client also offers Publish)', chords: [ctrl('s')] },
	{ id: 'saveAs', group: 'File', desc: 'Save as', chords: [ctrl('s', true)] },
	{ id: 'closeMap', group: 'File', desc: 'Close map tab', chords: [ctrl('w')] },
	{ id: 'nextTab', group: 'File', desc: 'Next map tab', chords: [ctrl('tab')] },
	{ id: 'prevTab', group: 'File', desc: 'Previous map tab', chords: [ctrl('tab', true)] },
	{ id: 'hidePanels', group: 'File', desc: 'Hide / show the panels (the menu bar stays)', chords: [key('tab')] },
	{ id: 'fullScreen', group: 'File', desc: 'Full screen on / off', chords: [key('f11')] },
	{ id: 'uiLarger', group: 'File', desc: 'Interface larger', chords: [ctrl('='), { key: '+', ctrl: true, hidden: true }] },
	{ id: 'uiSmaller', group: 'File', desc: 'Interface smaller', chords: [ctrl('-'), { key: '_', ctrl: true, hidden: true }] },
	{ id: 'uiReset', group: 'File', desc: 'Interface back to 100 %', chords: [ctrl('0')] },
	{ id: 'minimapImage', group: 'File', desc: 'Save the minimap as an image', chords: [ctrl('p', true)] },
	{ id: 'perfOverlay', group: 'File', desc: 'Performance overlay on / off: where the frame time goes', chords: [ctrl('m', true)] },
	{ id: 'help', group: 'File', desc: 'Help', chords: [key('f1')] },
	{ id: 'undo', group: 'File', desc: 'Undo', chords: [ctrl('z')] },
	{ id: 'redo', group: 'File', desc: 'Redo', chords: [ctrl('y'), ctrl('z', true)] },
	{ id: 'copy', group: 'File', desc: 'Copy the selected models (or area)', chords: [ctrl('c')] },
	{ id: 'paste', group: 'File', desc: 'Paste under the cursor (also into another map tab)', chords: [ctrl('v')] },
	{ id: 'selectAll', group: 'File', desc: 'Select the whole map and its models (switches to the Select tool)', chords: [ctrl('a')] },
	{ id: 'deselect', group: 'File', desc: 'Deselect', chords: [ctrl('d')] },
	{ id: 'pastePlace', group: 'File', desc: 'Place / cancel a paste', keys: 'Enter / Esc' },
	{ id: 'pasteLift', group: 'File', desc: 'Raise / lower the paste while placing', keys: 'PgUp / PgDn' },
	{ id: 'bookmark', group: 'File', desc: "Bookmark the camera's spot (Camera › Bookmarks)", chords: [ctrl('b')] },

	// The camera and the view.
	{ id: 'look', group: 'Camera', desc: 'Look around (orbit when following the ground)', keys: 'Right mouse drag' },
	{ id: 'slide', group: 'Camera', desc: 'Slide sideways and up/down (pan when following the ground)', keys: 'Middle mouse drag' },
	{ id: 'wheel', group: 'Camera', desc: 'Flight speed (zoom when following the ground)', keys: 'Mouse wheel' },
	{ id: 'fly', group: 'Camera', desc: 'Fly: W goes the way you look, A/D strafe (arrows nudge the object when one is selected)', keys: 'W A S D / arrows' },
	{ id: 'upDown', group: 'Camera', desc: 'Fly up / down', keys: 'Space / X' },
	{ id: 'turn', group: 'Camera', desc: 'Rotate', keys: 'Q / E' },
	{ id: 'fast', group: 'Camera', desc: 'Fast / very fast', keys: 'Shift / Ctrl+Shift' },
	{ id: 'cameraFaster', group: 'Camera', desc: 'Camera speed up a step', chords: [key('p')] },
	{ id: 'cameraSlower', group: 'Camera', desc: 'Camera speed down a step', chords: [key('o')] },
	{ id: 'followGround', group: 'Camera', desc: 'Follow the ground on/off (on, the camera stays above the terrain; off, it can enter caves)', chords: [key('t')] },
	{ id: 'topDown', group: 'Camera', desc: 'Top-down view on/off: straight down with no perspective; the wheel zooms, Q/E or a right drag turn the map', chords: [key('u')] },
	{ id: 'minimap', group: 'Camera', desc: "Minimap window: the map from above with the camera's spot; a click moves the camera there", chords: [key('m')] },
	{ id: 'focus', group: 'Camera', desc: 'Focus selected object', chords: [key('f')] },
	{ id: 'climbView', group: 'Camera', desc: 'Climb view on/off: ground too steep to walk up is tinted red (the slope is in the View menu)', chords: [shift('f2')] },
	{ id: 'cycleFaster', group: 'Camera', desc: 'Day cycle faster (a day in 40, 20, 10, 5, 2 or 1 min)', chords: [key('n')] },
	{ id: 'cycleSlower', group: 'Camera', desc: 'Day cycle slower (slower than 40 min pauses it)', chords: [shift('n')] },
	{ id: 'cyclePause', group: 'Camera', desc: 'Pause / run the day cycle', chords: [key('j')] },
] as const satisfies readonly Shortcut[]

const TOOL_KEYS = [
	{ id: 'pipette', group: 'Tools', desc: 'Pipette: pick the model under the cursor to place, or the texture to paint with', keys: 'Alt+click' },
	{ id: 'clickSelect', group: 'Tools', desc: 'Select a model, add or remove one (Select tool)', keys: 'Click, Shift+click' },
	{ id: 'dragSelect', group: 'Tools', desc: 'Select an area and the models in it (Select tool)', keys: 'Drag on the ground' },
	{ id: 'brushSmaller', group: 'Tools', desc: 'Brush smaller (fine steps when small, coarse when big; Ctrl+scroll too)', chords: [key('[')] },
	{ id: 'brushLarger', group: 'Tools', desc: 'Brush larger', chords: [key(']')] },
	{ id: 'falloffSofter', group: 'Tools', desc: 'Brush falloff softer', chords: [key('{')] },
	{ id: 'falloffHarder', group: 'Tools', desc: 'Brush falloff harder', chords: [key('}')] },
	{ id: 'brushDrag', group: 'Tools', desc: 'Size the brush where it stands: sideways for the size, up and down for the falloff', keys: 'Alt+right-drag' },
	{ id: 'spray', group: 'Tools', desc: 'Spray on / off (Paint tool)', keys: 'T' },
	{ id: 'nudge', group: 'Tools', desc: 'Move selected object (camera-relative)', keys: 'Arrow keys' },
	{ id: 'snapGround', group: 'Tools', desc: 'Put the selected models back on the ground', chords: [ctrl('pagedown')] },
	{ id: 'lift', group: 'Tools', desc: 'Raise / lower selected object', keys: 'Alt+↑ / Alt+↓, PgUp / PgDn' },
	{ id: 'spinFine', group: 'Tools', desc: 'Spin selected object 5°', keys: 'Alt+← / Alt+→' },
	{ id: 'spin', group: 'Tools', desc: 'Spin selected object 15° (or the placement preview)', keys: 'R / Shift+R' },
	{ id: 'bigSteps', group: 'Tools', desc: 'Bigger steps', keys: 'Shift + arrows' },
	{ id: 'resetRotation', group: 'Tools', desc: 'Stand the selected models upright (their tilt goes, their heading stays)', chords: [ctrl('r')] },
	{ id: 'group', group: 'Tools', desc: 'Group the selected models, so a click selects them all', chords: [ctrl('g')] },
	{ id: 'ungroup', group: 'Tools', desc: 'Ungroup the selected models', chords: [ctrl('g', true)] },
	{ id: 'placeSpin', group: 'Tools', desc: 'Rotate the placement preview (Place tool)', keys: 'Ctrl+scroll' },
	{ id: 'placeTilt', group: 'Tools', desc: 'Tilt / roll the selected models 5° a notch, or the placement preview with nothing selected (Place tool); all the way round', keys: 'Z+scroll, Shift+Z+scroll' },
	{ id: 'placeLift', group: 'Tools', desc: 'Raise / lower the placement preview (Place tool, nothing selected)', keys: 'PgUp / PgDn' },
	{ id: 'placeNudge', group: 'Tools', desc: 'Move the placement preview away from the cursor (Place tool, nothing selected; Shift for bigger steps)', keys: 'Arrow keys' },
	{ id: 'placeScale', group: 'Tools', desc: 'Scale the placement preview (Place tool; doodads only, the client draws buildings at full size)', keys: 'Shift+scroll' },
	{ id: 'scatter', group: 'Tools', desc: 'Scatter (Place tool)', keys: 'Shift+drag' },
	{ id: 'doodadSpin', group: 'Tools', desc: 'Spin the preview about the brush (Doodad brush tool)', keys: 'Ctrl+scroll, R' },
	{ id: 'doodadStack', group: 'Tools', desc: 'Stack models on top of each other, ignoring the spacing (Doodad brush tool)', keys: 'Shift+drag' },
	{ id: 'doodadErase', group: 'Tools', desc: "Erase the brush's models (Doodad brush tool)", keys: 'Ctrl+drag' },
	{ id: 'deleteSelected', group: 'Tools', desc: 'Delete the selected models', keys: 'Del' },
	{ id: 'duplicate', group: 'Tools', desc: 'Duplicate the selected models in place', chords: [ctrl('d', true)] },
	{ id: 'hideSelected', group: 'Tools', desc: 'Hide the selected models', keys: 'H' },
	{ id: 'unhideAll', group: 'Tools', desc: 'Unhide all models', chords: [shift('h')] },
	{ id: 'escDeselect', group: 'Tools', desc: 'Deselect', keys: 'Esc' },
	{ id: 'grid', group: 'Tools', desc: 'Toggle grid', chords: [key('g')] },
	{ id: 'inspector', group: 'Tools', desc: "Inspector: the selected model's placement numbers and actions (Esc closes it)", chords: [key('i')] },
	{ id: 'uiName', group: 'Tools', desc: 'Name the part of the UI under the cursor (for bug reports)', keys: 'Hold F8' },
	{ id: 'teleport', group: 'Tools', desc: 'Copy the GM teleport command (.go xyz) to the point under the cursor', chords: [key('f9')] },
] as const satisfies readonly Shortcut[]

type Row = (typeof GENERAL)[number] | (typeof TOOL_KEYS)[number]
type ToolCommand = `tool:${ToolId}`
/** A command App's key handler binds: a row with chords, or a tool's key. */
export type CommandId = Extract<Row, { chords: readonly Chord[] }>['id'] | ToolCommand
/** Any row of the table. */
export type ShortcutId = Row['id'] | ToolCommand

/** Each tool's key and letter, picking the tool. */
const TOOL_ROWS: Shortcut[] = TOOLS.map((t) => ({
	id: `tool:${t.id}`,
	group: 'Tools' as const,
	desc: t.name,
	chords: [key(t.key.toLowerCase()), ...(t.letter ? [key(t.letter.toLowerCase())] : [])],
}))

/** Every shortcut, in the Shortcuts dialog's order. */
export const SHORTCUTS: readonly Shortcut[] = [...GENERAL, ...TOOL_ROWS, ...TOOL_KEYS]

const BY_ID = new Map<string, Shortcut>(SHORTCUTS.map((s) => [s.id, s]))

/** Names of the named keys, as the menus show them. */
const NAMES: Record<string, string> = {
	pagedown: 'PgDn',
	pageup: 'PgUp',
	delete: 'Del',
	escape: 'Esc',
	tab: 'Tab',
	enter: 'Enter',
	'{': 'Shift+[',
	'}': 'Shift+]',
}

/** A key told by its own character, whatever Shift does ('[' and '{' are two keys). */
const isSymbol = (k: string) => k.length === 1 && !/[a-z0-9]/.test(k)

/** A chord as text: Ctrl+Shift+Z, Shift+F2, PgDn, Shift+[. */
export function chordLabel(c: Chord): string {
	const name = NAMES[c.key] ?? (/^f\d+$/.test(c.key) ? c.key.toUpperCase() : c.key.length === 1 ? c.key.toUpperCase() : c.key)
	return (c.ctrl ? 'Ctrl+' : '') + (c.shift && !isSymbol(c.key) ? 'Shift+' : '') + name
}

/** The keys of shortcut `id`, as the menus and the Shortcuts dialog show them. */
export function keysOf(id: ShortcutId): string {
	const s = BY_ID.get(id)
	if (!s) return ''
	return (
		s.keys ??
		(s.chords ?? [])
			.filter((c) => !c.hidden)
			.map(chordLabel)
			.join(' / ')
	)
}

/** The parts of a key event a chord is matched against. */
export type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey'>

/** Whether key event `e` is chord `c`. Alt is not looked at, as before the table. */
export function chordMatches(c: Chord, e: KeyLike): boolean {
	if (!!c.ctrl !== (e.ctrlKey || e.metaKey)) return false
	const k = e.key.toLowerCase()
	if (isSymbol(c.key)) return k === c.key
	if (!!c.shift !== e.shiftKey) return false
	return k === c.key || (c.key === '0' && (e.code === 'Digit0' || e.code === 'Numpad0'))
}

/**
 * Whether chord `c` is read before the engine and the tool see the key: the Ctrl chords, the
 * function keys and Tab. The rest come after them, so a tool's own letter (Paint's T) wins.
 */
export function isEarly(c: Chord): boolean {
	return !!c.ctrl || /^f\d+$/.test(c.key) || c.key === 'tab'
}

const BOUND = SHORTCUTS.filter((s) => s.chords?.length) as Array<Shortcut & { id: CommandId; chords: readonly Chord[] }>

/** The command bound to key event `e` among the early chords (`early`) or the later ones, or null. */
export function commandFor(e: KeyLike, early: boolean): CommandId | null {
	for (const s of BOUND) for (const c of s.chords) if (isEarly(c) === early && chordMatches(c, e)) return s.id
	return null
}

/** The Shortcuts dialog's sections: each group with its rows' keys and text. */
export function shortcutSections(): Array<[ShortcutGroup, Array<{ id: string; keys: string; desc: string }>]> {
	const out = new Map<ShortcutGroup, Array<{ id: string; keys: string; desc: string }>>()
	for (const s of SHORTCUTS) {
		const rows = out.get(s.group) ?? []
		rows.push({ id: s.id, keys: keysOf(s.id as ShortcutId), desc: s.desc })
		out.set(s.group, rows)
	}
	return [...out]
}

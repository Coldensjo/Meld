// The editor's keyboard shortcuts in one table (#583). App.svelte's key handler matches a key press
// against the rows that carry `chords` and runs that command (lib/ui/runCommand.ts), the menu bar
// takes its shortcut text and its action from the same row by id, and Help › Keyboard Shortcuts
// lists every row. A row with `codes` is a camera movement key CameraController holds. A row with
// neither is a key the engine or a tool reads itself (or a mouse action): it is listed, and a menu
// may show its keys, but it is fixed.
//
// The chords and codes here are the defaults. The Hotkey Manager (#396) rebinds a row through the
// `keymap` pref, which holds only the rows the user changed: the effective keys are rebuilt from it
// whenever it is replaced (`bindKeymap`), and every reader below goes through them.
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
	/** The physical keys (`KeyboardEvent.code`) the camera holds for this movement (CameraController). */
	readonly codes?: readonly string[]
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
	{ id: 'camForward', group: 'Camera', desc: 'Fly forward, the way you look', codes: ['KeyW'] },
	{ id: 'camBack', group: 'Camera', desc: 'Fly back', codes: ['KeyS'] },
	{ id: 'camLeft', group: 'Camera', desc: 'Strafe left', codes: ['KeyA'] },
	{ id: 'camRight', group: 'Camera', desc: 'Strafe right', codes: ['KeyD'] },
	{ id: 'camUp', group: 'Camera', desc: 'Fly up', codes: ['Space'] },
	{ id: 'camDown', group: 'Camera', desc: 'Fly down', codes: ['KeyX', 'KeyC'] },
	{ id: 'camTurnLeft', group: 'Camera', desc: 'Rotate left', codes: ['KeyQ'] },
	{ id: 'camTurnRight', group: 'Camera', desc: 'Rotate right', codes: ['KeyE'] },
	{ id: 'flyArrows', group: 'Camera', desc: 'Fly with the arrow keys (they nudge the object instead when one is selected)', keys: '↑ ← ↓ →' },
	{ id: 'fast', group: 'Camera', desc: 'Fast / very fast', keys: 'Shift / Ctrl+Shift' },
	{ id: 'cameraFaster', group: 'Camera', desc: 'Camera speed up a step', chords: [key('p')] },
	{ id: 'cameraSlower', group: 'Camera', desc: 'Camera speed down a step', chords: [key('o')] },
	{ id: 'orbitView', group: 'Camera', desc: 'Orbit View: the camera rides the ground and orbits a point on it (the default)', chords: [key('f2')] },
	{ id: 'flyingView', group: 'Camera', desc: 'Flying View: first person, flying freely, into caves too', chords: [key('f3')] },
	{ id: 'walkingView', group: 'Camera', desc: 'Walking View on/off: first person 3 yards above the ground, at a run; off returns to your camera', chords: [key('f4')] },
	{ id: 'topDown', group: 'Camera', desc: 'Top-down View on/off: straight down with no perspective; the wheel zooms, the turn keys (Q/E unless moved) or a right drag turn the map', chords: [key('u')] },
	{ id: 'followGround', group: 'Camera', desc: 'Orbit View / Flying View: switch between the two (the camera rides the ground, or flies freely)', chords: [key('t')] },
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
/** A camera movement CameraController holds while its key is down. */
export type CameraMove = Extract<Row, { codes: readonly string[] }>['id']
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

/**
 * The rows the user rebound (the `keymap` pref, #396): row id → its keys, each a chord as text
 * ('ctrl+shift+z', 'f1', '[', see `chordText`) or, for a camera row, a key code ('KeyW'). Only the
 * changed rows are in it, and an empty list leaves a row with no key. An entry that names no row,
 * or whose keys all fail to parse, is ignored: the row keeps its default.
 */
export type Keymap = Record<string, string[]>

// ---------------------------------------------------------------- keys as text

/** Names of the named keys, as the menus show them. */
const NAMES: Record<string, string> = {
	pagedown: 'PgDn',
	pageup: 'PgUp',
	delete: 'Del',
	escape: 'Esc',
	tab: 'Tab',
	enter: 'Enter',
	' ': 'Space',
	arrowup: '↑',
	arrowdown: '↓',
	arrowleft: '←',
	arrowright: '→',
	insert: 'Ins',
	backspace: 'Backspace',
	'{': 'Shift+[',
	'}': 'Shift+]',
}

/** A key told by its own character, whatever Shift does ('[' and '{' are two keys). */
const isSymbol = (k: string) => k.length === 1 && !/[a-z0-9]/.test(k)

/** A chord as text: Ctrl+Shift+Z, Shift+F2, PgDn, Shift+[. */
export function chordLabel(c: Chord): string {
	const name = NAMES[c.key] ?? (/^f\d+$/.test(c.key) ? c.key.toUpperCase() : c.key.length === 1 ? c.key.toUpperCase() : c.key[0].toUpperCase() + c.key.slice(1))
	return (c.ctrl ? 'Ctrl+' : '') + (c.shift && !isSymbol(c.key) ? 'Shift+' : '') + name
}

/** A chord as the keymap stores it: 'ctrl+shift+z', 'shift+f2', '[', 'ctrl++'. */
export function chordText(c: Chord): string {
	return (c.ctrl ? 'ctrl+' : '') + (c.shift && !isSymbol(c.key) ? 'shift+' : '') + c.key
}

/** The chord a keymap entry names, or null when it names none. */
export function parseChord(text: string): Chord | null {
	let rest = text.toLowerCase()
	let ctrl = false
	let shift = false
	for (;;) {
		if (rest.startsWith('ctrl+') && rest.length > 5) {
			ctrl = true
			rest = rest.slice(5)
		} else if (rest.startsWith('shift+') && rest.length > 6) {
			shift = true
			rest = rest.slice(6)
		} else break
	}
	if (!rest || (rest.length > 1 && !/^[a-z0-9]+$/.test(rest))) return null
	return { key: rest, ctrl, shift: shift && !isSymbol(rest) }
}

/** The key codes with a name of their own (the US layout's symbols). */
const CODE_NAMES: Record<string, string> = {
	Space: 'Space',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	BracketLeft: '[',
	BracketRight: ']',
	Minus: '-',
	Equal: '=',
	Semicolon: ';',
	Quote: "'",
	Comma: ',',
	Period: '.',
	Slash: '/',
	Backslash: '\\',
	Backquote: '`',
	PageUp: 'PgUp',
	PageDown: 'PgDn',
	Insert: 'Ins',
	Delete: 'Del',
}

/** A key code as the menus show it: KeyW is W, Digit1 is 1, Space is Space. */
export function codeLabel(code: string): string {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3)
	if (/^Digit\d$/.test(code)) return code.slice(5)
	if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`
	return CODE_NAMES[code] ?? code
}

/** The character a key code types with no modifier (on the US layout), as `KeyboardEvent.key` lowercased. */
function codeKey(code: string): string {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
	if (/^Digit\d$/.test(code)) return code.slice(5)
	if (code === 'Space') return ' '
	return CODE_NAMES[code]?.length === 1 ? CODE_NAMES[code] : code.toLowerCase()
}

const isCode = (s: unknown): s is string => typeof s === 'string' && /^[A-Z][A-Za-z0-9]*$/.test(s)

// ---------------------------------------------------------------- the effective keys

/** A row's chords after the keymap: the user's when they parse (or are an empty list), else the defaults. */
function rowChords(s: Shortcut, km: Keymap | undefined): readonly Chord[] {
	const o = km && Object.hasOwn(km, s.id) ? km[s.id] : undefined
	if (!Array.isArray(o)) return s.chords ?? []
	const parsed = o.map((x) => (typeof x === 'string' ? parseChord(x) : null)).filter((c): c is Chord => c !== null)
	return parsed.length || !o.length ? parsed : (s.chords ?? [])
}

/** A camera row's key codes after the keymap, as `rowChords`. */
function rowCodes(s: Shortcut, km: Keymap | undefined): readonly string[] {
	const o = km && Object.hasOwn(km, s.id) ? km[s.id] : undefined
	if (!Array.isArray(o)) return s.codes ?? []
	const codes = o.filter(isCode)
	return codes.length || !o.length ? codes : (s.codes ?? [])
}

interface Effective {
	chords: Map<string, readonly Chord[]>
	codes: Map<string, readonly string[]>
	/** The rows App's key handler binds, in the table's order. */
	bound: Array<{ id: CommandId; chords: readonly Chord[] }>
}

/**
 * The camera's keys, which CameraController reads every frame: each movement's key codes. Refilled in
 * place when the keymap changes, so the controller holds the one object.
 */
export const CAMERA_KEYS = {} as Record<CameraMove, string[]>

function build(km: Keymap | undefined): Effective {
	const out: Effective = { chords: new Map(), codes: new Map(), bound: [] }
	for (const s of SHORTCUTS) {
		if (s.chords) {
			const chords = rowChords(s, km)
			out.chords.set(s.id, chords)
			if (chords.length) out.bound.push({ id: s.id as CommandId, chords })
		} else if (s.codes) {
			const codes = rowCodes(s, km)
			out.codes.set(s.id, codes)
			const held = (CAMERA_KEYS[s.id as CameraMove] ??= [])
			held.length = 0
			held.push(...codes)
		}
	}
	return out
}

let source: () => Keymap | undefined = () => undefined
let builtFrom: Keymap | undefined = undefined
let effective = build(undefined)

/**
 * Where the keymap comes from: App passes `() => prefs.keymap`. The keys are rebuilt when it returns
 * another object, so a change must replace the pref, never edit it in place. Read inside a `$derived`
 * or an `$effect` (the menus, the Shortcuts dialog), the getter makes the reader follow the keymap.
 */
export function bindKeymap(get: () => Keymap | undefined) {
	source = get
	syncKeymap()
}

/** Rebuilds the keys if the keymap was replaced; App runs it in an effect, so the camera's keys follow at once. */
export function syncKeymap(): void {
	const km = source()
	if (km === builtFrom) return
	effective = build(km)
	builtFrom = km
}

function current(): Effective {
	syncKeymap()
	return effective
}

/** The keys of shortcut `id`, as the menus and the Shortcuts dialog show them; '' for a row left with none. */
export function keysOf(id: ShortcutId): string {
	const s = BY_ID.get(id)
	if (!s) return ''
	if (s.keys) return s.keys
	const e = current()
	if (s.codes) return (e.codes.get(id) ?? []).map(codeLabel).join(' / ')
	return (e.chords.get(id) ?? [])
		.filter((c) => !c.hidden)
		.map(chordLabel)
		.join(' / ')
}

/** A key hint for a status message: ` (T to fly freely)` with shortcut `id`'s current keys, or '' when the row has none, so a message follows a rebind (#710). */
export function keyHint(id: ShortcutId, what: string): string {
	const k = keysOf(id)
	return k ? ` (${k} ${what})` : ''
}

/** The first key of shortcut `id`, for the toolbar's buttons; '' when it has none. */
export function firstKeyOf(id: ShortcutId): string {
	const c = current()
		.chords.get(id)
		?.find((x) => !x.hidden)
	return c ? chordLabel(c) : ''
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

/** The command bound to key event `e` among the early chords (`early`) or the later ones, or null. */
export function commandFor(e: KeyLike, early: boolean): CommandId | null {
	for (const s of current().bound) for (const c of s.chords) if (isEarly(c) === early && chordMatches(c, e)) return s.id
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

// ---------------------------------------------------------------- rebinding (the Hotkey Manager)

/** Whether row `id` can be rebound: a command App binds or a camera movement. The rest are fixed. */
export function isBindable(id: string): boolean {
	const s = BY_ID.get(id)
	return !!(s && (s.chords || s.codes))
}

const isCamera = (id: string) => !!BY_ID.get(id)?.codes

/** Row `id`'s keys after the user's changes in `km`, as the keymap stores them. */
export function bindingsOf(id: string, km?: Keymap): string[] {
	const s = BY_ID.get(id)
	if (!s) return []
	if (s.codes) return [...rowCodes(s, km)]
	return rowChords(s, km)
		.filter((c) => !c.hidden)
		.map(chordText)
}

/** One of row `id`'s keys (as the keymap stores it) as the dialog shows it. */
export function bindingLabel(id: string, binding: string): string {
	if (isCamera(id)) return codeLabel(binding)
	const c = parseChord(binding)
	return c ? chordLabel(c) : binding
}

/** Whether `km` changes row `id`'s keys. */
export function isRebound(id: string, km: Keymap | undefined): boolean {
	return !!km && Object.hasOwn(km, id) && bindingsOf(id, km).join('\n') !== bindingsOf(id).join('\n')
}

/** `km` with row `id`'s keys set to `list`: a new object, without the row when `list` is its default. */
export function withBindings(km: Keymap | undefined, id: string, list: readonly string[]): Keymap {
	const out: Keymap = { ...km }
	const unique = [...new Set(list)]
	if (unique.join('\n') === bindingsOf(id).join('\n')) delete out[id]
	else out[id] = unique
	return out
}

/** Whether key `a` of row `idA` and key `b` of row `idB` would be the same press. */
function clash(idA: string, a: string, idB: string, b: string): boolean {
	const camA = isCamera(idA)
	const camB = isCamera(idB)
	if (camA && camB) return a === b
	if (camA || camB) {
		// The camera reads its key with any Shift (fast) and none of Ctrl.
		const code = camA ? a : b
		const c = parseChord(camA ? b : a)
		return !!c && !c.ctrl && c.key === codeKey(code)
	}
	const ca = parseChord(a)
	const cb = parseChord(b)
	return !!ca && !!cb && ca.key === cb.key && !!ca.ctrl === !!cb.ctrl && (isSymbol(ca.key) || !!ca.shift === !!cb.shift)
}

/**
 * `km` with `binding` put on row `id`, in place of its key at `index` (or added after them), and taken
 * off every other row that had the same press, so a key never runs two things. `moved` names the
 * rows it was taken from.
 */
export function assignBinding(km: Keymap | undefined, id: string, binding: string, index?: number): { keymap: Keymap; moved: string[] } {
	const moved: string[] = []
	let out: Keymap = { ...km }
	for (const s of SHORTCUTS) {
		if (s.id === id || !isBindable(s.id)) continue
		const keys = bindingsOf(s.id, out)
		const kept = keys.filter((k) => !clash(id, binding, s.id, k))
		if (kept.length === keys.length) continue
		out = withBindings(out, s.id, kept)
		moved.push(s.id)
	}
	const before = bindingsOf(id, out)
	const replaced = index === undefined ? undefined : before[index]
	const own = before.filter((k) => k === replaced || !clash(id, binding, id, k))
	if (replaced === undefined) own.push(binding)
	return { keymap: withBindings(out, id, replaced === undefined ? own : own.map((k) => (k === replaced ? binding : k))), moved }
}

/** `km` without row `id`'s key at `index`. */
export function removeBinding(km: Keymap | undefined, id: string, index: number): Keymap {
	return withBindings(
		km,
		id,
		bindingsOf(id, km).filter((_, i) => i !== index),
	)
}

/** Whether `km` has Q flying the camera up and E down (the "Q/E fly up and down" switch, #725). */
export function flyOnQE(km: Keymap | undefined): boolean {
	return bindingsOf('camUp', km).includes('KeyQ') && bindingsOf('camDown', km).includes('KeyE')
}

/**
 * `km` with the switch on or off. On, Q joins Fly up and E joins Fly down (the turns lose them, and
 * keep whatever other keys they have); off, they leave those rows and go back to the turns. It is
 * only the keymap, so the Hotkey Manager and the Shortcuts dialog show the truth.
 */
export function setFlyOnQE(km: Keymap | undefined, on: boolean): Keymap {
	if (on) return assignBinding(assignBinding(km, 'camUp', 'KeyQ').keymap, 'camDown', 'KeyE').keymap
	let out: Keymap = { ...km }
	const drop = (id: string, code: string) => {
		const i = bindingsOf(id, out).indexOf(code)
		if (i >= 0) out = removeBinding(out, id, i)
	}
	drop('camUp', 'KeyQ')
	drop('camDown', 'KeyE')
	out = assignBinding(out, 'camTurnLeft', 'KeyQ').keymap
	return assignBinding(out, 'camTurnRight', 'KeyE').keymap
}

/** `km` with row `id` back on its default keys. */
export function resetBindings(km: Keymap | undefined, id: string): Keymap {
	const out: Keymap = { ...km }
	delete out[id]
	return out
}

/** Modifier and system keys, never a binding by themselves. */
const MODIFIERS = new Set(['control', 'shift', 'alt', 'altgraph', 'meta', 'os', 'capslock', 'numlock', 'scrolllock', 'contextmenu', 'dead', 'unidentified', 'process', 'compose', 'fn'])

/** Keys the window keeps (reload, dev tools) and F8, which names the UI under the cursor. */
const WINDOW_KEYS = new Set(['f5', 'f8', 'f12'])

/** Keys the selection, the tools and the dialogs read themselves, plain. */
const ENGINE_KEYS = new Set(['escape', 'enter', 'delete', 'backspace', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown'])

/** Why `binding` cannot go on row `id`, or null when it can. */
export function refusal(id: string, binding: string): string | null {
	let k: string
	let ctrl = false
	if (isCamera(id)) {
		if (!isCode(binding) || /^(Shift|Control|Alt|Meta|OS)/.test(binding) || binding === 'CapsLock' || binding === 'ContextMenu') return 'Shift and Ctrl are the camera’s speed keys.'
		k = binding === 'NumpadEnter' ? 'enter' : binding.toLowerCase()
	} else {
		const c = parseChord(binding)
		if (!c) return 'That key cannot be bound.'
		k = c.key
		ctrl = !!c.ctrl
	}
	if (MODIFIERS.has(k)) return 'Press a key, with or without Ctrl and Shift.'
	if (WINDOW_KEYS.has(k)) return k === 'f8' ? 'F8 is kept for naming the UI under the cursor.' : `${k.toUpperCase()} is kept by the window.`
	if (!ctrl && ENGINE_KEYS.has(k)) return `${chordLabel({ key: k })} is read by the selection, the tools and the dialogs, and stays fixed.`
	return null
}

/** Plain keys a fixed row reads (the engine and the tools see them first): the row's id. */
const FIXED_KEYS: Record<string, string> = { h: 'hideSelected', r: 'spin', t: 'spray', z: 'placeTilt' }

/**
 * The fixed row that also reads `binding` on row `id`, for a warning: the selection or a tool takes
 * that key first, so the command runs only when they don't (H with no model selected).
 */
export function fixedClash(id: string, binding: string): Shortcut | null {
	let k: string | undefined
	if (isCamera(id)) k = codeKey(binding)
	else {
		const c = parseChord(binding)
		if (c && !c.ctrl) k = c.key
	}
	const row = k !== undefined ? FIXED_KEYS[k] : undefined
	return row ? (BY_ID.get(row) ?? null) : null
}

/** The binding a key press makes for row `id` (a code for a camera row, a chord's text otherwise), or why it makes none. */
export function bindingFromEvent(id: string, e: KeyLike & { altKey: boolean }): { binding: string } | { error: string } {
	if (e.altKey) return { error: 'Alt is kept for the pipette and the brush drag: press a key with or without Ctrl and Shift.' }
	if (isCamera(id)) {
		if (e.ctrlKey || e.metaKey) return { error: 'The camera keys take no Ctrl (Ctrl+Shift is very fast).' }
		return { binding: e.code }
	}
	return { binding: chordText({ key: e.key.toLowerCase(), ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }) }
}

/** Whether a key press is a modifier alone, which the Hotkey Manager waits past. */
export function isModifierKey(e: Pick<KeyboardEvent, 'key'>): boolean {
	return MODIFIERS.has(e.key.toLowerCase())
}

// The window's key handling as pure functions (#584): App.svelte's onKeyDown asks these whether a key
// stays with a form field or a window and where it goes, and runCommand steps the day cycle with
// stepCycle, so a Bun test (tests/keys.test.ts) checks the rules without the live app.

/** Input types that take no typing: a key on them is not text editing. */
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'])

/** The parts of a key's target these read: an element's tag, its editable flag and an input's type. */
export interface KeyTarget {
	tagName?: string
	isContentEditable?: boolean
	type?: string
}

/** The parts of a KeyboardEvent these read. */
export interface KeyPress {
	key: string
	ctrlKey: boolean
	metaKey: boolean
	altKey: boolean
	defaultPrevented?: boolean
	target: EventTarget | KeyTarget | null
}

/** Whether a key's target is a text field, another form control, or neither. */
export function formField(target: EventTarget | KeyTarget | null): 'text' | 'control' | null {
	const el = target as KeyTarget | null
	if (!el || !el.tagName) return null
	if (el.tagName === 'TEXTAREA' || el.isContentEditable) return 'text'
	if (el.tagName === 'SELECT') return 'control'
	if (el.tagName === 'INPUT') return NON_TEXT_INPUTS.has(el.type ?? '') ? 'control' : 'text'
	return null
}

/**
 * Whether a focused slider, select or checkbox keeps this key for itself. Only the keys it uses are
 * its own, so Delete and the tool letters still reach the map while the focus sits on a control
 * (after a click on an options-bar checkbox it stays there, #345). Ctrl+Z and Ctrl+Y always reach the map (#127).
 */
export function controlKeepsKey(e: KeyPress): boolean {
	const k = e.key.toLowerCase()
	if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) return false
	if (e.ctrlKey || e.metaKey || e.altKey) return true
	const el = (e.target ?? {}) as KeyTarget
	if (k === 'delete' || k === 'backspace') return false
	if (el.tagName === 'SELECT') return true
	if (k === 'escape') return false
	if (k === 'enter' || k === ' ' || k === 'tab') return true
	if (el.type === 'range' || el.type === 'radio') return k.startsWith('arrow') || k === 'home' || k === 'end' || k === 'pageup' || k === 'pagedown'
	return false
}

/** What is open over the map, as far as the keys go. */
export interface KeyGate {
	/** No engine yet, the New dialog or any dialog is open: no key reaches the map. */
	blocked: boolean
	/** The doodad brush editor takes every key (its own Esc closes it). */
	brushEditor: boolean
	/** The model preview window (#197) takes every key. */
	modelPreview: boolean
	inspector: boolean
	/** The quest, item, spell and character editors and the Icons tool: no undo steps of their own (their Save writes the database). */
	databaseEditor: boolean
	/** The creature and object editors: their spawn edits are undo steps, so undo and redo reach the map. */
	spawnEditor: boolean
}

/**
 * Where a key goes once the form fields have had it: nowhere (`none`), the Inspector's close
 * (`closeInspector`: Esc closes it alone, the selection stays), only undo and redo (`undoRedo`), or the
 * map's commands, selection and tool keys (`map`).
 */
export function keyRoute(e: Pick<KeyPress, 'key' | 'defaultPrevented'>, g: KeyGate): 'none' | 'closeInspector' | 'undoRedo' | 'map' {
	if (g.blocked || g.brushEditor) return 'none'
	// The preview window's Esc may have closed it before this runs.
	if (g.modelPreview || (e.key === 'Escape' && e.defaultPrevented)) return 'none'
	if (e.key === 'Escape' && g.inspector) return 'closeInspector'
	if (g.databaseEditor) return 'none'
	if (g.spawnEditor) return 'undoRedo'
	return 'map'
}

/** The day cycle's speeds, a day in so many minutes, slowest first; 0 is paused. */
export const CYCLE_MINUTES = [40, 20, 10, 5, 2, 1]

/** The next speed faster or slower than a day in `minutes` (0 paused); slower than the slowest pauses. */
export function stepCycle(minutes: number, faster: boolean): number {
	if (minutes <= 0) return faster ? CYCLE_MINUTES[0] : 0
	if (faster) return CYCLE_MINUTES.find((m) => m < minutes) ?? CYCLE_MINUTES[CYCLE_MINUTES.length - 1]
	return [...CYCLE_MINUTES].reverse().find((m) => m > minutes) ?? 0
}

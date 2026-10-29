// The shortcut table (#583): every bound key reaches one command, the menus take their shortcut text
// from the table, and the Shortcuts dialog lists every row.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	CAMERA_KEYS,
	SHORTCUTS,
	assignBinding,
	flyOnQE,
	setFlyOnQE,
	bindKeymap,
	bindingFromEvent,
	bindingLabel,
	bindingsOf,
	chordLabel,
	chordMatches,
	chordText,
	commandFor,
	fixedClash,
	isBindable,
	isEarly,
	isKeyOf,
	isOwnKey,
	pressed,
	isRebound,
	keyHint,
	keysOf,
	parseChord,
	refusal,
	removeBinding,
	resetBindings,
	shortcutSections,
	syncKeymap,
	withBindings,
	type Chord,
	type KeyLike,
	type Keymap,
	type ShortcutId,
} from '../src/lib/ui/commands'
import { TOOLS } from '../src/lib/ui/tools'

const press = (key: string, mods: { ctrl?: boolean; shift?: boolean; code?: string } = {}): KeyLike => ({
	key,
	code: mods.code ?? '',
	ctrlKey: !!mods.ctrl,
	metaKey: false,
	shiftKey: !!mods.shift,
})
/** The command a key press runs, early or late, as App's handler reads it. */
const run = (e: KeyLike) => commandFor(e, true) ?? (e.ctrlKey ? null : commandFor(e, false))

const src = (path: string) => readFileSync(join(import.meta.dir, '../src', path), 'utf8')

describe('shortcut table', () => {
	test('ids are unique', () => {
		const ids = SHORTCUTS.map((s) => s.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	test('every row has keys to show', () => {
		for (const s of SHORTCUTS) expect(keysOf(s.id as ShortcutId)).not.toBe('')
	})

	test('no two commands share a chord, nor two own rows', () => {
		const seen = new Map<string, string>()
		for (const s of SHORTCUTS)
			for (const c of s.chords ?? []) {
				if (s.own) {
					const sig = `own:${c.key}`
					expect(seen.get(sig) ?? s.id).toBe(s.id)
					seen.set(sig, s.id)
					continue
				}
				const sig = `${c.ctrl ? 'C' : ''}${c.shift ? 'S' : ''}:${c.key}`
				expect(seen.get(sig) ?? s.id).toBe(s.id)
				seen.set(sig, s.id)
			}
	})

	test('each chord matches the press it names, and only its own command', () => {
		for (const s of SHORTCUTS)
			for (const c of s.chords ?? []) {
				const e = press(c.key.length > 1 ? c.key[0].toUpperCase() + c.key.slice(1) : c.key, { ctrl: c.ctrl, shift: c.shift })
				expect(chordMatches(c, e)).toBe(true)
				if (s.own) {
					expect(pressed(s.id as never, e)).toBe(true)
					continue
				}
				expect(commandFor(e, isEarly(c))).toBe(s.id as never)
			}
	})

	test('the presses App binds', () => {
		expect(run(press('z', { ctrl: true }))).toBe('undo')
		expect(run(press('Z', { ctrl: true, shift: true }))).toBe('redo')
		expect(run(press('y', { ctrl: true }))).toBe('redo')
		expect(run(press('S', { ctrl: true, shift: true }))).toBe('saveAs')
		expect(run(press('D', { ctrl: true, shift: true }))).toBe('duplicate')
		expect(run(press('d', { ctrl: true }))).toBe('deselect')
		expect(run(press('Tab', { ctrl: true, shift: true }))).toBe('prevTab')
		expect(run(press('Tab'))).toBe('hidePanels')
		expect(run(press('+', { ctrl: true, shift: true }))).toBe('uiLarger')
		expect(run(press(')', { ctrl: true, shift: true, code: 'Digit0' }))).toBe(null)
		expect(run(press('0', { ctrl: true, code: 'Digit0' }))).toBe('uiReset')
		expect(run(press('0'))).toBe('tool:stamp')
		expect(run(press('k'))).toBe('tool:path')
		expect(run(press('b'))).toBe('tool:paint')
		expect(run(press('['))).toBe('brushSmaller')
		expect(run(press('{', { shift: true }))).toBe('falloffSofter')
		expect(run(press('N', { shift: true }))).toBe('cycleSlower')
		expect(run(press('n'))).toBe('cycleFaster')
		expect(run(press('H', { shift: true }))).toBe('unhideAll')
		expect(run(press('h'))).toBe(null)
		expect(run(press('F2', { shift: true }))).toBe('climbView')
		expect(run(press('PageDown', { ctrl: true }))).toBe('snapGround')
		// A Ctrl chord that is no command goes no further, so Ctrl+T is not T.
		expect(run(press('t', { ctrl: true }))).toBe(null)
	})

	test('the tool keys come from the toolbar', () => {
		for (const t of TOOLS) {
			expect(run(press(t.key.toLowerCase()))).toBe(`tool:${t.id}`)
			if (t.letter) expect(run(press(t.letter.toLowerCase()))).toBe(`tool:${t.id}`)
		}
	})

	test('labels', () => {
		const c = (key: string, ctrl = false, shift = false): Chord => ({ key, ctrl, shift })
		expect(chordLabel(c('z', true, true))).toBe('Ctrl+Shift+Z')
		expect(chordLabel(c('pagedown', true))).toBe('Ctrl+PgDn')
		expect(chordLabel(c('f2', false, true))).toBe('Shift+F2')
		expect(chordLabel(c('{'))).toBe('Shift+[')
		expect(keysOf('redo')).toBe('Ctrl+Y / Ctrl+Shift+Z')
		expect(keysOf('uiLarger')).toBe('Ctrl+=')
	})

	test('the Shortcuts dialog lists every row', () => {
		const rows = shortcutSections().flatMap(([, r]) => r.map((x) => x.id))
		expect(rows.sort()).toEqual(SHORTCUTS.map((s) => s.id).sort())
	})
})

describe('the menus and the dialogs use the table', () => {
	// The menus' items are built in lib/ui/menus.ts (#584).
	const menu = src('lib/ui/menus.ts')

	test('no menu shortcut is typed by hand', () => {
		expect(menu).not.toMatch(/shortcut:\s*['"`]/)
	})

	test('every id the menus name is in the table', () => {
		const ids = new Set(SHORTCUTS.map((s) => s.id))
		const named = [...menu.matchAll(/\b(?:cmd|toggle|keysOf)\('([^']+)'\)/g)].map((m) => m[1])
		expect(named.length).toBeGreaterThan(20)
		for (const id of named) expect(ids.has(id)).toBe(true)
	})

	test('the Shortcuts dialog has no list of its own', () => {
		expect(src('components/AppDialogs.svelte')).toContain('shortcutSections()')
	})

	test("App's key handler reads the table, not keys of its own", () => {
		const app = src('App.svelte')
		const handler = app.slice(app.indexOf('function onKeyDown'), app.indexOf('function onBeforeUnload'))
		expect(handler).toContain('commandFor(e, true)')
		expect(handler).not.toMatch(/key === '[a-z0-9]'/)
	})
})

describe('rebinding (#396)', () => {
	test('the defaults are what App bound before the keymap', () => {
		expect(bindingsOf('redo')).toEqual(['ctrl+y', 'ctrl+shift+z'])
		expect(bindingsOf('uiLarger')).toEqual(['ctrl+='])
		expect(bindingsOf('tool:select')).toEqual(['1', 'v'])
		expect(bindingsOf('camForward')).toEqual(['KeyW'])
		expect(bindingsOf('camDown')).toEqual(['KeyX', 'KeyC'])
		expect(CAMERA_KEYS.camUp).toEqual(['Space'])
		expect(isBindable('deleteSelected')).toBe(true)
		expect(isBindable('spinFine')).toBe(false)
		expect(bindingsOf('deleteSelected')).toEqual(['delete', 'backspace'])
		expect(keysOf('spinFine')).toBe('Alt+← / Alt+→')
		expect(keysOf('placeNudge')).toBe('↑ / ← / ↓ / →')
		expect(keysOf('doodadSpin')).toBe('Ctrl+scroll, R')
		expect(isBindable('grid')).toBe(true)
		expect(isBindable('camTurnLeft')).toBe(true)
	})

	test('chord text round-trips', () => {
		for (const s of SHORTCUTS)
			for (const c of s.chords ?? []) {
				const back = parseChord(chordText(c))
				expect(back && chordLabel(back)).toBe(chordLabel(c))
			}
		expect(parseChord('ctrl++')).toEqual({ key: '+', ctrl: true, shift: false })
		expect(parseChord('shift+{')).toEqual({ key: '{', ctrl: false, shift: false })
		expect(parseChord(' ')).toEqual({ key: ' ', ctrl: false, shift: false })
		expect(parseChord('ctrl+')).toBe(null)
		expect(parseChord('ctrl+page down')).toBe(null)
	})

	test('a keymap moves a command, and the key handler, the menus and the camera follow it', () => {
		let km: Keymap = {}
		bindKeymap(() => km)
		try {
			km = assignBinding(km, 'grid', 'ctrl+k').keymap
			expect(run(press('k', { ctrl: true }))).toBe('grid')
			expect(run(press('g'))).toBe('grid')
			expect(keysOf('grid')).toBe('G / Ctrl+K')
			km = assignBinding(km, 'grid', 'l', 0).keymap
			expect(run(press('g'))).toBe(null)
			expect(run(press('l'))).toBe('grid')
			expect(keysOf('grid')).toBe('L / Ctrl+K')

			km = assignBinding(km, 'camForward', 'KeyI', 0).keymap
			syncKeymap()
			expect(CAMERA_KEYS.camForward).toEqual(['KeyI'])
			// I was the inspector's: it leaves it.
			expect(bindingsOf('inspector', km)).toEqual([])
			expect(keysOf('inspector')).toBe('')
			expect(run(press('i'))).toBe(null)

			km = resetBindings(km, 'camForward')
			syncKeymap()
			expect(CAMERA_KEYS.camForward).toEqual(['KeyW'])
		} finally {
			bindKeymap(() => undefined)
		}
		expect(run(press('g'))).toBe('grid')
		expect(CAMERA_KEYS.camForward).toEqual(['KeyW'])
	})

	test('a key given to one command leaves the others', () => {
		const { keymap, moved } = assignBinding({}, 'saveAs', 'ctrl+z')
		expect(moved).toEqual(['undo'])
		expect(bindingsOf('undo', keymap)).toEqual([])
		expect(bindingsOf('saveAs', keymap)).toEqual(['ctrl+shift+s', 'ctrl+z'])
		// Shift+N and N are two presses; a symbol is told by its character.
		expect(assignBinding({}, 'grid', 'shift+n').moved).toEqual(['cycleSlower'])
		expect(assignBinding({}, 'grid', '{').moved).toEqual(['falloffSofter'])
		// A camera key takes the plain letter from a command, and a command takes a camera key.
		expect(assignBinding({}, 'camUp', 'KeyF').moved).toEqual(['focus'])
		expect(assignBinding({}, 'grid', 'q').moved).toEqual(['camTurnLeft'])
		expect(assignBinding({}, 'grid', 'ctrl+q').moved).toEqual([])
	})

	test('a row put back on its keys leaves the keymap', () => {
		let km = assignBinding({}, 'grid', 'ctrl+k').keymap
		expect(isRebound('grid', km)).toBe(true)
		km = removeBinding(km, 'grid', 1)
		expect(km).toEqual({})
		km = removeBinding(km, 'grid', 0)
		expect(km).toEqual({ grid: [] })
		expect(isRebound('grid', km)).toBe(true)
		expect(withBindings(km, 'grid', ['g'])).toEqual({})
	})

	test('a bad entry keeps the default', () => {
		const km: Keymap = { grid: ['ctrl+', 'page down'], camForward: ['w'], nonsense: ['x'] }
		expect(bindingsOf('grid', km)).toEqual(['g'])
		expect(bindingsOf('camForward', km)).toEqual(['KeyW'])
		bindKeymap(() => km)
		try {
			expect(run(press('g'))).toBe('grid')
		} finally {
			bindKeymap(() => undefined)
		}
	})

	test('reserved keys are refused, and keys the engine reads first are flagged', () => {
		expect(refusal('grid', 'delete')).not.toBe(null)
		expect(refusal('grid', 'arrowup')).not.toBe(null)
		expect(refusal('grid', 'f5')).not.toBe(null)
		expect(refusal('grid', 'f8')).not.toBe(null)
		expect(refusal('grid', 'ctrl+pagedown')).toBe(null)
		expect(refusal('camForward', 'ArrowUp')).not.toBe(null)
		expect(refusal('camForward', 'ShiftLeft')).not.toBe(null)
		expect(refusal('camForward', 'KeyI')).toBe(null)
		expect(fixedClash('grid', 'h')?.id).toBe('hideSelected')
		expect(fixedClash('grid', 'ctrl+h')).toBe(null)
		expect(fixedClash('grid', 'shift+r')?.id).toBe('spin')
		expect(fixedClash('camForward', 'KeyR')).toBe(null)
		expect(fixedClash('hideSelected', 'g')?.id).toBe('grid')
		expect(fixedClash('spray', 't')?.id).toBe('followGround')
	})

	test('the keys the selection and the tools read move like the rest (#711)', () => {
		let km: Keymap = {}
		bindKeymap(() => km)
		try {
			expect(pressed('deleteSelected', press('Delete'))).toBe(true)
			expect(pressed('deleteSelected', press('Backspace'))).toBe(true)
			expect(pressed('spin', press('R', { shift: true }))).toBe(true)
			expect(pressed('spin', press('r', { ctrl: true }))).toBe(false)
			expect(pressed('hideSelected', press('H', { shift: true }))).toBe(false)
			expect(pressed('nudgeLeft', press('ArrowLeft', { shift: true }))).toBe(true)

			// Delete on X: it leaves the camera's Fly down, and Delete no longer deletes.
			const r = assignBinding(km, 'deleteSelected', 'x', 0)
			expect(r.moved).toEqual(['camDown'])
			km = r.keymap
			expect(bindingsOf('camDown', km)).toEqual(['KeyC'])
			expect(pressed('deleteSelected', press('x'))).toBe(true)
			expect(pressed('deleteSelected', press('Delete'))).toBe(false)
			expect(keysOf('deleteSelected')).toBe('X / Backspace')

			// A command given T shares it with Paint's spray rather than taking it.
			const t = assignBinding(km, 'grid', 't')
			expect(t.moved).toEqual(['followGround'])
			expect(bindingsOf('spray', t.keymap)).toEqual(['t'])

			// Spin on Y: Shift+Y spins the other way, and a command with Shift+Y shares it.
			km = assignBinding(km, 'spin', 'y', 0).keymap
			expect(pressed('spin', press('Y', { shift: true }))).toBe(true)
			expect(keysOf('doodadSpin')).toBe('Ctrl+scroll, Y')
			expect(isKeyOf('placeTilt', press('Z', { ctrl: true }))).toBe(true)
			// Two own rows take a key from one another.
			expect(assignBinding(km, 'hideSelected', 'y').moved).toEqual(['spin'])
		} finally {
			bindKeymap(() => undefined)
		}
		expect(pressed('deleteSelected', press('Delete'))).toBe(true)
	})

	test('an own row refuses the keys read before it, and takes no Ctrl', () => {
		const ev = (key: string, m: { ctrl?: boolean; shift?: boolean } = {}) => ({ key, code: '', ctrlKey: !!m.ctrl, metaKey: false, shiftKey: !!m.shift, altKey: false })
		expect(isOwnKey('spin')).toBe(true)
		expect(isOwnKey('grid')).toBe(false)
		expect(refusal('deleteSelected', 'arrowup')).toBe(null)
		expect(refusal('escDeselect', 'escape')).toBe(null)
		expect(refusal('hideSelected', 'escape')).not.toBe(null)
		expect(refusal('hideSelected', 'enter')).not.toBe(null)
		expect(refusal('hideSelected', 'f6')).not.toBe(null)
		expect(refusal('hideSelected', 'tab')).not.toBe(null)
		expect(refusal('spin', '[')).not.toBe(null)
		expect(refusal('hideSelected', '[')).toBe(null)
		expect(bindingFromEvent('spin', ev('R', { shift: true }))).toEqual({ binding: 'r' })
		expect(bindingFromEvent('hideSelected', ev('H', { shift: true }))).toEqual({ binding: 'shift+h' })
		expect(bindingFromEvent('hideSelected', ev('h', { ctrl: true }))).toHaveProperty('error')
	})

	test('a key press makes a chord, or a code for the camera', () => {
		const ev = (key: string, code: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ key, code, ctrlKey: !!m.ctrl, metaKey: false, shiftKey: !!m.shift, altKey: !!m.alt })
		expect(bindingFromEvent('grid', ev('K', 'KeyK', { ctrl: true, shift: true }))).toEqual({ binding: 'ctrl+shift+k' })
		expect(bindingFromEvent('grid', ev('{', 'BracketLeft', { shift: true }))).toEqual({ binding: '{' })
		expect(bindingFromEvent('grid', ev('k', 'KeyK', { alt: true }))).toHaveProperty('error')
		expect(bindingFromEvent('camForward', ev('w', 'KeyW', { shift: true }))).toEqual({ binding: 'KeyW' })
		expect(bindingFromEvent('camForward', ev('w', 'KeyW', { ctrl: true }))).toHaveProperty('error')
		expect(bindingLabel('camUp', 'Space')).toBe('Space')
		expect(bindingLabel('grid', ' ')).toBe('Space')
	})
})

describe('Q/E fly switch (#725)', () => {
	test('on gives Q and E to up and down, off gives the turns back', () => {
		expect(flyOnQE({})).toBe(false)
		const on = setFlyOnQE({}, true)
		expect(flyOnQE(on)).toBe(true)
		expect(bindingsOf('camUp', on)).toEqual(['Space', 'KeyQ'])
		expect(bindingsOf('camDown', on)).toEqual(['KeyX', 'KeyC', 'KeyE'])
		expect(bindingsOf('camTurnLeft', on)).toEqual([])
		expect(bindingsOf('camTurnRight', on)).toEqual([])
		expect(setFlyOnQE(on, false)).toEqual({})
	})

	test('a status message names the key a command has now, and drops the clause when it has none (#710)', () => {
		let km: Keymap = {}
		bindKeymap(() => km)
		try {
			expect(keyHint('followGround', 'to fly freely')).toBe(' (T to fly freely)')
			km = assignBinding(km, 'followGround', 'y', 0).keymap
			expect(keyHint('followGround', 'to fly freely')).toBe(' (Y to fly freely)')
			km = removeBinding(km, 'followGround', 0)
			expect(keyHint('followGround', 'to fly freely')).toBe('')
		} finally {
			bindKeymap(() => undefined)
		}
	})
})

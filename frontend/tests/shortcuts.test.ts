// The shortcut table (#583): every bound key reaches one command, the menus take their shortcut text
// from the table, and the Shortcuts dialog lists every row.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SHORTCUTS, chordLabel, chordMatches, commandFor, isEarly, keysOf, shortcutSections, type Chord, type KeyLike, type ShortcutId } from '../src/lib/ui/commands'
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

	test('no two commands share a chord', () => {
		const seen = new Map<string, string>()
		for (const s of SHORTCUTS)
			for (const c of s.chords ?? []) {
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
	const menu = src('components/MenuBar.svelte')

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

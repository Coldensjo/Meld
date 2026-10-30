// Run with: bun test tests/editorWindows.test.ts
// The database editors in their own OS windows (#912, lib/toolwin/editors.ts): the target a window opens
// on, which slot opens which window, and the commands a window sends the main page.
import { expect, test } from 'bun:test'
import { EDITOR_SLOTS, EDITOR_WINDOWS, editorArgs, editorKindOf, editorTarget, queryArgs, readEditorCommand } from '../src/lib/toolwin/editors.ts'

test("a target goes through the window's query and back", () => {
	const args = editorArgs({ entry: -1 })
	// OpenToolWindow puts the arguments in the page's query, beside the kind.
	const search = '?' + new URLSearchParams({ ...args, window: 'item' }).toString()
	expect(editorTarget(queryArgs(search))).toEqual({ entry: -1 })
	expect(editorTarget({})).toBeNull()
	expect(editorTarget({ target: 'not json' })).toBeNull()
	expect(editorTarget({ target: '[1,2]' })).toBeNull()
	expect(editorTarget({ target: '7' })).toBeNull()
})

test('each window kind has its own slot, among the editor slots', () => {
	expect(editorKindOf('itemEditor')).toBe('item')
	expect(editorKindOf('creatureEditor')).toBe('')
	for (const slot of Object.values(EDITOR_WINDOWS)) expect(EDITOR_SLOTS as readonly string[]).toContain(slot)
})

test('an editor window command is read only when well formed', () => {
	expect(readEditorCommand({ type: 'open', slot: 'spellEditor', target: { entry: 5 } })).toEqual({ type: 'open', slot: 'spellEditor', target: { entry: 5 } })
	// Only an editor's slot: never another field of `ui`.
	expect(readEditorCommand({ type: 'open', slot: 'dialog', target: { entry: 5 } })).toBeNull()
	expect(readEditorCommand({ type: 'open', slot: 'spellEditor', target: 5 })).toBeNull()
	expect(readEditorCommand({ type: 'status', text: 'Saved.', timeout: 10000 })).toEqual({ type: 'status', text: 'Saved.', timeout: 10000 })
	expect(readEditorCommand({ type: 'status', text: 'Saved.' })).toEqual({ type: 'status', text: 'Saved.', timeout: 8000 })
	expect(readEditorCommand({ type: 'status' })).toBeNull()
	// Only the preferences the window writes, of the right type.
	expect(readEditorCommand({ type: 'prefs', prefs: { itemSort: 'quality', itemSortDesc: 'yes', theme: 'light' } })).toEqual({ type: 'prefs', prefs: { itemSort: 'quality' } })
	expect(readEditorCommand({ type: 'forget', forget: { items: [3, 'x', 4], looks: true } })).toEqual({ type: 'forget', forget: { items: [3, 4], itemIcons: false, looks: true } })
	expect(readEditorCommand({ type: 'forget' })).toBeNull()
	expect(readEditorCommand({ type: 'hello' })).toBeNull()
	// It went over Wails as JSON.
	const sent = JSON.parse(JSON.stringify({ type: 'forget', forget: { itemIcons: true } }))
	expect(readEditorCommand(sent)).toEqual({ type: 'forget', forget: { items: undefined, itemIcons: true, looks: false } })
})

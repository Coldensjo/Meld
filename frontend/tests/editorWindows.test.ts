// Run with: bun test tests/editorWindows.test.ts
// The database editors in their own OS windows (#912, lib/toolwin/editors.ts): the target a window opens
// on, which slot opens which window, and the commands a window sends the main page.
import { expect, test } from 'bun:test'
import { EDITOR_SLOTS, EDITOR_WINDOWS, editorArgs, editorKindOf, editorTarget, queryArgs, readEditorCommand, slotTarget } from '../src/lib/toolwin/editors.ts'
import type { vmangos } from '../src/lib/wails/models.ts'
import { MAP_CALL_NAMES, readMapCall, remoteMapActions, runMapCall, type MapActions, type MapCall } from '../src/lib/toolwin/spawnFields.ts'

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

test("a quest's giver goes through the window's query, and only a quest's (#914)", () => {
	const giver = { kind: 'creature' as const, id: 197, name: 'Marshal McBride', ready: true }
	const search = '?' + new URLSearchParams({ ...editorArgs({ entry: -1, giver }), window: 'quest' }).toString()
	expect(slotTarget('quest', queryArgs(search))).toEqual({ entry: -1, giver })
	expect(slotTarget('item', queryArgs(search))).toEqual({ entry: -1 })
	expect(slotTarget('quest', editorArgs({ entry: 5, giver: { kind: 'npc', id: 1, name: 'x', ready: true } }))).toEqual({ entry: 5 })
	expect(slotTarget('quest', {})).toEqual({ entry: 0 })
})

test('each window kind has its own slot, among the editor slots', () => {
	expect(editorKindOf('itemEditor')).toBe('item')
	expect(editorKindOf('spellEditor')).toBe('spell')
	expect(editorKindOf('questEditor')).toBe('quest')
	expect(editorKindOf('creatureEditor')).toBe('creature')
	expect(editorKindOf('objectEditor')).toBe('')
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
	expect(readEditorCommand({ type: 'forget', forget: { items: [3, 'x', 4], looks: true } })).toEqual({
		type: 'forget',
		forget: { items: [3, 4], itemIcons: false, looks: true, spells: undefined, spellTables: false, quests: undefined, questLists: false, creatureDisplays: false },
	})
	// A spell's save (#913): its row and name, and the tables when it added an icon.
	expect(readEditorCommand({ type: 'forget', forget: { spells: [133, null], spellTables: true } })).toEqual({
		type: 'forget',
		forget: { items: undefined, itemIcons: false, looks: false, spells: [133], spellTables: true, quests: undefined, questLists: false, creatureDisplays: false },
	})
	// A quest's save (#914): its name, and the Quests tabs' lists.
	expect(readEditorCommand({ type: 'forget', forget: { quests: [7], questLists: true, creatureDisplays: false } })).toEqual({
		type: 'forget',
		forget: { items: undefined, itemIcons: false, looks: false, spells: undefined, spellTables: false, quests: [7], questLists: true, creatureDisplays: false },
	})
	expect(readEditorCommand({ type: 'forget' })).toBeNull()
	expect(readEditorCommand({ type: 'hello' })).toBeNull()
	// It went over Wails as JSON.
	const sent = JSON.parse(JSON.stringify({ type: 'forget', forget: { itemIcons: true } }))
	expect(readEditorCommand(sent)).toEqual({ type: 'forget', forget: { items: undefined, itemIcons: true, looks: false, spells: undefined, spellTables: false, quests: undefined, questLists: false, creatureDisplays: false } })
})

test("a creature's spawn goes through the window's query (#915)", () => {
	const search = '?' + new URLSearchParams({ ...editorArgs({ key: 'c:79', entry: 197 }), window: 'creature' }).toString()
	expect(slotTarget('creature', queryArgs(search))).toEqual({ key: 'c:79', entry: 197 })
	// Opened on a template alone (the spawn browser, the Creatures workspace).
	expect(slotTarget('creature', editorArgs({ key: null, entry: 197 }))).toEqual({ key: null, entry: 197 })
	expect(slotTarget('creature', {})).toEqual({ key: null, entry: 0 })
	expect(slotTarget('item', editorArgs({ key: 'c:79', entry: 25 }))).toEqual({ entry: 25 })
})

test("a creature window's map actions and its open target reach the main page as commands (#915)", () => {
	const sent: MapCall[] = []
	const picked: string[] = []
	const switched: number[] = []
	const spawns = [{ guid: 80, entry: 197 }] as unknown as vmangos.WorldSpawn[]
	const act = remoteMapActions(
		(c) => sent.push(JSON.parse(JSON.stringify(c))),
		{ chooseWeapon: (key) => picked.push(key), spawns: () => spawns, keyOf: (s) => `c:${s.guid}` },
		(o) => switched.push(o.guid),
	)
	act.edit('c:79', { display: 5 }, 'Display (Marshal)')
	act.applyCreatureTemplate(197, { name: 'New' }, { name: 'Old' })
	act.chooseWeapon('c:79', 0)
	// A pool or formation mate is picked through the editor, which asks about its unsaved edits first.
	act.pickSpawn('c:80')
	act.pickSpawn('c:81')
	expect(sent).toEqual([
		{ name: 'edit', args: ['c:79', { display: 5 }, 'Display (Marshal)'] },
		{ name: 'applyCreatureTemplate', args: [197, { name: 'New' }, { name: 'Old' }] },
	])
	expect(picked).toEqual(['c:79'])
	expect(switched).toEqual([80])
	// The main page reads them back by name only, and runs them on its own actions.
	for (const c of sent) {
		const cmd = readEditorCommand({ type: 'map', ...c })
		expect(cmd).toEqual({ type: 'map', ...c })
	}
	expect(readEditorCommand({ type: 'map', name: 'chooseWeapon', args: [] })).toBeNull()
	expect(readEditorCommand({ type: 'map', name: 'toString', args: [] })).toBeNull()
	expect(readEditorCommand({ type: 'map', name: 'edit', args: 'x' })).toBeNull()
	const ran: unknown[][] = []
	const main = Object.fromEntries(MAP_CALL_NAMES.map((n) => [n, (...a: unknown[]) => ran.push([n, ...a])])) as unknown as MapActions
	const call = readMapCall('editPath', ['c:79'])
	expect(call).not.toBeNull()
	if (call) runMapCall(call, main)
	expect(ran).toEqual([['editPath', 'c:79']])
	expect(readEditorCommand({ type: 'target', target: { key: 'c:79', entry: 197 } })).toEqual({ type: 'target', target: { key: 'c:79', entry: 197 } })
	expect(readEditorCommand({ type: 'target', target: null })).toEqual({ type: 'target', target: null })
	expect(readEditorCommand({ type: 'target', target: { key: 5 } })).toBeNull()
	expect(readEditorCommand({ type: 'forget', forget: { creatureDisplays: true } })).toMatchObject({ type: 'forget', forget: { creatureDisplays: true } })
})

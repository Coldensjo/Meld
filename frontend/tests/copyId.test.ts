// Run with: bun test tests/copyId.test.ts
// Copy id (#681): the menu items that copy a thing's ids and name, and the menu a right-click opens.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'

const { copyItems, idOf, openIdMenu } = await import('../src/lib/ui/copyId.ts')
const { ui } = await import('../src/lib/state/editor.svelte.ts')

const labels = (items: { label?: string }[]) => items.map((i) => i.label ?? '-')

test('a template row is named by its entry, anything else by its id', () => {
	assert.deepEqual(idOf('item', 25), { what: 'item entry', id: 25 })
	assert.deepEqual(idOf('creature', 3), { what: 'creature entry', id: 3 })
	assert.deepEqual(idOf('spell', 133), { what: 'spell id', id: 133 })
	assert.deepEqual(idOf('faction template', 7), { what: 'faction template id', id: 7 })
})

test('the copy items list each id, then the name when there is one', () => {
	assert.deepEqual(labels(copyItems({ ids: [idOf('item', 25), { what: 'display id', id: 8 }], name: 'Worn Shortsword' })), ['Copy item entry 25', 'Copy display id 8', 'Copy name'])
	assert.deepEqual(labels(copyItems({ ids: [idOf('quest', 7)], name: '  ' })), ['Copy quest id 7'])
})

test('a right-click opens the copy menu below the row’s own actions, and nothing without an id or name', () => {
	let prevented = 0
	const e = { clientX: 4, clientY: 5, preventDefault: () => prevented++, stopPropagation: () => {} } as unknown as MouseEvent
	ui.contextMenu = null
	openIdMenu(e, { ids: [] })
	assert.equal(ui.contextMenu, null)
	assert.equal(prevented, 0)
	openIdMenu(e, { ids: [idOf('spell', 133)], name: 'Fireball' }, [{ label: 'Open', run: () => {} }])
	assert.equal(prevented, 1)
	assert.equal(ui.contextMenu!.title, 'Fireball')
	assert.deepEqual(labels(ui.contextMenu!.items), ['Open', '-', 'Copy spell id 133', 'Copy name'])
	ui.contextMenu = null
})

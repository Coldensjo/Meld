// Run with: bun test tests/gameCharacter.test.ts
// The Game Login character's test actions (#962): the level and mail items' labels, the items greyed
// out with the reason Go gives, and the open menu's items replaced once Go answers.
import './runes.ts'
import { afterAll, test } from 'bun:test'
import assert from 'node:assert/strict'

const g = globalThis as Record<string, unknown>
let reason = ''
const sent: string[] = []
g.go = {
	main: {
		App: {
			GameCharacter: async () => ({ character: 'Siz', reason }),
			SetCharacterLevel: async (level: number) => (sent.push(`level ${level}`), 'done'),
			MailItem: async (item: number, count: number) => (sent.push(`mail ${item}:${count}`), 'Mail sent to Siz'),
		},
	},
}
afterAll(() => {
	delete g.go
})

const { characterItems, levelAction, levelOf, mailAction } = await import('../src/lib/io/gameCharacter.ts')
const { ui } = await import('../src/lib/state/editor.svelte.ts')

const settle = () => new Promise((r) => setTimeout(r, 0))

test('a creature level range is the top of the range, at most 60', () => {
	assert.equal(levelOf(12, 12), '12')
	assert.equal(levelOf(10, 12), '10–12')
	assert.equal(levelAction(10, 12)?.label('Siz'), "Set Siz's level to 12 (this creature is 10–12)")
	assert.equal(levelAction(63, 63)?.label('Siz'), "Set Siz's level to 60 (this creature is 63)")
	assert.equal(levelAction(0, 0), null)
	assert.equal(mailAction(2589, 'Linen Cloth').label('Siz'), 'Mail to Siz')
	assert.equal(mailAction(2589, 'Linen Cloth', 20).label('Siz'), 'Mail 20 to Siz')
})

test('the items ask the server, then show its answer in the open menu, greyed out with the reason', async () => {
	reason = "the world server isn't running"
	const first = characterItems([mailAction(2589, 'Linen Cloth')])
	assert.equal(first.length, 1)
	assert.ok(first[0].disabled, 'greyed out until Go answers')
	ui.contextMenu = { x: 0, y: 0, title: 'Linen Cloth', items: [{ label: 'Open' }, ...first, { label: 'Copy name' }] }
	await settle()
	const items = ui.contextMenu?.items ?? []
	assert.deepEqual(
		items.map((i) => i.label),
		['Open', 'Mail to Siz', 'Copy name'],
	)
	assert.ok(items[1].disabled)
	assert.equal(items[1].hint, "The world server isn't running")

	reason = ''
	const ready = characterItems([mailAction(2589, 'Linen Cloth', 20), levelAction(5, 5)!])
	assert.ok(
		ready.every((i) => i.disabled),
		'still the last answer until Go answers again',
	)
	ui.contextMenu = { x: 0, y: 0, title: 'Linen Cloth', items: ready }
	await settle()
	const live = ui.contextMenu?.items ?? []
	assert.ok(live.every((i) => !i.disabled))
	live.forEach((i) => i.run?.())
	await settle()
	assert.deepEqual(sent, ['mail 2589:20', 'level 5'])
	ui.contextMenu = null
})

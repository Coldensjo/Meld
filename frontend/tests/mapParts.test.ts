// Run with: bun test tests/mapParts.test.ts
// A map too large for one binding call is saved in parts: Wails refuses a call over 64 MB ("assembled
// body too large"), which saving a big map (Cmd-S on a large client region) passed. A small map still
// goes whole; a big one in parts that join into its JSON, under a "map-" id.
import './runes.ts'
import { afterAll, test } from 'bun:test'
import assert from 'node:assert/strict'

const g = globalThis as Record<string, unknown>
const calls: string[] = []
let parts: string[] = []
g.go = {
	main: {
		App: {
			SendRegionEditPart: async (_id: string, index: number, part: string) => {
				calls.push(`part ${index}`)
				if (index === 0) parts = []
				parts.push(part)
			},
			DropRegionEditParts: async () => void calls.push('drop'),
		},
	},
}
afterAll(() => {
	delete g.go
})

const { PART_CHARS, sendInParts } = await import('../src/lib/io/inParts.ts')
const save = (path: string) => [async () => void calls.push(`whole ${path}`), async (id: string) => void calls.push(`parts ${path} ${id.startsWith('map-')}`)] as const

test('a small map is saved whole', async () => {
	calls.length = 0
	const [whole, inParts] = save('a.meld')
	await sendInParts('map', { name: 'Outland', heights: 'AAAA' }, whole, inParts)
	assert.deepEqual(calls, ['whole a.meld'])
})

test('a big map is saved in parts that join into its JSON', async () => {
	calls.length = 0
	const map = { name: 'Outland', heights: 'A'.repeat(PART_CHARS * 2 + 5) }
	const [whole, inParts] = save('b.meld')
	await sendInParts('map', map, whole, inParts)
	assert.deepEqual(calls, ['part 0', 'part 1', 'part 2', 'parts b.meld true'])
	assert.equal(parts.join(''), JSON.stringify(map))
})

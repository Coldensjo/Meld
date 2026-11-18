// Run with: bun test tests/regionParts.test.ts
// A region edit too large for one binding call goes to Go in parts: Wails refuses a call over 64 MB
// ("assembled body too large"), which a big region's compile and Changes window passed. A small edit
// still goes whole; a big one in parts that join into its JSON, and parts that fail are dropped.
import './runes.ts'
import { afterAll, test } from 'bun:test'
import assert from 'node:assert/strict'

const g = globalThis as Record<string, unknown>
const calls: string[] = []
let parts: string[] = []
let failAt = -1
g.go = {
	main: {
		App: {
			SaveRegion: async () => (calls.push('whole'), { tiles: 1 }),
			SendRegionEditPart: async (_id: string, index: number, part: string) => {
				if (index === failAt) throw new Error('bridge down')
				calls.push(`part ${index}`)
				if (index === 0) parts = []
				parts.push(part)
			},
			SaveRegionParts: async (id: string) => (calls.push(`parts ${id.startsWith('region-')}`), { tiles: 2 }),
			DropRegionEditParts: async () => void calls.push('drop'),
		},
	},
}
afterAll(() => {
	delete g.go
})

const { REGION_PART_CHARS, saveRegion } = await import('../src/lib/io/compile.ts')
type Edit = Parameters<typeof saveRegion>[0]

test('a small region edit goes whole', async () => {
	calls.length = 0
	const res = await saveRegion({ mapName: 'Azeroth', x: 31, y: 49, size: 1, heights: 'AAAA' } as Edit)
	assert.deepEqual(calls, ['whole'])
	assert.equal(res.tiles, 1)
})

test('a region edit over one call goes in parts that join into its JSON', async () => {
	calls.length = 0
	failAt = -1
	const edit = { mapName: 'Azeroth', x: 28, y: 46, size: 8, heights: 'A'.repeat(REGION_PART_CHARS * 2 + 5) } as Edit
	const res = await saveRegion(edit)
	assert.deepEqual(calls, ['part 0', 'part 1', 'part 2', 'parts true'])
	assert.equal(parts.join(''), JSON.stringify(edit))
	assert.ok(parts.every((p) => p.length <= REGION_PART_CHARS))
	assert.equal(res.tiles, 2)
})

test('parts that fail to send are dropped and the save is not made', async () => {
	calls.length = 0
	failAt = 1
	await assert.rejects(saveRegion({ mapName: 'Azeroth', x: 28, y: 46, size: 8, heights: 'A'.repeat(REGION_PART_CHARS + 5) } as Edit), /bridge down/)
	assert.deepEqual(calls, ['part 0', 'drop'])
})

import './runes.ts'
import { describe, expect, test } from 'bun:test'
import { RowList, moveRow, removeRow } from '../src/lib/ui/rowList.svelte.ts'

type Row = { item: number; count: number; name: string }

/** A list read from `db`, keyed on item and count only (the name is shown, not saved). */
function list(db: { rows: Row[] }) {
	return new RowList<Row[]>({
		empty: [],
		read: async () => db.rows.map((r) => ({ ...r })),
		key: (l) => JSON.stringify(l.map((r) => [r.item, r.count])),
	})
}

describe('RowList', () => {
	test('is clean before and after a read', async () => {
		const db = { rows: [{ item: 1, count: 2, name: 'a' }] }
		const l = list(db)
		expect(l.dirty).toBe(false)
		expect(await l.load()).toBe(true)
		expect(l.rows).toHaveLength(1)
		expect(l.dirty).toBe(false)
	})

	test('an edit to a keyed field is dirty, one to another field is not', async () => {
		const l = list({ rows: [{ item: 1, count: 2, name: 'a' }] })
		await l.load()
		l.rows[0].name = 'b'
		expect(l.dirty).toBe(false)
		l.rows[0].count = 3
		expect(l.dirty).toBe(true)
		l.rows[0].count = 2
		expect(l.dirty).toBe(false)
	})

	test('rows added before the first read count as an edit', () => {
		const l = list({ rows: [] })
		l.rows = [{ item: 5, count: 1, name: '' }]
		expect(l.dirty).toBe(true)
	})

	test('revert reads the rows again', async () => {
		const db = { rows: [{ item: 1, count: 2, name: 'a' }] }
		const l = list(db)
		await l.load()
		l.rows = removeRow(l.rows, 0)
		expect(l.dirty).toBe(true)
		await l.revert()
		expect(l.rows.map((r) => r.item)).toEqual([1])
		expect(l.dirty).toBe(false)
	})

	test('save marks what it wrote, and keeps the edits on a failure', async () => {
		const db = { rows: [{ item: 1, count: 2, name: 'a' }] }
		const l = list(db)
		await l.load()
		l.rows[0].count = 4
		expect(await l.save('Saving', async () => Promise.reject(new Error('no server')))).toBe(false)
		expect(l.error).toContain('no server')
		expect(l.dirty).toBe(true)
		expect(l.saving).toBe(false)
		expect(
			await l.save('Saving', async (rows) => {
				db.rows = rows.map((r) => ({ ...r }))
			}),
		).toBe(true)
		expect(l.error).toBe('')
		expect(l.dirty).toBe(false)
		expect(db.rows[0].count).toBe(4)
	})

	test('a read overtaken by a later one is dropped', async () => {
		const answers: ((r: Row[]) => void)[] = []
		const l = new RowList<Row[]>({ empty: [], read: () => new Promise((res) => answers.push(res)) })
		const first = l.load()
		const second = l.load()
		answers[1]([{ item: 2, count: 1, name: '' }])
		answers[0]([{ item: 1, count: 1, name: '' }])
		expect(await second).toBe(true)
		expect(await first).toBe(false)
		expect(l.rows.map((r) => r.item)).toEqual([2])
		expect(l.loading).toBe(false)
	})

	test('a failed read leaves an error and the rows as they were', async () => {
		const l = new RowList<Row[]>({ empty: [], read: () => Promise.reject(new Error('gone')) })
		expect(await l.load()).toBe(false)
		expect(l.error).toContain('gone')
		expect(l.loading).toBe(false)
		expect(l.rows).toEqual([])
	})

	test('set puts rows in as saved', () => {
		const l = new RowList<number[]>({ empty: [] })
		l.set([1, 2])
		expect(l.dirty).toBe(false)
		l.rows.push(3)
		expect(l.dirty).toBe(true)
		expect(l.saved).toBe('[1,2]')
	})
})

describe('moveRow and removeRow', () => {
	test('moveRow swaps neighbours and returns a new array', () => {
		const a = [1, 2, 3]
		const b = moveRow(a, 0, 1)
		expect(b).toEqual([2, 1, 3])
		expect(a).toEqual([1, 2, 3])
		expect(moveRow(a, 2, -2)).toEqual([3, 2, 1])
	})

	test('moveRow past an end returns the rows as they are', () => {
		const a = [1, 2, 3]
		expect(moveRow(a, 0, -1)).toBe(a)
		expect(moveRow(a, 2, 1)).toBe(a)
		expect(moveRow(a, 5, -1)).toBe(a)
	})

	test('removeRow drops one row', () => {
		expect(removeRow([1, 2, 3], 1)).toEqual([1, 3])
		expect(removeRow([1, 2, 3], 7)).toEqual([1, 2, 3])
	})
})

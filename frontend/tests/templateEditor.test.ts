import './runes.ts'
import { describe, expect, test } from 'bun:test'
import { TemplateEditor, checkRefused, tabChangeCounts } from '../src/lib/ui/templateEditor.svelte.ts'

type Target = { entry: number }
type Row = { entry: number; values: Record<string, string> }

/** An editor over `db`, whose reads wait for `gate` when one is set. */
function editor(db: Record<number, Record<string, string>>, extra: { dirty?: () => boolean } = {}) {
	const state = { target: null as Target | null, closed: 0, opened: [] as string[], reverted: 0, discarded: 0, gate: null as Promise<void> | null }
	const ed = new TemplateEditor<Target, Row>({
		id: (t) => String(t.entry),
		entry: (t) => t.entry,
		read: async (entry) => {
			const g = state.gate
			if (g) await g
			if (!db[entry]) throw new Error(`no row ${entry}`)
			return { entry, values: { ...db[entry] } }
		},
		clear: () => {
			state.target = null
			state.closed++
		},
		dirty: extra.dirty,
		onopen: (t, before) => state.opened.push(`${before}>${t.entry}`),
		onrevert: () => state.reverted++,
		ondiscard: () => state.discarded++,
	})
	const open = async (t: Target | null) => {
		state.target = t
		ed.open(t)
		await Bun.sleep(0)
	}
	return { ed, state, open }
}

describe('TemplateEditor', () => {
	test('opening reads the row, and opening it again does not', async () => {
		const { ed, state, open } = editor({ 1: { name: 'a' } })
		await open({ entry: 1 })
		expect(ed.record?.entry).toBe(1)
		expect(ed.values.name).toBe('a')
		expect(ed.unsaved).toBe(false)
		ed.values.name = 'b'
		await open({ entry: 1 })
		expect(ed.values.name).toBe('b')
		expect(state.opened).toEqual(['>1'])
	})

	test('an edit is a change until saved or reverted', async () => {
		const { ed, state, open } = editor({ 1: { name: 'a', level: '1' } })
		await open({ entry: 1 })
		ed.values.level = '2'
		expect(ed.changes).toEqual({ level: '2' })
		expect(ed.changeCount).toBe(1)
		ed.revert()
		expect(ed.changeCount).toBe(0)
		expect(state.reverted).toBe(1)
		ed.values.level = '3'
		ed.markSaved()
		expect(ed.unsaved).toBe(false)
	})

	test('a read that a later opening overtook is dropped', async () => {
		const { ed, state, open } = editor({ 1: { name: 'one' }, 2: { name: 'two' } })
		let release = () => {}
		state.gate = new Promise((r) => (release = r))
		await open({ entry: 1 })
		state.gate = null
		await open({ entry: 2 })
		expect(ed.values.name).toBe('two')
		release()
		await Bun.sleep(0)
		expect(ed.values.name).toBe('two')
		expect(ed.record?.entry).toBe(2)
	})

	test('a read that a close overtook is dropped', async () => {
		const { ed, state, open } = editor({ 1: { name: 'one' } })
		let release = () => {}
		state.gate = new Promise((r) => (release = r))
		await open({ entry: 1 })
		ed.close()
		release()
		await Bun.sleep(0)
		expect(ed.record).toBe(null)
		expect(ed.loading).toBe(false)
		expect(state.closed).toBe(1)
	})

	test('a failed read shows its error', async () => {
		const { ed, open } = editor({})
		await open({ entry: 9 })
		expect(ed.error).toContain('no row 9')
		expect(ed.loading).toBe(false)
	})

	test('closing with unsaved changes asks, and Discard then closes', async () => {
		const { ed, state, open } = editor({ 1: { name: 'a' } })
		await open({ entry: 1 })
		ed.values.name = 'b'
		ed.close()
		expect(ed.confirmClose).toBe(true)
		expect(state.closed).toBe(0)
		ed.discard()
		expect(state.closed).toBe(1)
		expect(state.discarded).toBe(1)
		expect(ed.values.name).toBe('a')
		expect(ed.confirmClose).toBe(false)
	})

	test('leave runs at once when nothing is unsaved, else after Discard', async () => {
		let tabDirty = false
		const { ed, state, open } = editor({ 1: { name: 'a' } }, { dirty: () => tabDirty })
		await open({ entry: 1 })
		let went = 0
		ed.leave(() => went++)
		expect(went).toBe(1)
		tabDirty = true
		ed.leave(() => went++)
		expect(went).toBe(1)
		expect(ed.confirmClose).toBe(true)
		ed.discard()
		expect(went).toBe(2)
		expect(state.closed).toBe(0)
	})

	test('an opening drops a pending leave', async () => {
		const { ed, state, open } = editor({ 1: { name: 'a' }, 2: { name: 'b' } })
		await open({ entry: 1 })
		ed.values.name = 'x'
		let went = 0
		ed.leave(() => went++)
		await open({ entry: 2 })
		expect(ed.confirmClose).toBe(false)
		ed.close()
		expect(went).toBe(0)
		expect(state.closed).toBe(1)
	})

	test('closed from outside, the same target reads afresh on its next opening', async () => {
		const db = { 1: { name: 'a' } }
		const { ed, open } = editor(db)
		await open({ entry: 1 })
		await open(null)
		db[1].name = 'changed'
		await open({ entry: 1 })
		expect(ed.values.name).toBe('changed')
	})

	test('reopen makes the same target read again', async () => {
		const db = { 1: { name: 'a' } }
		const { ed, open } = editor(db)
		await open({ entry: 1 })
		db[1].name = 'imported'
		ed.reopen()
		await open({ entry: 1 })
		expect(ed.values.name).toBe('imported')
	})

	test('a refused save shows its error and names the column', async () => {
		const { ed, open } = editor({ 1: { name: 'a' } })
		await open({ entry: 1 })
		let col = ''
		const ok = await ed.save(
			'Saving',
			async () => {
				checkRefused({ sql: '', refused: { column: 'RequiredLevel', message: 'RequiredLevel must be at most 60' } })
			},
			(c) => (col = c),
		)
		expect(ok).toBe(false)
		expect(ed.error).toBe('Error: RequiredLevel must be at most 60')
		expect(col).toBe('RequiredLevel')
		expect(ed.saving).toBe(false)
		expect(await ed.save('Saving', async () => {})).toBe(true)
		expect(ed.error).toBe('')
	})
})

test('a failure that refuses no value names no column', async () => {
	const { ed } = editor({})
	let col: string | null = null
	expect(
		await ed.save(
			'Saving',
			async () => Promise.reject(new Error('MinLevel the database is down')),
			(c) => (col = c),
		),
	).toBe(false)
	expect(ed.error).toBe('Error: MinLevel the database is down')
	expect(col).toBe(null)
})

test('checkRefused passes a result that refuses nothing', () => {
	const r: { sql: string; refused?: { column: string; message: string } } = { sql: 'UPDATE' }
	expect(checkRefused(r)).toBe(r)
})

test('tabChangeCounts counts the changed fields of each tab', () => {
	const tabs = [
		{ id: 'a', groups: [{ fields: [{ col: 'x' }, { col: 'y' }] }] },
		{ id: 'b', groups: [{ fields: [{ col: 'z' }] }, { fields: [{ col: 'w' }] }] },
	]
	const n = tabChangeCounts(tabs, { x: '1', w: '2', z: '3' })
	expect(n.get('a')).toBe(1)
	expect(n.get('b')).toBe(2)
})

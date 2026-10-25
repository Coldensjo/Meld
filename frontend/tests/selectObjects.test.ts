import './runes.ts'
import { expect, test } from 'bun:test'
import type { ObjectLayer } from '../src/lib/world/ObjectLayer'
import { editor } from '../src/lib/state/editor.svelte.ts'
import { selectObjects } from '../src/lib/state/selection'

function layer(n: number): ObjectLayer {
	const objects = new Map<number, { id: number }>()
	for (let i = 1; i <= n; i++) objects.set(i, { id: i })
	return { objects } as unknown as ObjectLayer
}

test('selectObjects drops duplicates and missing ids and keeps the order', () => {
	selectObjects(layer(5), [3, 1, 3, 9, 2, 1])
	expect([...editor.selectedIds]).toEqual([3, 1, 2])
	expect(editor.selected).toBeNull()
})

test('selectObjects makes a lone object its own primary and honours a given one', () => {
	selectObjects(layer(5), [4])
	expect(editor.selected?.id).toBe(4)
	selectObjects(layer(5), [1, 2, 3], 2)
	expect(editor.selected?.id).toBe(2)
	selectObjects(layer(5), [1, 2, 3], 9)
	expect(editor.selected).toBeNull()
})

test('selectObjects is linear in the selection size', () => {
	const l = layer(200000)
	const ids = [...l.objects.keys()]
	const t = performance.now()
	selectObjects(l, ids)
	expect(editor.selectedIds.length).toBe(200000)
	expect(performance.now() - t).toBeLessThan(1000)
})

test("selectObjects selects nothing in a look-only layer (a world view's streamed models, #15)", () => {
	const l = layer(5)
	l.lookOnly = true
	selectObjects(l, [1, 2, 3], 2)
	expect(editor.selectedIds.length).toBe(0)
	expect(editor.selected).toBeNull()
})

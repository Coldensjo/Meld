// Run with: bun test tests/doodadBrushWindow.test.ts
// The doodad brush editor in its own OS window (#911, lib/toolwin/doodadBrushes.ts): the commands the
// window sends and how the main page reads them, the thumbnail reply, the store helpers the editor uses
// in both pages, and the window's sync, which drops a view sent before the main page took its last edit.
import { expect, test } from 'bun:test'
import { BrushSync, brushesView, readBrushesCommand, readThumbReply } from '../src/lib/toolwin/doodadBrushes.ts'
import { readReply } from '../src/lib/toolwin/channel.ts'
import { activeBrushIn, addBrushTo, newBrush, newEntry, type BrushStore } from '../src/lib/tools/doodadBrush.ts'

const brush = () => ({ ...newBrush('Trees'), entries: [newEntry('m2:world/tree.m2')] })
const view = (store: BrushStore, ack: number) => brushesView(store, ack, { loaded: true, revision: 3 }, { browserNames: true, fpsLimit: 0 })

test('a set is read with its brushes, and refused when they have the wrong shape', () => {
	const sent = JSON.parse(JSON.stringify({ type: 'set', seq: 4, brushes: [brush()], active: 'Trees' }))
	expect(readBrushesCommand(sent)).toEqual({ type: 'set', seq: 4, brushes: [brush()], active: 'Trees' })
	expect(readBrushesCommand({ type: 'set', seq: 4, brushes: [{ name: 'x', entries: 3 }], active: 'x' })).toBeNull()
	expect(readBrushesCommand({ type: 'set', seq: 1.5, brushes: [], active: '' })).toBeNull()
	expect(readBrushesCommand({ type: 'set', seq: 1, active: '' })).toBeNull()
})

test('the other commands', () => {
	expect(readBrushesCommand({ type: 'thumb', key: 'm2:world/tree.m2' })).toEqual({ type: 'thumb', key: 'm2:world/tree.m2' })
	expect(readBrushesCommand({ type: 'thumb', key: 'prefab:abc' })).toBeNull()
	expect(readBrushesCommand({ type: 'thumb' })).toBeNull()
	expect(readBrushesCommand({ type: 'paint', extra: 1 })).toEqual({ type: 'paint' })
	expect(readBrushesCommand({ type: 'import' })).toEqual({ type: 'import' })
	expect(readBrushesCommand({ type: 'export' })).toEqual({ type: 'export' })
	expect(readBrushesCommand({ type: 'status', text: 'hi' })).toEqual({ type: 'status', text: 'hi' })
	expect(readBrushesCommand({ type: 'status', text: 3 })).toBeNull()
	expect(readBrushesCommand({ type: 'go', to: 1 })).toBeNull()
})

test('the thumbnail reply goes by kind and key', () => {
	const r = readReply(JSON.parse(JSON.stringify({ kind: 'doodad-brushes', reply: { type: 'thumb', key: 'm2:a.m2', ok: true } })), 'doodad-brushes')
	expect(r && readThumbReply(r)).toEqual({ type: 'thumb', key: 'm2:a.m2', ok: true })
	expect(readReply({ kind: 'history', reply: {} }, 'doodad-brushes')).toBeNull()
	expect(readThumbReply({ type: 'thumb', key: 'm2:a.m2' })).toBeNull()
})

test('the store helpers pick and add as the Doodad Brush tool does', () => {
	const store: BrushStore = { doodadBrushes: [], doodadBrush: '' }
	expect(activeBrushIn(store)).toBeNull()
	addBrushTo(store)
	addBrushTo(store)
	expect(store.doodadBrushes.map((b) => b.name)).toEqual(['New brush', 'New brush 2'])
	expect(activeBrushIn(store)?.name).toBe('New brush 2')
	store.doodadBrush = 'gone'
	expect(activeBrushIn(store)?.name).toBe('New brush')
})

test('the window sends an edit once, and drops a view older than its last edit', () => {
	const sync = new BrushSync()
	const store: BrushStore = { doodadBrushes: [brush()], doodadBrush: 'Trees' }
	expect(sync.take(view(store, 0))).toBe(true)
	// The view as taken is no edit.
	expect(sync.edit(store)).toBeNull()
	store.doodadBrushes[0].entries[0].weight = 50
	expect(sync.edit(store)).toBe(1)
	expect(sync.edit(store)).toBeNull()
	store.doodadBrushes[0].entries[0].weight = 60
	expect(sync.edit(store)).toBe(2)
	// The view the main page sent after taking edit 1, but before edit 2, would undo it.
	expect(sync.take(view({ doodadBrushes: [{ ...brush(), entries: [{ ...newEntry('m2:world/tree.m2'), weight: 50 }] }], doodadBrush: 'Trees' }, 1))).toBe(false)
	expect(sync.take(view(store, 2))).toBe(true)
	// A change made on the main page (another brush picked) comes in with the same number and is taken.
	expect(sync.take(view({ ...store, doodadBrush: 'Other' }, 2))).toBe(true)
	expect(sync.edit({ ...store, doodadBrush: 'Other' })).toBeNull()
})

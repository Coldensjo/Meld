// Run with: bun test tests/inspectorWindow.test.ts
// The Inspector in its own OS window (#910, lib/toolwin/inspector.ts): the commands its window sends,
// read back on the main page, a scrub's live edits sent once a frame, scrubs that arrive out of order
// making one undo step each, and the spawns its pool and formation fields are given.
import { expect, test } from 'bun:test'
import { CALL_NAMES, EditGestures, cleanPatch, readInspectorCommand, relatedSpawns, remoteActions, runInspectorCommand, type InspectorActions, type InspectorCommand } from '../src/lib/toolwin/inspector.ts'
import type { vmangos } from '../src/lib/wails/models.ts'

/** Sends through JSON, as the commands go over Wails, and reads them back as the main page does. */
function channel() {
	const sent: InspectorCommand[] = []
	const send = (cmd: InspectorCommand) => {
		const back = readInspectorCommand(JSON.parse(JSON.stringify(cmd)))
		if (!back) throw new Error(`unreadable command ${JSON.stringify(cmd)}`)
		sent.push(back)
	}
	return { sent, send }
}

/** Actions that log what runs, as the main page's would run it. */
function recorder() {
	const log: string[] = []
	const act: Record<string, unknown> = {
		start: () => log.push('start'),
		live: (p: object) => log.push(`live ${JSON.stringify(p)}`),
		commit: (p: object) => log.push(`commit ${JSON.stringify(p)}`),
	}
	for (const name of CALL_NAMES) act[name] = (...args: unknown[]) => log.push(`${name} ${JSON.stringify(args)}`)
	return { log, act: act as unknown as InspectorActions }
}

test('a scrub sends its live edits once a frame, the latest only, and its commit at once', () => {
	const { sent, send } = channel()
	const frames: Array<() => void> = []
	const act = remoteActions(send, (fn) => frames.push(fn))
	act.start()
	act.live({ yOff: 1 })
	act.live({ yOff: 2 })
	act.live({ x: 5 })
	expect(sent).toHaveLength(0)
	expect(frames).toHaveLength(1)
	frames.shift()!()
	expect(sent).toHaveLength(1)
	expect(sent[0]).toMatchObject({ type: 'edit', commit: false, patch: { yOff: 2, x: 5 } })
	act.live({ yOff: 3 })
	act.commit({ yOff: 4 })
	// The frame's pending live edit was overtaken by the commit.
	frames.shift()!()
	expect(sent).toHaveLength(2)
	expect(sent[1]).toMatchObject({ type: 'edit', commit: true, patch: { yOff: 4 } })
	expect((sent[1] as { gesture: number }).gesture).toBe((sent[0] as { gesture: number }).gesture)
	// The next scrub has a later number.
	act.start()
	act.commit({ yOff: 0 })
	expect((sent[2] as { gesture: number }).gesture).toBeGreaterThan((sent[1] as { gesture: number }).gesture)
})

test('every other action goes as a call by name, with its arguments', () => {
	const { sent, send } = channel()
	const act = remoteActions(send, () => {})
	act.selectType('m2:a.m2', true)
	act.poolSetting('object/7', { poolLimit: 2 }, 'Pool limit')
	act.deselect()
	expect(sent).toEqual([
		{ type: 'call', name: 'selectType', args: ['m2:a.m2', true] },
		{ type: 'call', name: 'poolSetting', args: ['object/7', { poolLimit: 2 }, 'Pool limit'] },
		{ type: 'call', name: 'deselect', args: [] },
	])
	const { log, act: main } = recorder()
	const gestures = new EditGestures()
	for (const c of sent) expect(runInspectorCommand(c, main, gestures)).toBe(true)
	expect(log).toEqual(['selectType ["m2:a.m2",true]', 'poolSetting ["object/7",{"poolLimit":2},"Pool limit"]', 'deselect []'])
})

test('the main page reads only well-formed commands', () => {
	expect(readInspectorCommand({ type: 'call', name: 'deselect', args: [] })).toEqual({ type: 'call', name: 'deselect', args: [] })
	expect(readInspectorCommand({ type: 'call', name: 'start', args: [] })).toBeNull()
	expect(readInspectorCommand({ type: 'call', name: 'toString', args: [] })).toBeNull()
	expect(readInspectorCommand({ type: 'call', name: 'deselect' })).toBeNull()
	expect(readInspectorCommand({ type: 'edit', commit: true, patch: { yOff: 1 } })).toBeNull()
	expect(readInspectorCommand({ type: 'edit', commit: true, gesture: 3, patch: { yOff: 1, id: 9, type: 'x', x: 'no', z: NaN } })).toEqual({ type: 'edit', commit: true, gesture: 3, patch: { yOff: 1 } })
	expect(readInspectorCommand({ type: 'key', key: { key: 'z', ctrlKey: true } })).toEqual({ type: 'key', key: { key: 'z', code: '', ctrlKey: true, metaKey: false, shiftKey: false } })
	expect(readInspectorCommand({ type: 'key', key: 'z' })).toBeNull()
	expect(readInspectorCommand({ type: 'hello' })).toBeNull()
	expect(cleanPatch(null)).toEqual({})
})

test('scrubs arriving out of order make one undo step each and leave no stray live edit', () => {
	const { log, act } = recorder()
	const g = new EditGestures()
	const edit = (gesture: number, commit: boolean, yOff: number): InspectorCommand => ({ type: 'edit', commit, patch: { yOff }, gesture })
	// Scrub 10: two live edits and the commit, then a live edit of it that came late.
	runInspectorCommand(edit(10, false, 1), act, g)
	expect(g.active).toBe(true)
	runInspectorCommand(edit(10, false, 2), act, g)
	runInspectorCommand(edit(10, true, 3), act, g)
	expect(g.active).toBe(false)
	runInspectorCommand(edit(10, false, 2), act, g)
	// Scrub 11 is a typed number: its commit alone starts and ends it.
	runInspectorCommand(edit(11, true, 7), act, g)
	// Scrub 12 begins; a live edit of an older scrub that arrives now is dropped.
	runInspectorCommand(edit(12, false, 8), act, g)
	runInspectorCommand(edit(11, false, 6), act, g)
	runInspectorCommand(edit(12, true, 9), act, g)
	expect(log).toEqual(['start', 'live {"yOff":1}', 'live {"yOff":2}', 'commit {"yOff":3}', 'start', 'commit {"yOff":7}', 'start', 'live {"yOff":8}', 'commit {"yOff":9}'])
	// A window opened again starts over.
	g.reset()
	runInspectorCommand(edit(1, true, 0), act, g)
	expect(log.at(-1)).toBe('commit {"yOff":0}')
	expect(runInspectorCommand({ type: 'key', key: { key: 'Escape', code: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false } }, act, g)).toBe(false)
})

const spawn = (kind: string, guid: number, f: Partial<vmangos.WorldSpawn> = {}) => ({ kind, guid, pool: 0, motherPool: 0, leader: 0, ...f }) as unknown as vmangos.WorldSpawn

test('the pool and formation fields get the spawns of the pools and formation, and the spawn itself', () => {
	const all = [
		spawn('object', 1, { pool: 5, motherPool: 9 }),
		spawn('object', 2, { pool: 5, motherPool: 9 }),
		spawn('object', 3, { pool: 6, motherPool: 9 }),
		spawn('object', 4, { pool: 7 }),
		spawn('monster', 10, { leader: 10 }),
		spawn('monster', 11, { leader: 10 }),
		spawn('monster', 12),
		spawn('monster', 1),
	]
	const guids = (s: vmangos.WorldSpawn) => relatedSpawns(all, s).map((o) => `${o.kind}/${o.guid}`)
	expect(guids(all[0])).toEqual(['object/1', 'object/2', 'object/3'])
	expect(guids(all[5])).toEqual(['monster/10', 'monster/11'])
	expect(guids(all[6])).toEqual(['monster/12'])
})

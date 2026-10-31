// Run with: bun test tests/leaveOut.test.ts
// Leaving single items out of a write (#960): the edits tied together, the split a write makes, and the
// seam warning for a tile left out beside a written one.
import { describe, expect, test } from 'bun:test'
import { pickSpawnEdits, seamWarnings, skippedTiles, spawnItem, spawnTies, tileItem } from '../src/lib/io/leaveOut'
import type { vmangos } from '../src/lib/wails/models'

function spawn(guid: number, vals: Partial<vmangos.WorldSpawn> = {}): vmangos.WorldSpawn {
	return {
		kind: 'monster',
		guid,
		entry: 1,
		leader: 0,
		followDist: 0,
		followAngle: 0,
		groupFlags: 0,
		pool: 0,
		poolLimit: 0,
		poolName: '',
		poolChance: 0,
		motherPool: 0,
		motherLimit: 0,
		...vals,
	} as Partial<vmangos.WorldSpawn> as vmangos.WorldSpawn
}

/** An edit of a loaded spawn from `was` to `now`. */
const changed = (was: vmangos.WorldSpawn, now: Partial<vmangos.WorldSpawn>): vmangos.SpawnEdit => ({ spawn: { ...was, ...now }, original: was, created: false, deleted: false })
const created = (s: vmangos.WorldSpawn): vmangos.SpawnEdit => ({ spawn: s, original: s, created: true, deleted: false })

const file = (tile: string): vmangos.FileChange => ({ name: `World/Maps/Azeroth/Azeroth_${tile}.adt`, group: 'tile', tile, reason: '', new: false, waiting: false })

describe('leaving items out of a write (#960)', () => {
	test('moves of two spawns are left out one by one', () => {
		const a = changed(spawn(1), { x: 5 })
		const b = changed(spawn(2), { x: 6 })
		const { write, kept } = pickSpawnEdits([a, b], new Set([spawnItem(a)]))
		expect(write).toEqual([b])
		expect(kept).toEqual([a])
		expect(pickSpawnEdits([a, b], new Set()).write).toEqual([a, b])
	})

	test('a new formation member goes with its new leader, and edits of one changed pool go together', () => {
		const leader = created(spawn(10, { leader: 10 }))
		const member = created(spawn(11, { leader: 10, followDist: 3 }))
		const poolA = changed(spawn(20, { pool: 7, poolLimit: 1 }), { poolLimit: 2 })
		const poolB = changed(spawn(21, { pool: 7, poolLimit: 1 }), { poolLimit: 2 })
		// Moved alone, with its pool as it was: not tied to the pool's other edits.
		const moved = changed(spawn(22, { pool: 7, poolLimit: 1 }), { x: 4 })
		const ties = spawnTies([leader, member, poolA, poolB, moved])
		expect(ties.get(spawnItem(member))?.sort()).toEqual([spawnItem(leader), spawnItem(member)].sort())
		expect(ties.get(spawnItem(poolA))?.sort()).toEqual([spawnItem(poolA), spawnItem(poolB)].sort())
		expect(ties.get(spawnItem(moved))).toEqual([spawnItem(moved)])
		const { write, kept } = pickSpawnEdits([leader, member, poolA, poolB, moved], new Set([spawnItem(leader), spawnItem(poolB)]))
		expect(write).toEqual([moved])
		expect(kept).toEqual([leader, member, poolA, poolB])
	})

	test('a member moved in an unchanged formation goes alone', () => {
		const leader = changed(spawn(10, { leader: 10 }), { x: 1 })
		const member = changed(spawn(11, { leader: 10 }), { x: 2 })
		expect(spawnTies([leader, member]).get(spawnItem(member))).toEqual([spawnItem(member)])
	})

	test('names the skipped tiles and warns of a tile left out beside a written one', () => {
		const left = new Set([tileItem('32_48'), spawnItem(changed(spawn(1), {})), tileItem('40_40')])
		expect(skippedTiles(left).sort()).toEqual(['32_48', '40_40'])
		const seams = seamWarnings([file('32_48'), file('33_48'), file('33_49'), file('32_47')], left)
		expect([...seams]).toEqual([['32_48', ['33_48', '32_47']]])
		expect(seamWarnings([file('32_48'), file('33_49')], left).size).toBe(0)
	})
})

import type { vmangos } from '../../../wailsjs/go/models'
import type { SpawnChange } from './formations'
import type { SpawnFields } from './spawnEdits'

// Spawn pools (pool_template, pool_creature, pool_gameobject, #172): "spawn N of these M". A pool
// spawns at most its limit of its members at a time, such as one of the veins that share a spot; a
// pool may itself belong to a mother pool (pool_pool), such as a zone's master pool of vein spots,
// which fills at most its own limit of them. The editor makes and changes pools of spawns; mother
// pools are read only.

/** The fields of a spawn in no pool. */
export const NO_POOL: SpawnFields = { pool: 0, poolLimit: 0, poolName: '', poolChance: 0, poolElsewhere: 0, motherPool: 0, motherLimit: 0, motherSize: 0, motherName: '' }

const keyOf = (s: vmangos.WorldSpawn) => `${s.kind}/${s.guid}`
const isObject = (s: vmangos.WorldSpawn) => s.kind === 'object'

/** The pool a spawn shows under in View › Spawn pools: its mother pool when it has one, else its own; 0 for none. */
export const topPool = (s: vmangos.WorldSpawn) => (s.pool ? s.motherPool || s.pool : 0)

/** The spawns of `spawns` in pool `pool` of the kind of `like` (creature or game object). */
export function poolMembers(spawns: readonly vmangos.WorldSpawn[], pool: number, like: vmangos.WorldSpawn): vmangos.WorldSpawn[] {
	if (!pool) return []
	return spawns.filter((o) => o.pool === pool && isObject(o) === isObject(like))
}

/** The other spawns of `s`'s pool among `spawns`. */
export function poolMates(spawns: readonly vmangos.WorldSpawn[], s: vmangos.WorldSpawn): vmangos.WorldSpawn[] {
	return poolMembers(spawns, s.pool, s).filter((o) => o.guid !== s.guid)
}

/** How many members a spawn's pool has in all: those of the region and those the database has elsewhere. */
export function poolSize(spawns: readonly vmangos.WorldSpawn[], s: vmangos.WorldSpawn): number {
	return s.pool ? poolMembers(spawns, s.pool, s).length + (s.poolElsewhere || 0) : 0
}

/** What the server spawns of a pool of `size` with limit `limit`, as a phrase: "1 of its 5 spawns at a time". */
export function poolRule(limit: number, size: number, what = 'spawns'): string {
	if (limit <= 0) return `all of its ${size} ${what}, though the server wants a limit of at least 1`
	if (limit >= size) return `all of its ${size} ${what}`
	return `${limit} of its ${size} ${what} at a time`
}

/** The pool fields of a spawn joining pool `pool` named `name` of limit `limit`, with no mother pool. */
export function newPoolFields(pool: number, name: string, limit = 1): SpawnFields {
	return { ...NO_POOL, pool, poolLimit: limit, poolName: name }
}

/**
 * The changes that put `member` into the pool of `target`: it takes the pool's limit, description,
 * mother pool and the count of its members elsewhere, with no chance of its own. A reason instead
 * when they can't share a pool.
 */
export function joinPoolChanges(target: vmangos.WorldSpawn, member: vmangos.WorldSpawn): SpawnChange[] | string {
	if (!target.pool) return `${target.name} is in no pool.`
	if (isObject(target) !== isObject(member)) return 'A pool holds creatures or game objects, not both.'
	if (member.pool === target.pool && isObject(member) === isObject(target)) return `${member.name} is in the pool already.`
	return [
		{
			key: keyOf(member),
			vals: {
				pool: target.pool,
				poolLimit: target.poolLimit,
				poolName: target.poolName,
				poolChance: 0,
				poolElsewhere: target.poolElsewhere,
				motherPool: target.motherPool,
				motherLimit: target.motherLimit,
				motherSize: target.motherSize,
				motherName: target.motherName,
			},
		},
	]
}

/** The change that takes a spawn out of its pool. */
export const leavePoolChanges = (s: vmangos.WorldSpawn): SpawnChange[] => [{ key: keyOf(s), vals: { ...NO_POOL } }]

/** The changes that give `s`'s pool a new limit or description: every member of the region carries them. */
export function poolSettingChanges(spawns: readonly vmangos.WorldSpawn[], s: vmangos.WorldSpawn, vals: { poolLimit?: number; poolName?: string }): SpawnChange[] {
	return poolMembers(spawns, s.pool, s).map((o) => ({ key: keyOf(o), vals: { ...vals } }))
}

/**
 * What the server would make of the chances of `s`'s pool, as a warning, or '' when they are fine.
 * Chances count only in a pool of limit 1; there, when every member has one, they must add up to 100
 * (VMaNGOS's PoolGroup::CheckValidity). Members outside the region are not known, so a pool with
 * some says nothing.
 */
export function chanceProblem(spawns: readonly vmangos.WorldSpawn[], s: vmangos.WorldSpawn): string {
	if (!s.pool) return ''
	const members = poolMembers(spawns, s.pool, s)
	const chanced = members.filter((o) => o.poolChance > 0)
	if (!chanced.length) return ''
	if (s.poolLimit !== 1) return 'Chances count only in a pool with a limit of 1; the server spawns these members at random.'
	if (s.poolElsewhere || chanced.length < members.length) return ''
	const sum = chanced.reduce((t, o) => t + o.poolChance, 0)
	return Math.abs(sum - 100) > 1e-3 ? `Every member has a chance, and they add up to ${Math.round(sum * 100) / 100}%; the server wants 100%.` : ''
}

/** A pool's colour in View › Spawn pools, the same for a pool in every region: a hue from its number. */
export function poolHue(pool: number): number {
	// The golden angle spreads neighbouring numbers far apart on the colour wheel.
	return (pool * 0.618033988749895) % 1
}

/** A pool of the region as the View › Spawn pools legend lists it. */
export interface PoolEntry {
	pool: number
	name: string
	/** It is a mother pool, its members pools rather than spawns. */
	mother: boolean
	limit: number
	/** Its members in all: pools for a mother pool, spawns for a pool. */
	size: number
	/** Its spawns in the region. */
	spawns: number
	hue: number
}

/** The pools of the region by the pool each spawn shows under (`topPool`), the ones with the most spawns first. */
export function poolLegend(spawns: readonly vmangos.WorldSpawn[]): PoolEntry[] {
	const by = new Map<string, PoolEntry>()
	for (const s of spawns) {
		const top = topPool(s)
		if (!top) continue
		const mother = !!s.motherPool
		const k = `${isObject(s) ? 'o' : 'c'}${top}`
		let e = by.get(k)
		if (!e) {
			e = { pool: top, name: mother ? s.motherName : s.poolName, mother, limit: mother ? s.motherLimit : s.poolLimit, size: mother ? s.motherSize : (s.poolElsewhere || 0), spawns: 0, hue: poolHue(top) }
			by.set(k, e)
		}
		e.spawns++
		if (!mother) e.size++
	}
	return [...by.values()].sort((a, b) => b.spawns - a.spawns || a.pool - b.pool)
}

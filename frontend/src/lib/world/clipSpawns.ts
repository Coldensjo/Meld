// The spawns of a copied area (#964): copied with the rest of the area (clipboard.ts), turned and
// mirrored with it (clipRotate.ts), and pasted as new spawns of the map pasted into. Kept apart from the
// clipboard module, which pulls in the terrain stroke, so it can be tested on its own under bun.
import type { vmangos } from '../wails/models'
import { spawnKey } from './spawnKey'
import { NO_FORMATION, wrapAngle } from './formations'
import { NO_POOL } from './pools'

/** The ground a spawn stands on: the map's heights, and where the map is. */
export interface SpawnGround {
	contains(x: number, z: number): boolean
	heightAt(x: number, z: number): number
}

/** A copied waypoint's height: above the ground under it, or above its creature's spawn point where the map didn't reach. */
export interface ClipPoint {
	yOff: number
	onGround: boolean
}

/**
 * A copied spawn: `s` is a copy whose x and z (and its waypoints') are relative to the clip's corner,
 * with its source guid, leader and pool entries, which the paste maps onto new ones.
 */
export interface ClipSpawn {
	s: vmangos.WorldSpawn
	/** Its height above the ground it stood on. */
	yOff: number
	/** Each of its waypoints' height, in path order. */
	points: ClipPoint[]
}

/** What a copy left behind of the formations and pools its spawns were in. */
export interface ClipSpawnDrops {
	/** Creatures that left their formation, as their leader stayed behind. */
	formation: number
	/** Spawns that left their pool, as part of it stayed behind. */
	pool: number
	/**
	 * Spawns whose pool left its master pool: a pasted pool is a new one, and the save makes no new
	 * master pool (only puts a pool into one the database has).
	 */
	mother: number
}

const isObject = (s: vmangos.WorldSpawn) => s.kind === 'object'
const poolKey = (s: vmangos.WorldSpawn) => `${isObject(s) ? 'o' : 'c'}${s.pool}`
const leaderKey = (guid: number) => `c${guid}`
const creatureKey = (s: vmangos.WorldSpawn) => (isObject(s) ? '' : leaderKey(s.guid))

/** A deep copy of a spawn, as plain data. */
const clone = (s: vmangos.WorldSpawn): vmangos.WorldSpawn => JSON.parse(JSON.stringify(s)) as vmangos.WorldSpawn

/** The fields of a pool in no master pool. */
const NO_MOTHER = { motherPool: 0, motherLimit: 0, motherSize: 0, motherName: '' }

/**
 * Copies the spawns of `all` (a region's, in its coordinates) that `inside` takes, relative to the
 * corner (ox, oz), with their heights above `ground`. A formation comes along with its leader: a
 * follower whose leader stays behind leaves it, as does a leader none of whose followers came. A pool
 * comes along whole or not at all: when one of its members stays behind (in the region or elsewhere in
 * the database), the copied ones leave it. A pool that comes leaves its master pool.
 */
export function copySpawns(all: readonly vmangos.WorldSpawn[], inside: (x: number, z: number) => boolean, ground: SpawnGround, ox: number, oz: number): { spawns: ClipSpawn[]; drops: ClipSpawnDrops } {
	const picked = all.filter((s) => inside(s.x, s.z))
	const drops: ClipSpawnDrops = { formation: 0, pool: 0, mother: 0 }
	if (!picked.length) return { spawns: [], drops }
	const inCopy = new Set(picked)

	const leaders = new Set(picked.map(creatureKey).filter((k) => k))
	const led = new Set<string>()
	for (const s of picked) if (!isObject(s) && s.leader && s.leader !== s.guid && leaders.has(leaderKey(s.leader))) led.add(leaderKey(s.leader))

	// A pool is whole when no member is outside the copy, in the region or in the database.
	const brokenPools = new Set<string>()
	for (const s of all) if (s.pool && !inCopy.has(s)) brokenPools.add(poolKey(s))
	for (const s of picked) if (s.pool && s.poolElsewhere > 0) brokenPools.add(poolKey(s))

	const spawns = picked.map((src): ClipSpawn => {
		const s = clone(src)
		if (!isObject(s) && s.leader) {
			const leader = s.leader === s.guid
			if (leader ? !led.has(leaderKey(s.guid)) : !leaders.has(leaderKey(s.leader))) {
				if (!leader) drops.formation++
				Object.assign(s, NO_FORMATION)
			}
		}
		if (s.pool) {
			if (brokenPools.has(poolKey(s))) {
				drops.pool++
				Object.assign(s, NO_POOL)
			} else if (s.motherPool) {
				drops.mother++
				Object.assign(s, NO_MOTHER)
			}
		}
		const gy = ground.contains(src.x, src.z) ? ground.heightAt(src.x, src.z) : src.y
		const points = (src.waypoints ?? []).map((p): ClipPoint => (ground.contains(p.x, p.z) ? { yOff: p.y - ground.heightAt(p.x, p.z), onGround: true } : { yOff: p.y - src.y, onGround: false }))
		s.x -= ox
		s.z -= oz
		s.waypoints = (s.waypoints ?? []).map((p) => ({ ...p, x: p.x - ox, z: p.z - oz }))
		return { s, yOff: src.y - gy, points }
	})
	return { spawns, drops }
}

/** A waypoint's facing changed by `f`, keeping 0 (no facing of its own) as none. */
const pointFacing = (o: number, f: (o: number) => number) => (o === 0 ? 0 : wrapAngle(f(o)) || 1e-4)

/** Applies `pos` to a copied spawn's place and its path's points, and `face` to its facing and theirs. */
function moved(c: ClipSpawn, pos: (x: number, z: number) => [number, number], face: (o: number) => number, slot?: (a: number) => number): ClipSpawn {
	const s = { ...c.s }
	;[s.x, s.z] = pos(s.x, s.z)
	s.orientation = wrapAngle(face(s.orientation))
	s.waypoints = (s.waypoints ?? []).map((p) => {
		const [x, z] = pos(p.x, p.z)
		return { ...p, x, z, orientation: pointFacing(p.orientation, face) }
	})
	if (slot && s.followAngle) s.followAngle = wrapAngle(slot(s.followAngle))
	return { ...c, s }
}

/**
 * The copied spawns turned with the clip a quarter turn clockwise seen from above (clipRotate.ts
 * `rotateClip`, a clip `W` wide): (x, z) lands at (z, W - x), and each spawn and path point turns a
 * quarter turn. A formation's slots are relative to its leader's facing, so they stay.
 */
export function rotateClipSpawns(list: readonly ClipSpawn[], W: number): ClipSpawn[] {
	return list.map((c) =>
		moved(
			c,
			(x, z) => [z, W - x],
			(o) => o + Math.PI / 2,
		),
	)
}

/**
 * The copied spawns mirrored with the clip (`mirrorClip`, a clip `W` by `H`): across `x` east to west,
 * across `z` north to south. A spawn keeps its shape and faces the mirrored way (its facing o becomes
 * -o across x, -o - π across z, as a model's yaw does), a formation's slots mirror (-angle), and a
 * tilted game object keeps its lean forward and rolls the other way.
 */
export function mirrorClipSpawns(list: readonly ClipSpawn[], axis: 'x' | 'z', W: number, H: number): ClipSpawn[] {
	const fx = axis === 'x'
	return list.map((c) => {
		const out = moved(
			c,
			(x, z) => (fx ? [W - x, z] : [x, H - z]),
			(o) => (fx ? -o : -o - Math.PI),
			(a) => -a,
		)
		const t = out.s.tilt
		// The tilt is relative to the facing, in the server's axes (x forward, y left, z up): mirrored
		// left to right, its roll and yaw turn the other way.
		if (t && t.length === 4) out.s.tilt = [-t[0], t[1], -t[2], t[3]]
		return out
	})
}

/** The new ids a paste gives: a guid of a spawn's range (creature or game object), and a pool entry (0 when none is left). */
export interface SpawnIds {
	guid(kind: 'creature' | 'object'): number
	pool(): number
}

/**
 * The copied spawns as new spawns with the clip's corner at world (ax, az) on `ground`: new guids
 * and, for the formations and pools that came along, new leaders and pool entries over them. Each
 * stands its copied height above the ground under it, as a pasted model does; a path point too, or
 * where the map doesn't reach it, its height above its creature. A spawn that lands off the map is left
 * out, and with it a formation it led. The new spawns belong to no world event (the save writes none
 * for a new spawn) and walk a path of their own.
 */
export function pasteSpawns(list: readonly ClipSpawn[], ax: number, az: number, ground: SpawnGround, ids: SpawnIds): vmangos.WorldSpawn[] {
	const landed = list.filter((c) => ground.contains(c.s.x + ax, c.s.z + az))
	const guids = new Map<string, number>()
	for (const c of landed) guids.set(spawnKey(c.s), ids.guid(isObject(c.s) ? 'object' : 'creature'))
	const creatureGuid = (guid: number) => guids.get(`monster/${guid}`) ?? guids.get(`npc/${guid}`)
	// A pool that came along is a new pool of the pasted spawns.
	const pools = new Map<string, number>()
	const entry = (key: string) => {
		let e = pools.get(key)
		if (e === undefined) pools.set(key, (e = ids.pool()))
		return e
	}
	// Leaders with a follower that landed, by their source guid.
	const leading = new Set<number>()
	for (const c of landed) if (!isObject(c.s) && c.s.leader && c.s.leader !== c.s.guid && creatureGuid(c.s.leader) !== undefined) leading.add(c.s.leader)

	return landed.map((c) => {
		const s = clone(c.s)
		const src = c.s
		s.guid = guids.get(spawnKey(src))!
		s.x = src.x + ax
		s.z = src.z + az
		s.y = ground.heightAt(s.x, s.z) + c.yOff
		s.waypoints = (src.waypoints ?? []).map((p, i) => {
			const x = p.x + ax
			const z = p.z + az
			const at = c.points[i]
			const y = at?.onGround && ground.contains(x, z) ? ground.heightAt(x, z) + at.yOff : s.y + (at?.yOff ?? 0)
			return { ...p, x, z, y }
		})
		s.pathFromTemplate = false
		s.events = []
		if (!isObject(src) && src.leader) {
			const leader = creatureGuid(src.leader)
			const keeps = src.leader === src.guid ? leading.has(src.guid) : leader !== undefined
			if (keeps && leader !== undefined) s.leader = leader
			else Object.assign(s, NO_FORMATION)
		}
		if (src.pool) {
			const pool = entry(poolKey(src))
			if (!pool) Object.assign(s, NO_POOL)
			else Object.assign(s, { pool, poolElsewhere: 0, ...NO_MOTHER })
		}
		return s
	})
}

/**
 * What a pasted spawn counts as when placed, for the save (`SpawnLayer.add`'s original), which writes
 * what differs from it: no formation, pool or path, and a creature standing, with no emote, weapons
 * out, as the spawn brush places one; so its formation, pool, path and pose are written with it. Its
 * display and equipment count as its template's, so they are written only where the copied spawn had
 * its own (#972): then the original has none (display 0, equipment -1, as creature_addon says "the
 * template's"), so the save writes them, while a template that picks among displays keeps picking.
 */
export function pastedOriginal(s: vmangos.WorldSpawn): vmangos.WorldSpawn {
	const o: vmangos.WorldSpawn = { ...s, ...NO_FORMATION, ...NO_POOL, waypoints: [] }
	if (!isObject(s)) {
		Object.assign(o, { standState: 0, emoteState: 0, sheathState: 1 })
		if (s.ownDisplay) o.display = 0
		if (s.ownEquipment) o.equipment = -1
	}
	return o
}

/** How many copied spawns `list` holds of each range, for the ids a paste needs (`SpawnIds`). */
export function clipSpawnNeeds(list: readonly ClipSpawn[]): { creatures: number; objects: number; pools: boolean } {
	let creatures = 0
	let objects = 0
	let pools = false
	for (const c of list) {
		if (isObject(c.s)) objects++
		else creatures++
		if (c.s.pool) pools = true
	}
	return { creatures, objects, pools }
}

/** What a copy left of the spawns' formations and pools, as a sentence for the status line (with a leading space), or ''. */
export function spawnDropsText(d: ClipSpawnDrops): string {
	const parts: string[] = []
	const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
	if (d.formation) parts.push(`${n(d.formation, 'creature leaves its formation', 'creatures leave their formation')}, as the leader is outside the area`)
	if (d.pool) parts.push(`${n(d.pool, 'spawn leaves its pool', 'spawns leave their pool')}, as part of the pool is outside the area`)
	if (d.mother) parts.push(`${n(d.mother, 'spawn', 'spawns')}' pools leave their master pool, as a pasted pool is a new one`)
	return parts.length ? ` In the copy, ${parts.join('; ')}.` : ''
}

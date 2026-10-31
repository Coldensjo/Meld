// Leaving single items out of a write (#960): the author unticks a spawn edit or a tile in the Changes
// window, and Save Spawns, Compile and Export Spawn SQL leave it out, while it stays pending for the
// next write. The unticked items are kept on the document (`MapDocument.leftOut`) as keys:
// `spawn:<spawnKey>` and `tile:<x>_<y>`. The map-wide files (WDT, WDL) and Publish's files and rows
// are always written, so they have no key.
import type { vmangos } from '../wails/models'
import { spawnKey } from '../world/spawnKey'

/** The key of a spawn edit in `MapDocument.leftOut`. */
export const spawnItem = (e: vmangos.SpawnEdit) => `spawn:${spawnKey(e.spawn)}`

/** The key of a tile ("x_y") in `MapDocument.leftOut`. */
export const tileItem = (tile: string) => `tile:${tile}`

/** Whether the formation fields of an edit differ from its original, or it is new. */
function formationChanged(e: vmangos.SpawnEdit): boolean {
	const s = e.spawn
	const o = e.original
	if (e.created || !o) return true
	return s.leader !== o.leader || s.followDist !== o.followDist || s.followAngle !== o.followAngle || s.groupFlags !== o.groupFlags
}

/** Whether the pool fields of an edit differ from its original, or it is new. */
function poolChanged(e: vmangos.SpawnEdit): boolean {
	const s = e.spawn
	const o = e.original
	if (e.created || !o) return true
	return s.pool !== o.pool || s.poolLimit !== o.poolLimit || s.poolName !== o.poolName || s.poolChance !== o.poolChance || s.motherPool !== o.motherPool || s.motherLimit !== o.motherLimit
}

/**
 * The edits that are written or left out together, by item key: each edit's group, itself included.
 * A spawn's path is part of its own edit; besides that, a creature whose formation changed goes with
 * its leader's edit (the group row names the leader), and the edits that change one pool go together
 * (the pool's own rows are written from them).
 */
export function spawnTies(edits: readonly vmangos.SpawnEdit[]): Map<string, string[]> {
	const parent = new Map<string, string>()
	const find = (k: string): string => {
		let p = parent.get(k) ?? k
		while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p
		parent.set(k, p)
		return p
	}
	const join = (a: string, b: string) => {
		const ra = find(a)
		const rb = find(b)
		if (ra !== rb) parent.set(ra, rb)
	}
	const byKey = new Map<string, vmangos.SpawnEdit>()
	for (const e of edits) byKey.set(spawnItem(e), e)
	const pools = new Map<number, string>()
	for (const e of edits) {
		if (e.deleted) continue
		const key = spawnItem(e)
		const s = e.spawn
		if (s.kind !== 'object' && s.leader && s.leader !== s.guid && formationChanged(e)) {
			for (const kind of ['monster', 'npc']) {
				const leader = `spawn:${kind}/${s.leader}`
				if (byKey.has(leader)) join(key, leader)
			}
		}
		if (s.pool && poolChanged(e)) {
			const first = pools.get(s.pool)
			if (first) join(key, first)
			else pools.set(s.pool, key)
		}
	}
	const groups = new Map<string, string[]>()
	for (const key of byKey.keys()) {
		const root = find(key)
		const g = groups.get(root)
		if (g) g.push(key)
		else groups.set(root, [key])
	}
	const out = new Map<string, string[]>()
	for (const key of byKey.keys()) out.set(key, groups.get(find(key))!)
	return out
}

/**
 * Splits the edits into those a write sends and those it leaves out: an edit is left out when it, or
 * any edit tied to it (`spawnTies`), is in `leftOut`.
 */
export function pickSpawnEdits(edits: vmangos.SpawnEdit[], leftOut: ReadonlySet<string>): { write: vmangos.SpawnEdit[]; kept: vmangos.SpawnEdit[] } {
	if (!leftOut.size) return { write: edits, kept: [] }
	const ties = spawnTies(edits)
	const write: vmangos.SpawnEdit[] = []
	const kept: vmangos.SpawnEdit[] = []
	for (const e of edits) {
		const out = (ties.get(spawnItem(e)) ?? [spawnItem(e)]).some((k) => leftOut.has(k))
		;(out ? kept : write).push(e)
	}
	return { write, kept }
}

/** The tiles ("x_y") a compile leaves out, for `RegionEdit.skip`. */
export function skippedTiles(leftOut: ReadonlySet<string>): string[] {
	const out: string[] = []
	for (const k of leftOut) if (k.startsWith('tile:')) out.push(k.slice(5))
	return out
}

/** Whether two tiles ("x_y") share an edge. */
function besides(a: string, b: string): boolean {
	const [ax, ay] = a.split('_').map(Number)
	const [bx, by] = b.split('_').map(Number)
	return Math.abs(ax - bx) + Math.abs(ay - by) === 1
}

/**
 * For each tile of `files` the author left out, the tiles it shares an edge with that are written: the
 * seam between them steps where the edit changed the heights along it, which File › Check Map's Region
 * edges finds (#195).
 */
export function seamWarnings(files: readonly vmangos.FileChange[], leftOut: ReadonlySet<string>): Map<string, string[]> {
	const tiles = files.filter((f) => f.group === 'tile' && f.tile).map((f) => f.tile)
	const out = new Map<string, string[]>()
	for (const t of tiles) {
		if (!leftOut.has(tileItem(t))) continue
		const written = tiles.filter((n) => !leftOut.has(tileItem(n)) && besides(t, n))
		if (written.length) out.set(t, written)
	}
	return out
}

/** How many items `n` are, as words: "1 spawn edit", "3 tiles". */
export const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

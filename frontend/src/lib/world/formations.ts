import type { vmangos } from '../../../wailsjs/go/models'
import type { SpawnFields } from './spawnEdits'

// Creature formations (creature_groups, #172): a leader and its followers, each in a slot at a
// distance and angle from the leader's facing, that walk the leader's path together. The server
// puts a follower at leader + (cos(angle + facing), sin(angle + facing)) * dist in its own axes
// (CreatureGroupMember::ComputeRelativePosition), which in a region's axes is the turn below.

/** Formation flags (creature_groups.flags, VMaNGOS's OptionFlags), with what each makes the group do. */
export const FORMATION_FLAGS: { bit: number; name: string }[] = [
	{ bit: 0x001, name: "Walk the leader's path in formation" },
	{ bit: 0x002, name: 'Fight together' },
	{ bit: 0x004, name: 'Leave a fight together' },
	{ bit: 0x008, name: 'Respawn together' },
	{ bit: 0x010, name: 'All respawn when the leader leaves a fight' },
	{ bit: 0x020, name: 'All respawn when any leaves a fight' },
	{ bit: 0x040, name: 'Tell the leader when a member dies' },
	{ bit: 0x080, name: 'Tell the members when any dies' },
]

/** The flags a new member gets: walk in formation and fight together, as VMaNGOS's own command gives. */
export const FORMATION_DEFAULT = 0x003

/** The fields a creature has outside any formation. */
export const NO_FORMATION: SpawnFields = { leader: 0, followDist: 0, followAngle: 0, groupFlags: 0 }

type Spot = { x: number; z: number }

/** Whether a creature leads a formation. */
export const leads = (s: vmangos.WorldSpawn) => s.kind !== 'object' && !!s.leader && s.leader === s.guid

/** Whether a creature follows a leader in a formation. */
export const follows = (s: vmangos.WorldSpawn) => s.kind !== 'object' && !!s.leader && s.leader !== s.guid

/** The creatures of `spawns` that follow the leader with guid `leader`. */
export function followersOf(spawns: readonly vmangos.WorldSpawn[], leader: number): vmangos.WorldSpawn[] {
	return spawns.filter((s) => s.kind !== 'object' && s.leader === leader && s.guid !== leader)
}

/** The creature of `spawns` with guid `guid`, or undefined. */
export function creatureOf(spawns: readonly vmangos.WorldSpawn[], guid: number): vmangos.WorldSpawn | undefined {
	return spawns.find((s) => s.kind !== 'object' && s.guid === guid)
}

/** An angle in [0, 2π), as creature_groups holds it. */
export function wrapAngle(a: number): number {
	const t = a % (2 * Math.PI)
	const w = t < 0 ? t + 2 * Math.PI : t
	// A hair under a full turn is no turn, so the field doesn't read 360°.
	return w > 2 * Math.PI - 1e-9 ? 0 : w
}

/**
 * Where a follower stands in its slot, in the region's axes: `dist` yards from the leader at `angle`
 * from the leader's facing. Writes into `out` and returns it.
 */
export function slotPosition<T extends Spot>(leader: vmangos.WorldSpawn, dist: number, angle: number, out: T): T {
	const h = angle + leader.orientation
	out.x = leader.x - Math.sin(h) * dist
	out.z = leader.z - Math.cos(h) * dist
	return out
}

/** The slot of a follower standing at (x, z): its distance from the leader and angle from the leader's facing. */
export function slotAt(leader: vmangos.WorldSpawn, x: number, z: number): { followDist: number; followAngle: number } {
	// The server's x is the region's -z and its y the region's -x.
	const sx = -(z - leader.z)
	const sy = -(x - leader.x)
	return { followDist: Math.hypot(sx, sy), followAngle: wrapAngle(Math.atan2(sy, sx) - leader.orientation) }
}

/**
 * The slot fields of follower `s` moved to (x, z), when its leader is among `spawns`: dragging a
 * follower sets its slot. Undefined for a creature that follows no leader of the region.
 */
export function slotFieldsAt(spawns: readonly vmangos.WorldSpawn[], s: vmangos.WorldSpawn, x: number, z: number): SpawnFields | undefined {
	if (!follows(s)) return undefined
	const leader = creatureOf(spawns, s.leader)
	return leader ? slotAt(leader, x, z) : undefined
}

/** A change of one spawn: its key and the fields it gets. */
export interface SpawnChange {
	key: string
	vals: SpawnFields
}

const keyOf = (s: vmangos.WorldSpawn) => `${s.kind}/${s.guid}`

/**
 * The changes that make `member` follow `leader` in a slot where it stands now. The leader leads
 * from then on (with the default flags if it had none); a member that led its own formation can't
 * join another, nor can a creature follow itself, which give a reason instead.
 */
export function joinChanges(spawns: readonly vmangos.WorldSpawn[], leader: vmangos.WorldSpawn, member: vmangos.WorldSpawn): SpawnChange[] | string {
	if (member.kind === 'object' || leader.kind === 'object') return 'Only creatures walk in formation.'
	if (member.guid === leader.guid) return `${leader.name} leads the formation.`
	if (follows(leader)) return `${leader.name} follows another leader; a follower can't lead.`
	if (leads(member) && followersOf(spawns, member.guid).length) return `${member.name} leads a formation of its own; disband it first.`
	const flags = leader.groupFlags || FORMATION_DEFAULT
	const out: SpawnChange[] = []
	if (!leads(leader)) out.push({ key: keyOf(leader), vals: { leader: leader.guid, followDist: 0, followAngle: 0, groupFlags: flags } })
	out.push({ key: keyOf(member), vals: { leader: leader.guid, ...slotAt(leader, member.x, member.z), groupFlags: flags } })
	return out
}

/**
 * The changes that take `member` out of its formation. A leader left with no follower in the region
 * stops leading.
 */
export function leaveChanges(spawns: readonly vmangos.WorldSpawn[], member: vmangos.WorldSpawn): SpawnChange[] {
	if (leads(member)) return disbandChanges(spawns, member)
	const out: SpawnChange[] = [{ key: keyOf(member), vals: { ...NO_FORMATION } }]
	const leader = creatureOf(spawns, member.leader)
	if (leader && leads(leader) && followersOf(spawns, leader.guid).every((f) => f.guid === member.guid)) out.push({ key: keyOf(leader), vals: { ...NO_FORMATION } })
	return out
}

/** The changes that end leader `leader`'s formation: it and its followers in the region leave it. */
export function disbandChanges(spawns: readonly vmangos.WorldSpawn[], leader: vmangos.WorldSpawn): SpawnChange[] {
	return [leader, ...followersOf(spawns, leader.guid)].map((s) => ({ key: keyOf(s), vals: { ...NO_FORMATION } }))
}

/** The changes that give leader `leader`'s whole formation the flags `flags`. */
export function flagChanges(spawns: readonly vmangos.WorldSpawn[], leader: vmangos.WorldSpawn, flags: number): SpawnChange[] {
	return [leader, ...followersOf(spawns, leader.guid)].map((s) => ({ key: keyOf(s), vals: { groupFlags: flags } }))
}

/** The group's options: the OR of its members' flags, as the server makes them. */
export function groupOptions(spawns: readonly vmangos.WorldSpawn[], leader: vmangos.WorldSpawn): number {
	let f = 0
	for (const s of followersOf(spawns, leader.guid)) f |= s.groupFlags
	return f || leader.groupFlags
}

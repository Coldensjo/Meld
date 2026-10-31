// File › Check Map's world links (#953), in the World data group (#951): what moves a player around the
// map. Go reads them (checkLinks, internal/vmangos/linkcheck.go: the client's flight stops with their
// routes, the area triggers on the map, the teleports of the spawns' templates and those landing on the
// map from anywhere, with the client's ground under a target on another map); this file matches each
// flight master to its stop the way the server does and measures a target on the open map against the
// editor's own terrain and models, so an unsaved edit counts.
import { fromServer, toServer } from '../wow/format'
import type { vmangos } from '../wails/models'
import { NPC_FLAGS } from '../world/spawnInfo'
import { capped, type Finding } from './findings'
import { nearestSpawns, type WorldSpawn } from './worldData'

export type LinkReport = vmangos.LinkReport
type LinkNode = vmangos.LinkNode
type PortalLink = vmangos.PortalLink

/** A spawn with its height, for the 3D distance the server measures a flight master's stop by. */
export interface LinkSpawn extends WorldSpawn {
	y: number
}

/** What the portal check asks of the open map: its ID, the tile at its north-west corner, and its ground and model floors. */
export interface LinkMap {
	mapId: number
	tileX: number
	tileY: number
	/** Whether the editor point is on the map's terrain. */
	contains: (x: number, z: number) => boolean
	/** The terrain's height there, -Infinity over a hole. */
	ground: (x: number, z: number) => number
	/** The first model surface straight below (x, y, z), -Infinity for none. */
	floorBelow: (x: number, y: number, z: number) => number
}

const MASTERS = 'Flight masters without flights'
const STOPS = 'Flight stops without routes'
const PORTALS = 'Portal destinations'

const FLIGHT_MASTER = NPC_FLAGS.find(([, n]) => n === 'flight master')![0]
/** How far a master's nearest stop may be before the finding says which stop it offers (yards): the stock masters stand within a few yards of theirs. */
export const FAR_STOP = 100
/** How far above the surface under it a target may be (yards) before the player is said to fall. */
export const ABOVE = 5
/** How far under the ground a target may be (yards) before the player is said to land under it. */
export const BELOW = 2

const SIDES = [
	{ name: 'Horde', mount: (n: LinkNode) => n.hordeMount },
	{ name: 'Alliance', mount: (n: LinkNode) => n.allianceMount },
] as const

const yd = (v: number) => `${Math.round(v)} yd`
const stopName = (n: LinkNode) => `${n.name || 'a stop'} (stop ${n.id})`

/**
 * The flight findings: a flight master (a creature with the flag) for which no stop on the map serves
 * either side (an error), whose nearest stop for its side has no route from it (a warning), or whose
 * nearest stop for either side is more than FAR_STOP yards away (info: it offers that stop's flights);
 * and a stop no route starts or ends at. The server's rule (ObjectMgr::GetNearestTaxiNode): the nearest
 * stop on the master's map, in 3D, that has a mount for the player's side and a route out that is not a
 * spell's own flight. The editor doesn't read the master's faction: a side whose stop is within FAR_STOP
 * is taken for its side, and only those sides are checked, unless no side's stop is that near.
 */
export function checkFlights(spawns: readonly LinkSpawn[], creatures: readonly vmangos.WorldTemplate[], report: LinkReport, map: Pick<LinkMap, 'tileX' | 'tileY'>): Finding[] {
	const masters: Finding[] = []
	const stops: Finding[] = []
	const flagged = new Map(creatures.filter((c) => c.npcFlags & FLIGHT_MASTER).map((c) => [c.entry, c]))
	const network = report.nodes.filter((n) => n.network)
	for (const s of spawns) {
		const t = s.kind !== 'object' ? flagged.get(s.entry) : undefined
		if (!t) continue
		const who = `${t.name || `#${t.entry}`} (creature ${t.entry})`
		const at = { x: s.x, z: s.z, group: 'world' as const, target: { kind: 'spawn' as const, key: s.key } }
		const p = toServer(s.x, s.z, map.tileX, map.tileY)
		const sides: Array<{ name: string; stop: LinkNode; d: number }> = []
		for (const side of SIDES) {
			let best: LinkNode | null = null
			let bestD = Infinity
			for (const n of network) {
				if (!side.mount(n)) continue
				const d = Math.hypot(n.x - p.x, n.y - p.y, n.z - s.y)
				if (d < bestD) [best, bestD] = [n, d]
			}
			if (best) sides.push({ name: side.name, stop: best, d: bestD })
		}
		if (!sides.length) {
			masters.push({ check: MASTERS, severity: 'error', message: `${who} is a flight master, but no flight stop on this map has a mount for either side, so talking to it shows no flights.`, ...at })
			continue
		}
		const near = sides.filter((x) => x.d <= FAR_STOP)
		for (const x of near.length ? near : sides) {
			if (x.stop.from === 0) {
				const message = `${who}: the ${x.name}'s nearest flight stop, ${stopName(x.stop)} ${yd(x.d)} away, has no route from it, so it offers ${x.name} players no flights.`
				masters.push({ check: MASTERS, severity: 'warning', message, ...at })
			} else if (x.d > FAR_STOP) masters.push({ check: MASTERS, severity: 'info', message: `${who}: the ${x.name}'s nearest flight stop is ${stopName(x.stop)}, ${yd(x.d)} away, so it offers that stop's flights.`, ...at })
		}
	}
	for (const n of report.nodes) {
		// A boat's or zeppelin's stop has no mount, and one only spells fly from is a scripted flight's.
		if ((!n.hordeMount && !n.allianceMount) || !n.network) continue
		const e = fromServer(n.x, n.y, map.tileX, map.tileY)
		const at = { x: e.x, z: e.z, group: 'world' as const, target: { kind: 'none' as const } }
		if (n.from === 0 && n.to === 0) stops.push({ check: STOPS, severity: 'warning', message: `Flight stop ${n.id} (${n.name || 'unnamed'}) has no route to or from it.`, ...at })
		else if (n.from === 0) stops.push({ check: STOPS, severity: 'info', message: `Flight stop ${n.id} (${n.name || 'unnamed'}) has routes to it but none from it, so a flight master there offers nothing.`, ...at })
		else if (n.to === 0) stops.push({ check: STOPS, severity: 'info', message: `Flight stop ${n.id} (${n.name || 'unnamed'}) has routes from it but none to it, so no one flies there.`, ...at })
	}
	return [...capped(MASTERS, masters), ...capped(STOPS, stops)]
}

/**
 * The portal findings: a teleport (an area trigger on the map, a spawn's gossip, spell or script, or a
 * teleport from elsewhere landing on the map) whose target map the client lacks (an error), whose target
 * is more than BELOW yards under the ground with no model floor at it (an error) or more than ABOVE yards
 * over the surface under it (a warning). A target on the open map is measured against its terrain and
 * models (and left out off its terrain); one on another map against the client's ground there, and left
 * out inside a building, whose floor isn't read. On a map of one building (a dungeon or raid, no tiles)
 * a target more than a few yards outside the building's bounds is a warning, since the player lands in
 * the void. One finding a target, naming the first teleport there.
 */
export function checkPortals(spawns: readonly WorldSpawn[], creatures: readonly vmangos.WorldTemplate[], objects: readonly vmangos.WorldTemplate[], report: LinkReport, map: LinkMap, from: { x: number; z: number } | null): Finding[] {
	const nearest = nearestSpawns(spawns, from)
	const names = new Map<string, string>([...creatures.map((c) => [`creature:${c.entry}`, c.name] as const), ...objects.map((o) => [`object:${o.entry}`, o.name] as const)])
	const byDest = new Map<string, { finding: Finding; more: number }>()
	const order: string[] = []

	const source = (l: PortalLink): { label: string; x: number; z: number; key?: string } => {
		if (l.kind === 'creature' || l.kind === 'object') {
			const k = `${l.kind}:${l.entry}`
			const s = nearest.get(k)
			return { label: `${names.get(k) || `#${l.entry}`} (${l.kind} ${l.entry}): ${l.label}`, x: s ? s.x : NaN, z: s ? s.z : NaN, key: s?.key }
		}
		if (l.kind === 'trigger') {
			const e = fromServer(l.at[0], l.at[1], map.tileX, map.tileY)
			return { label: l.label, x: e.x, z: e.z }
		}
		return { label: l.label, x: NaN, z: NaN }
	}
	const add = (l: PortalLink, severity: Finding['severity'], what: string, at?: { x: number; z: number }) => {
		const d = l.dest
		const k = `${d.map}:${d.x.toFixed(1)}:${d.y.toFixed(1)}:${d.z.toFixed(1)}`
		const had = byDest.get(k)
		if (had) {
			had.more++
			return
		}
		const src = source(l)
		const place = at ?? { x: src.x, z: src.z }
		const finding: Finding = { check: PORTALS, severity, message: `${src.label} ${what}`, x: place.x, z: place.z, group: 'world', target: !at && src.key ? { kind: 'spawn', key: src.key } : { kind: 'none' } }
		byDest.set(k, { finding, more: 0 })
		order.push(k)
	}

	for (const l of report.portals) {
		const d = l.dest
		const where = (l.mapName && d.map !== map.mapId ? ` on ${l.mapName}` : '') + ` (${d.x.toFixed(1)}, ${d.y.toFixed(1)}, ${d.z.toFixed(1)})`
		if (!l.mapKnown) {
			add(l, 'error', `sends the player to map ${d.map}, which the client has no map for.`)
			continue
		}
		if (d.map === map.mapId) {
			const e = fromServer(d.x, d.y, map.tileX, map.tileY)
			if (!map.contains(e.x, e.z)) continue
			const g = map.ground(e.x, e.z)
			const floor = map.floorBelow(e.x, d.z + 1, e.z)
			const onFloor = floor > -Infinity && d.z - floor <= ABOVE
			const at = { x: e.x, z: e.z }
			if (g > d.z + BELOW && !onFloor) {
				add(l, 'error', `lands ${yd(g - d.z)} under the ground${where}.`, at)
				continue
			}
			const under = Math.max(floor, g <= d.z + BELOW ? g : -Infinity)
			if (under === -Infinity) add(l, 'warning', `lands over a hole with nothing under it${where}.`, at)
			else if (d.z - under > ABOVE) add(l, 'warning', `lands ${yd(d.z - under)} above the ${under === floor ? 'floor' : 'ground'}${where}, so the player falls.`, at)
			continue
		}
		if (l.outsideBuilding) {
			add(l, 'warning', `lands outside the building${where}, in the void.`)
			continue
		}
		if (l.inBuilding || l.ground === null) continue
		const g = l.ground
		if (g > d.z + BELOW) add(l, 'error', `lands ${yd(g - d.z)} under the ground${where}.`)
		else if (d.z - g > ABOVE) add(l, 'warning', `lands ${yd(d.z - g)} above the ground${where}, so the player falls.`)
	}
	const out = order.map((k) => {
		const { finding, more } = byDest.get(k)!
		return more ? { ...finding, message: `${finding.message} ${more === 1 ? 'One more teleport lands' : `${more} more teleports land`} there.` } : finding
	})
	const rank = { error: 0, warning: 1, info: 2 }
	out.sort((a, b) => rank[a.severity] - rank[b.severity])
	return capped(PORTALS, out)
}

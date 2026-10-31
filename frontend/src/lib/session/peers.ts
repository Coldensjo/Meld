// The plain parts of a shared session's page side (#1000), kept apart from shared.svelte.ts so a Bun
// test can check them without the bindings: who joined or left between two member lists, the status
// bar's chip, and the serial send queue.

import { TILE_YARDS } from '../wow/format'

/** Why a guest cannot write the session's map into the client or server (#1005), shown as the menu items' tooltip and the status line. */
export const GUEST_EXPORT_REASON = "The host exports the session's map"

/** Why the session's map can't be made again in its tab (#1007: Grow Region, Revert, a recovered copy, a file opened over an untouched map): the others would keep editing the old one. */
export const SESSION_MAP_REASON = "The session's map can't be replaced while it is shared"

/** Why a guest can't revert or grow the session's map (#1008): the host makes it again and sends it to everyone. */
export const GUEST_REPLACE_REASON = "The host owns the session's map: only the host can revert or grow it"

/** A member of the session, as `session.Peer` gives it. */
export interface Peer {
	id: number
	name: string
}

/** A message of the session, as `session.Message` gives it (the "session:message" event). */
export interface Message {
	seq: number
	from: number
	/** The one member it went to, or absent for everyone. */
	to?: number
	kind: string
	data?: unknown
}

/** The host's member id (`session.HostID`). */
export const HOST_ID = 1

/** The kind of the message that carries the host's map to a guest that joined, or to everyone when the host made it again (data: `MapHandoff`). */
export const KIND_MAP = 'map'

/**
 * The map an edit message was made against (#1008): `g` in its data, the number of times the host had
 * made the session's map again (Revert, Grow Region) when it was sent; 0 when absent. A member drops the
 * others' edits made against another map than the one it has, since a grown map's grid is shifted.
 */
export function editGen(data: unknown): number {
	const g = (data as { g?: unknown } | null)?.g
	return typeof g === 'number' && Number.isInteger(g) && g > 0 ? g : 0
}

/** The members that are in `after` but not `before`, and the ones that went. */
export function peerChanges(before: readonly Peer[], after: readonly Peer[]) {
	const had = new Set(before.map((p) => p.id))
	const has = new Set(after.map((p) => p.id))
	return { joined: after.filter((p) => !had.has(p.id)), left: before.filter((p) => !has.has(p.id)) }
}

/** A member's name, or "Member <id>" for one that gave none. */
export const nameOf = (p: Peer) => p.name || `Member ${p.id}`

/** The members the status bar's chip names (#1004: each in its colour, a click flies to them): everyone but you. */
export function otherPeers(peers: readonly Peer[], you: number): Peer[] {
	return peers.filter((p) => p.id !== you)
}

/** The chip's tooltip: every member on a line, the host and you marked. */
export function peersTitle(peers: readonly Peer[], you: number) {
	return peers.map((p) => `${nameOf(p)}${p.id === HOST_ID ? ' (host)' : ''}${p.id === you ? ' (you)' : ''}`).join('\n')
}

/** The status line for a member joining or leaving. */
export function changeLine(joined: readonly Peer[], left: readonly Peer[]) {
	const parts: string[] = []
	if (joined.length) parts.push(`${joined.map(nameOf).join(', ')} joined the session`)
	if (left.length) parts.push(`${left.map(nameOf).join(', ')} left the session`)
	return parts.join('; ')
}

/**
 * A queue that runs each send after the one before it has finished, since Wails runs bound calls
 * concurrently and two sends not awaited one after the other can reach the host in either order. A
 * failed send rejects its own promise and leaves the queue going.
 */
export function serialQueue() {
	let tail: Promise<unknown> = Promise.resolve()
	return <T>(fn: () => Promise<T>): Promise<T> => {
		const run = tail.then(fn)
		tail = run.catch(() => undefined)
		return run
	}
}

/** The kind of the messages that carry a map too large for one message, in parts (data: `MapPart`, #1010). Joined, the parts' text is the `MapHandoff`'s JSON. */
export const KIND_MAP_PART = 'map.part'

/**
 * The most characters of a map's JSON one message carries. Wails refuses a binding call over 64 MB, and
 * the event that brings it to the guest's page was timed only up to 26 MB (#1006), so a larger map goes
 * in parts well below both: the JSON string escaping of a part's quotes adds at most as much again.
 */
export const MAP_PART_CHARS = 8_000_000

/** One part of a map sent in parts: part `part` (from 0) of `parts`, a slice of the handoff's JSON. */
export interface MapPart {
	part: number
	parts: number
	text: string
}

/** Cuts `text` into slices of at most `size` characters (one empty slice for an empty text). */
export function splitText(text: string, size: number): string[] {
	if (size <= 0) throw new Error('the part size must be positive')
	const out: string[] = []
	for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
	return out.length ? out : ['']
}

/** Puts a map's parts back together: `add` gives the whole text once the last part is in, else null. A part 0 starts a new map, dropping one half received. */
export class PartJoiner {
	private parts: string[] = []
	private count = 0
	private have = 0

	add(p: MapPart): string | null {
		if (!(p.parts >= 1) || !(p.part >= 0 && p.part < p.parts) || typeof p.text !== 'string') throw new Error(`a broken map part (${p.part} of ${p.parts})`)
		if (p.part === 0 || p.parts !== this.count) {
			this.parts = new Array<string>(p.parts)
			this.count = p.parts
			this.have = 0
		}
		if (this.parts[p.part] === undefined) this.have++
		this.parts[p.part] = p.text
		if (this.have < this.count) return null
		const text = this.parts.join('')
		this.reset()
		return text
	}

	reset() {
		this.parts = []
		this.count = 0
		this.have = 0
	}
}

/** A region's map and block corner, in tiles. */
export interface BlockCorner {
	mapName: string
	x: number
	y: number
}

/** How far a region opened again bigger from `was` to `now` moved its ground, in yards: a block grown north or west starts at another tile (#1012). */
export function blockShift(was: BlockCorner | null | undefined, now: BlockCorner | null | undefined): { x: number; z: number } | null {
	if (!was || !now || was.mapName.toLowerCase() !== now.mapName.toLowerCase()) return null
	const x = (was.x - now.x) * TILE_YARDS
	const z = (was.y - now.y) * TILE_YARDS
	return x || z ? { x, z } : null
}

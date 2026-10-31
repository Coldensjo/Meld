// The plain parts of a shared session's page side (#1000), kept apart from shared.svelte.ts so a Bun
// test can check them without the bindings: who joined or left between two member lists, the status
// bar's chip, and the serial send queue.

/** Why a guest cannot write the session's map into the client or server (#1005), shown as the menu items' tooltip and the status line. */
export const GUEST_EXPORT_REASON = "The host exports the session's map"

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

/** The kind of the message that carries the host's map to a guest that joined (data: `MapHandoff`). */
export const KIND_MAP = 'map'

/** The members that are in `after` but not `before`, and the ones that went. */
export function peerChanges(before: readonly Peer[], after: readonly Peer[]) {
	const had = new Set(before.map((p) => p.id))
	const has = new Set(after.map((p) => p.id))
	return { joined: after.filter((p) => !had.has(p.id)), left: before.filter((p) => !has.has(p.id)) }
}

const nameOf = (p: Peer) => p.name || `Member ${p.id}`

/** The status bar's chip: the other members' names, or what the session waits for when there are none. */
export function peersLabel(peers: readonly Peer[], you: number) {
	const others = peers.filter((p) => p.id !== you)
	return others.length ? `Session: ${others.map(nameOf).join(', ')}` : 'Session: waiting for others'
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

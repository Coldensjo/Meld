// A shared editing session's page side (#728, #1000): File › Host Session and Join Session, the members
// for the status bar, and the map a guest starts from. The transport is Go's (internal/session,
// app_session.go, docs/architecture/session.md): every message comes here as a "session:message" event,
// the page's own broadcasts too, and the end of this Meld's part as "session:ended".
//
// The state is low-rate (a member joining, the session starting or ending), so it is reactive. The last
// message's `seq` changes with every message and stays out of it (`lastSeq`).
import { HostSession, JoinSession, LeaveSession, SessionSend } from '../wails/App'
import type { main, mapfile } from '../wails/models'
import { EventsOn } from '../wails/runtime'
import { engineRef } from '../state/engineRef'
import { editor, setStatus } from '../state/editor.svelte'
import { fromMapData, toMapData } from '../io/mapData'
import { GUEST_EXPORT_REASON, HOST_ID, KIND_MAP, changeLine, peerChanges, serialQueue, type Message, type Peer } from './peers'
import { HEIGHTS_FLUSH_MS, HeightSync, KIND_HEIGHTS, type VertexRect } from './heights'

/** This Meld's part in a session. */
export const shared = $state({
	/** 'host', 'guest', or '' outside a session. */
	role: '' as '' | 'host' | 'guest',
	/** This Meld's member id. */
	you: 0,
	/** The session code (the host's only). */
	code: '',
	port: 0,
	/** The host's addresses for the guests to join at, with the port. */
	addrs: [] as string[],
	/** The members, the host first. Replaced, never edited in place. */
	peers: [] as Peer[],
	/** The tab of the session's map: the host's map it shares, or the one a guest opened from it; 0 for none yet. */
	docId: 0,
})

/** The map a guest starts from: the host's map as it was after message `seq` (#1001 drops older edits). */
export interface MapHandoff {
	seq: number
	map: mapfile.MapData
}

/** The `seq` of the last message this page has seen. */
let lastSeq = 0
let off: Array<() => void> = []
const queue = serialQueue()

/** The session map's document, or undefined while it is not open. */
function sessionDoc() {
	return shared.docId ? engineRef.current?.documents.find((d) => d.id === shared.docId) : undefined
}

/** Makes tab `id` the session's map (0 for none). The map's document is marked `shared`, so it is never replaced in its tab while the sync is bound to it (#1007). */
function setSessionDoc(id: number) {
	const old = sessionDoc()
	if (old) old.shared = false
	shared.docId = id
	const d = sessionDoc()
	if (d) d.shared = true
}

/** The session map's heights (#1001): sent every HEIGHTS_FLUSH_MS while they change, the others' applied in the host's order. */
const heights = new HeightSync({
	send: (data) => sessionSend(0, KIND_HEIGHTS, data),
	applied: (r: VertexRect) => {
		const d = sessionDoc()
		if (!d) return
		// The objects standing on the ground follow it, as after a stroke of one's own.
		const cs = d.terrain.cellSize
		d.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
		// Another member's edit is an unsaved change of the map here too (set once, not per message).
		if (engineRef.current?.activeDocumentId() === d.id) {
			if (!editor.dirty) editor.dirty = true
		} else d.meta.dirty = true
	},
	failed: (err) => setStatus(`A height edit did not reach the session: ${err}`, 8000),
})
let flushTimer: ReturnType<typeof setInterval> | null = null

/** Sends the session map's changed heights; stops syncing once that map is closed. */
function flushHeights() {
	const g = heights.bound
	if (!g) return
	if (sessionDoc()?.terrain !== g) {
		heights.unbind()
		return
	}
	heights.flush()
}

/** Sends a message into the session (to 0 is everyone), after every send before it. */
export function sessionSend(to: number, kind: string, data: unknown) {
	return queue(() => SessionSend(to, kind, data === undefined ? '' : JSON.stringify(data)))
}

function subscribe() {
	unsubscribe()
	lastSeq = 0
	heights.wait()
	flushTimer = setInterval(flushHeights, HEIGHTS_FLUSH_MS)
	off = [EventsOn<Message>('session:message', onMessage), EventsOn<string>('session:ended', onEnded)]
}

function unsubscribe() {
	for (const f of off) f()
	off = []
	if (flushTimer) clearInterval(flushTimer)
	flushTimer = null
	heights.unbind()
}

function apply(info: main.SessionInfo) {
	shared.role = info.role as '' | 'host' | 'guest'
	shared.you = info.you
	shared.code = info.code
	shared.port = info.port
	shared.addrs = info.addrs ?? []
	// A peer list that came as a message before the call returned is newer.
	if (!lastSeq) shared.peers = info.peers ?? []
}

function reset() {
	unsubscribe()
	shared.role = ''
	shared.you = 0
	shared.code = ''
	shared.port = 0
	shared.addrs = []
	shared.peers = []
	setSessionDoc(0)
}

/** Starts hosting a session with the active map as its map. Throws what Go refuses with. */
export async function hostSession(port: number, name: string) {
	const e = engineRef.current
	if (!e) throw new Error('the editor has not started')
	if (e.activeWorld()) throw new Error('a world view cannot be shared: File › Edit Here opens the block around the camera, which can')
	subscribe()
	try {
		apply(await HostSession(port, name))
	} catch (err) {
		reset()
		throw err
	}
	setSessionDoc(e.activeDocumentId())
	const d = sessionDoc()
	if (d) heights.bind(d.terrain, 0)
}

/** Joins the session hosted at `addr`; the host's map opens as a new tab once it arrives. */
export async function joinSession(addr: string, code: string, name: string) {
	subscribe()
	try {
		apply(await JoinSession(addr, code, name))
	} catch (err) {
		reset()
		throw err
	}
	setStatus('Joined the session; waiting for the map', 8000)
}

/** True when the map in the active tab (`docId`) is the session's and this Meld is a guest in it: the host alone compiles, publishes and launches it. */
export function isGuestMap(docId: number): boolean {
	return shared.role === 'guest' && shared.docId !== 0 && shared.docId === docId
}

/** True when tab `docId` is the session's map, for host and guest alike: it can't be made again in its tab (#1007). */
export function isSessionMap(docId: number): boolean {
	return shared.role !== '' && shared.docId !== 0 && shared.docId === docId
}

/** Refuses a write into the client or server from the active tab when it is a guest's session map; says why in the status bar. */
export function refuseGuestExport(engine: { activeDocumentId(): number }): boolean {
	if (!isGuestMap(engine.activeDocumentId())) return false
	setStatus(GUEST_EXPORT_REASON + ': ask the host to compile, publish or launch it', 6000)
	return true
}

/** Leaves the session: the host ends it for everyone. */
export async function leaveSession() {
	if (!shared.role) return
	await LeaveSession()
}

function onMessage(m: Message) {
	if (m.seq > lastSeq) lastSeq = m.seq
	const data = m.data as unknown
	switch (m.kind) {
		case 'session.welcome': {
			const w = data as { you: number; peers: Peer[] }
			shared.you = w.you
			shared.peers = w.peers ?? []
			return
		}
		case 'session.peers': {
			const peers = (data as Peer[] | null) ?? []
			const { joined, left } = peerChanges(shared.peers, peers)
			shared.peers = peers
			const line = changeLine(
				joined.filter((p) => p.id !== shared.you),
				left,
			)
			if (line) setStatus(line, 6000)
			if (shared.role === 'host') for (const p of joined) if (p.id !== HOST_ID) void sendMap(p)
			return
		}
		case KIND_MAP:
			if (m.to === shared.you && shared.role !== 'host') openHandoff(data as MapHandoff)
			return
		case KIND_HEIGHTS:
			heights.receive(m.seq, m.from, data, shared.you)
			return
	}
}

/** The host sends the session's map to a member that joined, as it is now. */
async function sendMap(p: Peer) {
	const e = engineRef.current
	const d = e?.documents.find((x) => x.id === shared.docId)
	if (!e || !d) {
		setStatus(`${p.name} joined, but the session's map is closed: they have no map to edit`, 8000)
		return
	}
	const handoff: MapHandoff = { seq: lastSeq, map: toMapData(e.snapshotOf(d)) }
	try {
		await sessionSend(p.id, KIND_MAP, handoff)
	} catch (err) {
		setStatus(`Sending the map to ${p.name} failed: ${err}`, 8000)
	}
}

/** A guest opens the host's map as a new tab, unsaved (Save is Save As there). */
function openHandoff(h: MapHandoff) {
	const e = engineRef.current
	if (!e) return
	try {
		e.openDocument(fromMapData(h.map), '')
	} catch (err) {
		setStatus(`The session's map could not be opened: ${err}`, 10000)
		return
	}
	setSessionDoc(e.activeDocumentId())
	// The edits held since joining that the map doesn't hold yet go in now.
	const d = sessionDoc()
	if (d) heights.bind(d.terrain, h.seq)
	const host = shared.peers.find((p) => p.id === HOST_ID)
	setStatus(`Opened ${host?.name || 'the host'}'s map ${h.map.name}`, 6000)
}

function onEnded(reason: string) {
	const was = shared.role
	reset()
	if (reason) setStatus(`The session ended: ${reason}`, 10000)
	else setStatus(was === 'host' ? 'You ended the session' : 'You left the session', 6000)
}

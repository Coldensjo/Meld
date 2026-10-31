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
import { GUEST_EXPORT_REASON, HOST_ID, KIND_MAP, KIND_MAP_PART, MAP_PART_CHARS, PartJoiner, changeLine, peerChanges, serialQueue, splitText, type MapPart, type Message, type Peer } from './peers'
import { HEIGHTS_FLUSH_MS, HeightSync, KIND_HEIGHTS, type VertexRect } from './heights'
import { KIND_PAINT, PaintSync } from './paint'
import { KIND_OBJECTS, LANES, Lanes, ObjectSync, type IdLane } from './objects'
import { selectObjects } from '../state/selection'

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
	/** The guest's lane for new object ids and the counts to start it from (#1003). */
	ids?: IdLane
}

/** The `seq` of the last message this page has seen. */
let lastSeq = 0
let off: Array<() => void> = []
const queue = serialQueue()
/** A guest's map arriving in parts (#1010). */
const mapParts = new PartJoiner()

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
		markUnsaved()
	},
	failed: (err) => setStatus(`A height edit did not reach the session: ${err}`, 8000),
})

/** Whether the session's map is the active tab, whose per-map fields live in `editor` rather than its `meta`. */
function sessionActive() {
	const d = sessionDoc()
	return !!d && engineRef.current?.activeDocumentId() === d.id
}

/** Another member's edit is an unsaved change of the map here too (set once, not per message). */
function markUnsaved() {
	const d = sessionDoc()
	if (!d) return
	if (sessionActive()) {
		if (!editor.dirty) editor.dirty = true
	} else d.meta.dirty = true
}

/** The session map's texture paint (#1002): whole chunks with their slots as paths, sent and applied as the heights are. */
const paint = new PaintSync({
	send: (data) => sessionSend(0, KIND_PAINT, data),
	palette: () => (sessionActive() ? editor.palette : (sessionDoc()?.meta.palette ?? [])),
	setPalette: (p) => {
		if (sessionActive()) editor.palette = p
		else {
			const d = sessionDoc()
			if (d) d.meta.palette = p
		}
	},
	applied: markUnsaved,
	failed: (err) => setStatus(`Texture paint did not sync with the session: ${err}`, 8000),
})
/** The session map's placed objects (#1003): the changed objects whole, sent and applied as the heights are. */
const objects = new ObjectSync({
	send: (data) => sessionSend(0, KIND_OBJECTS, data),
	applied: (ids) => {
		markUnsaved()
		// The selection and the Inspector's copy follow: a removed object leaves the selection.
		const d = sessionDoc()
		if (!d || !sessionActive()) return
		const touched = new Set(ids)
		if (editor.selectedIds.some((id) => touched.has(id) && !d.objects.objects.has(id))) selectObjects(d.objects, editor.selectedIds, editor.selected?.id)
		else if (editor.selected && touched.has(editor.selected.id)) {
			const o = d.objects.objects.get(editor.selected.id)
			if (o) editor.selected = { ...o }
		}
	},
	failed: (err) => setStatus(`A model edit did not reach the session: ${err}`, 8000),
})
/** The host's id lanes, by member (#1003). */
let lanes = new Lanes()
let flushTimer: ReturnType<typeof setInterval> | null = null

/** Sends the session map's changed heights, paint and objects; stops syncing once that map is closed. */
function flushEdits() {
	const doc = sessionDoc()
	const t = doc?.terrain
	if (heights.bound) {
		if (t !== heights.bound) heights.unbind()
		else heights.flush()
	}
	if (paint.bound) {
		if (t !== paint.bound) paint.unbind()
		else paint.flush()
	}
	if (objects.bound) {
		if (doc?.objects !== objects.bound) objects.unbind()
		else objects.flush()
	}
}

/** Starts syncing the session map's edits: the map as it was after message `afterSeq`, new object ids made in `ids`' lane. */
function bindEdits(afterSeq: number, ids: IdLane) {
	const d = sessionDoc()
	if (!d) return
	heights.bind(d.terrain, afterSeq)
	paint.bind(d.terrain, afterSeq)
	objects.bind(d.objects, afterSeq, ids)
}

/** Sends a message into the session (to 0 is everyone), after every send before it. */
export function sessionSend(to: number, kind: string, data: unknown) {
	return queue(() => sendJson(to, kind, data === undefined ? '' : JSON.stringify(data)))
}

function sendJson(to: number, kind: string, json: string) {
	// Wails refuses a binding call whose body is over 64 MB ("assembled body too large"). Say so plainly (#1006); the map goes in parts (#1010).
	if (json.length > MAX_SEND_BYTES) throw new Error(`the message is ${Math.round(json.length / 1e6)} MB, over the ${Math.round(MAX_SEND_BYTES / 1e6)} MB a binding call takes`)
	return SessionSend(to, kind, json)
}

/** Sends the map handoff to member `to`: as one message when its JSON fits in MAP_PART_CHARS, else in parts (kind `map.part`) one after the other in the queue (#1010). */
function sendHandoff(to: number, h: MapHandoff) {
	return queue(async () => {
		const json = JSON.stringify(h)
		if (json.length <= MAP_PART_CHARS) return sendJson(to, KIND_MAP, json)
		const texts = splitText(json, MAP_PART_CHARS)
		for (let i = 0; i < texts.length; i++) {
			const part: MapPart = { part: i, parts: texts.length, text: texts[i] }
			await sendJson(to, KIND_MAP_PART, JSON.stringify(part))
		}
	})
}

const MAX_SEND_BYTES = 60_000_000

function subscribe() {
	unsubscribe()
	lastSeq = 0
	lanes = new Lanes()
	mapParts.reset()
	heights.wait()
	paint.wait()
	objects.wait()
	flushTimer = setInterval(flushEdits, HEIGHTS_FLUSH_MS)
	off = [EventsOn<Message>('session:message', onMessage), EventsOn<string>('session:ended', onEnded)]
}

function unsubscribe() {
	for (const f of off) f()
	off = []
	if (flushTimer) clearInterval(flushTimer)
	flushTimer = null
	heights.unbind()
	paint.unbind()
	objects.unbind()
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
	bindEdits(0, { lane: 0, nextId: 0, nextGroup: 0 })
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
			if (shared.role === 'host') {
				for (const p of left) lanes.free(p.id)
				for (const p of joined) if (p.id !== HOST_ID) void sendMap(p)
			}
			return
		}
		case KIND_MAP:
			if (m.to === shared.you && shared.role !== 'host') openHandoff(data as MapHandoff)
			return
		case KIND_MAP_PART:
			if (m.to === shared.you && shared.role !== 'host') receivePart(data as MapPart)
			return
		case KIND_HEIGHTS:
			heights.receive(m.seq, m.from, data, shared.you)
			return
		case KIND_PAINT:
			paint.receive(m.seq, m.from, data, shared.you)
			return
		case KIND_OBJECTS:
			objects.receive(m.seq, m.from, data, shared.you)
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
	const lane = lanes.take(p.id)
	if (lane === null) {
		setStatus(`${p.name} joined, but every id lane is held: the session's map was not sent`, 8000)
		return
	}
	// The guest counts from above every id and group this map's layer has held, the removed ones too (an undo brings those back).
	const { nextId, nextGroup } = d.objects.counts
	const handoff: MapHandoff = { seq: lastSeq, map: toMapData(e.snapshotOf(d)), ids: { lane, nextId, nextGroup } }
	try {
		await sendHandoff(p.id, handoff)
	} catch (err) {
		setStatus(`Sending the map to ${p.name} failed: ${err}`, 8000)
	}
}

/** A guest gathers a map sent in parts and opens it once the last is in. */
function receivePart(p: MapPart) {
	let text: string | null
	let h: MapHandoff
	try {
		text = mapParts.add(p)
		if (text === null) {
			setStatus(`Receiving the session's map: part ${p.part + 1} of ${p.parts}`, 8000)
			return
		}
		h = JSON.parse(text) as MapHandoff
	} catch (err) {
		mapParts.reset()
		setStatus(`The session's map could not be read: ${err}`, 10000)
		return
	}
	openHandoff(h)
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
	// The edits held since joining that the map doesn't hold yet go in now. A host that sent no lane (an
	// older Meld, a scripted one) gets this member's id as one, which holds while the members stay below LANES.
	bindEdits(h.seq, h.ids ?? { lane: shared.you % LANES, nextId: 0, nextGroup: 0 })
	const host = shared.peers.find((p) => p.id === HOST_ID)
	setStatus(`Opened ${host?.name || 'the host'}'s map ${h.map.name}`, 6000)
}

function onEnded(reason: string) {
	const was = shared.role
	reset()
	if (reason) setStatus(`The session ended: ${reason}`, 10000)
	else setStatus(was === 'host' ? 'You ended the session' : 'You left the session', 6000)
}

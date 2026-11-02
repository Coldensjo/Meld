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
import { editor, setStatus, ui } from '../state/editor.svelte'
import { fromMapData, toMapData } from '../io/mapData'
import {
	GUEST_EXPORT_REASON,
	GUEST_REPLACE_REASON,
	HOST_ID,
	blockShift,
	KIND_MAP,
	KIND_MAP_PART,
	MAP_PART_CHARS,
	PartJoiner,
	changeLine,
	editGen,
	nameOf,
	peerChanges,
	serialQueue,
	splitText,
	type MapPart,
	type Message,
	type Peer,
} from './peers'
import { KIND_PRESENCE, PRESENCE_MS, PresenceBook, makePresence, presenceKey } from './presence'
import { PresenceView } from './PresenceView'
import { HEIGHTS_FLUSH_MS, HeightSync, KIND_HEIGHTS, type VertexRect } from './heights'
import { KIND_PAINT, PaintSync, remapSlots, reorderPalette } from './paint'
import { HoleSync, KIND_HOLES } from './holes'
import { KIND_LIQUIDS, LiquidSync } from './liquids'
import { ChunkDataSync, KIND_CHUNK_DATA } from './chunkData'
import { KIND_SHADOWS, ShadowSync } from './shadows'
import { KIND_SETTINGS, SettingsSync, readSettings, writeSettings } from './settings'
import { KIND_PATH_APPLY, PathApplySync, adoptNotes, notesOf, type ApplyNote, type PathApplyMap } from './pathApplies'
import { appliesOf, othersApplies } from '../tools/pathRecord'
import type { Terrain } from '../terrain/Terrain'
import { maskBytes } from '../terrain/tileMask'
import { KIND_OBJECTS, LANES, Lanes, ObjectSync, type IdLane } from './objects'
import { selectObjects } from '../state/selection'
import { TILE_CELLS, TILE_YARDS } from '../wow/format'
import type { MapDocument, VmangosRef } from '../engine/MapDocument'
import type { Engine, MapSnapshot } from '../engine/Engine'

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
	/**
	 * The guest's lane for new object ids and the counts to start it from (#1003). A map the host made
	 * again, sent to everyone (#1008), has the counts alone: each guest keeps its lane.
	 */
	ids?: IdLane | Omit<IdLane, 'lane'>
	/** How many times the host has made the session's map again (#1008, `mapGen`); absent for 0. */
	gen?: number
	/**
	 * How many of the map's palette entries are the session's order so far (#1009, `PaintSync.order`): the
	 * map is sent in that order, the host's own textures not yet in it after them. Absent for all of them.
	 */
	ordered?: number
	/** The paths another member applied last, in the host's notes (#1023), so a guest's Path tool refuses them too. Absent for none. */
	applies?: ApplyNote[]
}

/** The `seq` of the last message this page has seen. */
let lastSeq = 0
/**
 * How many times the host has made the session's map again in its tab (Revert, Grow Region, #1008): every
 * edit message carries the one it was made against (`g`, `editGen`) and the others' made against another
 * are dropped. -1 for a guest whose map has not come yet.
 */
let mapGen = 0
/** The edit messages a guest gets before its map, held until the map tells which `mapGen` they must have. */
let early: Message[] = []
/** A guest's id lane, from its own handoff; a map sent to everyone keeps it. */
let myLane = 0
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
	send: (data) => sessionSend(0, KIND_HEIGHTS, tagged(data)),
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
	send: (data) => sessionSend(0, KIND_PAINT, tagged(data)),
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
/** The session map's holes (#1016): the touched cells' hole bytes, sent and applied as the heights are. */
const holes = new HoleSync({
	send: (data) => sessionSend(0, KIND_HOLES, tagged(data)),
	applied: markUnsaved,
	failed: (err) => setStatus(`A hole edit did not reach the session: ${err}`, 8000),
})
/** The session map's painted liquids (#1017): the changed chunks' layers whole, sent and applied as the paint is. */
const liquids = new LiquidSync({
	send: (data) => sessionSend(0, KIND_LIQUIDS, tagged(data)),
	applied: markUnsaved,
	failed: (err) => setStatus(`A liquid edit did not reach the session: ${err}`, 8000),
})
/** The session map's chunk data (#1018): the changed chunks' zones and flags and the changed no-effect and biome map (#1036) cells, sent and applied as the holes are. */
const chunkData = new ChunkDataSync({
	send: (data) => sessionSend(0, KIND_CHUNK_DATA, tagged(data)),
	applied: markUnsaved,
	failed: (err) => setStatus(`A map data edit did not reach the session: ${err}`, 8000),
})
/** The session map's baked shadows (#1018): the changed texels' bits, or none, sent and applied as the holes are. */
const shadows = new ShadowSync({
	send: (data) => sessionSend(0, KIND_SHADOWS, tagged(data)),
	applied: markUnsaved,
	failed: (err) => setStatus(`A baked shadow edit did not reach the session: ${err}`, 8000),
})
/** The session map's settings (#1019): the sea, roles, ground effects, looks, paths, Map Properties' facts and tiles and the biomes (#1036), each changed field whole. */
const settings = new SettingsSync({
	send: (data) => sessionSend(0, KIND_SETTINGS, tagged(data)),
	read: () => {
		const d = sessionDoc()
		if (!d) return null
		const live = sessionActive()
		return readSettings(live ? editor : d.meta, d.meta.vmangos, live ? editor.mapBiomes : d.meta.biomes)
	},
	write: (set) => {
		const d = sessionDoc()
		if (!d) return []
		const t = d.terrain
		const live = sessionActive()
		const setTiles = (tiles: string) => t.setTileMask(maskBytes(tiles, t.size / TILE_CELLS))
		return writeSettings(live ? editor : d.meta, d.meta.vmangos, set, setTiles, (b) => {
			if (live) editor.mapBiomes = b
			else d.meta.biomes = b
		})
	},
	applied: () => {
		markUnsaved()
		// Map Properties' tile view and the History window follow the version; the engine reads the rest each frame.
		ui.historyVersion++
	},
	failed: (err) => setStatus(`A map setting did not reach the session: ${err}`, 8000),
})
/** The name of member `id` as the peers list shows it. */
function memberName(id: number): string {
	const p = shared.peers.find((x) => x.id === id)
	return p ? nameOf(p) : `Member ${id}`
}
/** Which member has each path's last apply live in the session map (#1022), so the Path tool refuses to lay another member's twice. */
const pathApplies = new PathApplySync({
	send: (data) => sessionSend(0, KIND_PATH_APPLY, tagged(data)),
	nameOf: memberName,
	failed: (err) => setStatus(`A path apply did not reach the session: ${err}`, 8000),
})
/** The map `pathApplies` works on for terrain `t`, the same object each time so the sync can tell the map is still open. */
const applyMaps = new WeakMap<Terrain, PathApplyMap>()
function applyMapOf(t: Terrain): PathApplyMap {
	let m = applyMaps.get(t)
	if (!m) applyMaps.set(t, (m = { own: appliesOf(t), others: othersApplies(t) }))
	return m
}
/** The session map's placed objects (#1003): the changed objects whole, sent and applied as the heights are. */
const objects = new ObjectSync({
	send: (data) => sessionSend(0, KIND_OBJECTS, tagged(data)),
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

/** The others' cameras and brush circles (#1004): the latest of each, drawn by `presenceView` while the session's map is the active tab. */
const presence = new PresenceBook()
let presenceView: PresenceView | null = null
let presenceTimer: ReturnType<typeof setInterval> | null = null
/** The key of the last presence this member sent (`presenceKey`), '' to send it again at the next tick (a member joined, the map was made again). */
let sentPresence = ''
/** A presence send not yet through the queue: the next waits, so a slow queue never piles them up. */
let presenceBusy = false

/**
 * Sends this member's presence when it changed (the camera, the tool, the brush circle), or `{}` once on
 * leaving the session's tab, and draws the others'. Runs every PRESENCE_MS, not per frame.
 */
function tickPresence() {
	const e = engineRef.current
	if (!e) return
	const active = mapGen >= 0 && sessionActive()
	if (!presenceBusy) {
		const mine = active ? makePresence(e.eye(), e.controller, editor.tool, e.brushRing()) : null
		const key = presenceKey(mine)
		if (key !== sentPresence) {
			sentPresence = key
			presenceBusy = true
			sessionSend(0, KIND_PRESENCE, tagged(mine ?? {}))
				.catch(() => (sentPresence = ''))
				.finally(() => (presenceBusy = false))
		}
	}
	if (mapGen >= 0) presence.keepGen(mapGen)
	if (!presenceView) {
		presenceView = new PresenceView()
		e.scene.add(presenceView.group)
	}
	const names = new Map(shared.peers.map((p) => [p.id, nameOf(p)]))
	presenceView.update(presence, active ? (sessionDoc()?.terrain ?? null) : null, (id) => names.get(id) ?? `Member ${id}`)
}

/** Drops the others' markers and takes the view out of the scene. */
function clearPresence() {
	presence.clear()
	sentPresence = ''
	if (presenceView) {
		presenceView.group.removeFromParent()
		presenceView.dispose()
		presenceView = null
	}
}

/**
 * Flies the camera to member `id`'s (#1004): the view it has, on the session's map, switching to its tab.
 * Says so in the status bar when that member is not on the session's map.
 */
export function flyToMember(id: number) {
	const e = engineRef.current
	const peer = shared.peers.find((p) => p.id === id)
	const name = peer ? nameOf(peer) : `Member ${id}`
	const p = presence.get(id)
	const d = sessionDoc()
	if (!e || !p || !d) {
		setStatus(`${name} is not on the session's map right now`, 5000)
		return
	}
	if (e.activeDocumentId() !== d.id) e.switchDocument(d.id)
	e.controller.setView(p.t[0], p.t[1], p.t[2], p.yaw, p.pitch, p.d)
}

/** Member `id`'s marker as drawn (its camera, its brush ring's centre, whether the markers show), or null for none: for the probes. */
export function presenceMarker(id: number) {
	return presenceView?.markerAt(id) ?? null
}

/** Sends the session map's changed heights, paint, holes, liquids, chunk data, shadows, objects and settings; stops syncing once that map is closed. */
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
	if (holes.bound) {
		if (t !== holes.bound) holes.unbind()
		else holes.flush()
	}
	if (liquids.bound) {
		if (doc?.liquids !== liquids.bound) liquids.unbind()
		else liquids.flush()
	}
	if (chunkData.bound) {
		if (t !== chunkData.bound) chunkData.unbind()
		else chunkData.flush()
	}
	if (shadows.bound) {
		if (t !== shadows.bound) shadows.unbind()
		else shadows.flush()
	}
	if (objects.bound) {
		if (doc?.objects !== objects.bound) objects.unbind()
		else objects.flush()
	}
	// After the paint, whose `add` has announced a texture a role names.
	if (settings.bound) {
		if (doc !== settings.bound) settings.unbind()
		else settings.flush()
	}
	if (pathApplies.bound) {
		if (!t || pathApplies.bound !== applyMapOf(t)) pathApplies.unbind()
		else pathApplies.flush()
	}
}

/** Starts syncing the session map's edits: the map as it was after message `afterSeq`, new object ids made in `ids`' lane. */
function bindEdits(afterSeq: number, ids: IdLane, ordered?: number) {
	const d = sessionDoc()
	if (!d) return
	heights.bind(d.terrain, afterSeq)
	paint.bind(d.terrain, afterSeq, ordered)
	holes.bind(d.terrain, afterSeq)
	liquids.bind(d.liquids, afterSeq)
	chunkData.bind(d.terrain, afterSeq)
	shadows.bind(d.terrain, afterSeq)
	objects.bind(d.objects, afterSeq, ids)
	settings.bind(d, afterSeq)
	pathApplies.bind(applyMapOf(d.terrain), afterSeq)
}

/** An edit message's data with the map it was made against (`g`, #1008), left out while the map was never made again. */
function tagged<T extends object>(data: T): T | (T & { g: number }) {
	return mapGen > 0 ? { ...data, g: mapGen } : data
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
	mapGen = -1
	early = []
	myLane = 0
	lanes = new Lanes()
	mapParts.reset()
	heights.wait()
	paint.wait()
	holes.wait()
	liquids.wait()
	chunkData.wait()
	shadows.wait()
	objects.wait()
	settings.wait()
	pathApplies.wait()
	flushTimer = setInterval(flushEdits, HEIGHTS_FLUSH_MS)
	clearPresence()
	presenceTimer = setInterval(tickPresence, PRESENCE_MS)
	off = [EventsOn<Message>('session:message', onMessage), EventsOn<string>('session:ended', onEnded)]
}

function unsubscribe() {
	for (const f of off) f()
	off = []
	if (flushTimer) clearInterval(flushTimer)
	flushTimer = null
	if (presenceTimer) clearInterval(presenceTimer)
	presenceTimer = null
	clearPresence()
	early = []
	heights.unbind()
	paint.unbind()
	holes.unbind()
	liquids.unbind()
	chunkData.unbind()
	shadows.unbind()
	objects.unbind()
	settings.unbind()
	pathApplies.unbind()
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
	mapGen = 0
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

/**
 * Leaves the session tab `docId` is the map of, then closes the tab, since the sync stops with its document.
 * On the host that ends the session (#1013): the guests get "the host ended the session" instead of going on
 * editing a map no one else has. On a guest it leaves (#1014): the host's chip drops it, rather than naming a
 * member whose sync stopped.
 */
export async function endSessionAndClose(docId: number) {
	if (isSessionMap(docId)) await leaveSession()
	engineRef.current?.closeDocument(docId)
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
			presence.keep(peers.map((p) => p.id))
			// A member that joined has seen no one's presence yet.
			if (joined.some((p) => p.id !== shared.you)) sentPresence = ''
			if (shared.role === 'host') {
				for (const p of left) lanes.free(p.id)
				for (const p of joined) if (p.id !== HOST_ID) void sendMap(p)
			}
			return
		}
		case KIND_MAP:
			if (mapForMe(m)) openHandoff(data as MapHandoff)
			return
		case KIND_MAP_PART:
			if (mapForMe(m)) receivePart(data as MapPart)
			return
		case KIND_HEIGHTS:
		case KIND_PAINT:
		case KIND_HOLES:
		case KIND_LIQUIDS:
		case KIND_CHUNK_DATA:
		case KIND_SHADOWS:
		case KIND_OBJECTS:
		case KIND_SETTINGS:
		case KIND_PATH_APPLY:
			receiveEdit(m)
			return
		case KIND_PRESENCE:
			// Kept whatever its map: a guest's arrive before its own map, and `tickPresence` drops the ones of another.
			if (m.from !== shared.you) presence.receive(m.from, m.data, editGen(m.data))
	}
}

/**
 * Whether a guest opens map message `m`: one addressed to it, or one to everyone (the host made the map
 * again, #1008) once it has the map. A guest without it yet gets its own handoff after that one.
 */
function mapForMe(m: Message): boolean {
	if (shared.role === 'host') return false
	return m.to ? m.to === shared.you : mapGen >= 0
}

/** The sync of each edit message's kind. */
const syncs: Record<string, { receive(seq: number, from: number, data: unknown, you: number): void }> = {
	[KIND_HEIGHTS]: heights,
	[KIND_PAINT]: paint,
	[KIND_HOLES]: holes,
	[KIND_LIQUIDS]: liquids,
	[KIND_CHUNK_DATA]: chunkData,
	[KIND_SHADOWS]: shadows,
	[KIND_OBJECTS]: objects,
	[KIND_SETTINGS]: settings,
	[KIND_PATH_APPLY]: pathApplies,
}

/** An edit message: held while a guest has no map yet, dropped when another member made it against another map than this one (#1008). */
function receiveEdit(m: Message) {
	if (mapGen < 0) {
		early.push(m)
		return
	}
	// One's own come back as the acknowledgement, which the sync matches by its own count.
	if (m.from !== shared.you && editGen(m.data) !== mapGen) return
	const sync = syncs[m.kind] ?? objects
	sync.receive(m.seq, m.from, m.data, shared.you)
}

/**
 * Runs `replace`, which makes tab `docId`'s map again in its tab (Revert to Saved, Grow Region). Outside a
 * session, or for another tab, it just runs. For the host's session map (#1008), its edits not sent yet go
 * out first, then the sync is bound to the new document and the map is sent to everyone, each guest
 * opening it over its session tab (`openHandoff`); the edits made against the old map are dropped from
 * then on (`mapGen`). A guest's is refused: the host owns the map.
 */
export function replaceSessionMap(docId: number, replace: () => void) {
	const e = engineRef.current
	const d = sessionDoc()
	if (!e || !d || !isSessionMap(docId)) return replace()
	if (shared.role !== 'host') throw new Error(GUEST_REPLACE_REASON)
	flushEdits()
	d.shared = false
	try {
		replace()
	} catch (err) {
		if (e.documents.includes(d)) d.shared = true
		throw err
	}
	adoptReplacement(e, d)
}

/**
 * Runs `open`, which opens tab `docId`'s map bigger in a new tab and closes `docId`'s (File › Grow region,
 * `extendRegion`, #1012). For the host's session map, the sync then moves to the new tab and the map goes to
 * everyone, as `replaceSessionMap` does; a guest's is refused.
 */
export async function moveSessionMap(docId: number, open: () => Promise<void>) {
	const e = engineRef.current
	const d = sessionDoc()
	if (!e || !d || !isSessionMap(docId)) return open()
	if (shared.role !== 'host') throw new Error(GUEST_REPLACE_REASON)
	flushEdits()
	// The old tab is closed, never replaced in place, so it stays marked shared while the new one loads.
	await open()
	d.shared = false
	adoptReplacement(e, d)
}

/** After old session map `d` was made again: binds the sync to the active tab and sends it to everyone, or keeps `d` when it is still open (nothing was made). */
function adoptReplacement(e: Engine, d: MapDocument) {
	// The new map took the tab's place and is active; a replace that did nothing (a grow of a map not from the client) leaves the old one.
	const nd = e.activeDocument()
	if (nd === d || e.documents.includes(d)) {
		d.shared = true
		return
	}
	mapGen++
	sentPresence = ''
	setSessionDoc(nd.id)
	bindEdits(lastSeq, { lane: 0, nextId: 0, nextGroup: 0 })
	if (!shared.peers.some((p) => p.id !== HOST_ID)) return
	const handoff: MapHandoff = { seq: lastSeq, gen: mapGen, map: toMapData(e.snapshotOf(nd)), ids: nd.objects.counts }
	sendHandoff(0, handoff).catch((err) => setStatus(`Sending the map to the session failed: ${err}`, 8000))
}

/**
 * `snap`, the map of tab `d`, with its texture palette in the session's order (#1009, `PaintSync.order`)
 * when `d` is the session's map: the members' palettes can hold textures added at once in either order,
 * so a save (and the map a joining guest gets) is written in the order every member keeps alike, the
 * chunk slots and the other palette indices it holds renumbered in the copy. The map itself is left as
 * it is, since History's steps hold its indices. Any other map comes back as it is.
 */
export function sessionOrdered(d: MapDocument, snap: MapSnapshot): MapSnapshot {
	if (!shared.role || d.id !== shared.docId || paint.bound !== d.terrain) return snap
	const r = reorderPalette(paint.order, snap.palette)
	if (!r) return snap
	const at = (i: number) => (i >= 0 && i < r.remap.length ? r.remap[i] : i)
	return {
		...snap,
		palette: r.palette,
		chunkSlots: remapSlots(snap.chunkSlots, r.remap),
		roles: snap.roles ? { rock: at(snap.roles.rock), dirt: at(snap.roles.dirt) } : snap.roles,
		pathApplies: snap.pathApplies?.map((a) => (a.record.paint ? { ...a, record: { ...a.record, paint: { ...a.record.paint, slots: remapSlots(a.record.paint.slots, r.remap) } } } : a)),
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
	const handoff: MapHandoff = { seq: lastSeq, map: toMapData(sessionOrdered(d, e.snapshotOf(d))), ids: { lane, nextId, nextGroup } }
	if (mapGen > 0) handoff.gen = mapGen
	if (paint.bound === d.terrain) handoff.ordered = paint.order.length
	const applies = notesOf(othersApplies(d.terrain))
	if (applies) handoff.applies = applies
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

/**
 * A guest opens the host's map: as a new tab the first time, unsaved (Save is Save As there), and over its
 * session tab when the host made the map again (#1008), which drops that tab's unsent edits and history.
 */
function openHandoff(h: MapHandoff) {
	const e = engineRef.current
	if (!e) return
	const gen = h.gen ?? 0
	const first = mapGen < 0
	const old = sessionDoc()
	// An older map than the one open, or one made again after this member closed the session's tab.
	if (!first && (gen <= mapGen || !old)) return
	let snap: ReturnType<typeof fromMapData>
	try {
		snap = fromMapData(h.map)
	} catch (err) {
		setStatus(`The session's map could not be read: ${err}`, 10000)
		return
	}
	const was = e.activeDocumentId()
	// A session tab this member saved keeps its file (with the host's map in it, unsaved).
	const path = !old ? '' : was === old.id ? editor.filePath : old.meta.filePath
	if (old) old.shared = false
	try {
		e.openDocument(snap, path, old?.id)
	} catch (err) {
		if (old && e.documents.includes(old)) old.shared = true
		setStatus(`The session's map could not be opened: ${err}`, 10000)
		return
	}
	const id = e.activeDocumentId()
	if (old) {
		// A grown map's ground moved in its square: the camera and the bookmarks move with it, as on the host (Engine.growWorld).
		const shift = squareShift(old.meta.vmangos, snap.vmangos) ?? blockShift(old.meta.region, snap.region)
		if (shift) {
			const c = e.controller
			c.setView(c.target.x + shift.x, c.target.y, c.target.z + shift.z, c.yaw, c.pitch, c.distance)
			editor.bookmarks = editor.bookmarks.map((b) => ({ ...b, x: b.x + shift.x, z: b.z + shift.z }))
		}
		if (path) editor.dirty = true
		// Opening activates the tab; a member working in another stays there.
		if (was !== old.id && e.documents.some((d) => d.id === was)) e.switchDocument(was)
	}
	setSessionDoc(id)
	mapGen = gen
	sentPresence = ''
	// The edits that came before the map, made against it, wait in the syncs (`wait`) for the bind below.
	const held = early
	early = []
	for (const m of held) receiveEdit(m)
	// The held edits the map doesn't hold yet go in now. A host that sent no lane (an older Meld, a scripted
	// one) gets this member's id as one, which holds while the members stay below LANES.
	if (first) myLane = h.ids && 'lane' in h.ids ? h.ids.lane : shared.you % LANES
	const nd = sessionDoc()
	if (nd) adoptNotes(applyMapOf(nd.terrain), h.applies, shared.you, memberName)
	bindEdits(h.seq, { lane: myLane, nextId: h.ids?.nextId ?? 0, nextGroup: h.ids?.nextGroup ?? 0 }, h.ordered)
	const host = shared.peers.find((p) => p.id === HOST_ID)?.name || 'the host'
	if (first) setStatus(`Opened ${host}'s map ${h.map.name}`, 6000)
	else setStatus(`${host} made the session's map again (a revert or a grow): its tab here holds theirs now, and your edits not yet sent are gone`, 10000)
}

/** How far a map made again from `was` to `now` moved its ground, in yards: a grown client map's square starts at another tile. */
function squareShift(was: VmangosRef | null | undefined, now: VmangosRef | null | undefined): { x: number; z: number } | null {
	if (!was || !now || was.dir !== now.dir) return null
	const x = ((was.tileX ?? 0) - (now.tileX ?? 0)) * TILE_YARDS
	const z = ((was.tileY ?? 0) - (now.tileY ?? 0)) * TILE_YARDS
	return x || z ? { x, z } : null
}

function onEnded(reason: string) {
	const was = shared.role
	reset()
	if (reason) setStatus(`The session ended: ${reason}`, 10000)
	else setStatus(was === 'host' ? 'You ended the session' : 'You left the session', 6000)
}

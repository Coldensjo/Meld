// Presence in a shared session (#1004, docs/architecture/session.md): where each member's camera is and,
// while they hold a brush tool over the ground, their brush circle, so two people don't sculpt the same
// hill unknowingly. Not map content: no replay, no History; each member keeps the latest message per
// member and sends its own only when it changed, a few times a second. Kept free of the bindings and
// three.js so a Bun test can check it (`PresenceView` draws it).

/** The kind of a message carrying a member's presence (data: `PresenceData`, or `{}` while away). */
export const KIND_PRESENCE = 'presence'

/** How often a member's presence is compared and sent when it changed, in ms (about 7 Hz). */
export const PRESENCE_MS = 150

/** A member's brush circle on the ground: its centre, its radius in yards and whether it is square. */
export interface PresenceBrush {
	x: number
	z: number
	r: number
	square: boolean
}

/** A member's presence on the session's map. */
export interface Presence {
	/** The 3D camera's position, and the way it looks (a unit vector). */
	cam: [number, number, number]
	dir: [number, number, number]
	/** The camera's view as the controller holds it (the point it looks at, its angles and distance): Fly to a member takes it. */
	t: [number, number, number]
	yaw: number
	pitch: number
	d: number
	/** The tool the member holds (`ToolId`). */
	tool: string
	/** The brush circle as drawn on the member's screen, absent while it is off the ground or the tool has none. */
	b?: [number, number, number, number]
}

/** A `presence` message's data: a `Presence`, or `{}` while the member is in another tab than the session's map (away). */
export type PresenceData = Presence | Record<string, never>

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const vec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(finite)

/** A message's data as a presence, or null for an away or broken one. */
export function readPresence(data: unknown): Presence | null {
	const p = data as Partial<Presence> | null
	if (!p || !vec3(p.cam) || !vec3(p.dir) || !vec3(p.t) || !finite(p.yaw) || !finite(p.pitch) || !finite(p.d)) return null
	if (p.b !== undefined && !(Array.isArray(p.b) && p.b.length === 4 && p.b.every(finite) && p.b[2] > 0)) return null
	return { cam: p.cam, dir: p.dir, t: p.t, yaw: p.yaw, pitch: p.pitch, d: p.d, tool: typeof p.tool === 'string' ? p.tool : '', b: p.b }
}

/** The brush of presence `p`, or null for none. */
export function brushOf(p: Presence): PresenceBrush | null {
	return p.b ? { x: p.b[0], z: p.b[1], r: p.b[2], square: p.b[3] === 1 } : null
}

/** Rounds to a hundredth of a yard (or of a radian), which no marker shows, so a still camera's float noise sends nothing. */
const r2 = (v: number) => Math.round(v * 100) / 100

type Vec = { x: number; y: number; z: number }

/** Builds a presence with its numbers rounded, from the camera (where it is and the way it looks), the controller's view, the tool and the brush (null for none). */
export function makePresence(cam: { pos: Vec; dir: Vec }, view: { target: Vec; yaw: number; pitch: number; distance: number }, tool: string, brush: PresenceBrush | null): Presence {
	const p: Presence = {
		cam: [r2(cam.pos.x), r2(cam.pos.y), r2(cam.pos.z)],
		dir: [r2(cam.dir.x), r2(cam.dir.y), r2(cam.dir.z)],
		t: [r2(view.target.x), r2(view.target.y), r2(view.target.z)],
		yaw: r2(view.yaw),
		pitch: r2(view.pitch),
		d: r2(view.distance),
		tool,
	}
	if (brush) p.b = [r2(brush.x), r2(brush.z), r2(brush.r), brush.square ? 1 : 0]
	return p
}

/** A key that changes when anything a marker or Fly to shows changes: the send compares it with the last one sent. */
export function presenceKey(p: Presence | null): string {
	return p ? JSON.stringify(p) : 'away'
}

/** One colour each for up to 16 members (`LANES`), by member id: the marker's, the ring's and the chip's. */
const COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#22b8cf', '#f06595', '#94d82d', '#845ef7', '#20c997', '#fab005', '#5c7cfa', '#e599f7', '#ffa8a8', '#a9e34b']

/** The colour of member `id` (CSS hex). */
export function memberColor(id: number): string {
	return COLORS[(((id - 1) % COLORS.length) + COLORS.length) % COLORS.length]
}

/** The others' latest presence, by member. Messages come in the host's order, so the latest is the last one received. */
export class PresenceBook {
	private byId = new Map<number, Presence>()
	/** The map each presence was sent on (`editGen`, #1008): a grown map's ground is shifted. */
	private gens = new Map<number, number>()
	/** Counts every change, so a view redraws only after one. */
	version = 0

	/** Takes member `from`'s message `data`, sent on map generation `gen`: its presence, or away (`{}`), which drops its marker. */
	receive(from: number, data: unknown, gen = 0) {
		const p = readPresence(data)
		if (!p) return this.drop(from)
		this.byId.set(from, p)
		this.gens.set(from, gen)
		this.version++
	}

	/** Drops the presences sent on another map than generation `gen` (the host made the map again since): their members send theirs again on the new map. */
	keepGen(gen: number) {
		for (const [id, g] of [...this.gens]) if (g !== gen) this.drop(id)
	}

	/** Drops the members that are not in `ids` any more (a `session.peers` message). */
	keep(ids: Iterable<number>) {
		const has = new Set(ids)
		for (const id of [...this.byId.keys()]) if (!has.has(id)) this.drop(id)
	}

	drop(id: number) {
		this.gens.delete(id)
		if (this.byId.delete(id)) this.version++
	}

	clear() {
		this.gens.clear()
		if (!this.byId.size) return
		this.byId.clear()
		this.version++
	}

	get(id: number): Presence | undefined {
		return this.byId.get(id)
	}

	entries(): IterableIterator<[number, Presence]> {
		return this.byId.entries()
	}

	get size() {
		return this.byId.size
	}
}
